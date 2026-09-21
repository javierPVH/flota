import { useState } from 'react'
import { Camera, FileText, Trash2 } from 'lucide-react'
import { Button, SelectField, TextAreaField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createIncident, uploadDocument } from '../api.ts'
import { DEFAULT_PRIORITY, priorityOptions } from '../incidentPriority.ts'
import {
  DEFAULT_INCIDENT_TYPE,
  INCIDENT_TYPES,
  attachmentDocType,
  type IncidentKind,
} from '../incidentTypes.ts'
import type { IncidentInput } from '../api.ts'
import { fmtKm, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { enqueueIncidentWithFiles, isNetworkError, newClientRef, safeEnqueue } from '../offline/queue.ts'
import { compressImages } from '../offline/images.ts'
import type { Vehicle } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

/** Recorrido del parte: qué pasa · [lo suyo] · qué lo prueba · dónde se arregla.
 *
 * El paso del medio lo pone el tipo: el **parte de neumáticos** tiene el suyo
 * (km, motivo, ruedas y medidas — en el primer paso eran diez campos de scroll)
 * y la **avería** y el **mantenimiento puntual** preguntan cómo queda el coche.
 * La petición general no tiene ninguno: va derecha a los documentos. */
type Step = 'launch' | 'tires' | 'availability' | 'docs' | 'manage'

/** Cómo queda el coche según quien lo conduce. NO cambia el estado del
 * vehículo —eso lo decide la gestión—; pedir sustitución abre su solicitud. */
const AVAILABILITY = ['active', 'stopped', 'substitute'] as const
type Availability = (typeof AVAILABILITY)[number]

function stepsFor(kind: IncidentKind): Step[] {
  if (kind === 'tires') return ['launch', 'tires', 'docs', 'manage']
  if (kind === 'breakdown' || kind === 'maintenance') {
    return ['launch', 'availability', 'docs', 'manage']
  }
  return ['launch', 'docs', 'manage']
}

/** Un adjunto y SU referencia: se genera al elegir el archivo, no al enviar,
 * para que un reintento (o el reenvío de la cola) no lo suba dos veces. */
interface Attachment {
  file: File
  ref: string
}

/** Nota con la que se archiva la documentación del coche de sustitución. Es
 * DATO (viaja al back y se lee en la ficha), no interfaz: va fija en
 * castellano como el resto de lo que escribe el servidor. */
const SUBSTITUTE_DOC_NOTE = 'Documentación del coche de sustitución facilitado al conductor.'

/** Caja de adjuntar con su lista y su papelera. Son dos en el paso de
 * documentos —lo que prueba la incidencia y, si ya lo han dado, los papeles
 * del coche de sustitución—, y las dos se manejan igual. */
function AttachBox({
  label,
  removeLabel,
  files,
  onAdd,
  onRemove,
  selectedLabel,
}: {
  label: string
  removeLabel: (name: string) => string
  files: Attachment[]
  onAdd: (files: Attachment[]) => void
  onRemove: (ref: string) => void
  selectedLabel: (n: number) => string
}) {
  return (
    <>
      <label className={`photo-attach${files.length > 0 ? ' has-file' : ''}`}>
        <Camera size={18} aria-hidden />
        {files.length > 0 ? selectedLabel(files.length) : label}
        <input
          type="file"
          aria-label={label}
          accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
          multiple
          onChange={async (event) => {
            const input = event.target
            const picked = Array.from(input.files ?? [])
            // Se limpia el input: si no, volver a elegir el MISMO archivo (lo
            // normal al equivocarse y repetir) no dispara `change` y parecería
            // que no ha pasado nada.
            input.value = ''
            const ready = await compressImages(picked)
            onAdd(ready.map((file) => ({ file, ref: newClientRef() })))
          }}
        />
      </label>
      {files.length > 0 && (
        <ul className="doc-list">
          {files.map(({ file, ref }) => (
            <li key={ref} className="doc-item">
              <FileText size={18} aria-hidden className="doc-icon" />
              <div className="doc-info">
                <strong>{file.name}</strong>
              </div>
              <button
                type="button"
                className="doc-remove"
                aria-label={removeLabel(file.name)}
                onClick={() => onRemove(ref)}
              >
                <Trash2 size={18} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** Incidencia unificada en tres pasos. Los tipos que ofrece son los MISMOS que
 * gestión (`src/incidentTypes.ts`), y neumáticos usa exactamente el parte
 * guiado de Gestión (`report_version: 1`) y sus mismos nombres de campo. */
export function BreakdownModal({
  vehicle,
  kmCurrent,
  kmEstimated,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  /** Odómetro conocido del coche (del resumen): precarga «Kilometraje actual»
   * del parte de neumáticos — en campo nadie se baja a mirar el cuadro para
   * repetir un dato que ya tenemos. Queda editable: manda lo que se vea. */
  kmCurrent?: number | null
  /** R3-42: la lectura precargada es una ESTIMACIÓN (N8b) — la pista avisa. */
  kmEstimated?: boolean
  onClose: () => void
  onSaved?: () => void
}) {
  const { t, language } = useLang()
  const n = t.newIncident
  const b = t.breakdown
  const [step, setStep] = useState<Step>('launch')
  const [cameBack, setCameBack] = useState(false)
  const [kind, setKind] = useState<IncidentKind>(DEFAULT_INCIDENT_TYPE)
  // Prioridad de la petición: la marca quien la abre (gestión tría por ella).
  const [priority, setPriority] = useState<string>(DEFAULT_PRIORITY)
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  // Paso «Documentos»: varios archivos (la foto del daño Y el presupuesto del
  // taller, que no se hace con la cámara). Opcional: se puede enviar sin nada.
  const [files, setFiles] = useState<Attachment[]>([])
  // Segunda caja del mismo paso, solo al pedir coche de sustitución: los
  // papeles del que ya le hayan dado (permiso, ficha técnica, seguro…).
  // Opcionales de verdad: lo normal al comunicar es no tener coche todavía.
  const [substituteFiles, setSubstituteFiles] = useState<Attachment[]>([])

  // Parte guiado de neumáticos: mismos campos que Gestión.
  const [mileage, setMileage] = useState(kmCurrent != null ? String(kmCurrent) : '')
  const [changeReason, setChangeReason] = useState('')
  const [wheelScope, setWheelScope] = useState('front')
  const [frontMeasure, setFrontMeasure] = useState('')
  const [rearMeasure, setRearMeasure] = useState('')
  const [wheel, setWheel] = useState('front_left')
  const [tireMeasure, setTireMeasure] = useState('')

  // Paso «Disponibilidad»: nace en «sigue en servicio», que es el caso normal
  // (una avería no para el coche por sí sola — mismo criterio que gestión).
  const [availability, setAvailability] = useState<Availability>('active')

  // Segunda fase: gestión, igual que Avería.
  const [managementPostalCode, setManagementPostalCode] = useState('')
  const [saving, setSaving] = useState(false)
  // R5-50: UNA referencia por captura, no por pulsación: el reintento manual
  // tras un 502/504 manda la misma y el back no duplica. El modal se remonta al
  // cerrarse, así que la siguiente petición estrena otra (los adjuntos llevan
  // la suya desde que se eligen).
  const [incidentRef] = useState(newClientRef)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const tiresValid = Boolean(
    mileage && changeReason &&
    (changeReason === 'wear'
      ? wheelScope &&
        ((wheelScope !== 'front' && wheelScope !== 'all') || frontMeasure.trim()) &&
        ((wheelScope !== 'rear' && wheelScope !== 'all') || rearMeasure.trim())
      : changeReason === 'puncture' && wheel && tireMeasure.trim()),
  )
  // El comentario del parte de neumáticos es opcional; el resto se cuenta.
  const launchValid = Boolean(kind === 'tires' || description.trim())
  // Lo ÚNICO que se exige al pedir coche de sustitución: algún documento que lo
  // justifique (uno o varios). Sin pedirlo, los adjuntos siguen siendo libres.
  const needsDocument = availability === 'substitute' && stepsFor(kind).includes('availability')
  const docsValid = !needsDocument || files.length > 0
  const managementValid = /^[0-9]{5}$/.test(managementPostalCode)
  const steps = stepsFor(kind)
  const current = steps.indexOf(step)
  const nextStep = steps[current + 1]
  const previousStep = steps[current - 1]
  const stepValid: Record<Step, boolean> = {
    launch: launchValid,
    tires: tiresValid,
    availability: true,
    docs: docsValid,
    manage: managementValid,
  }

  function goTo(next: Step) {
    setCameBack(steps.indexOf(next) < current)
    setStep(next)
    setError('')
  }

  function tireDetails(): Record<string, unknown> {
    const details: Record<string, unknown> = {
      report_version: 1,
      change_reason: changeReason,
    }
    if (changeReason === 'wear') {
      details.wheel_scope = wheelScope
      if (wheelScope === 'front' || wheelScope === 'all') details.front_measure = frontMeasure.trim()
      if (wheelScope === 'rear' || wheelScope === 'all') details.rear_measure = rearMeasure.trim()
    } else {
      details.wheel = wheel
      details.tire_measure = tireMeasure.trim()
    }
    return details
  }

  async function handleSend() {
    setSaving(true)
    setError('')
    const guided: Record<string, unknown> = {
      ...(kind === 'tires' ? tireDetails() : {}),
      // Cómo queda el coche, tal y como lo cuenta quien conduce: es dato de la
      // petición, no una orden. Con «substitute» el back abre además la
      // solicitud de coche en la bandeja de administración.
      ...(steps.includes('availability') ? { availability } : {}),
    }
    const payload: IncidentInput & { client_ref: string } = {
      vehicle: vehicle.id,
      type: kind,
      priority,
      date,
      description: description.trim(),
      workshop_postal_code: managementPostalCode,
      ...(kind === 'tires' ? {
        mileage: Number(mileage),
      } : {}),
      ...(Object.keys(guided).length > 0 ? { details: guided } : {}),
      // R3-34: misma referencia en el intento directo y en el reenvío offline.
      client_ref: incidentRef,
    }
    // El tipo del documento lo decide lo que se comunica, no el formulario, y
    // la regla es UNA para las dos puertas de alta de la PWA (esta y
    // `NewIncidentPage`): vive en `incidentTypes.ts`.
    const uploads = [
      ...files.map(({ file, ref }) => ({
        file,
        type: attachmentDocType(kind),
        client_ref: ref,
        notes: '',
      })),
      // Los del coche de sustitución van como «Otro» y con su nota: no son
      // papeles del coche de la incidencia —el sustituto puede no existir aún
      // en la flota—, pero cuelgan de la petición, que es donde se tramita.
      ...(needsDocument ? substituteFiles : []).map(({ file, ref }) => ({
        file,
        type: 'other',
        client_ref: ref,
        notes: SUBSTITUTE_DOC_NOTE,
      })),
    ]
    try {
      const incident = await createIncident(payload)
      // Con sustitución pedida, lo que hay que saber es que la solicitud queda
      // en manos de administración: el coche no llega por comunicarlo.
      let notice = needsDocument ? b.savedRequest : b.saved
      for (const upload of uploads) {
        const docPayload = {
          vehicle: vehicle.id,
          incident: incident.id,
          type: upload.type,
          client_ref: upload.client_ref,
          ...(upload.notes ? { notes: upload.notes } : {}),
        }
        try {
          await uploadDocument(docPayload, upload.file)
        } catch (err) {
          // R3-27: sin red, el adjunto va a la cola de documentos (que ya sabe
          // reenviarlo) en vez de quedarse en un aviso y no llegar nunca.
          if (
            isNetworkError(err) &&
            (await safeEnqueue({
              kind: 'document',
              payload: docPayload,
              file: upload.file,
              fileName: upload.file.name,
              fileType: upload.file.type,
            }))
          ) {
            notice = b.savedUploadQueued
          } else {
            notice = b.savedUploadFailed
          }
        }
      }
      setDone(notice)
      onSaved?.()
    } catch (err) {
      // R3-27: sin cobertura, el parte ENTERO (con su adjunto) queda en la
      // cola en vez de perderse el formulario al cerrar.
      if (isNetworkError(err) && (await enqueueIncidentWithFiles(payload, uploads))) {
        setDone(b.queued)
        onSaved?.()
      } else {
        setError(asErrorMessage(err, t.incidentModal.error))
      }
    } finally {
      setSaving(false)
    }
  }

  const stepLabels: Record<Step, string> = {
    launch: t.shell.tabs.breakdown,
    tires: b.stepTires,
    availability: b.stepAvailability,
    docs: b.stepDocs,
    manage: b.stepManage,
  }

  return (
    <SupervisorModal
      open
      // Tres pasos y un parte de neumáticos con rejillas de dos columnas: con
      // el ancho de serie se leía estrecho en tableta.
      wide
      title={b.title(vehicle.plate)}
      onClose={onClose}
      // El pie es el mismo en todos los pasos: se sale por la izquierda y se
      // avanza por la derecha, y solo el último envía. «Continuar» exige lo
      // obligatorio del paso que se deja (los adjuntos solo lo son si se pide
      // coche de sustitución).
      footer={done ? (
        <Button type="button" onClick={onClose}>{t.incidentModal.close}</Button>
      ) : (
        <>
          {previousStep === undefined ? (
            <Button type="button" onClick={onClose}>{t.incidentModal.close}</Button>
          ) : (
            <Button type="button" onClick={() => goTo(previousStep)}>{b.back}</Button>
          )}
          {nextStep === undefined ? (
            <Button type="button" onClick={handleSend} disabled={saving || !managementValid}>{b.submit}</Button>
          ) : (
            <Button type="button" onClick={() => goTo(nextStep)} disabled={!stepValid[step]}>{b.next}</Button>
          )}
        </>
      )}
    >
      {done ? <p className="reminder-done" role="status">{done}</p> : (
        <>
          <div className="flow-steps" aria-hidden>
            {steps.map((key, index) => (
              <span
                key={key}
                className={`flow-step${index === current ? ' is-current' : index < current ? ' is-done' : ''}`}
              >
                {stepLabels[key]}
              </span>
            ))}
          </div>
          <div key={step} className={`step-pane${cameBack ? ' from-left' : ''}`}>
            {step === 'launch' ? (
              <div className="modal-form">
                <div className="incident-grid breakdown-kind-date">
                  <SelectField
                    label={t.incidentModal.kind}
                    aria-label={t.incidentModal.kind}
                    options={INCIDENT_TYPES.map((value) => ({ value, label: t.incidentModal.kinds[value] }))}
                    value={kind}
                    onValueChange={(value) => setKind(value as IncidentKind)}
                    required
                    requiredVisual
                  />
                  <TextInputField label={t.incidentModal.date} aria-label={t.incidentModal.date} type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} required requiredVisual />
                </div>
                <SelectField
                  label={t.priority.label}
                  aria-label={t.priority.label}
                  options={priorityOptions(t.priority)}
                  value={priority}
                  onValueChange={setPriority}
                  required
                  requiredVisual
                />
                {/* Qué es cada tipo. Sale con TODOS (antes, con «General» no):
                    son cuatro y la diferencia entre ellos es justo lo que hay
                    que acertar para que la petición llegue a quien la atiende. */}
                <p className="update-notice">{t.incidentModal.info[kind]}</p>

                {/* El parte de neumáticos tiene su propio paso: aquí solo se
                    dice QUÉ pasa. */}
                {kind !== 'tires' && (
                  <TextAreaField label={t.incidentModal.description} aria-label={t.incidentModal.description} value={description} onChange={(e) => setDescription(e.target.value)} required requiredVisual />
                )}
              </div>
            ) : step === 'tires' ? (
              <div className="modal-form">
                    <p className="update-hint">
                      {t.incidentModal.tireRequiredBase}{' '}
                      {changeReason === 'wear'
                        ? t.incidentModal.tireRequiredWear
                        : changeReason === 'puncture'
                          ? t.incidentModal.tireRequiredPuncture
                          : ''}
                    </p>
                    <TextInputField label={n.mileage} aria-label={n.mileage} type="number" min={0} value={mileage} onChange={(e) => setMileage(e.target.value)} required requiredVisual />
                    {/* De dónde sale el número que viene puesto: si el coche
                        ha rodado desde esa lectura, se corrige a mano. */}
                    {kmCurrent != null && (
                      <p className="update-hint">
                        {kmEstimated
                          ? n.mileageFromReadingEstimated(fmtKm(kmCurrent, language))
                          : n.mileageFromReading(fmtKm(kmCurrent, language))}
                      </p>
                    )}
                    <SelectField label={n.changeReason} aria-label={n.changeReason} options={[
                      { value: 'wear', label: n.wear }, { value: 'puncture', label: n.puncture },
                    ]} value={changeReason} onValueChange={setChangeReason} required requiredVisual includeSelectFlag selectFlagLabel={n.choose} />
                    {changeReason === 'wear' && <>
                      <div className="incident-grid tire-wheel-grid">
                        <SelectField label={n.whichWheels} aria-label={n.whichWheels} options={[
                          { value: 'front', label: n.front }, { value: 'rear', label: n.rear }, { value: 'all', label: n.allWheels },
                        ]} value={wheelScope} onValueChange={setWheelScope} required requiredVisual />
                        {(wheelScope === 'front' || wheelScope === 'all') && <TextInputField label={n.frontMeasure} aria-label={n.frontMeasure} placeholder="205/55 R16" value={frontMeasure} onChange={(e) => setFrontMeasure(e.target.value)} required requiredVisual />}
                        {(wheelScope === 'rear' || wheelScope === 'all') && <TextInputField label={n.rearMeasure} aria-label={n.rearMeasure} placeholder="205/55 R16" value={rearMeasure} onChange={(e) => setRearMeasure(e.target.value)} required requiredVisual />}
                      </div>
                    </>}
                    {changeReason === 'puncture' && <div className="incident-grid">
                      <SelectField label={n.whichWheel} aria-label={n.whichWheel} options={[
                        { value: 'front_left', label: n.frontLeft }, { value: 'front_right', label: n.frontRight },
                        { value: 'rear_left', label: n.rearLeft }, { value: 'rear_right', label: n.rearRight },
                      ]} value={wheel} onValueChange={setWheel} required requiredVisual />
                      <TextInputField label={n.tireMeasure} aria-label={n.tireMeasure} placeholder="205/55 R16" value={tireMeasure} onChange={(e) => setTireMeasure(e.target.value)} required requiredVisual />
                    </div>}
                    <TextAreaField label={n.comment} aria-label={n.comment} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            ) : step === 'availability' ? (
              <div className="modal-form">
                {/* Lo que se dice aquí NO mueve el coche de estado: eso lo hace
                    la gestión. Pedir sustitución abre una solicitud, y es lo
                    único que obliga a adjuntar algo (paso siguiente). */}
                <p className="update-hint">{b.availabilityHint}</p>
                <fieldset className="choice-group">
                  <legend>{b.availabilityLabel}</legend>
                  {AVAILABILITY.map((value) => (
                    <label
                      key={value}
                      className={`choice-card${availability === value ? ' is-active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="incident-availability"
                        value={value}
                        checked={availability === value}
                        onChange={() => setAvailability(value)}
                      />
                      <span>
                        <strong>{b.availability[value]}</strong>
                        <small>{b.availabilityNotes[value]}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </div>
            ) : step === 'docs' ? (
              <div className="modal-form">
                {/* Con coche de sustitución pedido, el adjunto deja de ser
                    opcional: es lo único que se exige para tramitarla. */}
                <p className={needsDocument ? 'update-notice' : 'update-hint'}>
                  {needsDocument ? b.docsRequired : b.docsHint}
                </p>
                <AttachBox
                  label={t.incidentModal.attach}
                  removeLabel={b.removeFile}
                  selectedLabel={n.attachmentsSelected}
                  files={files}
                  onAdd={(added) => setFiles((current) => [...current, ...added])}
                  onRemove={(ref) => setFiles((current) => current.filter((item) => item.ref !== ref))}
                />
                {/* Si el taller o la empresa ya le han dado un coche mientras
                    se tramita, sus papeles se suben aquí y quedan con la
                    petición. Es opcional: lo normal es no tenerlo todavía. */}
                {needsDocument && (
                  <section className="incident-section" aria-labelledby="substitute-docs-title">
                    <h2 id="substitute-docs-title">{b.substituteDocsTitle}</h2>
                    <p className="update-hint">{b.substituteDocsHint}</p>
                    <AttachBox
                      label={b.substituteAttach}
                      removeLabel={b.removeFile}
                      selectedLabel={n.attachmentsSelected}
                      files={substituteFiles}
                      onAdd={(added) => setSubstituteFiles((current) => [...current, ...added])}
                      onRemove={(ref) =>
                        setSubstituteFiles((current) => current.filter((item) => item.ref !== ref))
                      }
                    />
                  </section>
                )}
              </div>
            ) : (
              <div className="modal-form">
                <p className="update-hint">{b.workshopHint}</p>
                <TextInputField label={b.preferredPostalCode} aria-label={b.preferredPostalCode} inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={managementPostalCode} onChange={(e) => setManagementPostalCode(e.target.value)} required requiredVisual />
              </div>
            )}
            {error && <div role="alert" className="form-error">{error}</div>}
          </div>
        </>
      )}
    </SupervisorModal>
  )
}
