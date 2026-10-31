import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, FileQuestion, Paperclip, Upload } from 'lucide-react'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { listIncidents, requestDocumentSupply, uploadDocument } from '../api.ts'
import { useAuth } from '../auth.ts'
import {
  REQUESTABLE_DOCUMENT_TYPES,
  REQUESTABLE_PERSONAL_DOCUMENT_TYPES,
  documentExpires,
  documentLinkRequired,
  incidentTypeRequiredBy,
  linkableIncidents,
} from '../documentRules.ts'
import { fmtDate } from '../format.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { useLang } from '../i18n.tsx'
import { isNetworkError, newClientRef, safeEnqueue } from '../offline/queue.ts'
import type { Incident, Vehicle } from '../types.ts'
import {
  MODAL_ASK_STEPS,
  MODAL_UPLOAD_STEPS,
  type DocumentMode,
  type DocumentStep,
} from '../uploadSteps.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

const DOCUMENT_TYPES = [
  'registration_certificate',
  'technical_datasheet',
  'insurance',
  'contract',
  'return_report',
  'accident_report',
  'damage_photos',
  'other',
]

/** Tipos con sentido como documento PERSONAL (la misma lista cerrada del back
 * que usa «Mis documentos»: el permiso de conducir y «Otro»). */
const PERSONAL_TYPES = ['driving_license', 'other']

/** De quién es lo que se sube: del coche o de la persona que lo conduce. */
type Owner = 'vehicle' | 'driver'

/**
 * Documentos desde la ficha, con el vehículo fijado. El mismo botón hace
 * **dos cosas**, y por eso el primer paso es la bifurcación:
 *
 * - **subir** uno que se tiene (el recorrido de siempre);
 * - **pedir** el que falta, que es lo que no tenía camino: un conductor solo
 *   podía hablar de un documento que ya existía Y que ya veía (borrarlo,
 *   corregirlo, abrir su archivo), así que «necesito el contrato de mi coche
 *   y no está» —o está y su tipo está cerrado al conductor, con lo que ni se
 *   lista— salía de la herramienta por teléfono y no dejaba rastro.
 *
 * En las dos ramas se pregunta primero **de quién es** el documento: los
 * papeles del coche cuelgan de la matrícula (`vehicle`) y pueden ir ligados a
 * una incidencia; el permiso de conducir es de la **persona** (`user`, la
 * carpeta `Usuarios/<correo>` del archivador) y no lleva incidencia, así que
 * con él el paso «Ligado a» desaparece.
 */
