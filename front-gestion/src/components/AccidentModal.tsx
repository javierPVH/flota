import { useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createIncident, updateVehicleFields, uploadDocument } from '../api.ts'
import { todayIso } from '../format.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { Vehicle } from '../types.ts'

// Máximo del datetime-local: el accidente no puede ser futuro (lo valida
// también el back). Mismo cálculo que la PWA.
const nowLocalDateTime = () => {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 16)
}

// Líneas repetibles del parte — los MISMOS campos que la PWA (NewIncidentPage):
// el back los valida en `details` y los materializa en sus tablas.
type ThirdParty = {
  full_name: string
  plate: string
  brand: string
  model: string
  phone: string
  insurer: string
  policy_number: string
  damage_description: string
}
type InjuredPerson = { full_name: string; phone: string; email: string; plate: string; seat: string }

const emptyThirdParty = (): ThirdParty => ({
  full_name: '',
  plate: '',
  brand: '',
  model: '',
  phone: '',
  insurer: '',
  policy_number: '',
  damage_description: '',
})
const emptyInjuredPerson = (): InjuredPerson => ({
  full_name: '',
  phone: '',
  email: '',
  plate: '',
  seat: 'driver',
})

interface Props {
  vehicle: Vehicle
  onClose: () => void
  onDone: () => void
}

/** Comunicación de accidente desde gestión (menú ⋮ del vehículo): el mismo
 * parte guiado que la PWA — dónde y cuándo, daños, terceros implicados y
 * lesionados, atestado y archivo. Abre una petición de accidente (visible en
 * «Estados abiertos») y, si se deja marcado, pasa el coche a «Accidentado». */
