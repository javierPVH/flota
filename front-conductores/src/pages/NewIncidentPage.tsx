import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button, SelectField, TextAreaField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createIncident, listVehicles, uploadDocument } from '../api.ts'
import { useAuth } from '../auth.ts'
import type { Vehicle } from '../types.ts'

// Tipos de incidencia (lista cerrada del back, Épica 6).
const INCIDENT_TYPE_OPTIONS = [
  { value: 'breakdown', label: 'Avería' },
  { value: 'accident', label: 'Accidente' },
  { value: 'maintenance', label: 'Mantenimiento' },
  { value: 'inspection', label: 'Revisión' },
]

/** Hoy en formato de <input type="date"> (zona local, no UTC). */
function todayIso(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

/**
 * M6 — Nueva incidencia del grupo (Épica 6): avería/accidente con fotos desde
 * el móvil. Las fotos se suben como documentos `damage_photos` ligados a la
 * incidencia (multipart → el back archiva en Drive, Fase A3).
 */
export function NewIncidentPage() {
  const { user } = useAuth()
  const isSupervisor = user?.roles.includes('supervisor') ?? false
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [form, setForm] = useState({
    vehicle: params.get('vehiculo') ?? '',
    type: 'breakdown',
    date: todayIso(),
    description: '',
  })
  const [photos, setPhotos] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isSupervisor) return
    listVehicles()
      .then((page) => setVehicles(page.results))
      .catch(() => setVehicles([]))
  }, [isSupervisor])

  if (!isSupervisor) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.vehicle) return
    setSaving(true)
    setError('')
    try {
      const incident = await createIncident({
        vehicle: Number(form.vehicle),
        type: form.type,
        date: form.date,
        description: form.description,
      })
      // Fotos como documentos ligados al parte (HU-4.1 + Épica 6). Si alguna
      // falla, la incidencia ya existe: se avisa sin perder lo demás.
      const failed: string[] = []
      for (const photo of photos) {
        try {
          await uploadDocument(
            { vehicle: incident.vehicle, type: 'damage_photos', incident: incident.id },
            photo,
          )
        } catch {
          failed.push(photo.name)
        }
      }
      if (failed.length > 0) {
        setError(
          `Incidencia creada, pero no se pudieron subir: ${failed.join(', ')}. ` +
            'Puedes añadirlas desde la ficha del vehículo.',
        )
        setSaving(false)
        return
      }
      navigate('/grupo', { replace: true })
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo crear la incidencia.'))
      setSaving(false)
    }
  }

  return (
    <div className="field-page">
      <Link to="/grupo" className="back-link">
        <ArrowLeft size={16} aria-hidden /> Mi grupo
      </Link>
      <div className="page-head">
        <h2>Nueva incidencia</h2>
      </div>

      <form className="modal-form" onSubmit={handleSubmit}>
        <SelectField
          label="Vehículo"
          options={[
            { value: '', label: 'Elige un vehículo…' },
            ...vehicles.map((v) => ({
              value: String(v.id),
              label: `${v.plate} · ${v.brand} ${v.model}`,
            })),
          ]}
          value={form.vehicle}
          onValueChange={(value) => setForm((f) => ({ ...f, vehicle: value }))}
        />
        <SelectField
          label="Tipo"
          options={INCIDENT_TYPE_OPTIONS}
          value={form.type}
          onValueChange={(value) => setForm((f) => ({ ...f, type: value }))}
        />
        <TextInputField
          label="Fecha"
          type="date"
          max={todayIso()}
          value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          required
        />
        <TextAreaField
          label="Descripción"
          rows={3}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Qué ha pasado, dónde, estado del vehículo…"
        />
        <label className="file-field">
          <span>Fotos (cámara / galería, opcional)</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            onChange={(e) => setPhotos(Array.from(e.target.files ?? []))}
          />
          {photos.length > 0 && (
            <span className="doc-sub">
              {photos.length} foto{photos.length === 1 ? '' : 's'} seleccionada
              {photos.length === 1 ? '' : 's'}
            </span>
          )}
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={() => navigate('/grupo')}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving || !form.vehicle}>
            {saving ? 'Creando…' : 'Crear incidencia'}
          </Button>
        </div>
      </form>
    </div>
  )
}
