import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  createFuelConsumption,
  createKmReading,
  listAll,
  listFuelConsumptions,
  listKmReadingsAll,
  type FuelConsumption,
} from '../api.ts'
import { fmtConsumption, fmtDate, fmtKm, todayIso } from '../format.ts'
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
 * — Combustible: ANOTAR el consumo medio que marca el ordenador de a bordo
 *   (GAP-2, l/100km o kWh/100km) en una fecha con día. Cada anotación es una fila:
 *   ni litros, ni importe, ni origen, ni una cifra por mes. La nota de arriba
 *   es la misma que lee el conductor en la PWA: el consumo del último
 *   trayecto o ciclo de repostaje, no el histórico del coche.
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
  const [fuelDate, setFuelDate] = useState(todayIso())
  const [consumption, setConsumption] = useState('')

  const loadFuel = useCallback(() => {
    listAll(listFuelConsumptions({ vehicle: vehicle.id }))
      .then((rows) =>
        setFuelRows(
          [...rows].sort(
            (a, b) => b.reading_date.localeCompare(a.reading_date) || b.id - a.id,
          ),
        ),
      )
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
    try {
      // Cada anotación es una fila nueva: dos del mismo día son dos lecturas.
      await createFuelConsumption({
        vehicle: vehicle.id,
        reading_date: fuelDate,
        avg_consumption: consumption,
      })
      setNotice(t.fuelSaved)
      setConsumption('')
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
          {/* Qué cifra se anota: la misma nota que lee el conductor en la PWA. */}
          <p className="ops-note kmfuel-note">
            {t.fuelNoteLead}
            <br />
            <strong>{t.fuelNoteWarn}</strong>
          </p>
          {/* Primero cuánto y luego cuándo (con día), en la misma línea. */}
          <div className="kmfuel-row">
            <TextInputField
              label={t.consumptionLabel}
              aria-label={t.consumptionLabel}
              type="number"
              min={0}
              step="0.01"
              value={consumption}
              onChange={(e) => setConsumption(e.target.value)}
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
          {/* Las últimas anotaciones, para ver la serie de un vistazo. */}
          <p className="ops-field-label">{t.recentTitle}</p>
          {fuelRows !== null && fuelRows.length === 0 ? (
            <p className="muted ops-note">{t.fuelEmpty}</p>
          ) : (
            <ul className="kmfuel-months">
              {(fuelRows ?? []).slice(0, 10).map((row) => (
                <li key={row.id}>
                  <span>{fmtDate(row.reading_date, language)}</span>
                  <span>{fmtConsumption(row.avg_consumption, language)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="ops-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={saving || !consumption.trim()}>
              {saving ? t.saving : t.fuelSave}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
