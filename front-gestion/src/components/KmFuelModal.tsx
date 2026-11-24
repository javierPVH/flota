import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Pencil } from 'lucide-react'
import { Button, Modal, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  createFuelConsumption,
  createKmReading,
  listAll,
  listFuelConsumptions,
  listKmReadingsAll,
  updateFuelConsumption,
  updateKmReading,
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
 *
 * En las dos, la **última** anotación se puede MODIFICAR (el lápiz de la
 * primera fila): el formulario de registrar deja su sitio al de corregir, y al
 * guardar sale un **aviso** con el antes y el después; solo con «Siguiente» se
 * escribe. No crea un registro nuevo: corrige el que hay, y el cambio queda en
 * el histórico de la ficha, de donde se revierte.
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

  // --- Modificar la última anotación ----------------------------------------
  // `editing` es lo que se está corrigiendo (con lo tecleado); `confirming`,
  // que el aviso está abierto y falta el «Siguiente».
  const [editing, setEditing] = useState<{
    kind: 'km' | 'fuel'
    id: number
    value: string
    date: string
  } | null>(null)
  const [confirming, setConfirming] = useState(false)
  // Registrar una anotación nueva con una corrección de campo esperando la
  // ANULA (el back, sola): antes se avisa, y solo «Registrar y anular» sigue.
  const [superseding, setSuperseding] = useState<'km' | 'fuel' | null>(null)
  const lastFuel = fuelRows?.[0] ?? null

  function switchTab(next: 'km' | 'fuel') {
    setTab(next)
    setError('')
    setNotice('')
    setEditing(null)
  }

  function startEdit(kind: 'km' | 'fuel') {
    setError('')
    setNotice('')
    if (kind === 'km' && lastReading) {
      setEditing({
        kind,
        id: lastReading.id,
        value: lastReading.km_reading === null ? '' : String(lastReading.km_reading),
        date: lastReading.reading_date ?? '',
      })
    } else if (kind === 'fuel' && lastFuel) {
      setEditing({
        kind,
        id: lastFuel.id,
        value: lastFuel.avg_consumption,
        date: lastFuel.reading_date,
      })
    }
  }

  /** Lo que el registro dice hoy y lo que se ha tecleado, ya legibles. */
  function editSummary() {
    if (!editing) return null
    const fecha = (iso: string | null) => (iso ? fmtDate(iso, language) : '—')
    if (editing.kind === 'km') {
      const valueChanged = Number(editing.value) !== lastReading?.km_reading
      const dateChanged = editing.date !== (lastReading?.reading_date ?? '')
      return {
        changed: valueChanged || dateChanged,
        valueChanged,
        dateChanged,
        before: `${lastReading?.km_reading == null ? '—' : fmtKm(lastReading.km_reading, language)} · ${fecha(lastReading?.reading_date ?? null)}`,
        after: `${fmtKm(Number(editing.value), language)} · ${fecha(editing.date)}`,
      }
    }
    const valueChanged = Number(editing.value) !== Number(lastFuel?.avg_consumption)
    const dateChanged = editing.date !== (lastFuel?.reading_date ?? '')
    return {
      changed: valueChanged || dateChanged,
      valueChanged,
      dateChanged,
      before: `${fmtConsumption(lastFuel?.avg_consumption ?? null, language)} · ${fecha(lastFuel?.reading_date ?? null)}`,
      after: `${fmtConsumption(editing.value, language)} · ${fecha(editing.date)}`,
    }
  }

  /** Guardar la corrección NO escribe: abre el aviso. */
  function submitEdit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    if (!editSummary()?.changed) {
      setError(t.editNothing)
      return
    }
    setConfirming(true)
  }

  /** «Siguiente» del aviso: ahora sí se escribe, y solo lo que cambia. */
  async function applyEdit() {
    const summary = editSummary()
    if (!editing || !summary) return
    setSaving(true)
    setError('')
    try {
      if (editing.kind === 'km') {
        await updateKmReading(editing.id, {
          ...(summary.valueChanged ? { km_reading: Number(editing.value) } : {}),
          ...(summary.dateChanged ? { reading_date: editing.date } : {}),
        })
        setNotice(t.editKmSaved)
        loadReadings()
      } else {
        await updateFuelConsumption(editing.id, {
          ...(summary.valueChanged ? { avg_consumption: editing.value } : {}),
          ...(summary.dateChanged ? { reading_date: editing.date } : {}),
        })
        setNotice(t.editFuelSaved)
        loadFuel()
      }
      setEditing(null)
      onDone()
    } catch (err) {
      // El motivo (p. ej. el odómetro retrocedería) se lee en el formulario
      // de corregir, que sigue abierto con lo tecleado.
      setError(asErrorMessage(err, t.errGeneric))
    } finally {
      setConfirming(false)
      setSaving(false)
    }
  }

  /** El formulario de corregir: el mismo par cifra + fecha, sobre el registro. */
  function editForm(kind: 'km' | 'fuel') {
    if (!editing) return null
    return (
      <form className="ops-form" onSubmit={submitEdit}>
        <p className="ops-field-label">{kind === 'km' ? t.editKmTitle : t.editFuelTitle}</p>
        <p className="muted ops-note">{t.editHint}</p>
        <div className="kmfuel-row">
          <TextInputField
            label={kind === 'km' ? t.kmLabel : t.consumptionLabel}
            aria-label={kind === 'km' ? t.kmLabel : t.consumptionLabel}
            type="number"
            min={0}
            step={kind === 'km' ? 1 : '0.01'}
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            required
          />
          <TextInputField
            label={kind === 'km' ? t.dateLabel : t.fuelDateLabel}
            aria-label={kind === 'km' ? t.dateLabel : t.fuelDateLabel}
            type="date"
            max={todayIso()}
            value={editing.date}
            onChange={(e) => setEditing({ ...editing, date: e.target.value })}
            required
          />
        </div>
        <div className="ops-actions">
          <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
            {t.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {t.editSave}
          </Button>
        </div>
      </form>
    )
  }

  function submitKm(e: FormEvent) {
    e.preventDefault()
    if (lastReading?.pending_change) setSuperseding('km')
    else void saveKm()
  }

  async function saveKm() {
    setSuperseding(null)
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

  function submitFuel(e: FormEvent) {
    e.preventDefault()
    if (fuelRows?.[0]?.pending_change) setSuperseding('fuel')
    else void saveFuel()
  }

  async function saveFuel() {
    setSuperseding(null)
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

      {tab === 'km' && editing?.kind === 'km' && editForm('km')}
      {tab === 'km' && editing?.kind !== 'km' && (
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

          {lastReading?.pending_change && (
            <p className="muted ops-note" role="note">
              {t.editPending}
            </p>
          )}
          {/* Las últimas lecturas, para ver la serie sin salir del modal. */}
          <p className="ops-field-label">{t.kmRecentTitle}</p>
          {readings !== null && readings.length === 0 ? (
            <p className="muted ops-note">{t.noReadings}</p>
          ) : (
            <ul className="kmfuel-months">
              {(readings ?? []).slice(0, 5).map((row, index) => (
                <li key={row.id}>
                  <span>{row.reading_date ? fmtDate(row.reading_date, language) : '—'}</span>
                  <span>
                    {row.km_reading !== null ? fmtKm(row.km_reading, language) : '—'}
                    {row.estimated ? ` ${t.estimatedTag}` : ''}
                  </span>
                  {/* Solo la ÚLTIMA se modifica desde aquí. */}
                  {index === 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={Boolean(row.pending_change)}
                      title={row.pending_change ? t.editPending : undefined}
                      onClick={() => startEdit('km')}
                    >
                      <Pencil size={14} aria-hidden /> {t.editLast}
                    </Button>
                  )}
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

      {tab === 'fuel' && editing?.kind === 'fuel' && editForm('fuel')}
      {tab === 'fuel' && editing?.kind !== 'fuel' && (
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
          {lastFuel?.pending_change && (
            <p className="muted ops-note" role="note">
              {t.editPending}
            </p>
          )}
          {/* Las últimas anotaciones, para ver la serie de un vistazo. */}
          <p className="ops-field-label">{t.recentTitle}</p>
          {fuelRows !== null && fuelRows.length === 0 ? (
            <p className="muted ops-note">{t.fuelEmpty}</p>
          ) : (
            <ul className="kmfuel-months">
              {(fuelRows ?? []).slice(0, 10).map((row, index) => (
                <li key={row.id}>
                  <span>{fmtDate(row.reading_date, language)}</span>
                  <span>{fmtConsumption(row.avg_consumption, language)}</span>
                  {/* Solo la ÚLTIMA se modifica desde aquí. */}
                  {index === 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={Boolean(row.pending_change)}
                      title={row.pending_change ? t.editPending : undefined}
                      onClick={() => startEdit('fuel')}
                    >
                      <Pencil size={14} aria-hidden /> {t.editLast}
                    </Button>
                  )}
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

      {/* El aviso de que registrar anula la corrección que esperaba. */}
      <Modal
        open={superseding !== null}
        title={t.supersedeTitle}
        onClose={() => setSuperseding(null)}
      >
        <div className="modal-form">
          <p role="alert" style={{ margin: 0 }}>
            {superseding === 'fuel' ? t.supersedeFuel : t.supersedeKm}
          </p>
          <div className="ops-actions">
            <Button type="button" variant="secondary" onClick={() => setSuperseding(null)}>
              {t.cancel}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void (superseding === 'fuel' ? saveFuel() : saveKm())}
            >
              {t.supersedeContinue}
            </Button>
          </div>
        </div>
      </Modal>

      {/* El aviso: guardar la corrección no escribe hasta «Siguiente». */}
      <Modal open={confirming} title={t.editWarnTitle} onClose={() => setConfirming(false)}>
        <div className="modal-form">
          <p role="alert" style={{ margin: 0 }}>
            {t.editWarn(
              editing?.kind === 'fuel' ? t.editWhatFuel : t.editWhatKm,
              editSummary()?.before ?? '',
              editSummary()?.after ?? '',
            )}
          </p>
          <div className="ops-actions">
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              {t.cancel}
            </Button>
            <Button type="button" variant="primary" disabled={saving} onClick={applyEdit}>
              {saving ? t.saving : t.editNext}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
