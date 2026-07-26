import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Gauge } from 'lucide-react'
import { Button, PageHeader, Panel, SelectField } from '@flota/ui/ui'
import { ApiError, asErrorMessage } from '@flota/ui/http'

import { createKmReading, fetchVehicleSummary, listKmReadings, listVehicles } from '../api.ts'
import { fmtDate, fmtKm, pendingThisMonth, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { enqueue, isNetworkError } from '../offline/queue.ts'
import type { KmReading, Vehicle, VehicleSummary } from '../types.ts'

interface SavedReading {
  plate: string
  km: number
  /** Km del periodo: diferencia con la última lectura conocida (o null si es la primera). */
  driven: number | null
  /** true si se quedó en la cola offline (sin red), pendiente de envío. */
  queued: boolean
}

/**
 * M3 — Registro de odómetro (HU-3.1/3.2): lectura ACUMULADA, no km del mes.
 * Muestra la última lectura como referencia y, al guardar, confirma los km
 * recorridos en el periodo. El no-retroceso lo valida también el servidor.
 */
export function RegisterKmPage() {
  const { t } = useLang()
  const [params] = useSearchParams()
  const preselected = params.get('vehiculo') ?? ''

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [vehicleId, setVehicleId] = useState(preselected)
  const [summary, setSummary] = useState<VehicleSummary | null>(null)
  const [km, setKm] = useState('')
  const [date, setDate] = useState(todayIso())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<SavedReading | null>(null)

  /** Errores del servidor en claro: no-retroceso (400) y throttle (429).
   * El throttle se decide por STATUS (E5: la regex sobre el texto del back se
   * rompía al cambiar la redacción o el idioma). El transporte del DS ya
   * desenvuelve {detail, errors} al mensaje de campo. */
  function readableError(err: unknown): string {
    if (err instanceof ApiError && err.status === 429) return t.km.throttled
    const message = asErrorMessage(err, t.km.saveError)
    return message.replace(/^km_reading:\s*/, '')
  }

  useEffect(() => {
    let alive = true
    listVehicles()
      .then((page) => {
        if (!alive) return
        setVehicles(page.results)
        // Sin preselección, con un solo coche no hay nada que elegir.
        if (!preselected && page.results.length === 1) setVehicleId(String(page.results[0].id))
      })
      .catch((err) => alive && setError(asErrorMessage(err, t.home.loadError)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [preselected, t])

  // Historial reciente (mejora 🟡): las últimas lecturas a la vista ayudan a
  // detectar erratas en el momento (un dígito de más se ve al instante).
  const [recent, setRecent] = useState<KmReading[]>([])

  // Referencia: última lectura del vehículo elegido + historial reciente.
  useEffect(() => {
    setSummary(null)
    setRecent([])
    if (!vehicleId) return
    let alive = true
    fetchVehicleSummary(Number(vehicleId))
      .then((s) => alive && setSummary(s))
      .catch(() => alive && setSummary(null))
    listKmReadings(Number(vehicleId))
      .then((page) => {
        if (!alive) return
        // El back ordena ascendente por fecha: nos quedamos con las 4 últimas.
        setRecent([...page.results].slice(-4).reverse())
      })
      .catch(() => alive && setRecent([]))
    return () => {
      alive = false
    }
  }, [vehicleId])

  const vehicle = useMemo(
    () => vehicles.find((v) => String(v.id) === vehicleId) ?? null,
    [vehicles, vehicleId],
  )
  const kmValue = km === '' ? null : Number(km)
  const goesBack =
    kmValue !== null && summary?.km_current != null && kmValue < summary.km_current

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!vehicle || kmValue === null || Number.isNaN(kmValue)) return
    setSaving(true)
    setError('')
    const payload = { vehicle: vehicle.id, km_reading: kmValue, reading_date: date }
    try {
      const reading = await createKmReading(payload)
      setSaved({
        plate: vehicle.plate,
        km: reading.km_reading ?? kmValue,
        driven: summary?.km_current != null ? kmValue - summary.km_current : null,
        queued: false,
      })
      setKm('')
      // Refresca la referencia para un posible segundo registro.
      fetchVehicleSummary(vehicle.id).then(setSummary, () => {})
    } catch (err) {
      // Sin red (M7): a la cola offline — se enviará al reconectar.
      if (isNetworkError(err)) {
        await enqueue({ kind: 'km', payload })
        setSaved({
          plate: vehicle.plate,
          km: kmValue,
          driven: summary?.km_current != null ? kmValue - summary.km_current : null,
          queued: true,
        })
        setKm('')
      } else {
        setError(readableError(err))
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>

  if (saved) {
    return (
      <div className="km-saved">
        <CheckCircle2 size={52} aria-hidden className={saved.queued ? 'km-saved-queued' : 'km-saved-icon'} />
        <h2>{saved.queued ? t.km.queuedTitle : t.km.savedTitle}</h2>
        {saved.queued && <p className="km-saved-detail">{t.km.queuedNote}</p>}
        <p className="km-saved-detail">
          {saved.plate}: <strong>{fmtKm(saved.km)}</strong>
        </p>
        {saved.driven !== null && (
          <p className="km-saved-detail">
            {t.km.drivenPrefix}
            <strong>{fmtKm(saved.driven)}</strong>
            {t.km.drivenSuffix}
          </p>
        )}
        <div className="request-actions">
          <Button onClick={() => setSaved(null)}>{t.km.another}</Button>
          <Link to="/" className="back-link center">
            {t.km.backHome}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="field-page">
      <PageHeader title={t.km.title} />

      {vehicles.length > 1 ? (
        <SelectField
          label={t.km.vehicle}
          options={[
            { value: '', label: t.km.choose },
            ...vehicles.map((v) => ({
              value: String(v.id),
              label: `${v.plate} · ${v.brand} ${v.model}`,
            })),
          ]}
          value={vehicleId}
          onValueChange={setVehicleId}
        />
      ) : (
        vehicle && (
          <p className="km-vehicle">
            <span className="plate">{vehicle.plate}</span> · {vehicle.brand} {vehicle.model}
          </p>
        )
      )}

      {summary && (
        <Panel tone={pendingThisMonth(summary) ? 'warning' : undefined}>
          <p className="panel-note">
            <Gauge size={16} aria-hidden />{' '}
            {summary.km_current != null ? (
              <>
                {t.km.lastReading} <strong>{fmtKm(summary.km_current)}</strong>
                {summary.km_reading_date ? ` (${fmtDate(summary.km_reading_date)})` : ''}
                {pendingThisMonth(summary) ? t.km.missingMonth : ''}
              </>
            ) : (
              t.km.firstReading
            )}
          </p>
          {recent.length > 1 && (
            <ul className="km-recent">
              {recent.map((r) => (
                <li key={r.id}>
                  <span>{fmtDate(r.reading_date)}</span>
                  <strong>{fmtKm(r.km_reading)}</strong>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {vehicleId && (
        <form className="modal-form" onSubmit={handleSubmit}>
          <label className="km-input-label">
            <span>{t.km.odometer}</span>
            <input
              className="km-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder={summary?.km_current != null ? String(summary.km_current) : '0'}
              value={km}
              onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
          </label>
          {goesBack && (
            <div role="alert" className="form-error">
              {t.km.noGoBack(fmtKm(summary?.km_current))}
            </div>
          )}
          <label className="file-field">
            <span>{t.km.date}</span>
            <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          </label>
          {error && <div role="alert" className="form-error">{error}</div>}
          <Button type="submit" disabled={saving || kmValue === null || goesBack}>
            {saving ? t.km.saving : t.km.save}
          </Button>
        </form>
      )}
    </div>
  )
}
