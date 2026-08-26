import { useState, type FormEvent } from 'react'
import { Camera, Plus, Trash2 } from 'lucide-react'
import { Button, Modal, SelectField, TextAreaField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createIncident, uploadDocument } from '../api.ts'
import { todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const nowLocalDateTime = () => {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 16)
}

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
  full_name: '', plate: '', brand: '', model: '', phone: '', insurer: '',
  policy_number: '', damage_description: '',
})
const emptyInjuredPerson = (): InjuredPerson => ({
  full_name: '', phone: '', email: '', plate: '', seat: 'driver',
})

/** Parte guiado de accidente para el supervisor. Mantiene el mismo contrato
 * (`Incident.details.report_version = 1`) que Gestión y NewIncidentPage, de
 * modo que el back materializa AccidentReport, AccidentThirdParty y
 * AccidentInjured sin un flujo alternativo. */
export function AccidentModal({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  onClose: () => void
  onSaved?: () => void
}) {
  const { t } = useLang()
  const a = t.newIncident
  const [details, setDetails] = useState({
    street: '', street_number: '', postal_code: '', locality: '', province: '',
    occurred_at: '', phone: '', workshop_postal_code: '', damage_description: '',
    police_report_reference: '',
  })
  const [thirdParties, setThirdParties] = useState<ThirdParty[]>([])
  const [injuredPeople, setInjuredPeople] = useState<InjuredPerson[]>([])
  const [reportFile, setReportFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const setDetail = (name: keyof typeof details, value: string) =>
    setDetails((current) => ({ ...current, [name]: value }))
  const updateThirdParty = (index: number, patch: Partial<ThirdParty>) =>
    setThirdParties((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row))
  const updateInjured = (index: number, patch: Partial<InjuredPerson>) =>
    setInjuredPeople((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const incident = await createIncident({
        vehicle: vehicle.id,
        type: 'accident',
        date: details.occurred_at ? details.occurred_at.slice(0, 10) : todayIso(),
        description: details.damage_description.trim(),
        workshop_postal_code: details.workshop_postal_code,
        details: {
          report_version: 1,
          street: details.street,
          street_number: details.street_number,
          postal_code: details.postal_code,
          locality: details.locality,
          province: details.province,
          occurred_at: details.occurred_at,
          phone: details.phone,
          damage_description: details.damage_description.trim(),
          police_report_reference: details.police_report_reference,
          third_parties: thirdParties,
          injured_people: injuredPeople,
        },
      })
      let notice = t.accidentModal.saved
      if (reportFile) {
        try {
          await uploadDocument(
            { vehicle: vehicle.id, incident: incident.id, type: 'accident_report' },
            reportFile,
          )
        } catch {
          notice = t.accidentModal.savedUploadFailed(reportFile.name)
        }
      }
      setDone(notice)
      onSaved?.()
    } catch (err) {
      setError(asErrorMessage(err, a.createError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={t.accidentModal.title(vehicle.plate)}
      onClose={onClose}
      footer={done ? (
        <Button type="button" onClick={onClose}>{t.accidentModal.close}</Button>
      ) : undefined}
    >
      {done ? <p className="reminder-done" role="status">{done}</p> : (
        <form className="modal-form" onSubmit={submit}>
          <p className="update-hint">{a.accidentData}</p>
          <div className="incident-grid">
            <TextInputField label={a.street} aria-label={a.street} value={details.street} onChange={(e) => setDetail('street', e.target.value)} required />
            <TextInputField label={a.streetNumber} aria-label={a.streetNumber} value={details.street_number} onChange={(e) => setDetail('street_number', e.target.value)} />
            <TextInputField label={a.postalCode} aria-label={a.postalCode} inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={details.postal_code} onChange={(e) => setDetail('postal_code', e.target.value)} required />
            <TextInputField label={a.locality} aria-label={a.locality} value={details.locality} onChange={(e) => setDetail('locality', e.target.value)} required />
            <TextInputField label={a.province} aria-label={a.province} value={details.province} onChange={(e) => setDetail('province', e.target.value)} required />
            <TextInputField label={a.accidentAt} aria-label={a.accidentAt} type="datetime-local" max={nowLocalDateTime()} value={details.occurred_at} onChange={(e) => setDetail('occurred_at', e.target.value)} required />
            <TextInputField label={a.phone} aria-label={a.phone} type="tel" value={details.phone} onChange={(e) => setDetail('phone', e.target.value)} required />
            <TextInputField label={a.workshopPostalCodeOptional} aria-label={a.workshopPostalCodeOptional} inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={details.workshop_postal_code} onChange={(e) => setDetail('workshop_postal_code', e.target.value)} />
          </div>
          <TextAreaField label={a.damageDescription} aria-label={a.damageDescription} rows={4} value={details.damage_description} onChange={(e) => setDetail('damage_description', e.target.value)} required />

          <RepeatableHeader title={a.thirdParties} addLabel={a.add} onAdd={() => setThirdParties((rows) => [...rows, emptyThirdParty()])} />
          {thirdParties.map((row, index) => (
            <div className="incident-repeat-card" key={`third-${index}`}>
              <button type="button" className="incident-remove" aria-label={a.removeThirdParty} onClick={() => setThirdParties((rows) => rows.filter((_, i) => i !== index))}><Trash2 size={17} aria-hidden /></button>
              <div className="incident-grid">
                <TextInputField label={a.fullName} aria-label={a.fullName} value={row.full_name} onChange={(e) => updateThirdParty(index, { full_name: e.target.value })} />
                <TextInputField label={a.plate} aria-label={a.plate} value={row.plate} onChange={(e) => updateThirdParty(index, { plate: e.target.value })} />
                <TextInputField label={a.brand} aria-label={a.brand} value={row.brand} onChange={(e) => updateThirdParty(index, { brand: e.target.value })} />
                <TextInputField label={a.model} aria-label={a.model} value={row.model} onChange={(e) => updateThirdParty(index, { model: e.target.value })} />
                <TextInputField label={a.phone} aria-label={a.phone} type="tel" value={row.phone} onChange={(e) => updateThirdParty(index, { phone: e.target.value })} />
                <TextInputField label={a.insurer} aria-label={a.insurer} value={row.insurer} onChange={(e) => updateThirdParty(index, { insurer: e.target.value })} />
                <TextInputField label={a.policyNumber} aria-label={a.policyNumber} value={row.policy_number} onChange={(e) => updateThirdParty(index, { policy_number: e.target.value })} />
              </div>
              <TextAreaField label={a.damageDescription} aria-label={a.damageDescription} rows={2} value={row.damage_description} onChange={(e) => updateThirdParty(index, { damage_description: e.target.value })} />
            </div>
          ))}

          <RepeatableHeader title={a.injuredPeople} addLabel={a.add} onAdd={() => setInjuredPeople((rows) => [...rows, emptyInjuredPerson()])} />
          {injuredPeople.map((row, index) => (
            <div className="incident-repeat-card" key={`injured-${index}`}>
              <button type="button" className="incident-remove" aria-label={a.removeInjured} onClick={() => setInjuredPeople((rows) => rows.filter((_, i) => i !== index))}><Trash2 size={17} aria-hidden /></button>
              <div className="incident-grid">
                <TextInputField label={a.fullName} aria-label={a.fullName} value={row.full_name} onChange={(e) => updateInjured(index, { full_name: e.target.value })} />
                <TextInputField label={a.phone} aria-label={a.phone} type="tel" value={row.phone} onChange={(e) => updateInjured(index, { phone: e.target.value })} />
                <TextInputField label={a.email} aria-label={a.email} type="email" value={row.email} onChange={(e) => updateInjured(index, { email: e.target.value })} />
                <TextInputField label={a.plate} aria-label={a.plate} value={row.plate} onChange={(e) => updateInjured(index, { plate: e.target.value })} />
                <SelectField label={a.seat} aria-label={a.seat} options={[{ value: 'driver', label: a.driver }, { value: 'passenger', label: a.passenger }]} value={row.seat} onValueChange={(seat) => updateInjured(index, { seat })} />
              </div>
            </div>
          ))}
          <TextInputField label={a.policeReportReference} aria-label={a.policeReportReference} value={details.police_report_reference} onChange={(e) => setDetail('police_report_reference', e.target.value)} />
          {/* Misma caja de selección que el modal de Incidencia. */}
          <label className={`photo-attach${reportFile ? ' has-file' : ''}`}>
            <Camera size={18} aria-hidden />
            {reportFile ? reportFile.name : a.accidentReport}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              onChange={(e) => setReportFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {error && <div role="alert" className="form-error">{error}</div>}
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
            <Button type="submit" disabled={saving}>{saving ? a.submitting : t.accidentModal.submit}</Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

function RepeatableHeader({ title, addLabel, onAdd }: { title: string; addLabel: string; onAdd: () => void }) {
  return <div className="incident-repeat-head"><h3>{title}</h3><button type="button" className="incident-add" onClick={onAdd}><Plus size={16} aria-hidden /> {addLabel}</button></div>
}
