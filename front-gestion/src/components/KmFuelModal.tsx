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
  /** Pestaña de salida: la ficha entra por «Combustible» desde su KPI. */
  initialTab?: 'km' | 'fuel'
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
export function KmFuelModal({ vehicle, initialTab = 'km', onClose, onDone }: Props) {
  const t = useVehiclesCopy().kmFuel
  const { language } = useLang()

  const [tab, setTab] = useState<'km' | 'fuel'>(initialTab)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // --- Kilómetros -----------------------------------------------------------
  // La serie entera (viene ordenada por fecha descendente): la primera es la
  // última lectura y las cinco primeras, el histórico corto de aquí.
  const [readings, setReadings] = useState<KmReading[] | null>(null)
  const [km, setKm] = useState('')
  const [kmDate, setKmDate] = useState(todayIso())
  const lastReading = readings?.[0] ?? null

  const loadReadings = useCallback(() => {
    listKmReadingsAll({ vehicle: vehicle.id })
      .then((page) => setReadings(page.results))
      .catch(() => setReadings([]))
  }, [vehicle.id])
  useEffect(() => {
    loadReadings()
  }, [loadReadings])

  // --- Combustible (GAP-2) ---------------------------------------------------
  const [fuelRows, setFuelRows] = useState<FuelConsumption[] | null>(null)
  // Fecha con día: es lo que se elige (y lo que se recuerda de un repostaje),
  // aunque la fila siga siendo EL MES —el back normaliza `period` al día 1—.
  const [fuelDate, setFuelDate] = useState(todayIso())
  const month = fuelDate.slice(0, 7)
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
      loadReadings()
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
          // El back lo normaliza al día 1: la serie es mensual.
          period: fuelDate,
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
          {/* Lectura y fecha van juntas: son un solo dato en dos campos. */}
          <div className="kmfuel-row">
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

          {/* Las últimas lecturas, para ver la serie sin salir del modal. */}
          <p className="ops-field-label">{t.kmRecentTitle}</p>
          {readings !== null && readings.length === 0 ? (
            <p className="muted ops-note">{t.noReadings}</p>
          ) : (
            <ul className="kmfuel-months">
              {(readings ?? []).slice(0, 5).map((row) => (
                <li key={row.id}>
                  <span>{row.reading_date ? fmtDate(row.reading_date, language) : '—'}</span>
                  <span>
                    {row.km_reading !== null ? fmtKm(row.km_reading, language) : '—'}
                    {row.estimated ? ` ${t.estimatedTag}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
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
          {/* Primero cuánto y luego cuándo, en la misma línea. */}
          <div className="kmfuel-row">
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
            <TextInputField
              label={t.fuelDateLabel}
              aria-label={t.fuelDateLabel}
              type="date"
              max={todayIso()}
              value={fuelDate}
              onChange={(e) => setFuelDate(e.target.value)}
              required
            />
          </div>
          {/* Los últimos meses registrados, para ver la serie de un vistazo. */}
          <p className="ops-field-label">{t.recentTitle}</p>
          {fuelRows !== null && fuelRows.length === 0 ? (
            <p className="muted ops-note">{t.fuelEmpty}</p>
          ) : (
            <ul className="kmfuel-months">
              {(fuelRows ?? []).slice(0, 10).map((row) => (
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
