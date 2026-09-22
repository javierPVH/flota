import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, Paperclip } from 'lucide-react'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { listIncidents, uploadDocument } from '../api.ts'
import { useAuth } from '../auth.ts'
import {
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
import { UPLOAD_STEPS, type UploadStep } from '../uploadSteps.ts'
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
 * Subida de documentos desde la ficha, con el vehículo fijado.
 *
 * El primer paso pregunta **de quién es** el documento: los papeles del coche
 * cuelgan de la matrícula (`vehicle`) y pueden ir ligados a una incidencia;
 * el permiso de conducir es de la **persona** (`user`, la carpeta
 * `Usuarios/<correo>` del archivador) y no lleva incidencia, así que con él
 * el paso «Ligado a» desaparece. Antes desde aquí solo se subían los del
 * coche, y el permiso había que ir a buscarlo a «Mi perfil».
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
  const [owner, setOwner] = useState<Owner>('vehicle')
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [form, setForm] = useState({ type: 'other', expiry_date: '', incident: '', notes: '' })
  const [file, setFile] = useState<File | null>(null)
  // Tres pasos: qué se sube · de qué es · qué más hay que decir.
  const [step, setStep] = useState<UploadStep>('file')
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

  function reset() {
    setDone('')
    setError('')
    setFile(null)
    setOwner('vehicle')
    setForm({ type: 'other', expiry_date: '', incident: '', notes: '' })
    setStep('file')
  }

  const personal = owner === 'driver'
  const types = personal ? PERSONAL_TYPES : DOCUMENT_TYPES
  // Un documento personal no se liga a nada: su recorrido se salta «Ligado a».
  const steps: readonly UploadStep[] = personal ? ['file', 'notes'] : UPLOAD_STEPS

  // Lo que exige cada paso para dejar pasar al siguiente. El vínculo es el
  // único que puede quedarse sin salida: un parte de accidente sin accidente
  // abierto no se puede subir, y ahí lo que hay que hacer es decirlo.
  const stepValid: Record<UploadStep, boolean> = {
    file: Boolean(file),
    link: personal || !linkRequired || Boolean(form.incident),
    notes: true,
  }
  const current = steps.indexOf(step)
  const nextStep = steps[current + 1]
  const previousStep = steps[current - 1]
  const stepLabels: Record<UploadStep, string> = {
    file: copy.stepFile,
    link: copy.stepLink,
    notes: copy.stepNotes,
  }

  function goTo(next: UploadStep) {
    setCameBack(UPLOAD_STEPS.indexOf(next) < current)
    setStep(next)
    setError('')
  }

  /** Intro: antes del último paso avanza, no sube. */
  function onFormSubmit(event: FormEvent) {
    event.preventDefault()
    if (nextStep !== undefined) {
      if (stepValid[step]) goTo(nextStep)
      return
    }
    void handleSubmit(event)
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
      title={`${copy.title} · ${vehicle.plate}`}
      onClose={onClose}
      footer={done ? (
        <>
          <Button type="button" variant="secondary" onClick={reset}>{copy.another}</Button>
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
              onClick={(event) => void handleSubmit(event)}
              disabled={saving || (!personal && Boolean(boundTo) && linkable.length === 0)}
            >
              {saving ? doc.uploadSubmitting : copy.submit}
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
          <h2>{copy.savedTitle}</h2>
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
              />
              <p className="update-hint">{copy.ownerHint}</p>
            </>
          )}
          <SelectField
            label={doc.docType}
            options={types.map((value) => ({ value, label: doc.docTypes[value] ?? value }))}
            value={form.type}
            onValueChange={changeType}
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