export function AccidentModal({ vehicle, onClose, onDone }: Props) {
  const copy = useVehiclesCopy()
  const t = copy.accident

  const [form, setForm] = useState({
    street: '',
    streetNumber: '',
    postalCode: '',
    locality: '',
    province: '',
    occurredAt: '',
    phone: '',
    workshopCp: '',
    damages: '',
    policeRef: '',
  })
  const setField = (name: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [name]: value }))

  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([])
  const [injuredPeople, setInjuredPeople] = useState<InjuredPerson[]>([])
  const updateThirdParty = (index: number, patch: Partial<ThirdParty>) =>
    setThirdParties((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const updateInjured = (index: number, patch: Partial<InjuredPerson>) =>
    setInjuredPeople((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const [reportFile, setReportFile] = useState<File | null>(null)
  // El accidente deja el coche «Accidentado» salvo que se desmarque (o ya lo esté).
  const vehicleAlreadyAccident = vehicle.state === 'accidente'
  const [markState, setMarkState] = useState(!vehicleAlreadyAccident)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      // 1) La petición de accidente con su parte guiado (contrato de la PWA:
      // el back lo valida y lo materializa en las tablas del parte).
      const incident = await createIncident({
        vehicle: vehicle.id,
        type: 'accident',
        date: form.occurredAt ? form.occurredAt.slice(0, 10) : todayIso(),
        description: form.damages.trim(),
        workshop_postal_code: form.workshopCp,
        details: {
          report_version: 1,
          street: form.street,
          street_number: form.streetNumber,
          postal_code: form.postalCode,
          locality: form.locality,
          province: form.province,
          occurred_at: form.occurredAt,
          phone: form.phone,
          damage_description: form.damages.trim(),
          police_report_reference: form.policeRef,
          third_parties: thirdParties,
          injured_people: injuredPeople,
        },
      })
      const parts: string[] = [t.created]
      // 2) El estado del vehículo (opt-out con la casilla).
      if (markState && !vehicleAlreadyAccident) {
        await updateVehicleFields(vehicle.id, {
          state: 'accidente',
          change_reason: form.damages.trim(),
          expected_updated_at: vehicle.updated_at,
        })
        parts.push(t.stateChanged)
      }
      // 3) El archivo del parte, ligado a la petición (best-effort: el parte
      // ya está comunicado; un fallo de subida no lo tumba).
      if (reportFile) {
        try {
          await uploadDocument(
            { vehicle: vehicle.id, incident: incident.id, type: 'accident_report' },
            reportFile,
          )
        } catch {
          parts.push(t.fileFailed(reportFile.name))
        }
      }
      onDone()
      setInfo(parts.join(' '))
    } catch (err) {
      setError(asErrorMessage(err, t.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  if (info) {
    return (
      <div className="ops-modal">
        <div className="ops-success" role="status">{info}</div>
        <div className="ops-actions">
          <Button variant="primary" onClick={onClose}>{copy.ops.close}</Button>
        </div>
      </div>
    )
  }

  return (
    <form className="ops-modal" onSubmit={submit}>
      <p className="muted ops-note">{t.dataSection}</p>
      <TextInputField
        label={t.street}
        aria-label={t.street}
        value={form.street}
        onChange={(e) => setField('street', e.target.value)}
        required
      />
      <div className="ops-grid">
        <TextInputField
          label={t.streetNumber}
          aria-label={t.streetNumber}
          value={form.streetNumber}
          onChange={(e) => setField('streetNumber', e.target.value)}
        />
        <TextInputField
          label={t.postalCode}
          aria-label={t.postalCode}
          inputMode="numeric"
          pattern="[0-9]{5}"
          maxLength={5}
          value={form.postalCode}
          onChange={(e) => setField('postalCode', e.target.value)}
          required
        />
      </div>
      <div className="ops-grid">
        <TextInputField
          label={t.locality}
          aria-label={t.locality}
          value={form.locality}
          onChange={(e) => setField('locality', e.target.value)}
          required
        />
        <TextInputField
          label={t.province}
          aria-label={t.province}
          value={form.province}
          onChange={(e) => setField('province', e.target.value)}
          required
        />
      </div>
      <TextInputField
        label={t.occurredAt}
        aria-label={t.occurredAt}
        type="datetime-local"
        max={nowLocalDateTime()}
        value={form.occurredAt}
        onChange={(e) => setField('occurredAt', e.target.value)}
        required
      />
      <div className="ops-grid">
        <TextInputField
          label={t.phone}
          aria-label={t.phone}
          type="tel"
          value={form.phone}
          onChange={(e) => setField('phone', e.target.value)}
          required
        />
        <TextInputField
          label={t.workshopCp}
          aria-label={t.workshopCp}
          inputMode="numeric"
          pattern="[0-9]{5}"
          maxLength={5}
          value={form.workshopCp}
          onChange={(e) => setField('workshopCp', e.target.value)}
        />
      </div>
      <label className="ops-field-label" htmlFor="accident-damages">{t.damages}</label>
      <textarea
        id="accident-damages"
        className="ops-textarea"
        rows={4}
        value={form.damages}
        onChange={(e) => setField('damages', e.target.value)}
        required
      />

      {/* Terceros implicados: líneas repetibles, como en el parte de la PWA. */}
      <div className="acc-repeat-head">
        <h4>{t.thirdParties}</h4>
        <Button type="button" size="sm" variant="secondary" onClick={() => setThirdParties((rows) => [...rows, emptyThirdParty()])}>
          <Plus size={15} aria-hidden /> {t.add}
        </Button>
      </div>
      {thirdParties.map((row, index) => (
        <div className="acc-repeat-card" key={`third-${index}`}>
          <div className="acc-repeat-card-head">
            <strong>{t.thirdParties} · {index + 1}</strong>
            <Button
              type="button"
              size="sm"
              variant="danger"
              aria-label={t.removeThirdParty}
              onClick={() => setThirdParties((rows) => rows.filter((_, i) => i !== index))}
            >
              <Trash2 size={15} aria-hidden />
            </Button>
          </div>
          <div className="ops-grid">
            <TextInputField label={t.tpFullName} aria-label={t.tpFullName} value={row.full_name} onChange={(e) => updateThirdParty(index, { full_name: e.target.value })} />
            <TextInputField label={t.tpPlate} aria-label={t.tpPlate} value={row.plate} onChange={(e) => updateThirdParty(index, { plate: e.target.value })} />
            <TextInputField label={t.tpBrand} aria-label={t.tpBrand} value={row.brand} onChange={(e) => updateThirdParty(index, { brand: e.target.value })} />
            <TextInputField label={t.tpModel} aria-label={t.tpModel} value={row.model} onChange={(e) => updateThirdParty(index, { model: e.target.value })} />
            <TextInputField label={t.tpPhone} aria-label={t.tpPhone} type="tel" value={row.phone} onChange={(e) => updateThirdParty(index, { phone: e.target.value })} />
            <TextInputField label={t.tpInsurer} aria-label={t.tpInsurer} value={row.insurer} onChange={(e) => updateThirdParty(index, { insurer: e.target.value })} />
            <TextInputField label={t.tpPolicy} aria-label={t.tpPolicy} value={row.policy_number} onChange={(e) => updateThirdParty(index, { policy_number: e.target.value })} />
          </div>
          <label className="ops-field-label" htmlFor={`accident-tp-damages-${index}`}>{t.tpDamages}</label>
          <textarea
            id={`accident-tp-damages-${index}`}
            className="ops-textarea"
            rows={2}
            value={row.damage_description}
            onChange={(e) => updateThirdParty(index, { damage_description: e.target.value })}
          />
        </div>
      ))}

      {/* Lesionados. */}
      <div className="acc-repeat-head">
        <h4>{t.injured}</h4>
        <Button type="button" size="sm" variant="secondary" onClick={() => setInjuredPeople((rows) => [...rows, emptyInjuredPerson()])}>
          <Plus size={15} aria-hidden /> {t.add}
        </Button>
      </div>
      {injuredPeople.map((row, index) => (
        <div className="acc-repeat-card" key={`injured-${index}`}>
          <div className="acc-repeat-card-head">
            <strong>{t.injured} · {index + 1}</strong>
            <Button
              type="button"
              size="sm"
              variant="danger"
              aria-label={t.removeInjured}
              onClick={() => setInjuredPeople((rows) => rows.filter((_, i) => i !== index))}
            >
              <Trash2 size={15} aria-hidden />
            </Button>
          </div>
          <div className="ops-grid">
            <TextInputField label={t.tpFullName} aria-label={t.tpFullName} value={row.full_name} onChange={(e) => updateInjured(index, { full_name: e.target.value })} />
            <TextInputField label={t.tpPhone} aria-label={t.tpPhone} type="tel" value={row.phone} onChange={(e) => updateInjured(index, { phone: e.target.value })} />
            <TextInputField label={t.injEmail} aria-label={t.injEmail} type="email" value={row.email} onChange={(e) => updateInjured(index, { email: e.target.value })} />
            <TextInputField label={t.injPlate} aria-label={t.injPlate} value={row.plate} onChange={(e) => updateInjured(index, { plate: e.target.value })} />
            <SelectField
              label={t.injSeat}
              aria-label={t.injSeat}
              required
              options={[
                { value: 'driver', label: t.seatDriver },
                { value: 'passenger', label: t.seatPassenger },
              ]}
              value={row.seat}
              onValueChange={(seat) => updateInjured(index, { seat })}
            />
          </div>
        </div>
      ))}

      <div className="ops-grid">
        <TextInputField
          label={t.policeRef}
          aria-label={t.policeRef}
          value={form.policeRef}
          onChange={(e) => setField('policeRef', e.target.value)}
        />
      </div>
      <label className="file-field">
        <span>{t.file}</span>
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf"
          onChange={(e) => setReportFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {!vehicleAlreadyAccident && (
        <label className="baja-toggle">
          <input
            type="checkbox"
            checked={markState}
            onChange={(e) => setMarkState(e.target.checked)}
          />
          {t.markState}
        </label>
      )}

      {error && <div role="alert" className="form-error">{error}</div>}

      <div className="ops-actions">
        <Button type="button" variant="secondary" onClick={onClose}>{copy.ops.cancel}</Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? t.sending : t.submit}
        </Button>
      </div>
    </form>
  )
}
