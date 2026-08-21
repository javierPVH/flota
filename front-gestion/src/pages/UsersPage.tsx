import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  Button,
  DateMiniFilter,
  IconButton,
  MiniToolsButtons,
  Modal,
  PageHeader,
  SelectField,
} from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download, Pencil, Upload } from 'lucide-react'

import {
  type ManagedUserFull,
  deactivateUser,
  listAll,
  listUsers,
  updateUser,
} from '../api.ts'
import { ColumnsPicker } from '../components/ColumnsPicker.tsx'
import { exportCsv } from '../csv.ts'
import { BulkImportModal } from '../components/bulk-import/BulkImportModal.tsx'
import { useConfirm } from '../components/ConfirmDialog.tsx'
import { UserFormModal } from '../components/UserFormModal.tsx'
import { useUsersCopy } from '../translations/users.ts'
import type { Role } from '../types.ts'

// Orden por defecto de las columnas y cuáles arrancan ocultas (ninguna).
const COLUMN_KEYS = ['name', 'dni', 'contact', 'license_type', 'fuel_card', 'roles', 'is_active']
const DEFAULT_HIDDEN: string[] = []

// Clave canónica del conjunto de roles (orden alfabético) para el filtro por rol.
const roleKey = (roles: Role[]) => (roles.length ? [...roles].sort().join(',') : 'none')

// Fecha local (YYYY-MM-DD) de hace N días (para el preset "Últimos 30 días").
function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

type UserStatus = 'all' | 'active' | 'inactive'
interface UserFilter {
  search: string
  role: string
  from: string
  to: string
  status: UserStatus
}

// Filtrado en cliente compartido por la barra y por el modal de exportación.
function filterUsers(list: ManagedUserFull[], f: UserFilter): ManagedUserFull[] {
  const term = f.search.trim().toLowerCase()
  return list.filter((u) => {
    if (f.status === 'active' && !u.is_active) return false
    if (f.status === 'inactive' && u.is_active) return false
    if (f.role && roleKey(u.roles) !== f.role) return false
    if (term) {
      const hay = `${u.name} ${u.username} ${u.email} ${u.dni ?? ''} ${u.phone}`.toLowerCase()
      if (!hay.includes(term)) return false
    }
    if (f.from || f.to) {
      const d = (u.date_joined || '').slice(0, 10) // 'YYYY-MM-DD'
      if (!d) return false
      if (f.from && d < f.from) return false
      if (f.to && d > f.to) return false
    }
    return true
  })
}

/** Gestión de conductores/usuarios (HU-2.6, solo admin). Desactivar ≠ borrar:
 * el histórico se conserva y el desactivado no sale en asignación. */
