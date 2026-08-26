import { useState } from 'react'
import { Camera } from 'lucide-react'
import { Button, Modal, SelectField, TextAreaField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createIncident, uploadDocument } from '../api.ts'
import { todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

/**
 * Lanzar una avería, en modal y en DOS pasos: los datos de la avería (con el
 * coche fijado — el selector va deshabilitado a propósito, la avería es de la
 * tarjeta desde la que se abre) y, con una animación, la GESTIÓN, donde SÍ se
 * comunica. La gestión pide únicamente el código postal de la ubicación
 * preferente, que permitirá buscar el taller más cercano.
 */
export function BreakdownModal({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  onClose: () => void
  /** Creada: la página refresca sus datos (la marca 🔧 de la tarjeta). */
  onSaved?: () => void
}) {
  const { t } = useLang()
  const [step, setStep] = useState<'launch' | 'manage'>('launch')
  // Dirección de la animación: avanzar entra por la derecha; volver, por la izquierda.
  const [cameBack, setCameBack] = useState(false)
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [postalCode, setPostalCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  function goTo(next: 'launch' | 'manage') {
    setCameBack(next === 'launch')
    setStep(next)
  }

  async function handleSend() {
    setSaving(true)
    setError('')
    try {
      const incident = await createIncident({
        vehicle: vehicle.id,
        type: 'breakdown',
        date,
        description: description.trim(),
        workshop_postal_code: postalCode,
      })
      let notice = t.breakdown.saved
      // Adjuntos best-effort: la avería ya existe; un fallo no la tumba.
      const uploads: Array<{ file: File; type: string }> = []
      if (photo) uploads.push({ file: photo, type: 'damage_photos' })
      for (const upload of uploads) {
        try {
          await uploadDocument(
            { vehicle: vehicle.id, incident: incident.id, type: upload.type },
            upload.file,
          )
        } catch {
          notice = t.breakdown.savedUploadFailed
        }
      }
      setDone(notice)
      onSaved?.()
    } catch (err) {
      setError(asErrorMessage(err, t.breakdown.error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={t.breakdown.title(vehicle.plate)}
      onClose={onClose}
      footer={
        done ? (
          <Button type="button" onClick={onClose}>
            {t.breakdown.close}
          </Button>
        ) : step === 'launch' ? (
          <>
            <Button type="button" onClick={onClose}>
              {t.breakdown.close}
            </Button>
            <Button type="button" onClick={() => goTo('manage')} disabled={!description.trim()}>
              {t.breakdown.next}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" onClick={() => goTo('launch')}>
              {t.breakdown.back}
            </Button>
            <Button type="button" onClick={handleSend} disabled={saving || !/^[0-9]{5}$/.test(postalCode)}>
              {t.breakdown.submit}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p className="reminder-done" role="status">
          {done}
        </p>
      ) : (
        <>
          {/* El ciclo empieza aquí: avería → ubicación preferente. */}
          <div className="flow-steps" aria-hidden>
            <span className={`flow-step ${step === 'launch' ? 'is-current' : 'is-done'}`}>
              {t.breakdown.stepLaunch}
            </span>
            <span className={`flow-step${step === 'manage' ? ' is-current' : ''}`}>
              {t.breakdown.stepManage}
            </span>
          </div>

          {/* La key remonta el pane al cambiar de paso: la animación de
              deslizamiento se dispara en cada transición. */}
          <div key={step} className={`step-pane${cameBack ? ' from-left' : ''}`}>
            {step === 'launch' ? (
              <div className="modal-form">
                {/* El coche está decidido por la tarjeta: se enseña, no se elige. */}
                <SelectField
                  label={t.breakdown.vehicle}
                  options={[
                    {
                      value: String(vehicle.id),
                      label: `${vehicle.plate} · ${vehicle.brand} ${vehicle.model}`,
                    },
                  ]}
                  value={String(vehicle.id)}
                  onValueChange={() => {}}
                  disabled
                  required
                />
                {/* El DS pinta la etiqueta como texto (no <label>): aria-label. */}
                <TextInputField
                  label={t.breakdown.date}
                  aria-label={t.breakdown.date}
                  type="date"
                  max={todayIso()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
                <TextAreaField
                  label={t.breakdown.description}
                  aria-label={t.breakdown.description}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
                {/* Caja punteada de adjuntar foto (el diseño de referencia). */}
                <label className={`photo-attach${photo ? ' has-file' : ''}`}>
                  <Camera size={18} aria-hidden />
                  {photo ? t.breakdown.attached(photo.name) : t.breakdown.attach}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic"
                    onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            ) : (
              <div className="modal-form">
                <p className="update-hint">{t.breakdown.workshopHint}</p>
                <TextInputField
                  label={t.breakdown.preferredPostalCode}
                  aria-label={t.breakdown.preferredPostalCode}
                  inputMode="numeric"
                  pattern="[0-9]{5}"
                  maxLength={5}
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  required
                />
              </div>
            )}
            {error && (
              <div role="alert" className="form-error">
                {error}
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
