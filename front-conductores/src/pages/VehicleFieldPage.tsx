import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, Camera, ClipboardCheck, ExternalLink, FileText, Gauge, Wrench } from 'lucide-react'
import { Badge, Button, Modal, Panel, SelectField, StatCard, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  fetchVehicle,
  fetchVehicleSummary,
  listAssignments,
  listDocuments,
  listIncidents,
  proposeAssignment,
  registerItv,
  uploadDocument,
} from '../api.ts'
import { useAuth } from '../auth.ts'
import {
  AccordionTools,
  CollapsibleCard,
  useAccordion,
} from '../components/CollapsibleCard.tsx'
import { useLang } from '../i18n.tsx'
import {
  documentStatusTone,
  fmtDate,
  fmtKm,
  incidentStatusTone,
  itvClass,
  todayIso,
  pendingThisMonth,
  vehicleStateTone,
} from '../format.ts'
import { isNetworkError, safeEnqueue } from '../offline/queue.ts'
import type { AssignmentRow, FlotaDocument, Incident, Vehicle, VehicleSummary } from '../types.ts'

// Tipos de documento (lista cerrada del back, Épica 4); etiquetas en i18n.
const DOCUMENT_TYPES = [
  'registration_certificate',
  'technical_datasheet',
  'insurance',
  'contract',
  'delivery_report',
  'return_report',
  'accident_report',
  'damage_photos',
  'other',
]

/** Solo enlaces http(s): corta javascript:/data: aunque el back ya sanea. */
function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : ''
}

/** Enlace al archivo: Drive si ya está archivado; staging local si no. */
function documentHref(doc: FlotaDocument): string {
  return safeHref(doc.drive_url) || safeHref(doc.file_url)
}

const EMPTY_FORM = { type: 'other', expiry_date: '', incident: '', notes: '' }

// Resultado de la ITV: valores libres del back, consensuados con gestión.
const ITV_RESULT_VALUES = ['done', 'not done'] as const

/**
 * M2 — Ficha de campo (HU-1.2 lectura, 4.1, 4.3): consulta rápida a pie de
 * vehículo + subida de documentos por cámara/galería (multipart; el back
 * archiva en la carpeta de Drive del vehículo — Fase A3).
 */