export function UploadDocumentModal({
  vehicle,
  driver = null,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  /** Conductor vigente del coche (el `driver` del resumen): el titular de un
   * documento personal cuando quien sube es quien supervisa. Sin él, la
   * persona es quien está usando la app, si conduce. */
  driver?: { id: number; name: string } | null
  onClose: () => void
  onSaved?: () => void
}) {
  const { t } = useLang()
  const { user } = useAuth()
  const etiqueta = useDomainLabels()
  const doc = t.vehicle
  const copy = t.uploadDoc
  // A quién se le cuelga un documento personal: al conductor del coche y, si
  // el resumen no lo trae, a quien está subiendo (si conduce).
  const personalTarget =
    driver ??
    (user && user.roles.includes('driver')
      ? {
          id: user.id,
          name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username,
        }
      : null)
  // Pedir es SIEMPRE para uno mismo (el back lo exige): el supervisor pide los
  // papeles del coche, no el permiso de conducir de su conductor.
  const askTarget =
    user && user.roles.includes('driver')
      ? {
          id: user.id,
          name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username,
        }
      : null
  const [mode, setMode] = useState<DocumentMode | null>(null)
  const [owner, setOwner] = useState<Owner>('vehicle')
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [form, setForm] = useState({ type: 'other', expiry_date: '', incident: '', notes: '' })
  const [file, setFile] = useState<File | null>(null)
  // Lo que se pide: qué papel y para qué (los dos obligatorios).
  const [ask, setAsk] = useState({ type: '', note: '' })
  const [step, setStep] = useState<DocumentStep>('mode')
  const [cameBack, setCameBack] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    listIncidents(vehicle.id)
      .then((page) => setIncidents(page.results))
      .catch(() => setIncidents([]))
  }, [vehicle.id])

  // Qué pide el formulario según el tipo (mismas reglas que el back): la
  // caducidad solo a lo que caduca; el parte de accidente, un accidente abierto.
  const expires = documentExpires(form.type)
  const boundTo = incidentTypeRequiredBy(form.type)
  // Obligatorio también para las fotos de daños (son las fotos DE una incidencia).
  const linkRequired = documentLinkRequired(form.type)
  const linkable = linkableIncidents(incidents, form.type)

  function changeType(value: string) {
    setForm((current) => ({
      ...current,
      type: value,
      expiry_date: documentExpires(value) ? current.expiry_date : '',
      incident: linkableIncidents(incidents, value).some((row) => String(row.id) === current.incident)
        ? current.incident
        : '',
    }))
  }

  /** Cambiar de titular cambia el catálogo de tipos: se vuelve a «Otro», que
   * está en los dos, y se suelta la incidencia (un personal no la lleva). */
  function changeOwner(value: string) {
    const next: Owner = value === 'driver' && personalTarget ? 'driver' : 'vehicle'
    setOwner(next)
    setForm((current) => ({ ...current, type: 'other', expiry_date: '', incident: '' }))
  }

  /** Lo mismo en la rama de pedir, donde el catálogo también depende del
   * titular: nadie pide «su» póliza de seguro, que esa es del coche. */
  function changeAskOwner(value: string) {
    const next: Owner = value === 'driver' && askTarget ? 'driver' : 'vehicle'
    setOwner(next)
    setAsk((current) => ({ ...current, type: '' }))
  }

  function reset() {
    setDone('')
    setError('')
    setFile(null)
    setMode(null)
    setOwner('vehicle')
    setForm({ type: 'other', expiry_date: '', incident: '', notes: '' })
    setAsk({ type: '', note: '' })
    setStep('mode')
  }

  const personal = owner === 'driver'
  const types = personal ? PERSONAL_TYPES : DOCUMENT_TYPES
  const askTypes = personal ? REQUESTABLE_PERSONAL_DOCUMENT_TYPES : REQUESTABLE_DOCUMENT_TYPES
  const asking = mode === 'ask'
  // Un documento personal no se liga a nada: su recorrido se salta «Ligado a».
  const steps: readonly DocumentStep[] = asking
    ? MODAL_ASK_STEPS
    : personal
      ? ['mode', 'file', 'notes']
      : MODAL_UPLOAD_STEPS

  // Lo que exige cada paso para dejar pasar al siguiente. El vínculo es el
  // único que puede quedarse sin salida: un parte de accidente sin accidente
  // abierto no se puede subir, y ahí lo que hay que hacer es decirlo.
  const stepValid: Record<DocumentStep, boolean> = {
    mode: mode !== null,
    file: Boolean(file),
    link: personal || !linkRequired || Boolean(form.incident),
    notes: true,
    ask: Boolean(ask.type) && ask.note.trim().length > 0,
  }
  const current = steps.indexOf(step)
  const nextStep = steps[current + 1]
  const previousStep = steps[current - 1]
  const stepLabels: Record<DocumentStep, string> = {
    mode: copy.stepMode,
    file: copy.stepFile,
    link: copy.stepLink,
    notes: copy.stepNotes,
    ask: copy.stepAsk,
  }

  function goTo(next: DocumentStep) {
    setCameBack(steps.indexOf(next) < current)
    setStep(next)
    setError('')
  }

  /** Elegir qué se viene a hacer avanza: es una bifurcación, no un campo. */
  function chooseMode(value: DocumentMode) {
    setMode(value)
    setOwner('vehicle')
    setCameBack(false)
    setStep(value === 'ask' ? 'ask' : 'file')
    setError('')
  }

  /** Intro: antes del último paso avanza, no envía. */
  function onFormSubmit(event: FormEvent) {
    event.preventDefault()
    if (nextStep !== undefined) {
      if (stepValid[step]) goTo(nextStep)
      return
    }
    if (asking) void handleAsk(event)
    else void handleSubmit(event)
  }

  /** Pedir el documento que falta. No sube nada ni cambia nada: abre la
   * solicitud que decide administración. */
  async function handleAsk(event: FormEvent) {
    event.preventDefault()
    if (!ask.type) return
    if (!ask.note.trim()) {
      setError(copy.askNoteRequired)
      return
    }
    setSaving(true)
    setError('')
    const titular = personal && askTarget ? { user: askTarget.id } : { vehicle: vehicle.id }
    try {
      await requestDocumentSupply({ ...titular, type: ask.type, note: ask.note.trim() })
      setDone(copy.askSaved)
      onSaved?.()
    } catch (caught) {
      // A propósito, sin cola offline: una petición no es un registro de campo
      // que se pierda si no hay cobertura — se vuelve a intentar.
      setError(asErrorMessage(caught, copy.askError))
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!file) {
      setError(doc.chooseFile)
      return
    }
    if (!personal && linkRequired && !form.incident) {
      setError(boundTo ? doc.linkAccidentRequired : doc.linkIncidentRequired)
      return
    }
    setSaving(true)
    setError('')
    // Titular único, como exige el back: el coche O la persona.
    const titular = personal && personalTarget ? { user: personalTarget.id } : { vehicle: vehicle.id }
    const payload = {
      ...titular,
      type: form.type,
      expiry_date: form.expiry_date || null,
      incident: !personal && form.incident ? Number(form.incident) : null,
      notes: form.notes,
      // R3-34: misma referencia en el intento directo y en el reenvío offline.
      client_ref: newClientRef(),
    }
    try {
      const created = await uploadDocument(payload, file)
      setDone(created.status === 'pending_archive' ? doc.uploadOkPending : doc.uploadOkArchived)
      onSaved?.()
    } catch (caught) {
      if (
        isNetworkError(caught) &&
        (await safeEnqueue({ kind: 'document', payload, file, fileName: file.name, fileType: file.type }))
      ) {
        setDone(doc.uploadOffline)
        onSaved?.()
      } else {
        setError(asErrorMessage(caught, doc.uploadError))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <SupervisorModal
      open
      title={`${copy.titleBoth} · ${vehicle.plate}`}
      onClose={onClose}
      footer={done ? (
        <>
          <Button type="button" variant="secondary" onClick={reset}>
            {asking ? copy.askAnother : copy.another}
          </Button>
          <Button type="button" onClick={onClose}>{t.carUpdate.close}</Button>
        </>
      ) : (
        <>
          {previousStep === undefined ? (
            <Button type="button" variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
          ) : (
            <Button type="button" onClick={() => goTo(previousStep)}>{t.breakdown.back}</Button>
          )}
          {nextStep === undefined ? (
            <Button
              type="button"
              onClick={(event) => void (asking ? handleAsk(event) : handleSubmit(event))}
              disabled={
                saving ||
                (asking
                  ? !stepValid.ask
                  : !personal && Boolean(boundTo) && linkable.length === 0)
              }
            >
              {asking
                ? saving ? copy.askSubmitting : copy.askSubmit
                : saving ? doc.uploadSubmitting : copy.submit}
            </Button>
          ) : (
            <Button type="button" onClick={() => goTo(nextStep)} disabled={!stepValid[step]}>
              {t.breakdown.next}
            </Button>
          )}
        </>
      )}
    >
      {done ? (
        <div className="km-saved">
          <CheckCircle2 size={52} aria-hidden className="km-saved-icon" />
          <h2>{asking ? copy.askSavedTitle : copy.savedTitle}</h2>
          <p className="km-saved-detail" role="status">{done}</p>
        </div>
      ) : (
        <form className="modal-form" onSubmit={onFormSubmit}>
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
          {step === 'mode' && <>
          {/* La bifurcación: dos cosas distintas que comparten botón, porque
              quien llega aquí viene a hacer una u otra con el mismo papel. */}
          <p className="update-hint">{copy.modeLabel}</p>
          <div className="mode-choice">
            {([
              { key: 'upload' as const, icon: Upload, label: copy.modeUpload, hint: copy.modeUploadHint },
              { key: 'ask' as const, icon: FileQuestion, label: copy.modeAsk, hint: copy.modeAskHint },
            ]).map(({ key, icon: Icon, label, hint }) => (
              <button
                key={key}
                type="button"
                className={`mode-option${mode === key ? ' is-active' : ''}`}
                onClick={() => chooseMode(key)}
              >
                <Icon size={24} aria-hidden />
                <span className="mode-option-label">{label}</span>
                <span className="mode-option-hint">{hint}</span>
              </button>
            ))}
          </div>
          </>}

          {step === 'ask' && <>
          {/* Pedir: de quién es, qué papel hace falta y para qué. Son tres
              preguntas cortas, así que caben en una pantalla. */}
          {askTarget && (
            <>
              <SelectField
                label={copy.owner}
                required
                options={[
                  { value: 'vehicle', label: copy.ownerVehicle(vehicle.plate) },
                  { value: 'driver', label: copy.ownerDriver(askTarget.name) },
                ]}
                value={owner}
                onValueChange={changeAskOwner}
              />
              <p className="update-hint">{copy.askOwnerHint}</p>
            </>
          )}
          <SelectField
            label={copy.askType}
            required
            requiredVisual
            options={[
              { value: '', label: copy.askTypeChoose },
              ...askTypes.map((value) => ({ value, label: doc.docTypes[value] ?? value })),
            ]}
            value={ask.type}
            onValueChange={(value) => setAsk((current) => ({ ...current, type: value }))}
          />
          <TextInputField
            label={copy.askNote}
            required
            requiredVisual
            value={ask.note}
            onChange={(event) => setAsk((current) => ({ ...current, note: event.target.value }))}
          />
          <p className="update-hint">{copy.askNoteHint}</p>
          </>}

          {step === 'file' && <>
          {/* De quién es: solo se pregunta si hay una persona a la que
              colgárselo (el conductor del coche, o quien sube si conduce). */}
          {personalTarget && (
            <>
              <SelectField
                label={copy.owner}
                options={[
                  { value: 'vehicle', label: copy.ownerVehicle(vehicle.plate) },
                  { value: 'driver', label: copy.ownerDriver(personalTarget.name) },
                ]}
                value={owner}
                onValueChange={changeOwner}
                // Siempre tiene valor: sin `required`, el SelectField del DS
                // añade la opción «-- Ignorar --», que aquí no significa nada.
                required
              />
              <p className="update-hint">{copy.ownerHint}</p>
            </>
          )}
          <SelectField
            label={doc.docType}
            options={types.map((value) => ({ value, label: doc.docTypes[value] ?? value }))}
            value={form.type}
            onValueChange={changeType}
            required
          />
          <div className="file-block">
            <span className="file-block-label">
              {doc.filePick} <span className="req-badge" aria-hidden>{t.common.required}</span>
            </span>
            {/* La misma caja de adjuntar del resto de la app (pulgar-friendly),
                no el «Seleccionar archivo» del sistema. */}
            <label className={`photo-attach${file ? ' has-file' : ''}`}>
              <Paperclip size={18} aria-hidden />
              {file ? file.name : doc.filePick}
              <input
                type="file"
                aria-label={doc.filePick}
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          {expires && (
            <TextInputField
              label={doc.expiry}
              type="date"
              value={form.expiry_date}
              onChange={(event) => setForm((current) => ({ ...current, expiry_date: event.target.value }))}
            />
          )}
          </>}

          {step === 'link' && <>
          {/* De qué es el documento. Con tipos que no llevan nada (la póliza,
              el permiso de circulación…) el paso lo dice en vez de quedarse en
              blanco: no se recorre un paso vacío sin saber por qué. */}
          <p className="update-hint">
            {linkRequired || linkable.length > 0 ? copy.linkHint : copy.linkNothing}
          </p>
          {linkRequired ? (
            linkable.length > 0 ? (
              <SelectField
                label={boundTo ? doc.linkAccident : doc.linkIncidentOpen}
                required
                requiredVisual
                options={[
                  { value: '', label: boundTo ? doc.linkChoose : doc.linkChooseIncident },
                  ...linkable.map((incident) => ({
                    value: String(incident.id),
                    label: `#${incident.id} · ${etiqueta.incidentType(incident)}${incident.date ? ` (${fmtDate(incident.date)})` : ''}`,
                  })),
                ]}
                value={form.incident}
                onValueChange={(value) => setForm((current) => ({ ...current, incident: value }))}
              />
            ) : (
              <p className="form-error" role="status">
                {boundTo ? doc.noOpenAccident : doc.noOpenIncident}
              </p>
            )
          ) : (
            linkable.length > 0 && (
              // Opcional: la opción «ninguna» lleva centinela, porque un
              // `<select required>` con la opción vacía no pasa la validación
              // nativa y bloqueaba el envío.
              <SelectField
                label={doc.linkIncident}
                required
                options={[
                  { value: 'none', label: doc.linkNone },
                  ...linkable.map((incident) => ({
                    value: String(incident.id),
                    label: `#${incident.id} · ${etiqueta.incidentType(incident)} · ${etiqueta.incidentStatus(incident)}${incident.date ? ` (${fmtDate(incident.date)})` : ''}`,
                  })),
                ]}
                value={form.incident || 'none'}
                onValueChange={(value) =>
                  setForm((current) => ({ ...current, incident: value === 'none' ? '' : value }))
                }
              />
            )
          )}
          </>}

          {step === 'notes' && <>
          <p className="update-hint">{copy.notesHint}</p>
          <TextInputField
            label={doc.notes}
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          />
          </>}
          {error && <div role="alert" className="form-error">{error}</div>}
          </div>
        </form>
      )}
    </SupervisorModal>
  )
}
