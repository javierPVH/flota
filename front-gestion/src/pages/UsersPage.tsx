import { useCallback, useEffect, useState, type FormEvent } from 'react'
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
import type { Role } from '../types.ts'

const LICENSE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'B', label: 'B (turismos)' },
  { value: 'C1', label: 'C1' },
  { value: 'C', label: 'C (camiones)' },
  { value: 'C+E', label: 'C+E (camión con remolque)' },
  { value: 'D1', label: 'D1' },
  { value: 'D', label: 'D (autobuses)' },
]

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  supervisor: 'Supervisor',
  driver: 'Conductor',
}
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
  const confirm = useConfirm()
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
      .catch((err) => setError(asErrorMessage(err, 'No se pudieron cargar los usuarios.')))
      .finally(() => setLoading(false))
  }, [search])

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
      setFormError(asErrorMessage(err, 'No se pudo guardar el usuario.'))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(user: ManagedUserFull) {
    try {
      if (user.is_active) {
        if (
          !(await confirm({
            message: `¿Desactivar a ${user.name}? No podrá entrar ni salir en asignaciones; su histórico se conserva.`,
            confirmLabel: 'Desactivar',
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
      setError(asErrorMessage(err, 'No se pudo cambiar el estado del usuario.'))
    }
  }

  const rows = showInactive ? users : users.filter((u) => u.is_active)

  const columns: Array<TableWithPanelColumn<ManagedUserFull>> = [
    {
      key: 'name',
      label: 'Nombre',
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
      label: 'DNI',
      getValue: (u) => u.dni ?? '',
      render: (u) => u.dni ?? '—',
    },
    {
      key: 'contact',
      label: 'Contacto',
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
      label: 'Permiso',
      getValue: (u) => u.license_type,
      render: (u) => u.license_type || '—',
    },
    {
      key: 'fuel_card',
      label: 'Tarjeta',
      getValue: (u) => (u.fuel_card ? 'Sí' : 'No'),
      render: (u) => (u.fuel_card ? '⛽ Sí' : 'No'),
    },
    {
      key: 'roles',
      label: 'Roles',
      getValue: (u) => u.roles.map((r) => ROLE_LABEL[r] ?? r).join(' · '),
      render: (u) => u.roles.map((r) => ROLE_LABEL[r] ?? r).join(' · ') || '—',
    },
    {
      key: 'is_active',
      label: 'Estado',
      getValue: (u) => (u.is_active ? 'Activo' : 'Desactivado'),
      render: (u) => (
        <Badge tone={u.is_active ? 'success' : 'neutral'}>
          {u.is_active ? 'Activo' : 'Desactivado'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      label: 'Acciones',
      align: 'right',
      searchable: false,
      sortable: false,
      render: (u) => (
        <div className="row-actions">
          <IconButton aria-label="Editar" title="Editar" onClick={() => openEdit(u)}>
            <Pencil size={15} />
          </IconButton>
          <Button
            variant={u.is_active ? 'danger' : 'primary'}
            size="sm"
            onClick={() => toggleActive(u)}
          >
            {u.is_active ? 'Desactivar' : 'Reactivar'}
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Conductores y usuarios"
        subtitle="Altas, roles y estado de las personas de la flota."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={rows.length === 0}
              onClick={() => exportCsv('usuarios', columns, rows)}
            >
              <Download size={16} aria-hidden /> Exportar CSV
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Nuevo usuario
            </Button>
          </>
        }
      />

      <div className="list-tools">
        <input
          className="search-input"
          type="search"
          placeholder="Buscar nombre, usuario, email o DNI…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="baja-toggle">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Mostrar desactivados
        </label>
      </div>

      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">Cargando…</p>
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
          emptyStateLabel="Sin usuarios con estos filtros."
        />
      )}

      <Modal
        open={modalOpen}
        title={editing ? `Editar ${editing.name}` : 'Nuevo usuario'}
        onClose={() => setModalOpen(false)}
      >
        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <TextInputField
              label="Usuario"
              requiredVisual
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              required
              disabled={Boolean(editing)}
            />
            <TextInputField
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <TextInputField
              label="Nombre"
              value={form.first_name}
              onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
            />
            <TextInputField
              label="Apellidos"
              value={form.last_name}
              onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
            />
            <TextInputField
              label="DNI"
              value={form.dni}
              onChange={(e) => setForm((f) => ({ ...f, dni: e.target.value }))}
            />
            <TextInputField
              label="Teléfono"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
            <SelectField
              label="Tipo de permiso"
              options={LICENSE_OPTIONS}
              value={form.license_type}
              onValueChange={(value) => setForm((f) => ({ ...f, license_type: value }))}
            />
            <TextInputField
              label={
                editing
                  ? 'Nueva contraseña (opcional)'
                  : passwordRequiredOnCreate
                    ? 'Contraseña'
                    : 'Contraseña (opcional)'
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
            Tiene tarjeta de combustible
          </label>
          <div className="roles-picker">
            <span className="doc-attach-label">Roles</span>
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
                {ROLE_LABEL[role]}
              </label>
            ))}
          </div>
          {!editing && (
            <p className="muted" style={{ margin: 0 }}>
              {passwordRequiredOnCreate
                ? 'Obligatoria: es el único método de acceso (login con Google desactivado). Mínimo 8 caracteres; evita contraseñas comunes o solo numéricas.'
                : 'Sin contraseña, el usuario solo podrá entrar con Google.'}
            </p>
          )}
          {formError && <div role="alert" className="form-error">{formError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
