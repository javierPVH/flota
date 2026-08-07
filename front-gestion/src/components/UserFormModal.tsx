import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  type ManagedUserFull,
  type ManagedUserInput,
  createUser,
  updateUser,
} from '../api.ts'
import { useUsersCopy } from '../translations/users.ts'
import type { Role } from '../types.ts'

const ALL_ROLES: Role[] = ['admin', 'supervisor', 'driver']

interface FormState {
  username: string
  first_name: string
  last_name: string
  email: string
  dni: string
  phone: string
  license_type: string
  fuel_card: boolean
  roles: Role[]
  password: string
}

const EMPTY: FormState = {
  username: '',
  first_name: '',
  last_name: '',
  email: '',
  dni: '',
  phone: '',
  license_type: '',
  fuel_card: false,
  roles: ['driver'],
  password: '',
}

/**
 * Alta/edición de persona (conductor/supervisor/admin) en modal. Fuente única
 * del formulario, compartida por la página de Conductores y por las pestañas de
 * personas de la vista general, para que ambas ofrezcan exactamente lo mismo.
 */
export function UserFormModal({
  open,
  editing,
  onClose,
  onDone,
}: {
  open: boolean
  editing: ManagedUserFull | null
  onClose: () => void
  onDone: () => void
}) {
  const t = useUsersCopy()
  const licenseOptions = useMemo(
    () => [
      { value: '', label: '—' },
      { value: 'B', label: t.licenses.B },
      { value: 'C1', label: t.licenses.C1 },
      { value: 'C', label: t.licenses.C },
      { value: 'C+E', label: t.licenses.CE },
      { value: 'D1', label: t.licenses.D1 },
      { value: 'D', label: t.licenses.D },
    ],
    [t],
  )
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Sincroniza el formulario cada vez que se abre (alta vacía o edición cargada).
  useEffect(() => {
    if (!open) return
    if (editing) {
      setForm({
        username: editing.username,
        first_name: editing.first_name,
        last_name: editing.last_name,
        email: editing.email,
        dni: editing.dni ?? '',
        phone: editing.phone,
        license_type: editing.license_type,
        fuel_card: editing.fuel_card,
        roles: editing.roles,
        password: '',
      })
    } else {
      setForm(EMPTY)
    }
    setFormError('')
  }, [open, editing])

  // Solo los ADMIN requieren contraseña al crear (es su acceso a la gestión).
  const passwordRequiredOnCreate = !editing && form.roles.includes('admin')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (form.roles.length === 0) {
      setFormError(t.rolesRequired)
      return
    }
    setSaving(true)
    setFormError('')
    const data: ManagedUserInput = {
      // El backend exige `username` único; si se deja vacío al crear, se usa el email.
      username: form.username.trim() || form.email.trim(),
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email,
      dni: form.dni || null,
      phone: form.phone,
      license_type: form.license_type,
      fuel_card: form.fuel_card,
      roles: form.roles,
    }
    if (form.password) data.password = form.password
    try {
      if (editing) await updateUser(editing.id, data)
      else await createUser(data)
      onDone()
    } catch (err) {
      setFormError(asErrorMessage(err, t.saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={editing ? t.modalEdit(editing.name) : t.modalNew}
      onClose={onClose}
      wide
    >
      <form className="modal-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <TextInputField
            label={t.fEmail}
            type="email"
            requiredVisual
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            required
          />
          <TextInputField
            label={t.fUsername}
            placeholder={t.usernamePlaceholder}
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            disabled={Boolean(editing)}
          />
          <TextInputField
            label={t.fFirstName}
            requiredVisual
            value={form.first_name}
            onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
            required
          />
          <TextInputField
            label={t.fLastName}
            requiredVisual
            value={form.last_name}
            onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
            required
          />
          <TextInputField
            label={t.fDni}
            value={form.dni}
            onChange={(e) => setForm((f) => ({ ...f, dni: e.target.value }))}
          />
          <TextInputField
            label={t.fPhone}
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <SelectField
            label={t.fLicenseType}
            options={licenseOptions}
            value={form.license_type}
            onValueChange={(value) => setForm((f) => ({ ...f, license_type: value }))}
          />
          <TextInputField
            label={
              editing
                ? t.fPasswordNew
                : passwordRequiredOnCreate
                  ? t.fPassword
                  : t.fPasswordOptional
            }
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            autoComplete="new-password"
            required={passwordRequiredOnCreate}
            requiredVisual={passwordRequiredOnCreate}
            minLength={8}
          />
        </div>
        <label className="baja-toggle">
          <input
            type="checkbox"
            checked={form.fuel_card}
            onChange={(e) => setForm((f) => ({ ...f, fuel_card: e.target.checked }))}
          />
          {t.fuelCardToggle}
        </label>
        <div className="roles-picker">
          <span className="doc-attach-label">
            {t.rolesLabel} <span className="required-mark" aria-hidden="true">*</span>
          </span>
          {ALL_ROLES.map((role) => (
            <label key={role} className="baja-toggle">
              <input
                type="checkbox"
                checked={form.roles.includes(role)}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    roles: e.target.checked
                      ? [...f.roles, role]
                      : f.roles.filter((r) => r !== role),
                  }))
                }
              />
              {t.roles[role]}
            </label>
          ))}
        </div>
        {!editing && (
          <p className="muted" style={{ margin: 0 }}>
            {passwordRequiredOnCreate ? t.passwordRequiredHint : t.passwordOptionalHint}
          </p>
        )}
        {formError && <div role="alert" className="form-error">{formError}</div>}
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? t.saving : t.save}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
