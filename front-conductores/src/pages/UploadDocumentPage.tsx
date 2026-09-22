import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Paperclip } from 'lucide-react'
import { Button, PageHeader, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { listIncidents, listVehicles, uploadDocument } from '../api.ts'
import { useAuth } from '../auth.ts'
import type { LayoutContext } from '../components/Layout.tsx'
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

// Tipos de documento (lista cerrada del back, Épica 4); etiquetas en i18n.
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

/**
 * Subida de documentos como VISTA propia (antes era un formulario desplegable
 * dentro de la ficha). Se llega desde el inicio o desde la ficha, con el
 * vehículo ya elegido por la URL (`?vehiculo=`). Sin red, el binario y sus
 * metadatos entran en la cola offline (M7).
 */
export function UploadDocumentPage() {
  const { t } = useLang()
  const etiqueta = useDomainLabels()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Modo Flota: el selector pide al back SOLO los coches que supervisa (los
  // roles se suman; sin filtro un supervisor-admin vería toda la flota).
  const ctx = useOutletContext<LayoutContext | null>()
  const supervisedBy = ctx?.fleetMode ? user?.id ?? null : null
  // Las etiquetas de los campos ya viven en `t.vehicle` (la ficha las usaba):
  // aquí solo se añade lo propio de la vista (título, vuelta, confirmación).
  const doc = t.vehicle
  const copy = t.uploadDoc

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [vehicleId, setVehicleId] = useState(params.get('vehiculo') ?? '')
  const [form, setForm] = useState({ type: 'other', expiry_date: '', incident: '', notes: '' })
  const [file, setFile] = useState<File | null>(null)
  // Los MISMOS tres pasos que el modal de la ficha (`uploadSteps.ts`).
  const [step, setStep] = useState<UploadStep>('file')
  const [cameBack, setCameBack] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    let alive = true
    listVehicles(supervisedBy !== null ? { supervisor: supervisedBy } : {})
      .then((page) => {
        if (!alive) return
        setVehicles(page.results)
        // Con un solo coche no hay nada que elegir: se preselecciona.
        if (!params.get('vehiculo') && page.results.length === 1) {
          setVehicleId(String(page.results[0].id))
        }
      })
      .catch(() => alive && setVehicles([]))
    return () => {
      alive = false
    }
  }, [params, supervisedBy])

  // Incidencias del vehículo elegido: permiten ligar la foto a un parte. El
  // efecto SOLO carga; limpiar la selección al cambiar de coche se hace en el
  // propio `onValueChange` (es un evento, no una sincronización).
  useEffect(() => {
    if (!vehicleId) return
    let alive = true
    listIncidents(Number(vehicleId))
      .then((page) => alive && setIncidents(page.results))
      .catch(() => alive && setIncidents([]))
    return () => {
      alive = false
    }
  }, [vehicleId])

  // Qué pide el formulario según el tipo (mismas reglas que el back): la
  // caducidad solo a lo que caduca; el parte de accidente, un accidente abierto.
  const expires = documentExpires(form.type)
  const boundTo = incidentTypeRequiredBy(form.type)
  // Obligatorio también para las fotos de daños (son las fotos DE una incidencia).
  const linkRequired = documentLinkRequired(form.type)
  const linkable = linkableIncidents(incidents, form.type)

  function changeType(value: string) {
    setForm((f) => ({
      ...f,
      type: value,
      expiry_date: documentExpires(value) ? f.expiry_date : '',
      incident: linkableIncidents(incidents, value).some((row) => String(row.id) === f.incident)
        ? f.incident
        : '',
    }))
  }

  // Lo que exige cada paso. Aquí el coche también: la vista se abre sin él
  // cuando se llega desde el inicio con varios vehículos.
  const stepValid: Record<UploadStep, boolean> = {
    file: Boolean(vehicleId && file),
    link: !linkRequired || Boolean(form.incident),
    notes: true,
  }
  const current = UPLOAD_STEPS.indexOf(step)
  const nextStep = UPLOAD_STEPS[current + 1]
  const previousStep = UPLOAD_STEPS[current - 1]
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
    if (!vehicleId) return
    if (!file) {
      setError(doc.chooseFile)
      return
    }
    if (linkRequired && !form.incident) {
      setError(boundTo ? doc.linkAccidentRequired : doc.linkIncidentRequired)
      return
    }
    setSaving(true)
    setError('')
    const payload = {
      vehicle: Number(vehicleId),
      type: form.type,
      expiry_date: form.expiry_date || null,
      incident: form.incident ? Number(form.incident) : null,
      notes: form.notes,
      // R3-34: misma referencia en el intento directo y en el reenvío offline.
      client_ref: newClientRef(),
    }
    try {
      const created = await uploadDocument(payload, file)
      setDone(created.status === 'pending_archive' ? doc.uploadOkPending : doc.uploadOkArchived)
    } catch (err) {
      if (
        isNetworkError(err) &&
        (await safeEnqueue({ kind: 'document', payload, file, fileName: file.name, fileType: file.type }))
      ) {
        setDone(doc.uploadOffline)
      } else {
        setError(asErrorMessage(err, doc.uploadError))
      }
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="km-saved">
        <CheckCircle2 size={52} aria-hidden className="km-saved-icon" />
        <h2>{copy.savedTitle}</h2>
        <p className="km-saved-detail">{done}</p>
        <div className="request-actions">
          <Button
            onClick={() => {
              setDone('')
              setFile(null)
              setForm({ type: 'other', expiry_date: '', incident: '', notes: '' })
              setStep('file')
            }}
          >
            {copy.another}
          </Button>
          <Link to="/" className="back-link center">
            {copy.backHome}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="field-page">
      <PageHeader
        breadcrumb={
          <Link to="/" className="back-link">
            <ArrowLeft size={16} aria-hidden /> {copy.back}
          </Link>
        }
        title={copy.title}
      />

      <form className="modal-form" onSubmit={onFormSubmit}>
        <div className="flow-steps" aria-hidden>
          {UPLOAD_STEPS.map((key, index) => (
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
        {vehicles.length > 1 && (
          <SelectField
            label={copy.vehicle}
            requiredVisual
            options={[
              { value: '', label: copy.choose },
              ...vehicles.map((v) => ({
                value: String(v.id),
                label: `${v.plate} · ${v.brand} ${v.model}`,
              })),
            ]}
            value={vehicleId}
            onValueChange={(value) => {
              setVehicleId(value)
              // Las incidencias son de OTRO coche: la selección deja de valer.
              setIncidents([])
              setForm((f) => ({ ...f, incident: '' }))
            }}
          />
        )}
        <SelectField
          label={doc.docType}
          options={DOCUMENT_TYPES.map((value) => ({
            value,
            label: doc.docTypes[value] ?? value,
          }))}
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
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        {expires && (
          <TextInputField
            label={doc.expiry}
            type="date"
            value={form.expiry_date}
            onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
          />
        )}
        </>}

        {step === 'link' && <>
        {/* De qué es el documento; con tipos que no llevan nada, el paso
            lo dice en vez de quedarse en blanco. */}
        <p className="update-hint">
          {linkRequired || linkable.length > 0 ? copy.linkHint : copy.linkNothing}
        </p>
        {vehicleId && linkRequired ? (
          linkable.length > 0 ? (
            <SelectField
              label={boundTo ? doc.linkAccident : doc.linkIncidentOpen}
              required
              requiredVisual
              options={[
                { value: '', label: boundTo ? doc.linkChoose : doc.linkChooseIncident },
                ...linkable.map((i) => ({
                  value: String(i.id),
                  label: `#${i.id} · ${etiqueta.incidentType(i)}${i.date ? ` (${fmtDate(i.date)})` : ''}`,
                })),
              ]}
              value={form.incident}
              onValueChange={(value) => setForm((f) => ({ ...f, incident: value }))}
            />
          ) : (
            <p className="form-error" role="status">
              {boundTo ? doc.noOpenAccident : doc.noOpenIncident}
            </p>
          )
        ) : (
          vehicleId &&
          linkable.length > 0 && (
            // Opcional: la opción «ninguna» lleva centinela, porque un
            // `<select required>` con la opción vacía no pasa la validación
            // nativa y bloqueaba el envío.
            <SelectField
              label={doc.linkIncident}
              required
              options={[
                { value: 'none', label: doc.linkNone },
                ...linkable.map((i) => ({
                  value: String(i.id),
                  label: `#${i.id} · ${etiqueta.incidentType(i)} · ${etiqueta.incidentStatus(i)}${i.date ? ` (${fmtDate(i.date)})` : ''}`,
                })),
              ]}
              value={form.incident || 'none'}
              onValueChange={(value) =>
                setForm((f) => ({ ...f, incident: value === 'none' ? '' : value }))
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
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
        </>}
        {error && <div role="alert" className="form-error">{error}</div>}
        </div>
        <div className="form-actions">
          {previousStep === undefined ? (
            <Button type="button" variant="secondary" onClick={() => navigate('/')}>
              {t.common.cancel}
            </Button>
          ) : (
            <Button type="button" onClick={() => goTo(previousStep)}>{t.breakdown.back}</Button>
          )}
          {nextStep === undefined ? (
            <Button
              type="submit"
              disabled={saving || !vehicleId || (Boolean(boundTo) && linkable.length === 0)}
            >
              {saving ? doc.uploadSubmitting : copy.submit}
            </Button>
          ) : (
            <Button type="button" onClick={() => goTo(nextStep)} disabled={!stepValid[step]}>
              {t.breakdown.next}
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
