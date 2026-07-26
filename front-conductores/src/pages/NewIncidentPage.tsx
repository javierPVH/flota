import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button, PageHeader, SelectField, TextAreaField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createIncident, listVehicles, uploadDocument } from '../api.ts'
import { useAuth } from '../auth.ts'
import { todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

// Tipos de incidencia (lista cerrada del back, Épica 6); etiquetas en i18n.
const INCIDENT_TYPES = ['breakdown', 'accident', 'maintenance', 'inspection']

/**
 * M6 — Nueva incidencia del grupo (Épica 6): avería/accidente con fotos desde
 * el móvil. Las fotos se suben como documentos `damage_photos` ligados a la
 * incidencia (multipart → el back archiva en Drive, Fase A3).
 */
export function NewIncidentPage() {
  const { user } = useAuth()
  const { t } = useLang()
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
        setError(t.newIncident.uploadFailed(failed.join(', ')))
        setSaving(false)
        return
      }
      navigate('/grupo', { replace: true })
    } catch (err) {
      setError(asErrorMessage(err, t.newIncident.createError))
      setSaving(false)
    }
  }

  return (
    <div className="field-page">
      <PageHeader
        breadcrumb={
          <Link to="/grupo" className="back-link">
            <ArrowLeft size={16} aria-hidden /> {t.newIncident.back}
          </Link>
        }
        title={t.newIncident.title}
      />

      <form className="modal-form" onSubmit={handleSubmit}>
        <SelectField
          label={t.newIncident.vehicle}
          options={[
            { value: '', label: t.newIncident.choose },
            ...vehicles.map((v) => ({
              value: String(v.id),
              label: `${v.plate} · ${v.brand} ${v.model}`,
            })),
          ]}
          value={form.vehicle}
          onValueChange={(value) => setForm((f) => ({ ...f, vehicle: value }))}
        />
        <SelectField
          label={t.newIncident.type}
          options={INCIDENT_TYPES.map((value) => ({
            value,
            label: t.newIncident.types[value] ?? value,
          }))}
          value={form.type}
          onValueChange={(value) => setForm((f) => ({ ...f, type: value }))}
        />
        <TextInputField
          label={t.newIncident.date}
          type="date"
          max={todayIso()}
          value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          required
        />
        <TextAreaField
          label={t.newIncident.description}
          rows={3}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder={t.newIncident.descPlaceholder}
        />
        <label className="file-field">
          <span>{t.newIncident.photos}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            onChange={(e) => setPhotos(Array.from(e.target.files ?? []))}
          />
          {photos.length > 0 && (
            <span className="doc-sub">{t.newIncident.photosSelected(photos.length)}</span>
          )}
        </label>
        {error && <div role="alert" className="form-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={() => navigate('/grupo')}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={saving || !form.vehicle}>
            {saving ? t.newIncident.submitting : t.newIncident.submit}
          </Button>
        </div>
      </form>
    </div>
  )
}
