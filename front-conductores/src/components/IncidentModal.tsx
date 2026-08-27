import { useState } from 'react'
import { Camera } from 'lucide-react'
import { Button, SelectField, TextAreaField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createIncident, uploadDocument } from '../api.ts'
import { todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

type IncidentKind = 'general' | 'tires' | 'maintenance'
type Step = 'launch' | 'manage'
const KINDS: IncidentKind[] = ['general', 'tires', 'maintenance']

/** Avería unificada en dos fases. Neumáticos usa exactamente el
 * parte guiado de Gestión (`report_version: 1`) y sus mismos nombres de campo. */
export function BreakdownModal({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  onClose: () => void
  onSaved?: () => void
}) {
  const { t } = useLang()
  const n = t.newIncident
  const b = t.breakdown
  const [step, setStep] = useState<Step>('launch')
  const [cameBack, setCameBack] = useState(false)
  const [kind, setKind] = useState<IncidentKind>('general')
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  const [launchFile, setLaunchFile] = useState<File | null>(null)

  // Parte guiado de neumáticos: mismos campos que Gestión.
  const [mileage, setMileage] = useState('')
  const [changeReason, setChangeReason] = useState('')
  const [wheelScope, setWheelScope] = useState('front')
  const [frontMeasure, setFrontMeasure] = useState('')
  const [rearMeasure, setRearMeasure] = useState('')
  const [wheel, setWheel] = useState('front_left')
  const [tireMeasure, setTireMeasure] = useState('')

  // Segunda fase: gestión, igual que Avería.
  const [managementPostalCode, setManagementPostalCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const tiresValid = Boolean(
    mileage && changeReason &&
    (changeReason === 'wear'
      ? wheelScope &&
        ((wheelScope !== 'front' && wheelScope !== 'all') || frontMeasure.trim()) &&
        ((wheelScope !== 'rear' && wheelScope !== 'all') || rearMeasure.trim())
      : changeReason === 'puncture' && wheel && tireMeasure.trim()),
  )
  const launchValid = Boolean(kind === 'tires' ? tiresValid : description.trim())
  const managementValid = /^[0-9]{5}$/.test(managementPostalCode)

  function goTo(next: Step) {
    setCameBack(next === 'launch')
    setStep(next)
    setError('')
  }

  function tireDetails(): Record<string, unknown> {
    const details: Record<string, unknown> = {
      report_version: 1,
      change_reason: changeReason,
    }
    if (changeReason === 'wear') {
      details.wheel_scope = wheelScope
      if (wheelScope === 'front' || wheelScope === 'all') details.front_measure = frontMeasure.trim()
      if (wheelScope === 'rear' || wheelScope === 'all') details.rear_measure = rearMeasure.trim()
    } else {
      details.wheel = wheel
      details.tire_measure = tireMeasure.trim()
    }
    return details
  }

  async function handleSend() {
    setSaving(true)
    setError('')
    try {
      const guided = kind === 'tires' ? tireDetails() : {}
      const incident = await createIncident({
        vehicle: vehicle.id,
        type: kind,
        date,
        description: description.trim(),
        workshop_postal_code: managementPostalCode,
        ...(kind === 'tires' ? {
          mileage: Number(mileage),
        } : {}),
        ...(Object.keys(guided).length > 0 ? { details: guided } : {}),
      })
      let notice = b.saved
      const uploads = [
        ...(launchFile ? [{ file: launchFile, type: kind === 'tires' ? 'damage_photos' : 'other' }] : []),
      ]
      for (const upload of uploads) {
        try {
          await uploadDocument(
            { vehicle: vehicle.id, incident: incident.id, type: upload.type },
            upload.file,
          )
        } catch {
          notice = b.savedUploadFailed
        }
      }
      setDone(notice)
      onSaved?.()
    } catch (err) {
      setError(asErrorMessage(err, t.incidentModal.error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SupervisorModal
      open
      title={b.title(vehicle.plate)}
      onClose={onClose}
      footer={done ? (
        <Button type="button" onClick={onClose}>{t.incidentModal.close}</Button>
      ) : step === 'launch' ? (
        <>
          <Button type="button" onClick={onClose}>{t.incidentModal.close}</Button>
          <Button type="button" onClick={() => goTo('manage')} disabled={!launchValid}>{b.next}</Button>
        </>
      ) : (
        <>
          <Button type="button" onClick={() => goTo('launch')}>{b.back}</Button>
          <Button type="button" onClick={handleSend} disabled={saving || !managementValid}>{b.submit}</Button>
        </>
      )}
    >
      {done ? <p className="reminder-done" role="status">{done}</p> : (
        <>
          <div className="flow-steps" aria-hidden>
            <span className={`flow-step ${step === 'launch' ? 'is-current' : 'is-done'}`}>{t.shell.tabs.breakdown}</span>
            <span className={`flow-step${step === 'manage' ? ' is-current' : ''}`}>{b.stepManage}</span>
          </div>
          <div key={step} className={`step-pane${cameBack ? ' from-left' : ''}`}>
            {step === 'launch' ? (
              <div className="modal-form">
                <div className="incident-grid breakdown-kind-date">
                  <SelectField
                    label={t.incidentModal.kind}
                    aria-label={t.incidentModal.kind}
                    options={KINDS.map((value) => ({ value, label: t.incidentModal.kinds[value] }))}
                    value={kind}
                    onValueChange={(value) => setKind(value as IncidentKind)}
                    required
                  />
                  <TextInputField label={t.incidentModal.date} aria-label={t.incidentModal.date} type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} required />
                </div>
                {kind !== 'general' && (
                  <p className="update-notice">{t.incidentModal.info[kind]}</p>
                )}

                {kind === 'tires' ? (
                  <>
                    <p className="update-hint">
                      {t.incidentModal.tireRequiredBase}{' '}
                      {changeReason === 'wear'
                        ? t.incidentModal.tireRequiredWear
                        : changeReason === 'puncture'
                          ? t.incidentModal.tireRequiredPuncture
                          : ''}
                    </p>
                    <TextInputField label={n.mileage} aria-label={n.mileage} type="number" min={0} value={mileage} onChange={(e) => setMileage(e.target.value)} required />
                    <SelectField label={n.changeReason} aria-label={n.changeReason} options={[
                      { value: 'wear', label: n.wear }, { value: 'puncture', label: n.puncture },
                    ]} value={changeReason} onValueChange={setChangeReason} required includeSelectFlag selectFlagLabel={n.choose} />
                    {changeReason === 'wear' && <>
                      <div className="incident-grid tire-wheel-grid">
                        <SelectField label={n.whichWheels} aria-label={n.whichWheels} options={[
                          { value: 'front', label: n.front }, { value: 'rear', label: n.rear }, { value: 'all', label: n.allWheels },
                        ]} value={wheelScope} onValueChange={setWheelScope} required />
                        {(wheelScope === 'front' || wheelScope === 'all') && <TextInputField label={n.frontMeasure} aria-label={n.frontMeasure} placeholder="205/55 R16" value={frontMeasure} onChange={(e) => setFrontMeasure(e.target.value)} required />}
                        {(wheelScope === 'rear' || wheelScope === 'all') && <TextInputField label={n.rearMeasure} aria-label={n.rearMeasure} placeholder="205/55 R16" value={rearMeasure} onChange={(e) => setRearMeasure(e.target.value)} required />}
                      </div>
                    </>}
                    {changeReason === 'puncture' && <div className="incident-grid">
                      <SelectField label={n.whichWheel} aria-label={n.whichWheel} options={[
                        { value: 'front_left', label: n.frontLeft }, { value: 'front_right', label: n.frontRight },
                        { value: 'rear_left', label: n.rearLeft }, { value: 'rear_right', label: n.rearRight },
                      ]} value={wheel} onValueChange={setWheel} required />
                      <TextInputField label={n.tireMeasure} aria-label={n.tireMeasure} placeholder="205/55 R16" value={tireMeasure} onChange={(e) => setTireMeasure(e.target.value)} required />
                    </div>}
                    <TextAreaField label={n.comment} aria-label={n.comment} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
                  </>
                ) : kind ? (
                  <>
                    <TextAreaField label={t.incidentModal.description} aria-label={t.incidentModal.description} value={description} onChange={(e) => setDescription(e.target.value)} required />
                  </>
                ) : null}
                {kind && <label className={`photo-attach${launchFile ? ' has-file' : ''}`}>
                  <Camera size={18} aria-hidden />
                  {launchFile ? launchFile.name : t.incidentModal.attach}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" onChange={(e) => setLaunchFile(e.target.files?.[0] ?? null)} />
                </label>}
              </div>
            ) : (
              <div className="modal-form">
                <p className="update-hint">{b.workshopHint}</p>
                <TextInputField label={b.preferredPostalCode} aria-label={b.preferredPostalCode} inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={managementPostalCode} onChange={(e) => setManagementPostalCode(e.target.value)} required />
              </div>
            )}
            {error && <div role="alert" className="form-error">{error}</div>}
          </div>
        </>
      )}
    </SupervisorModal>
  )
}
