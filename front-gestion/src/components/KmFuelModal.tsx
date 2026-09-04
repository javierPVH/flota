import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  createFuelConsumption,
  createKmReading,
  listAll,
  listFuelConsumptions,
  listKmReadingsAll,
  updateFuelConsumption,
  type FuelConsumption,
} from '../api.ts'
import { fmtDate, fmtKm, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { KmReading, Vehicle } from '../types.ts'

interface Props {
  vehicle: Vehicle
  onClose: () => void
  onDone: () => void
}

/**
 * Kilómetros y combustible del vehículo (menú ⋮), en dos pestañas:
 * — Kilómetros: registrar una lectura (HU-3.x; la del mes cierra su aviso).
 * — Combustible: la serie MENSUAL de consumo (GAP-2, solo litros; el importe
 *   se gestiona desde la ficha del vehículo y aquí NO se toca al actualizar);
 *   guardar sobre un mes ya registrado lo ACTUALIZA en vez de duplicarlo.
 */
export function KmFuelModal({ vehicle, onClose, onDone }: Props) {
  const t = useVehiclesCopy().kmFuel
  const { language } = useLang()

  const [tab, setTab] = useState<'km' | 'fuel'>('km')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // --- Kilómetros -----------------------------------------------------------
  const [lastReading, setLastReading] = useState<KmReading | null>(null)
  const [km, setKm] = useState('')
  const [kmDate, setKmDate] = useState(todayIso())

  const loadLastReading = useCallback(() => {
    listKmReadingsAll({ vehicle: vehicle.id })
      .then((page) => setLastReading(page.results[0] ?? null))
      .catch(() => setLastReading(null))
  }, [vehicle.id])
  useEffect(() => {
    loadLastReading()
  }, [loadLastReading])

  // --- Combustible (GAP-2) ---------------------------------------------------
  const [fuelRows, setFuelRows] = useState<FuelConsumption[] | null>(null)
  const [month, setMonth] = useState(todayIso().slice(0, 7))
  const [liters, setLiters] = useState('')

  const loadFuel = useCallback(() => {
    listAll(listFuelConsumptions({ vehicle: vehicle.id }))
      .then((rows) => setFuelRows([...rows].sort((a, b) => b.period.localeCompare(a.period))))
      .catch(() => setFuelRows([]))
  }, [vehicle.id])
  useEffect(() => {
    loadFuel()
  }, [loadFuel])

  function switchTab(next: 'km' | 'fuel') {
    setTab(next)
    setError('')
    setNotice('')
  }

  async function submitKm(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await createKmReading({
        vehicle: vehicle.id,
        km_reading: Number(km),
        reading_date: kmDate,
      })
      setNotice(t.kmSaved)
      setKm('')
      loadLastReading()
      onDone()
    } catch (err) {
      setError(asErrorMessage(err, t.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  async function submitFuel(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    // El mes es la clave de la serie: si ya está registrado, se actualiza.
    const existing = (fuelRows ?? []).find((row) => row.period.slice(0, 7) === month)
    try {
      if (existing) {
        // Solo los litros: el importe que tuviera la fila se conserva.
        await updateFuelConsumption(existing.id, { liters })
        setNotice(t.fuelUpdated)
      } else {
        await createFuelConsumption({
          vehicle: vehicle.id,
          period: `${month}-01`,
          liters,
          source: 'manual',
        })
        setNotice(t.fuelSaved)
      }
      setLiters('')
      loadFuel()
      onDone()
    } catch (err) {
      setError(asErrorMessage(err, t.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ops-modal">
      <div className="ops-tabs" role="tablist" aria-label={t.title(vehicle.plate)}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'km'}
          className={`ops-tab${tab === 'km' ? ' is-active' : ''}`}
          onClick={() => switchTab('km')}
        >
          {t.tabKm}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'fuel'}
          className={`ops-tab${tab === 'fuel' ? ' is-active' : ''}`}
          onClick={() => switchTab('fuel')}
        >
          {t.tabFuel}
        </button>
      </div>

      {notice && (
        <p className="ops-success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}

      {tab === 'km' && (
        <form className="ops-form" onSubmit={submitKm}>
          <p className="muted ops-note">
            {t.lastReading}:{' '}
            {lastReading && lastReading.km_reading !== null ? (
              <strong>
                {fmtKm(lastReading.km_reading, language)}
                {lastReading.reading_date ? ` · ${fmtDate(lastReading.reading_date, language)}` : ''}
                {lastReading.estimated ? ` ${t.estimatedTag}` : ''}
              </strong>
            ) : (
              t.noReadings
            )}
          </p>
          <div className="ops-grid">
            <TextInputField
              label={t.kmLabel}
              aria-label={t.kmLabel}
              type="number"
              min={0}
              value={km}
              onChange={(e) => setKm(e.target.value)}
              required
            />
            <TextInputField
              label={t.dateLabel}
              aria-label={t.dateLabel}
              type="date"
              max={todayIso()}
              value={kmDate}
              onChange={(e) => setKmDate(e.target.value)}
              required
            />
          </div>
          <div className="ops-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={saving || !km.trim()}>
              {saving ? t.saving : t.kmSave}
            </Button>
          </div>
        </form>
      )}

      {tab === 'fuel' && (
        <form className="ops-form" onSubmit={submitFuel}>
          <p className="muted ops-note">{t.fuelHint}</p>
          <div className="ops-grid">
            <TextInputField
              label={t.monthLabel}
              aria-label={t.monthLabel}
              type="month"
              max={todayIso().slice(0, 7)}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              required
            />
            <TextInputField
              label={t.litersLabel}
              aria-label={t.litersLabel}
              type="number"
              min={0}
              step="0.01"
              value={liters}
              onChange={(e) => setLiters(e.target.value)}
              required
            />
          </div>
          {/* Los últimos meses registrados, para ver la serie de un vistazo. */}
          <p className="ops-field-label">{t.recentTitle}</p>
          {fuelRows !== null && fuelRows.length === 0 ? (
            <p className="muted ops-note">{t.fuelEmpty}</p>
          ) : (
            <ul className="kmfuel-months">
              {(fuelRows ?? []).slice(0, 6).map((row) => (
                <li key={row.id}>
                  <span>{row.period.slice(0, 7)}</span>
                  <span>{Number(row.liters).toLocaleString(language)} L</span>
                </li>
              ))}
            </ul>
          )}
          <div className="ops-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={saving || !liters.trim()}>
              {saving ? t.saving : t.fuelSave}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