export function VehicleFieldPage() {
  const { id } = useParams()
  const vehicleId = Number(id)
  const { user } = useAuth()
  const { t } = useLang()

  // Acordeón de tarjetas (mejora): desplegadas por defecto; en móvil plegar
  // ahorra mucho scroll.
  const accordion = useAccordion(['proposals', 'situation', 'incidents', 'documents'])

  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [summary, setSummary] = useState<VehicleSummary | null>(null)
  const [documents, setDocuments] = useState<FlotaDocument[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Subida de documento (HU-4.1)
  const [showUpload, setShowUpload] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [uploadOk, setUploadOk] = useState('')
  const uploadRef = useRef<HTMLFormElement>(null)

  // M4: propuesta de fechas (HU-2.3) y registro de ITV (HU-5.1)
  const [myProposals, setMyProposals] = useState<AssignmentRow[]>([])
  const [proposeOpen, setProposeOpen] = useState(false)
  const [proposeForm, setProposeForm] = useState({ start_date: todayIso(), end_date: '' })
  const [proposeError, setProposeError] = useState('')
  const [proposeOk, setProposeOk] = useState('')
  const [itvOpen, setItvOpen] = useState(false)
  const [itvForm, setItvForm] = useState({ event_date: todayIso(), result: 'done', next_due: '' })
  const [itvError, setItvError] = useState('')
  const [itvOk, setItvOk] = useState('')

  const loadDocuments = useCallback(() => {
    listDocuments(vehicleId)
      .then((page) => setDocuments(page.results))
      .catch(() => setDocuments([]))
  }, [vehicleId])

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([fetchVehicle(vehicleId), fetchVehicleSummary(vehicleId)])
      .then(([v, s]) => {
        if (!alive) return
        setVehicle(v)
        setSummary(s)
      })
      .catch((err) => alive && setError(asErrorMessage(err, t.vehicle.loadError)))
      .finally(() => alive && setLoading(false))
    loadDocuments()
    return () => {
      alive = false
    }
  }, [vehicleId, loadDocuments])

  // Incidencias abiertas del vehículo: el conductor las LEE (el back acota a
  // sus vehículos); gestionarlas sigue siendo cosa de gestión. También sirven
  // para ligar el acta/parte/fotos al subir un documento.
  useEffect(() => {
    listIncidents(vehicleId)
      .then((page) => setIncidents(page.results.filter((i) => i.status !== 'closed')))
      .catch(() => setIncidents([]))
  }, [vehicleId])

  // Propuestas de fechas PROPIAS pendientes de confirmación (HU-2.3).
  const loadProposals = useCallback(() => {
    if (!user) return
    listAssignments(vehicleId, 'proposed')
      .then((page) => setMyProposals(page.results.filter((a) => a.driver === user.id)))
      .catch(() => setMyProposals([]))
  }, [vehicleId, user])

  useEffect(loadProposals, [loadProposals])

  function openUpload() {
    if (!accordion.isOpen('documents')) accordion.toggle('documents')
    setShowUpload(true)
    setUploadOk('')
    setTimeout(() => uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault()
    if (!file) {
      setFormError(t.vehicle.chooseFile)
      return
    }
    setSaving(true)
    setFormError('')
    const payload = {
      vehicle: vehicleId,
      type: form.type,
      expiry_date: form.expiry_date || null,
      incident: form.incident ? Number(form.incident) : null,
      notes: form.notes,
    }
    try {
      const doc = await uploadDocument(payload, file)
      setForm(EMPTY_FORM)
      setFile(null)
      setShowUpload(false)
      setUploadOk(
        doc.status === 'pending_archive' ? t.vehicle.uploadOkPending : t.vehicle.uploadOkArchived,
      )
      loadDocuments()
    } catch (err) {
      // Sin red (M7): el binario entra en la cola offline con sus metadatos.
      if (isNetworkError(err) &&
          (await safeEnqueue({ kind: 'document', payload, file, fileName: file.name, fileType: file.type }))) {
        setForm(EMPTY_FORM)
        setFile(null)
        setShowUpload(false)
        setUploadOk(t.vehicle.uploadOffline)
      } else {
        setFormError(asErrorMessage(err, t.vehicle.uploadError))
      }
    } finally {
      setSaving(false)
    }
  }

  async function handlePropose(event: FormEvent) {
    event.preventDefault()
    if (proposeForm.end_date && proposeForm.end_date < proposeForm.start_date) {
      setProposeError(t.vehicle.proposeEndBeforeStart)
      return
    }
    setSaving(true)
    setProposeError('')
    try {
      await proposeAssignment({
        vehicle: vehicleId,
        start_date: proposeForm.start_date,
        end_date: proposeForm.end_date || null,
      })
      setProposeOpen(false)
      setProposeForm({ start_date: todayIso(), end_date: '' })
      setProposeOk(t.vehicle.proposeOk)
      loadProposals()
    } catch (err) {
      setProposeError(asErrorMessage(err, t.vehicle.proposeError))
    } finally {
      setSaving(false)
    }
  }

  async function handleItv(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setItvError('')
    const payload = {
      vehicle: vehicleId,
      event_date: itvForm.event_date,
      itv: { result: itvForm.result, next_due: itvForm.next_due || null },
    }
    try {
      await registerItv(payload)
      setItvOpen(false)
      setItvForm({ event_date: todayIso(), result: 'done', next_due: '' })
      setItvOk(t.vehicle.itvOk)
      // La señal del back refresca next_itv_date: recarga la cabecera.
      fetchVehicle(vehicleId).then(setVehicle, () => {})
    } catch (err) {
      // Sin red (M7): a la cola offline — se enviará al reconectar.
      if (isNetworkError(err) && (await safeEnqueue({ kind: 'itv', payload }))) {
        setItvOpen(false)
        setItvForm({ event_date: todayIso(), result: 'done', next_due: '' })
        setItvOk(t.vehicle.itvOffline)
      } else {
        setItvError(asErrorMessage(err, t.vehicle.itvError))
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>
  if (error || !vehicle) return <div role="alert" className="form-error">{error || t.vehicle.notFound}</div>

  const kmPending = summary ? pendingThisMonth(summary) : false

  return (
    <div className="field-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} aria-hidden /> {t.vehicle.back}
      </Link>

      <header className="field-head">
        <span className="plate plate-lg">{vehicle.plate}</span>
        <Badge tone={vehicleStateTone(vehicle.state)}>{vehicle.state_display || '—'}</Badge>
      </header>
      <p className="vehicle-model">
        {vehicle.brand} {vehicle.model}
        {vehicle.year ? ` · ${vehicle.year}` : ''}
      </p>

      <div className="stat-row">
        <StatCard
          label={t.vehicle.kmLabel}
          value={summary ? fmtKm(summary.km_current) : '—'}
          sub={
            summary?.km_reading_date
              ? t.vehicle.readingOf(fmtDate(summary.km_reading_date))
              : t.vehicle.noReadings
          }
          accent={kmPending ? 'warning' : 'teal'}
        />
        <StatCard
          label={t.vehicle.nextItv}
          value={
            <span className={itvClass(vehicle.next_itv_date)}>{fmtDate(vehicle.next_itv_date)}</span>
          }
          sub={
            itvClass(vehicle.next_itv_date) === 'itv-overdue'
              ? t.vehicle.itvOverdue
              : itvClass(vehicle.next_itv_date) === 'itv-soon'
                ? t.vehicle.itvSoon
                : ' '
          }
          accent={itvClass(vehicle.next_itv_date) ? 'warning' : 'primary'}
        />
      </div>

      {kmPending && (
        <Panel tone="warning">
          <p className="panel-note">
            {t.vehicle.kmPending}{' '}
            <Link to={`/registrar?vehiculo=${vehicle.id}`}>{t.vehicle.kmPendingCta}</Link>
          </p>
        </Panel>
      )}

      {/* Accesos directos de campo (M2 + M4). */}
      <div className="quick-actions">
        <Link to={`/registrar?vehiculo=${vehicle.id}`} className="quick-action">
          <Gauge size={20} aria-hidden /> {t.common.registerKm}
        </Link>
        <button type="button" className="quick-action" onClick={openUpload}>
          <Camera size={20} aria-hidden /> {t.vehicle.quickUpload}
        </button>
        <button
          type="button"
          className="quick-action"
          onClick={() => {
            setProposeOk('')
            setProposeError('')
            setProposeOpen(true)
          }}
        >
          <CalendarPlus size={20} aria-hidden /> {t.vehicle.quickPropose}
        </button>
        <button
          type="button"
          className="quick-action"
          onClick={() => {
            setItvOk('')
            setItvError('')
            setItvOpen(true)
          }}
        >
          <ClipboardCheck size={20} aria-hidden /> {t.vehicle.quickItv}
        </button>
      </div>

      {proposeOk && <p role="status" className="form-ok">{proposeOk}</p>}
      {itvOk && <p role="status" className="form-ok">{itvOk}</p>}

      <AccordionTools accordion={accordion} />

      {/* Propuestas propias pendientes (HU-2.3): NO alteran la vigente. */}
      {myProposals.length > 0 && (
        <CollapsibleCard id="proposals" accordion={accordion} title={t.vehicle.proposalsTitle}>
          <ul className="doc-list">
            {myProposals.map((p) => (
              <li key={p.id} className="doc-item">
                <CalendarPlus size={18} aria-hidden className="doc-icon" />
                <div className="doc-info">
                  <strong>
                    {t.vehicle.proposalFrom(fmtDate(p.start_date))}
                    {p.end_date ? t.vehicle.proposalUntil(fmtDate(p.end_date)) : t.vehicle.proposalOpenEnd}
                  </strong>
                  <span className="doc-sub">{t.vehicle.proposalNote}</span>
                </div>
                <Badge tone="warning">{t.vehicle.proposalPending}</Badge>
              </li>
            ))}
          </ul>
        </CollapsibleCard>
      )}

      {/* Tres atributos independientes (HU-1.6), en solo lectura. */}
      <CollapsibleCard id="situation" accordion={accordion} title={t.vehicle.situationTitle}>
        <dl className="vehicle-meta">
          <dt>{t.vehicle.state}</dt>
          <dd>
            <Badge tone={vehicleStateTone(vehicle.state)}>{vehicle.state_display || '—'}</Badge>
          </dd>
          <dt>{t.vehicle.substitution}</dt>
          <dd>{vehicle.is_substitute ? t.vehicle.isSubstitute : t.vehicle.mainVehicle}</dd>
          <dt>{t.vehicle.driver}</dt>
          <dd>{summary?.driver?.name ?? t.vehicle.noDriver}</dd>
          {vehicle.supervisor_name && (
            <>
              <dt>{t.vehicle.supervisor}</dt>
              <dd>{vehicle.supervisor_name}</dd>
            </>
          )}
          <dt>{t.vehicle.use}</dt>
          <dd>{vehicle.business_use || '—'}</dd>
        </dl>
      </CollapsibleCard>

      {/* Incidencias abiertas (mejora 🟡): el conductor ve qué le pasa a SU
          vehículo; la gestión (cerrar, coste…) sigue en el front de gestión. */}
      {incidents.length > 0 && (
        <CollapsibleCard id="incidents" accordion={accordion} title={t.vehicle.incidentsTitle}>
          <ul className="doc-list">
            {incidents.map((i) => (
              <li key={i.id} className="doc-item">
                <Wrench size={18} aria-hidden className="doc-icon" />
                <div className="doc-info">
                  <strong>{i.type_display}</strong>
                  <span className="doc-sub">
                    {i.date ? fmtDate(i.date) : t.vehicle.noDate}
                    {i.description ? ` · ${i.description}` : ''}
                  </span>
                </div>
                <Badge tone={incidentStatusTone(i.status)}>{i.status_display}</Badge>
              </li>
            ))}
          </ul>
        </CollapsibleCard>
      )}

      {/* Documentos (HU-4.1/4.3): viven en Drive; aquí solo la referencia. */}
      <CollapsibleCard
        id="documents"
        accordion={accordion}
        title={t.vehicle.documentsTitle}
        actions={
          <Button size="sm" onClick={openUpload}>
            <Camera size={16} aria-hidden /> {t.vehicle.upload}
          </Button>
        }
      >
        {uploadOk && <p role="status" className="form-ok">{uploadOk}</p>}
        {documents.length === 0 && <p className="empty-note">{t.vehicle.noDocuments}</p>}
        <ul className="doc-list">
          {documents.map((doc) => {
            const href = documentHref(doc)
            return (
              <li key={doc.id} className="doc-item">
                <FileText size={18} aria-hidden className="doc-icon" />
                <div className="doc-info">
                  <strong>{doc.type_display}</strong>
                  <span className="doc-sub">
                    {fmtDate(doc.created_at)}
                    {doc.expiry_date ? t.vehicle.expires(fmtDate(doc.expiry_date)) : ''}
                  </span>
                </div>
                <Badge tone={documentStatusTone(doc.status)}>{doc.status_display}</Badge>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="doc-open"
                    aria-label={t.vehicle.openDoc(doc.type_display)}
                  >
                    <ExternalLink size={18} aria-hidden />
                  </a>
                )}
              </li>
            )
          })}
        </ul>

        <Modal
          open={proposeOpen}
          title={t.vehicle.proposeTitle(vehicle.plate)}
          onClose={() => setProposeOpen(false)}
        >
          <form className="modal-form" onSubmit={handlePropose}>
            <p className="doc-sub">{t.vehicle.proposeHint}</p>
            <TextInputField
              label={t.vehicle.proposeFrom}
              type="date"
              value={proposeForm.start_date}
              onChange={(e) => setProposeForm((f) => ({ ...f, start_date: e.target.value }))}
              required
            />
            <TextInputField
              label={t.vehicle.proposeUntil}
              type="date"
              min={proposeForm.start_date}
              value={proposeForm.end_date}
              onChange={(e) => setProposeForm((f) => ({ ...f, end_date: e.target.value }))}
            />
            {proposeError && <div role="alert" className="form-error">{proposeError}</div>}
            <div className="form-actions">
              <Button type="button" variant="secondary" onClick={() => setProposeOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={saving || !proposeForm.start_date}>
                {saving ? t.vehicle.proposeSending : t.vehicle.proposeSend}
              </Button>
            </div>
          </form>
        </Modal>

        <Modal open={itvOpen} title={t.vehicle.itvTitle(vehicle.plate)} onClose={() => setItvOpen(false)}>
          <form className="modal-form" onSubmit={handleItv}>
            <TextInputField
              label={t.vehicle.itvDate}
              type="date"
              max={todayIso()}
              value={itvForm.event_date}
              onChange={(e) => setItvForm((f) => ({ ...f, event_date: e.target.value }))}
              required
            />
            <SelectField
              label={t.vehicle.itvResult}
              options={[
                { value: ITV_RESULT_VALUES[0], label: t.vehicle.itvResultDone },
                { value: ITV_RESULT_VALUES[1], label: t.vehicle.itvResultNotDone },
              ]}
              value={itvForm.result}
              onValueChange={(value) => setItvForm((f) => ({ ...f, result: value }))}
            />
            <TextInputField
              label={t.vehicle.itvNextDue}
              type="date"
              min={itvForm.event_date}
              value={itvForm.next_due}
              onChange={(e) => setItvForm((f) => ({ ...f, next_due: e.target.value }))}
            />
            <p className="doc-sub">{t.vehicle.itvAutoClose}</p>
            {itvError && <div role="alert" className="form-error">{itvError}</div>}
            <div className="form-actions">
              <Button type="button" variant="secondary" onClick={() => setItvOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t.vehicle.itvSubmitting : t.vehicle.itvSubmit}
              </Button>
            </div>
          </form>
        </Modal>

        {showUpload && (
          <form ref={uploadRef} className="modal-form upload-form" onSubmit={handleUpload}>
            <h4 className="panel-title">{t.vehicle.uploadTitle}</h4>
            <SelectField
              label={t.vehicle.docType}
              options={DOCUMENT_TYPES.map((value) => ({
                value,
                label: t.vehicle.docTypes[value] ?? value,
              }))}
              value={form.type}
              onValueChange={(value) => setForm((f) => ({ ...f, type: value }))}
            />
            <label className="file-field">
              <span>{t.vehicle.filePick}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <TextInputField
              label={t.vehicle.expiry}
              type="date"
              value={form.expiry_date}
              onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
            />
            {incidents.length > 0 && (
              <SelectField
                label={t.vehicle.linkIncident}
                options={[
                  { value: '', label: t.vehicle.linkNone },
                  ...incidents.map((i) => ({
                    value: String(i.id),
                    label: `#${i.id} · ${i.type_display}${i.date ? ` (${fmtDate(i.date)})` : ''}`,
                  })),
                ]}
                value={form.incident}
                onValueChange={(value) => setForm((f) => ({ ...f, incident: value }))}
              />
            )}
            <TextInputField
              label={t.vehicle.notes}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
            {formError && <div role="alert" className="form-error">{formError}</div>}
            <div className="form-actions">
              <Button type="button" variant="secondary" onClick={() => setShowUpload(false)}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t.vehicle.uploadSubmitting : t.vehicle.uploadTitle}
              </Button>
            </div>
          </form>
        )}
      </CollapsibleCard>
    </div>
  )
}
