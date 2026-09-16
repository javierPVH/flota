import { useState, type FormEvent } from 'react'
import { Button, FileField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { renewInsurance } from '../../api.ts'
import { fmtDate, plusOneYearIso } from '../../format.ts'
import { useLang } from '../../i18n.tsx'
import { useResolveCopy } from '../../translations/resolve.ts'
import { uploadProof } from './proof.ts'

interface Props {
  vehicleId: number
  /** Vencimiento vigente (de la ficha o de la alerta): la nueva fecha se
   * propone un año después y no puede adelantarlo. */
  currentExpiry: string | null
  onClose: () => void
  /** Renovado: texto para el aviso verde del padre (que recarga sus datos). */
  onDone: (notice: string) => void
  /** Atajo del tipo: el padre monta el correo a la renting con el vehículo. */
  onEmailRenting?: () => void
}

/**
 * Resolver un aviso de seguro ES renovarlo: nueva fecha de vencimiento (con la
 * póliza opcional, que queda en Documentos con esa caducidad) y notas. El back
 * actualiza la ficha, emite el evento «Renovación de seguro» y cierra los
 * avisos de seguro con actor. Contenido del modal: el padre pone el `Modal`.
 */
export function RenewInsuranceForm({
  vehicleId,
  currentExpiry,
  onClose,
  onDone,
  onEmailRenting,
}: Props) {
  const t = useResolveCopy()
  const i = t.insurance
  const { language } = useLang()

  const [expiry, setExpiry] = useState(() => plusOneYearIso(currentExpiry))
  const [notes, setNotes] = useState('')
  const [policy, setPolicy] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!expiry) return
    setSaving(true)
    setError('')
    try {
      const trimmed = notes.trim()
      const res = await renewInsurance(vehicleId, {
        expiry_date: expiry,
        ...(trimmed ? { notes: trimmed } : {}),
      })
      // La póliza va después, con su caducidad y ligada a la renovación que
      // la trajo (su registro), y nunca tumba la renovación ya hecha (la señal
      // del back es idempotente con la fecha ya aplicada).
      const failed = await uploadProof(
        { vehicle: vehicleId, type: 'insurance', expiry_date: expiry, event: res.event ?? null },
        policy,
      )
      let notice = res.changed ? i.savedNotice(fmtDate(expiry, language)) : i.unchangedNotice
      if (failed) notice = `${notice} ${t.common.proofFailed(failed)}`
      onDone(notice)
    } catch (err) {
      setError(asErrorMessage(err, t.common.genericError))
    } finally {
      setSaving(false)
    }
  }

  const notesId = `renew-insurance-${vehicleId}-notes`

  return (
    <form className="ops-modal" onSubmit={submit}>
      <p className="muted ops-note">
        {i.intro(currentExpiry ? fmtDate(currentExpiry, language) : '—')}
      </p>
      <div className="ops-grid">
        <TextInputField
          label={i.newExpiry}
          aria-label={i.newExpiry}
          type="date"
          min={currentExpiry ?? undefined}
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          required
        />
      </div>
      <label className="ops-field-label" htmlFor={notesId}>
        {i.notes}
      </label>
      <textarea
        id={notesId}
        className="ops-textarea"
        rows={2}
        placeholder={i.notesPlaceholder}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <FileField
        label={t.common.proof(t.docs.insurance)}
        accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
        value={policy}
        onFiles={(files) => setPolicy(files[0] ?? null)}
      />

      {onEmailRenting && (
        <div className="resolve-side-action">
          <p className="muted" style={{ margin: 0 }}>
            {i.emailHint}
          </p>
          <Button type="button" variant="secondary" onClick={onEmailRenting}>
            {i.emailButton}
          </Button>
        </div>
      )}

      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
      <div className="ops-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t.common.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={saving || !expiry}>
          {saving ? t.common.saving : i.confirm}
        </Button>
      </div>
    </form>
  )
}
