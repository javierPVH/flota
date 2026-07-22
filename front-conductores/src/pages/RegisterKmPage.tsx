import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Gauge } from 'lucide-react'
import { Button, Panel, SelectField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createKmReading, fetchVehicleSummary, listVehicles } from '../api.ts'
import { fmtDate, fmtKm, pendingThisMonth } from '../format.ts'
import { enqueue, isNetworkError } from '../offline/queue.ts'
import type { Vehicle, VehicleSummary } from '../types.ts'

/** Hoy en formato de <input type="date"> (zona local, no UTC). */
function todayIso(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

/** Errores del servidor en claro: no-retroceso (400) y throttle (429).
 * El transporte del DS ya desenvuelve {detail, errors} al mensaje de campo. */
function readableError(err: unknown): string {
  const message = asErrorMessage(err, 'No se pudo guardar la lectura.')
  if (/throttled|Espera/i.test(message)) {
    return 'Demasiados registros seguidos. Espera un momento y reintenta.'
  }
  return message.replace(/^km_reading:\s*/, '')
}

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

  useEffect(() => {
    let alive = true
    listVehicles()
      .then((page) => {
        if (!alive) return
        setVehicles(page.results)
        // Sin preselección, con un solo coche no hay nada que elegir.
        if (!preselected && page.results.length === 1) setVehicleId(String(page.results[0].id))
      })
      .catch((err) => alive && setError(asErrorMessage(err, 'No se pudieron cargar tus vehículos.')))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [preselected])

  // Referencia: última lectura del vehículo elegido.
  useEffect(() => {
    setSummary(null)
    if (!vehicleId) return
    let alive = true
    fetchVehicleSummary(Number(vehicleId))
      .then((s) => alive && setSummary(s))
      .catch(() => alive && setSummary(null))
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

  if (loading) return <p className="gate-checking">Cargando…</p>

  if (saved) {
    return (
      <div className="km-saved">
        <CheckCircle2 size={52} aria-hidden className={saved.queued ? 'km-saved-queued' : 'km-saved-icon'} />
        <h2>{saved.queued ? 'Lectura en cola' : 'Lectura guardada'}</h2>
        {saved.queued && (
          <p className="km-saved-detail">
            Estás sin conexión: la lectura se enviará sola en cuanto vuelva la red.
          </p>
        )}
        <p className="km-saved-detail">
          {saved.plate}: <strong>{fmtKm(saved.km)}</strong>
        </p>
        {saved.driven !== null && (
          <p className="km-saved-detail">
            Has recorrido <strong>{fmtKm(saved.driven)}</strong> desde la última lectura.
          </p>
        )}
        <div className="request-actions">
          <Button onClick={() => setSaved(null)}>Registrar otra lectura</Button>
          <Link to="/" className="back-link center">
            Volver a mis vehículos
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="field-page">
      <div className="page-head">
        <h2>Registrar kilómetros</h2>
      </div>

      {vehicles.length > 1 ? (
        <SelectField
          label="Vehículo"
          options={[
            { value: '', label: 'Elige un vehículo…' },
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
                Última lectura: <strong>{fmtKm(summary.km_current)}</strong>
                {summary.km_reading_date ? ` (${fmtDate(summary.km_reading_date)})` : ''}
                {pendingThisMonth(summary) ? ' — falta la de este mes.' : ''}
              </>
            ) : (
              'Aún no hay lecturas: esta será la primera.'
            )}
          </p>
        </Panel>
      )}

      {vehicleId && (
        <form className="modal-form" onSubmit={handleSubmit}>
          <label className="km-input-label">
            <span>Odómetro (km totales del cuadro)</span>
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
            <div className="form-error">
              El odómetro no puede retroceder: la última lectura fue {fmtKm(summary?.km_current)}.
            </div>
          )}
          <label className="file-field">
            <span>Fecha de la lectura</span>
            <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          </label>
          {error && <div className="form-error">{error}</div>}
          <Button type="submit" disabled={saving || kmValue === null || goesBack}>
            {saving ? 'Guardando…' : 'Guardar lectura'}
          </Button>
        </form>
      )}
    </div>
  )
}
