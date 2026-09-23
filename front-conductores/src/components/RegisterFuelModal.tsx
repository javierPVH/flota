import { useState, type FormEvent } from 'react'
import { Fuel } from 'lucide-react'
import { Button, Panel } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { addFuelEntry } from '../api.ts'
import { fmtDate, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { isNetworkError, newClientRef, safeEnqueue } from '../offline/queue.ts'
import type { Vehicle, VehicleSummary } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

/** Coma o punto: el teclado numérico del móvil da lo que da. */
const decimal = (value: string) => value.replace(',', '.').trim()
/** Lo tecleado como número, o null si el campo está vacío. */
const asNumber = (value: string) => (value.trim() === '' ? null : Number(decimal(value)))

/** Campo decimal de campo: teclado numérico del móvil y solo cifras, coma o punto. */
function DecimalField({
  label,
  required,
  placeholder,
  value,
  onChange,
  autoFocus,
}: {
  label: string
  required?: boolean
  placeholder: string
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  const { t } = useLang()
  return (
    <label className="km-input-label">
      <span>
        {label}
        {required && (
          <>
            {' '}
            <span className="req-badge" aria-hidden>{t.common.required}</span>
          </>
        )}
      </span>
      <input
        className="km-input"
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9.,]/g, ''))}
        autoFocus={autoFocus}
        required={required}
      />
    </label>
  )
}

/**
 * GAP-2 — Consumo medio de campo, hermano del modal de km: se anota lo que
 * marca el ORDENADOR DE A BORDO (l/100km o kWh/100km) para el último trayecto o
 * ciclo de repostaje, con el día. Cada anotación es una fila: ni litros, ni
 * importe, ni origen, ni una cifra por mes. La nota de arriba dice qué cifra
 * se anota y cuál no (el histórico acumulado del coche no sirve).
 *
 * Sin red va a la cola offline (M7): en una gasolinera de obra es lo normal.
 */
export function FuelPane({
  vehicle,
  summary,
  onSaved,
  onCancel,
}: {
  vehicle: Vehicle
  summary: VehicleSummary | null
  /** Guardado. El mensaje es para quien enmarca (la pestaña lo enseña). */
  onSaved: (message: string) => void
  onCancel?: () => void
}) {
  const { t, language } = useLang()
  const [consumption, setConsumption] = useState('')
  const [date, setDate] = useState(todayIso())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // R5-50: UNA referencia por captura, no por pulsación. Si el POST llegó pero
  // la respuesta se perdió (502/504/429), el reintento manual manda la misma y
  // el back no crea otra anotación. El modal se remonta al cerrarse.
  const [clientRef] = useState(newClientRef)

  const value = asNumber(consumption)
  const valueOk = value !== null && !Number.isNaN(value) && value > 0
  const dateOk = Boolean(date) && date <= todayIso()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!valueOk || !dateOk) return
    setSaving(true)
    setError('')
    const payload = {
      vehicle: vehicle.id,
      avg_consumption: decimal(consumption),
      // R3-37: el día se fija AL CAPTURAR, no cuando el servidor procese el
      // reenvío — una anotación encolada sin cobertura es de SU día aunque la
      // cola la entregue más tarde.
      reading_date: date,
      // R3-34: misma referencia en el intento directo y en el reenvío — si la
      // respuesta se perdió por el camino, el back no crea otra fila.
      client_ref: clientRef,
    }
    const hecho = () => {
      setConsumption('')
      onSaved(t.fuel.saved)
    }
    try {
      await addFuelEntry(payload)
      hecho()
    } catch (caught) {
      if (isNetworkError(caught) && (await safeEnqueue({ kind: 'fuel', payload }))) {
        hecho()
      } else {
        setError(asErrorMessage(caught, t.fuel.saveError))
      }
    } finally {
      setSaving(false)
    }
  }

  const last = summary?.fuel_avg_consumption ?? null
  const lastDate = summary?.fuel_avg_date ?? null

  return (
    <form id="vehicle-fuel-form" className="modal-form" onSubmit={submit}>
      {/* Qué cifra se anota, y cuál no: la misma nota que en gestión. */}
      <Panel>
        <p className="panel-note">
          <Fuel size={16} aria-hidden /> {t.fuel.noteLead}
        </p>
        <p className="panel-note"><strong>{t.fuel.noteWarn}</strong></p>
      </Panel>
      <DecimalField
        label={t.fuel.consumption}
        required
        placeholder={t.fuel.consumptionPlaceholder}
        value={consumption}
        onChange={setConsumption}
        autoFocus
      />
      <label className="km-input-label">
        <span>
          {t.fuel.date} <span className="req-badge" aria-hidden>{t.common.required}</span>
        </span>
        <input
          className="km-input"
          type="date"
          max={todayIso()}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
      </label>
      {/* La última anotación, solo si el resumen ha llegado — sin él no se
          sabe, y no es lo mismo que «sin anotaciones». */}
      {summary && (
        <p className="doc-sub">
          {last !== null ? (
            <>
              {t.fuel.lastNoted}:{' '}
              <strong>
                {Number(last).toLocaleString(language, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </strong>
              {lastDate ? ` · ${fmtDate(lastDate)}` : ''}
            </>
          ) : (
            t.fuel.noneYet
          )}
        </p>
      )}
      {error && <div role="alert" className="form-error">{error}</div>}
      <div className="form-actions">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>{t.common.cancel}</Button>
        )}
        <Button type="submit" disabled={saving || !valueOk || !dateOk}>
          {saving ? t.fuel.saving : t.fuel.save}
        </Button>
      </div>
    </form>
  )
}

/** La misma anotación, en su propia ventana (ficha, tarjeta y nav de campo). */
export function RegisterFuelModal({
  vehicle,
  summary,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  summary: VehicleSummary | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLang()
  return (
    <SupervisorModal open title={`${t.fuel.title} · ${vehicle.plate}`} onClose={onClose}>
      <FuelPane
        vehicle={vehicle}
        summary={summary}
        onCancel={onClose}
        onSaved={() => {
          onSaved()
          onClose()
        }}
      />
    </SupervisorModal>
  )
}
