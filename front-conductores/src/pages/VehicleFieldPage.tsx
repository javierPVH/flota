import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Camera, ExternalLink, FileText, Gauge } from 'lucide-react'
import { Button, Panel, SelectField, StatCard, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  fetchVehicle,
  fetchVehicleSummary,
  listDocuments,
  listIncidents,
  uploadDocument,
} from '../api.ts'
import { useAuth } from '../auth.ts'
import { fmtDate, fmtKm, itvClass, pendingThisMonth } from '../format.ts'
import type { FlotaDocument, Incident, Vehicle, VehicleSummary } from '../types.ts'

// Tipos de documento (lista cerrada del back, Épica 4).
const DOCUMENT_TYPE_OPTIONS = [
  { value: 'registration_certificate', label: 'Permiso de circulación' },
  { value: 'technical_datasheet', label: 'Ficha técnica' },
  { value: 'insurance', label: 'Seguro' },
  { value: 'contract', label: 'Contrato' },
  { value: 'delivery_report', label: 'Acta de entrega' },
  { value: 'return_report', label: 'Acta de devolución' },
  { value: 'accident_report', label: 'Parte de accidente' },
  { value: 'damage_photos', label: 'Fotos de daños' },
  { value: 'other', label: 'Otro' },
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

/**
 * M2 — Ficha de campo (HU-1.2 lectura, 4.1, 4.3): consulta rápida a pie de
 * vehículo + subida de documentos por cámara/galería (multipart; el back
 * archiva en la carpeta de Drive del vehículo — Fase A3).
 */
export function VehicleFieldPage() {
  const { id } = useParams()
  const vehicleId = Number(id)
  const { user } = useAuth()
  const isSupervisor = user?.roles.includes('supervisor') ?? false

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
      .catch((err) => alive && setError(asErrorMessage(err, 'No se pudo cargar el vehículo.')))
      .finally(() => alive && setLoading(false))
    loadDocuments()
    return () => {
      alive = false
    }
  }, [vehicleId, loadDocuments])

  // Las incidencias son de gestión: solo el supervisor puede listarlas para
  // ligar el acta/parte/fotos al subir (el conductor no las ve).
  useEffect(() => {
    if (!isSupervisor) return
    listIncidents(vehicleId)
      .then((page) => setIncidents(page.results.filter((i) => i.status !== 'closed')))
      .catch(() => setIncidents([]))
  }, [vehicleId, isSupervisor])

  function openUpload() {
    setShowUpload(true)
    setUploadOk('')
    setTimeout(() => uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault()
    if (!file) {
      setFormError('Elige una foto o un PDF.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const doc = await uploadDocument(
        {
          vehicle: vehicleId,
          type: form.type,
          expiry_date: form.expiry_date || null,
          incident: form.incident ? Number(form.incident) : null,
          notes: form.notes,
        },
        file,
      )
      setForm(EMPTY_FORM)
      setFile(null)
      setShowUpload(false)
      setUploadOk(
        doc.status === 'pending_archive'
          ? 'Documento subido. Queda pendiente de archivar en Drive; mientras tanto se abre desde aquí.'
          : 'Documento subido y archivado en Drive.',
      )
      loadDocuments()
    } catch (err) {
      setFormError(asErrorMessage(err, 'No se pudo subir el documento.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="gate-checking">Cargando…</p>
  if (error || !vehicle) return <div className="form-error">{error || 'Vehículo no encontrado.'}</div>

  const kmPending = summary ? pendingThisMonth(summary) : false

  return (
    <div className="field-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} aria-hidden /> Volver
      </Link>

      <header className="field-head">
        <span className="plate plate-lg">{vehicle.plate}</span>
        <span className={`badge ${vehicle.state}`}>{vehicle.state_display || '—'}</span>
      </header>
      <p className="vehicle-model">
        {vehicle.brand} {vehicle.model}
        {vehicle.year ? ` · ${vehicle.year}` : ''}
      </p>

      <div className="stat-row">
        <StatCard
          label="Km actual"
          value={summary ? fmtKm(summary.km_current) : '—'}
          sub={
            summary?.km_reading_date
              ? `Lectura del ${fmtDate(summary.km_reading_date)}`
              : 'Sin lecturas'
          }
          accent={kmPending ? 'warning' : 'teal'}
        />
        <StatCard
          label="Próxima ITV"
          value={
            <span className={itvClass(vehicle.next_itv_date)}>{fmtDate(vehicle.next_itv_date)}</span>
          }
          sub={
            itvClass(vehicle.next_itv_date) === 'itv-overdue'
              ? 'Vencida'
              : itvClass(vehicle.next_itv_date) === 'itv-soon'
                ? 'Próxima (≤30 días)'
                : ' '
          }
          accent={itvClass(vehicle.next_itv_date) ? 'warning' : 'primary'}
        />
      </div>

      {kmPending && (
        <Panel tone="warning">
          <p className="panel-note">
            Falta la lectura de km de este mes.{' '}
            <Link to={`/registrar?vehiculo=${vehicle.id}`}>Registrarla ahora</Link>
          </p>
        </Panel>
      )}

      {/* Accesos directos de campo (M4 añadirá proponer fechas / ITV). */}
      <div className="quick-actions">
        <Link to={`/registrar?vehiculo=${vehicle.id}`} className="quick-action">
          <Gauge size={20} aria-hidden /> Registrar km
        </Link>
        <button type="button" className="quick-action" onClick={openUpload}>
          <Camera size={20} aria-hidden /> Subir documento
        </button>
      </div>

      {/* Tres atributos independientes (HU-1.6), en solo lectura. */}
      <Panel>
        <h3 className="panel-title">Situación</h3>
        <dl className="vehicle-meta">
          <dt>Estado</dt>
          <dd>
            <span className={`badge ${vehicle.state}`}>{vehicle.state_display || '—'}</span>
          </dd>
          <dt>Sustitución</dt>
          <dd>{vehicle.is_substitute ? '🔁 Es vehículo de sustitución' : 'Vehículo principal'}</dd>
          <dt>Conductor</dt>
          <dd>{summary?.driver?.name ?? 'Sin conductor asignado'}</dd>
          {vehicle.supervisor_name && (
            <>
              <dt>Supervisor</dt>
              <dd>{vehicle.supervisor_name}</dd>
            </>
          )}
          <dt>Uso</dt>
          <dd>{vehicle.business_use || '—'}</dd>
        </dl>
      </Panel>

      {/* Documentos (HU-4.1/4.3): viven en Drive; aquí solo la referencia. */}
      <Panel>
        <div className="panel-head">
          <h3 className="panel-title">Documentos</h3>
          <Button size="sm" onClick={openUpload}>
            <Camera size={16} aria-hidden /> Subir
          </Button>
        </div>
        {uploadOk && <p className="form-ok">{uploadOk}</p>}
        {documents.length === 0 && <p className="empty-note">Sin documentos.</p>}
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
                    {doc.expiry_date ? ` · caduca ${fmtDate(doc.expiry_date)}` : ''}
                  </span>
                </div>
                <span className={`pill doc-${doc.status}`}>{doc.status_display}</span>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="doc-open"
                    aria-label={`Abrir ${doc.type_display}`}
                  >
                    <ExternalLink size={18} aria-hidden />
                  </a>
                )}
              </li>
            )
          })}
        </ul>

        {showUpload && (
          <form ref={uploadRef} className="modal-form upload-form" onSubmit={handleUpload}>
            <h4 className="panel-title">Subir documento</h4>
            <SelectField
              label="Tipo de documento"
              options={DOCUMENT_TYPE_OPTIONS}
              value={form.type}
              onValueChange={(value) => setForm((f) => ({ ...f, type: value }))}
            />
            <label className="file-field">
              <span>Foto o PDF (cámara / galería)</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <TextInputField
              label="Caducidad (opcional)"
              type="date"
              value={form.expiry_date}
              onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
            />
            {incidents.length > 0 && (
              <SelectField
                label="Ligado a incidencia (opcional)"
                options={[
                  { value: '', label: 'Ninguna' },
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
              label="Notas (opcional)"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
            {formError && <div className="form-error">{formError}</div>}
            <div className="form-actions">
              <Button type="button" variant="secondary" onClick={() => setShowUpload(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Subiendo…' : 'Subir documento'}
              </Button>
            </div>
          </form>
        )}
      </Panel>
    </div>
  )
}
