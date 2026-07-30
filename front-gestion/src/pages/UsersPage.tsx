import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, IconButton, Modal, PageHeader, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download, Pencil } from 'lucide-react'

import {
  type ManagedUserFull,
  type ManagedUserInput,
  createUser,
  deactivateUser,
  fetchAuthConfig,
  listAll,
  listUsers,
  updateUser,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { useConfirm } from '../components/ConfirmDialog.tsx'
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

/** Gestión de conductores/usuarios (HU-2.6, solo admin). Desactivar ≠ borrar:
 * el histórico se conserva y el desactivado no sale en asignación. */
export function UsersPage() {
  const t = useUsersCopy()
  const confirm = useConfirm()
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
  const [users, setUsers] = useState<ManagedUserFull[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ManagedUserFull | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Si Google está desactivado, la contraseña es el ÚNICO método de acceso: sin
  // ella el alta crea un usuario que no puede entrar (contraseña inutilizable).
  // Por eso, con Google off, la contraseña es obligatoria al crear.
  const [googleEnabled, setGoogleEnabled] = useState(false)
  useEffect(() => {
    fetchAuthConfig()
      .then((cfg) => setGoogleEnabled(cfg.google_enabled))
      .catch(() => setGoogleEnabled(false))
  }, [])
  const passwordRequiredOnCreate = !editing && !googleEnabled

  const load = useCallback(() => {
    setLoading(true)
    listAll(listUsers({ search: search || undefined }))
      .then((rows) => {
        setUsers(rows)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
      .finally(() => setLoading(false))
  }, [search, t])

  useEffect(() => {
    const timer = setTimeout(load, 300)
    return () => clearTimeout(timer)
  }, [load])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY)
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(user: ManagedUserFull) {
    setEditing(user)
    setForm({
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      dni: user.dni ?? '',
      phone: user.phone,
      license_type: user.license_type,
      fuel_card: user.fuel_card,
      roles: user.roles,
      password: '',
    })
    setFormError('')
    setModalOpen(true)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFormError('')
    const data: ManagedUserInput = {
      username: form.username,
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
      setModalOpen(false)
      load()
    } catch (err) {
      setFormError(asErrorMessage(err, t.saveError))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(user: ManagedUserFull) {
    try {
      if (user.is_active) {
        if (
          !(await confirm({
            message: t.confirmDeactivate(user.name),
            confirmLabel: t.deactivate,
            tone: 'warning',
          }))
        )
          return
        await deactivateUser(user.id)
      } else {
        await updateUser(user.id, { is_active: true })
      }
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.toggleError))
    }
  }

  const rows = showInactive ? users : users.filter((u) => u.is_active)

  const columns: Array<TableWithPanelColumn<ManagedUserFull>> = [
    {
      key: 'name',
      label: t.columns.name,
      getValue: (u) => `${u.name} ${u.username}`,
      render: (u) => (
        <>
          <Link to={`/conductores/${u.id}`} className="cell-link">
            <strong>{u.name}</strong>
          </Link>
          <div className="muted">{u.username}</div>
        </>
      ),
    },
    {
      key: 'dni',
      label: t.columns.dni,
      getValue: (u) => u.dni ?? '',
      render: (u) => u.dni ?? '—',
    },
    {
      key: 'contact',
      label: t.columns.contact,
      getValue: (u) => `${u.email} ${u.phone}`,
      render: (u) => (
        <>
          {u.email || '—'}
          {u.phone ? <div className="muted">{u.phone}</div> : null}
        </>
      ),
    },
    {
      key: 'license_type',
      label: t.columns.license,
      getValue: (u) => u.license_type,
      render: (u) => u.license_type || '—',
    },
    {
      key: 'fuel_card',
      label: t.columns.fuelCard,
      getValue: (u) => (u.fuel_card ? t.yes : t.no),
      render: (u) => (u.fuel_card ? t.fuelYes : t.no),
    },
    {
      key: 'roles',
      label: t.columns.roles,
      getValue: (u) => u.roles.map((r) => t.roles[r] ?? r).join(' · '),
      render: (u) => u.roles.map((r) => t.roles[r] ?? r).join(' · ') || '—',
    },
    {
      key: 'is_active',
      label: t.columns.status,
      getValue: (u) => (u.is_active ? t.active : t.inactive),
      render: (u) => (
        <Badge tone={u.is_active ? 'success' : 'neutral'}>
          {u.is_active ? t.active : t.inactive}
        </Badge>
      ),
    },
    {
      key: 'actions',
      label: t.columns.actions,
      align: 'right',
      searchable: false,
      sortable: false,
      render: (u) => (
        <div className="row-actions">
          <IconButton aria-label={t.edit} title={t.edit} onClick={() => openEdit(u)}>
            <Pencil size={15} />
          </IconButton>
          <Button
            variant={u.is_active ? 'danger' : 'primary'}
            size="sm"
            onClick={() => toggleActive(u)}
          >
            {u.is_active ? t.deactivate : t.reactivate}
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={rows.length === 0}
              onClick={() => exportCsv('usuarios', columns, rows)}
            >
              <Download size={16} aria-hidden /> {t.exportCsv}
            </Button>
            <Button variant="primary" onClick={openCreate}>
              {t.newUser}
            </Button>
          </>
        }
      />

      <div className="list-tools">
        <input
          className="search-input"
          type="search"
          aria-label={t.searchPlaceholder}
          placeholder={t.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="baja-toggle">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          {t.showInactive}
        </label>
      </div>

      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <TableWithPanel<ManagedUserFull>
          rows={rows}
          columns={columns}
          rowKey={(u) => String(u.id)}
          rowClassName={(u) => (u.is_active ? '' : 'row-muted')}
          enableColumnSort
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={t.empty}
        />
      )}

      <Modal
        open={modalOpen}
        title={editing ? t.modalEdit(editing.name) : t.modalNew}
        onClose={() => setModalOpen(false)}
      >
        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <TextInputField
              label={t.fUsername}
              requiredVisual
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              required
              disabled={Boolean(editing)}
            />
            <TextInputField
              label={t.fEmail}
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <TextInputField
              label={t.fFirstName}
              value={form.first_name}
              onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
            />
            <TextInputField
              label={t.fLastName}
              value={form.last_name}
              onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
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
            <span className="doc-attach-label">{t.rolesLabel}</span>
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
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? t.saving : t.save}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
