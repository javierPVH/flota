import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { Button, PageHeader, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { listIncidents, listVehicles, uploadDocument } from '../api.ts'
import { fmtDate } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { isNetworkError, newClientRef, safeEnqueue } from '../offline/queue.ts'
import type { Incident, Vehicle } from '../types.ts'

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

/**
 * Subida de documentos como VISTA propia (antes era un formulario desplegable
 * dentro de la ficha). Se llega desde el inicio o desde la ficha, con el
 * vehículo ya elegido por la URL (`?vehiculo=`). Sin red, el binario y sus
 * metadatos entran en la cola offline (M7).
 */
export function UploadDocumentPage() {
  const { t } = useLang()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Las etiquetas de los campos ya viven en `t.vehicle` (la ficha las usaba):
  // aquí solo se añade lo propio de la vista (título, vuelta, confirmación).
  const doc = t.vehicle
  const copy = t.uploadDoc

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [vehicleId, setVehicleId] = useState(params.get('vehiculo') ?? '')
  const [form, setForm] = useState({ type: 'other', expiry_date: '', incident: '', notes: '' })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    let alive = true
    listVehicles()
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
  }, [params])

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!vehicleId) return
    if (!file) {
      setError(doc.chooseFile)
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

      <form className="modal-form" onSubmit={handleSubmit}>
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
          onValueChange={(value) => setForm((f) => ({ ...f, type: value }))}
        />
        <label className="file-field">
          <span>
            {doc.filePick} <span className="req-badge" aria-hidden>{t.common.required}</span>
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && <span className="doc-sub">{file.name}</span>}
        </label>
        <TextInputField
          label={doc.expiry}
          type="date"
          value={form.expiry_date}
          onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
        />
        {vehicleId && incidents.length > 0 && (
          <SelectField
            label={doc.linkIncident}
            options={[
              { value: '', label: doc.linkNone },
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
          label={doc.notes}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
        {error && <div role="alert" className="form-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={() => navigate('/')}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={saving || !vehicleId}>
            {saving ? doc.uploadSubmitting : copy.submit}
          </Button>
        </div>
      </form>
    </div>
  )
}
