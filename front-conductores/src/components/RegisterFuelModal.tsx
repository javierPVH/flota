import { useState, type FormEvent } from 'react'
import { Fuel } from 'lucide-react'
import { Button, Panel } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { addFuelEntry } from '../api.ts'
import { fmtEur, fmtLiters, todayIso } from '../format.ts'
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
 * GAP-2 — Gasto de combustible de campo, hermano del modal de km: se apunta el
 * repostaje (litros y lo pagado) y el back lo SUMA al mes en curso, porque la
 * serie de consumo es mensual (una fila por vehículo y mes). Por eso la pista
 * de arriba es «este mes ya llevas…» y no «última lectura».
 *
 * Sin red va a la cola offline (M7): en una gasolinera de obra es lo normal.
 */
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
  const { t, language } = useLang()
  const [liters, setLiters] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const litersValue = asNumber(liters)
  const amountValue = asNumber(amount)
  const litersOk = litersValue !== null && !Number.isNaN(litersValue) && litersValue > 0
  const amountOk = amountValue === null || (!Number.isNaN(amountValue) && amountValue >= 0)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!litersOk || !amountOk) return
    setSaving(true)
    setError('')
    const payload = {
      vehicle: vehicle.id,
      liters: decimal(liters),
      amount: amount.trim() === '' ? null : decimal(amount),
      // R3-37: el mes se fija AL CAPTURAR, no cuando el servidor procese el
      // reenvío — un repostaje del día 31 encolado sin cobertura debe sumar a
      // SU mes aunque la cola lo entregue el día 1 del siguiente.
      period: `${todayIso().slice(0, 7)}-01`,
      // R3-34: misma referencia en el intento directo y en el reenvío — si la
      // respuesta se perdió por el camino, el back no vuelve a sumar.
      client_ref: newClientRef(),
    }
    try {
      await addFuelEntry(payload)
      onSaved()
      onClose()
    } catch (caught) {
      if (isNetworkError(caught) && (await safeEnqueue({ kind: 'fuel', payload }))) {
        onSaved()
        onClose()
      } else {
        setError(asErrorMessage(caught, t.fuel.saveError))
      }
    } finally {
      setSaving(false)
    }
  }

  const monthLiters = summary?.fuel_month_liters ?? null

  return (
    <SupervisorModal
      open
      title={`${t.fuel.title} · ${vehicle.plate}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
          <Button type="submit" form="vehicle-fuel-form" disabled={saving || !litersOk || !amountOk}>
            {saving ? t.fuel.saving : t.fuel.save}
          </Button>
        </>
      }
    >
      <form id="vehicle-fuel-form" className="modal-form" onSubmit={submit}>
        {/* Lo que ya lleva el mes: el repostaje se SUMA a esta cifra. Solo si
            el resumen ha llegado — sin él no se sabe, y no es lo mismo que
            «sin gasto». */}
        {summary && (
          <Panel>
            <p className="panel-note">
              <Fuel size={16} aria-hidden />{' '}
              {monthLiters !== null ? (
                <>
                  {t.fuel.monthSoFar} <strong>{fmtLiters(monthLiters, language)}</strong>
                  {summary.fuel_month_amount
                    ? ` · ${fmtEur(summary.fuel_month_amount, language)}`
                    : ''}
                </>
              ) : (
                t.fuel.monthEmpty
              )}
            </p>
          </Panel>
        )}
        <DecimalField
          label={t.fuel.liters}
          required
          placeholder="45,50"
          value={liters}
          onChange={setLiters}
          autoFocus
        />
        <DecimalField
          label={t.fuel.amount}
          placeholder="62,30"
          value={amount}
          onChange={setAmount}
        />
        <p className="doc-sub">{t.fuel.addsToMonth}</p>
        {error && <div role="alert" className="form-error">{error}</div>}
      </form>
    </SupervisorModal>
  )
}