export function UsersPage() {
  const t = useUsersCopy()
  const confirm = useConfirm()
  const [users, setUsers] = useState<ManagedUserFull[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [roleFilter, setRoleFilter] = useState('') // '' = todos; 'none' = sin rol
  // Fecha de creación: borrador (inputs) vs aplicado (lo que filtra, al pulsar 🔍).
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [appliedFrom, setAppliedFrom] = useState('')
  const [appliedTo, setAppliedTo] = useState('')

  // Columnas: orden + ocultas + menú desplegable (como en Vehículos).
  const [colOrder, setColOrder] = useState<string[]>(() => [...COLUMN_KEYS])
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => new Set(DEFAULT_HIDDEN))

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ManagedUserFull | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  // Modal de exportación: mismos filtros que la barra + estado + columnas.
  const [exportOpen, setExportOpen] = useState(false)
  const [expSearch, setExpSearch] = useState('')
  const [expRole, setExpRole] = useState('')
  const [expFrom, setExpFrom] = useState('')
  const [expTo, setExpTo] = useState('')
  const [expStatus, setExpStatus] = useState<UserStatus>('all')
  const [expCols, setExpCols] = useState<Set<string>>(() => new Set())

  // Opciones del filtro por rol: roles sueltos + combinaciones (clave = roleKey).
  const roleFilterOptions = useMemo(
    () => [
      { value: '', label: t.roleFilterAll },
      { value: 'admin', label: t.roles.admin },
      { value: 'supervisor', label: t.roles.supervisor },
      { value: 'driver', label: t.roles.driver },
      { value: 'driver,supervisor', label: `${t.roles.supervisor} · ${t.roles.driver}` },
      { value: 'admin,supervisor', label: `${t.roles.supervisor} · ${t.roles.admin}` },
      { value: 'admin,driver', label: `${t.roles.admin} · ${t.roles.driver}` },
      {
        value: 'admin,driver,supervisor',
        label: `${t.roles.admin} · ${t.roles.supervisor} · ${t.roles.driver}`,
      },
      { value: 'none', label: t.roleFilterNone },
    ],
    [t],
  )

  // Opciones de estado para el modal de exportación.
  const statusOptions = useMemo(
    () => [
      { value: 'all', label: t.statusAll },
      { value: 'active', label: t.statusActive },
      { value: 'inactive', label: t.statusInactive },
    ],
    [t],
  )

  const load = useCallback(() => {
    setLoading(true)
    // Trae SIEMPRE todos los empleados; la búsqueda y los filtros van en cliente.
    listAll(listUsers())
      .then((rows) => {
        setUsers(rows)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  function openCreate() {
    setEditing(null)
    setModalOpen(true)
  }

  function openEdit(user: ManagedUserFull) {
    setEditing(user)
    setModalOpen(true)
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

  const rows = useMemo(
    () =>
      filterUsers(users, {
        // "Mostrar desactivados": ON → solo desactivados; OFF → solo activos.
        status: showInactive ? 'inactive' : 'active',
        role: roleFilter,
        search,
        from: appliedFrom,
        to: appliedTo,
      }),
    [users, showInactive, roleFilter, search, appliedFrom, appliedTo],
  )

  // Vista previa de lo que exportará el modal (filtros independientes de la barra).
  const exportRows = useMemo(
    () =>
      filterUsers(users, {
        status: expStatus,
        role: expRole,
        search: expSearch,
        from: expFrom,
        to: expTo,
      }),
    [users, expStatus, expRole, expSearch, expFrom, expTo],
  )

  const allColumns: Array<TableWithPanelColumn<ManagedUserFull>> = [
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
      render: (u) => (u.fuel_card ? <span className="fuel-yes">{t.yes}</span> : t.no),
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
  ]

  const actionsColumn: TableWithPanelColumn<ManagedUserFull> = {
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
  }

  const colByKey = new Map(allColumns.map((c) => [c.key, c]))

  // M15: todas las columnas; el orden y las ocultas van CONTROLADOS a la tabla
  // (ver VehiclesPage), así que ya no hace falta remontarla en cada cambio.
  const tableColumns: Array<TableWithPanelColumn<ManagedUserFull>> = [
    ...colOrder
      .map((key) => colByKey.get(key))
      .filter((c): c is TableWithPanelColumn<ManagedUserFull> => Boolean(c)),
    actionsColumn,
  ]

  // Columnas exportables (las de acciones no tienen valor).
  const exportableColumns = allColumns.filter((c) => c.getValue)

  function toggleExportCol(key: string) {
    setExpCols((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function openExport() {
    // Prellenar con lo que hay en la barra; el usuario lo ajusta en el modal.
    setExpSearch(search)
    setExpRole(roleFilter)
    setExpFrom(appliedFrom)
    setExpTo(appliedTo)
    setExpStatus(showInactive ? 'inactive' : 'active')
    setExpCols(new Set(exportableColumns.map((c) => c.key)))
    setExportOpen(true)
  }

  function runExport() {
    const cols = exportableColumns.filter((c) => expCols.has(c.key))
    exportCsv('usuarios', cols, exportRows)
    setExportOpen(false)
  }

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={users.length === 0}
              onClick={openExport}
            >
              <Download size={16} aria-hidden /> {t.exportCsv}
            </Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload size={16} aria-hidden /> {t.importBtn}
            </Button>
            <Button variant="primary" onClick={openCreate}>
              {t.newUser}
            </Button>
          </>
        }
      />

      <div className="filters-bar filters-bar--panel">
        {/* 1 · Nº de registros (ancho fijo: cabe hasta 5 dígitos). */}
        <div className="filter-field filter-field--count">
          <label>{t.lblRecords}</label>
          <div className="filter-count">{rows.length}</div>
        </div>

        {/* 2 · Búsqueda (papelera para limpiar); campo estrecho, pegado a la izquierda. */}
        <div className="filter-field filter-field--search">
          <label htmlFor="users-search">{t.lblSearch}</label>
          <div className="filter-search">
            <input
              id="users-search"
              type="search"
              aria-label={t.lblSearch}
              placeholder={t.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <MiniToolsButtons
              size="xs"
              showLock={false}
              showSearch={false}
              showSort={false}
              showDelete
              onDelete={() => setSearch('')}
            />
          </div>
        </div>

        {/* 3 · Filtro por rol (campo estrecho). */}
        <div className="filter-field filter-field--role">
          <label>{t.lblRole}</label>
          <SelectField
            aria-label={t.roleFilterLabel}
            containerClassName="role-filter"
            required
            options={roleFilterOptions}
            value={roleFilter}
            onValueChange={setRoleFilter}
          />
        </div>

        {/* 4 · Fecha de creación (misma lógica/UI que el panel: Desde/Hasta + 🔍 + 🗑 + Últimos 30 días). */}
        <div className="filter-field filter-field--date">
          <label>{t.lblCreated}</label>
          <DateMiniFilter
            fromLabel={t.dateFrom}
            toLabel={t.dateTo}
            startDate={dateFrom}
            endDate={dateTo}
            onStartDateChange={setDateFrom}
            onEndDateChange={setDateTo}
            onApply={() => {
              setAppliedFrom(dateFrom)
              setAppliedTo(dateTo)
            }}
            onClear={() => {
              setDateFrom('')
              setDateTo('')
              setAppliedFrom('')
              setAppliedTo('')
            }}
            onApplyLast30Days={() => {
              const from = isoDaysAgo(30)
              const to = isoDaysAgo(0)
              setDateFrom(from)
              setDateTo(to)
              setAppliedFrom(from)
              setAppliedTo(to)
            }}
          />
        </div>

        {/* 5 · Columnas (mostrar/ocultar + ordenar) — M18: componente compartido. */}
        <ColumnsPicker
          order={colOrder}
          hidden={hiddenCols}
          labelOf={(key) => colByKey.get(key)?.label}
          copy={{
            label: t.lblColumns,
            button: t.columnsBtn,
            moveUp: t.colMoveUp,
            moveDown: t.colMoveDown,
            showAll: t.columnsAll,
          }}
          onOrderChange={setColOrder}
          onHiddenChange={setHiddenCols}
        />

        {/* 6 · Interruptores: mostrar desactivados. */}
        <div className="filter-toggles">
          <label className="baja-toggle">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            {t.showInactive}
          </label>
        </div>
      </div>

      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <TableWithPanel<ManagedUserFull>
          rows={rows}
          columns={tableColumns}
          columnOrder={[...colOrder, actionsColumn.key]}
          onColumnOrderChange={(keys) => setColOrder(keys.filter((k) => k !== actionsColumn.key))}
          hiddenColumns={[...hiddenCols]}
          onHiddenColumnsChange={(keys) => setHiddenCols(new Set(keys))}
          rowKey={(u) => String(u.id)}
          rowClassName={(u) => (u.is_active ? '' : 'row-muted')}
          enableColumnSort
          showControlPanel={false}
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={t.empty}
        />
      )}

      <UserFormModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onDone={() => {
          setModalOpen(false)
          load()
        }}
      />

      {/* Importación masiva de personas (IMPORTACION_MASIVA.md §9). */}
      <BulkImportModal
        open={importOpen}
        entity="users"
        onClose={() => setImportOpen(false)}
        onDone={load}
      />

      <Modal open={exportOpen} title={t.exportTitle} onClose={() => setExportOpen(false)} wide>
        <div className="export-form">
          <p className="muted" style={{ margin: 0 }}>{t.exportIntro}</p>

          {/* Mismos controles que la barra de filtros. */}
          <div className="filters-bar">
            <div className="filter-field filter-field--search">
              <label htmlFor="export-search">{t.lblSearch}</label>
              <div className="filter-search">
                <input
                  id="export-search"
                  type="search"
                  aria-label={t.lblSearch}
                  placeholder={t.searchPlaceholder}
                  value={expSearch}
                  onChange={(e) => setExpSearch(e.target.value)}
                />
                <MiniToolsButtons
                  size="xs"
                  showLock={false}
                  showSearch={false}
                  showSort={false}
                  showDelete
                  onDelete={() => setExpSearch('')}
                />
              </div>
            </div>

            <div className="filter-field filter-field--role">
              <label>{t.lblRole}</label>
              <SelectField
                aria-label={t.roleFilterLabel}
                containerClassName="role-filter"
                required
                options={roleFilterOptions}
                value={expRole}
                onValueChange={setExpRole}
              />
            </div>

            <div className="filter-field filter-field--role">
              <label>{t.exportStatusLabel}</label>
              <SelectField
                aria-label={t.exportStatusLabel}
                containerClassName="role-filter"
                required
                options={statusOptions}
                value={expStatus}
                onValueChange={(v) => setExpStatus(v as UserStatus)}
              />
            </div>

            <div className="filter-field filter-field--date">
              <label>{t.lblCreated}</label>
              <DateMiniFilter
                fromLabel={t.dateFrom}
                toLabel={t.dateTo}
                startDate={expFrom}
                endDate={expTo}
                onStartDateChange={setExpFrom}
                onEndDateChange={setExpTo}
                onClear={() => {
                  setExpFrom('')
                  setExpTo('')
                }}
                onApplyLast30Days={() => {
                  setExpFrom(isoDaysAgo(30))
                  setExpTo(isoDaysAgo(0))
                }}
              />
            </div>
          </div>

          {/* Selección de columnas a incluir. */}
          <div className="export-cols">
            <div className="export-cols-head">
              <span className="doc-attach-label">{t.exportColumns}</span>
              <span className="export-cols-actions">
                <button
                  type="button"
                  className="linklike"
                  onClick={() => setExpCols(new Set(exportableColumns.map((c) => c.key)))}
                >
                  {t.exportSelectAll}
                </button>
                <button type="button" className="linklike" onClick={() => setExpCols(new Set())}>
                  {t.exportSelectNone}
                </button>
              </span>
            </div>
            <div className="export-cols-list">
              {exportableColumns.map((c) => (
                <label key={c.key} className="baja-toggle">
                  <input
                    type="checkbox"
                    checked={expCols.has(c.key)}
                    onChange={() => toggleExportCol(c.key)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>

          <p className="export-summary">
            {t.exportSummaryLabel}{' '}
            <span className="export-num">{exportRows.length}</span> {t.exportSummaryOf}{' '}
            <span className="export-num">{users.length}</span> {t.exportSummaryTail}
          </p>

          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setExportOpen(false)}>
              {t.cancel}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={exportRows.length === 0 || expCols.size === 0}
              onClick={runExport}
            >
              <Download size={16} aria-hidden /> {t.exportRun}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
