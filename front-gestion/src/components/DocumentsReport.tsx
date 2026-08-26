import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { Badge, Button, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { ExternalLink } from 'lucide-react'

import { createDocument, uploadDocument } from '../api.ts'
import { documentStatusTone } from '../format.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useReportsCopy } from '../translations/reports.ts'
import { exportCsv } from '../csv.ts'
import { TableInfoBar } from './TableInfoBar.tsx'
import { VehicleSelect } from './VehicleSelect.tsx'
import type { FlotaDocument, Vehicle } from '../types.ts'

const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : '')

// Tipos de documento (lista cerrada del back, Épica 4). Etiquetas en panels.ts.
const DOC_TYPE_VALUES = [
  'registration_certificate',
  'technical_datasheet',
  'insurance',
  'contract',
  'delivery_report',
  'return_report',
  'accident_report',
  'damage_photos',
  'driving_license',
  'other',
] as const

/** Opción de usuario para el filtro y para el titular (id + nombre visible). */
export interface UserOption {
  id: number
  label: string
}

interface NewDocForm {
  type: string
  vehicle: string
  user: string
  expiry_date: string
  notes: string
}

/** Fila de la vista agrupada: un titular (matrícula o persona) y sus documentos. */
interface GroupRow {
  key: string
  title: string
  personal: boolean
  driver: string
  rows: FlotaDocument[]
}

/**
 * Informe de documentos de la flota (pestaña de Informes): tabla estilo
 * vehículos con franja de opciones (registros + buscar + filtros de vehículo y
 * estado + export).
 *
 * Los documentos llegan ya cargados desde la página —una sola petición para
 * todos los tipos—, así que cambiar de tipo es instantáneo y los recuentos de
 * las sub-pestañas son reales. `type` vacío significa «todos los tipos», y
 * entonces la tabla añade la columna Tipo.
 */
export function DocumentsReport({
  type,
  docs,
  loading,
  error,
  vehicleLabel,
  plateById,
  vehicles,
  users,
  onCreated,
}: {
  /** Tipo de documento; '' = todos. */
  type: string
  docs: FlotaDocument[]
  loading: boolean
  error: string
  vehicleLabel: string
  plateById: Map<number, string>
  vehicles: Vehicle[]
  /** Usuarios para el filtro por titular y para el alta de documento personal. */
  users: UserOption[]
  /** Recarga el listado tras un alta (los documentos los tiene la página). */
  onCreated: () => void
}) {
  const t = usePanelsCopy().documents
  const docsCopy = useReportsCopy().docs
  const [search, setSearch] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('')
  // Dos búsquedas por persona DISTINTAS: de quién es el documento (titular
  // personal, o conductor actual del coche titular) y quién lo subió («Por»).
  const [userFilter, setUserFilter] = useState('')
  const [uploaderFilter, setUploaderFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  // Vista agrupada: un acordeón por matrícula (los personales, por titular).
  const [grouped, setGrouped] = useState(false)

  // Conductor actual de cada coche (id y nombre), para el filtro «titular o
  // conductor» y la columna Conductor, sin más peticiones (los vehículos ya
  // llegan cargados).
  const driverByVehicle = useMemo(() => {
    const seen = new Map<number, number>()
    for (const v of vehicles) if (v.driver_id != null) seen.set(v.id, v.driver_id)
    return seen
  }, [vehicles])
  const driverNameByVehicle = useMemo(() => {
    const seen = new Map<number, string>()
    for (const v of vehicles) {
      if (v.driver_id != null) seen.set(v.id, v.driver_name || `#${v.driver_id}`)
    }
    return seen
  }, [vehicles])

  const plate = (id: number) => plateById.get(id) ?? `#${id}`
  /** Titular de la fila: la matrícula del coche o el nombre del usuario. */
  const owner = (doc: FlotaDocument) =>
    doc.vehicle != null ? plate(doc.vehicle) : doc.user_name || (doc.user != null ? `#${doc.user}` : '')

  // Alta de documento (incluidos los PERSONALES: titular = usuario).
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<NewDocForm>({
    type: 'driving_license',
    vehicle: '',
    user: '',
    expiry_date: '',
    notes: '',
  })
  const [attach, setAttach] = useState<{ file: File | null; manualUrl: string }>({
    file: null,
    manualUrl: '',
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const closeModal = useCallback(() => setModalOpen(false), [])

  function openCreate() {
    // El tipo se precarga con la sub-pestaña activa; sin ella, el caso nuevo
    // más habitual: el permiso de conducir (titular usuario).
    setForm({ type: type || 'driving_license', vehicle: '', user: '', expiry_date: '', notes: '' })
    setAttach({ file: null, manualUrl: '' })
    setFormError('')
    setModalOpen(true)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.vehicle && !form.user) {
      setFormError(docsCopy.ownerRequired)
      return
    }
    if (!attach.file && !attach.manualUrl) {
      setFormError(t.attachRequired)
      return
    }
    setSaving(true)
    setFormError('')
    const base = {
      vehicle: form.vehicle ? Number(form.vehicle) : undefined,
      user: form.user ? Number(form.user) : undefined,
      type: form.type,
      expiry_date: form.expiry_date || null,
      notes: form.notes || undefined,
    }
    try {
      if (attach.file) await uploadDocument(base, attach.file)
      else await createDocument({ ...base, drive_url: attach.manualUrl })
      setModalOpen(false)
      onCreated()
    } catch (err) {
      setFormError(asErrorMessage(err, t.saveError))
    } finally {
      setSaving(false)
    }
  }

  // Documentos del tipo activo: la base de los recuentos y de la tabla.
  const typed = useMemo(() => (type ? docs.filter((doc) => doc.type === type) : docs), [docs, type])

  // Recuento por estado — sirve de resumen y de filtro rápido.
  const statusCounts = useMemo(() => {
    const seen = new Map<string, { label: string; count: number }>()
    for (const doc of typed) {
      const entry = seen.get(doc.status)
      if (entry) entry.count += 1
      else seen.set(doc.status, { label: doc.status_display || doc.status, count: 1 })
    }
    return [...seen.entries()].map(([value, info]) => ({ value, ...info }))
  }, [typed])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return typed.filter((doc) => {
      if (vehicleFilter && String(doc.vehicle ?? '') !== vehicleFilter) return false
      if (userFilter) {
        // «De quién es»: su documento personal o el del coche que lleva ahora.
        const person = Number(userFilter)
        const driver = doc.vehicle != null ? driverByVehicle.get(doc.vehicle) : undefined
        if (doc.user !== person && driver !== person) return false
      }
      if (uploaderFilter && String(doc.uploaded_by ?? '') !== uploaderFilter) return false
      if (statusFilter && doc.status !== statusFilter) return false
      if (!term) return true
      const titular = doc.vehicle != null ? (plateById.get(doc.vehicle) ?? doc.vehicle) : doc.user_name
      const haystack = `${titular} ${doc.type_display} ${doc.uploaded_by_name ?? ''} ${doc.status_display} ${doc.expiry_date ?? ''} ${doc.created_at.slice(0, 10)}`
      return haystack.toLowerCase().includes(term)
    })
  }, [typed, search, vehicleFilter, userFilter, uploaderFilter, statusFilter, plateById, driverByVehicle])

  const columns: Array<TableWithPanelColumn<FlotaDocument>> = [
    {
      // Titular: la matrícula del coche o el nombre del usuario (personal).
      key: 'owner',
      label: docsCopy.ownerColumn,
      getValue: (doc) => owner(doc),
      render: (doc) => <strong>{owner(doc) || '—'}</strong>,
    },
    {
      // Conductor ACTUAL del coche titular; vacío en los documentos personales.
      key: 'driver',
      label: docsCopy.driverColumn,
      getValue: (doc) => (doc.vehicle != null ? (driverNameByVehicle.get(doc.vehicle) ?? '') : ''),
      render: (doc) =>
        doc.vehicle != null ? driverNameByVehicle.get(doc.vehicle) || '—' : '—',
    },
    // Con «Todos» el tipo deja de ser implícito: hay que verlo en la fila.
    ...(type
      ? []
      : [
          {
            key: 'type',
            label: docsCopy.typeColumn,
            getValue: (doc: FlotaDocument) => doc.type_display,
          },
        ]),
    {
      key: 'created_at',
      label: t.columns.uploaded,
      isDate: true,
      getValue: (doc) => doc.created_at.slice(0, 10),
      render: (doc) => doc.created_at.slice(0, 10),
    },
    {
      key: 'uploaded_by',
      label: t.columns.by,
      getValue: (doc) => doc.uploaded_by_name || '',
      render: (doc) => doc.uploaded_by_name || '—',
    },
    {
      key: 'expiry_date',
      label: t.columns.expiry,
      isDate: true,
      getValue: (doc) => doc.expiry_date ?? '',
      render: (doc) => doc.expiry_date ?? '—',
    },
    {
      key: 'status',
      label: t.columns.status,
      getValue: (doc) => doc.status_display,
      render: (doc) => <Badge tone={documentStatusTone(doc.status)}>{doc.status_display}</Badge>,
    },
    {
      key: 'actions',
      label: t.columns.actions,
      align: 'right',
      searchable: false,
      sortable: false,
      render: (doc) => {
        const href = safeHref(doc.drive_url) || safeHref(doc.file_url)
        return href ? (
          <a className="doc-open" href={href} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden /> {t.open}
          </a>
        ) : (
          '—'
        )
      },
    },
  ]

  const csvColumns = columns.filter((c) => c.key !== 'actions')
  // Dentro del acordeón el titular y el conductor ya están en la fila del
  // grupo: fuera esas columnas de la tabla interior.
  const innerColumns = columns.filter((c) => c.key !== 'owner' && c.key !== 'driver')

  // Vista agrupada: sobre los documentos YA filtrados, un grupo por matrícula
  // y, tras los coches, uno por titular de documentos personales.
  const groups = useMemo<GroupRow[]>(() => {
    if (!grouped) return []
    const byKey = new Map<string, GroupRow>()
    for (const doc of visible) {
      const key = doc.vehicle != null ? `v-${doc.vehicle}` : `u-${doc.user}`
      let group = byKey.get(key)
      if (!group) {
        group = {
          key,
          title:
            doc.vehicle != null
              ? (plateById.get(doc.vehicle) ?? `#${doc.vehicle}`)
              : docsCopy.groupPersonal(doc.user_name || `#${doc.user}`),
          personal: doc.vehicle == null,
          driver: doc.vehicle != null ? (driverNameByVehicle.get(doc.vehicle) ?? '') : '',
          rows: [],
        }
        byKey.set(key, group)
      }
      group.rows.push(doc)
    }
    return [...byKey.values()].sort(
      (a, b) => Number(a.personal) - Number(b.personal) || a.title.localeCompare(b.title),
    )
  }, [grouped, visible, plateById, driverNameByVehicle, docsCopy])

  // La tabla agrupada: UNA fila por titular, con sus documentos como acordeón
  // (fila expandible) dentro de la misma tabla.
  const groupCols: Array<TableWithPanelColumn<GroupRow>> = [
    {
      key: 'owner',
      label: docsCopy.ownerColumn,
      getValue: (g) => g.title,
      render: (g) => <strong>{g.title}</strong>,
    },
    {
      key: 'driver',
      label: docsCopy.driverColumn,
      getValue: (g) => g.driver,
      render: (g) => g.driver || '—',
    },
    {
      key: 'count',
      label: docsCopy.groupDocsColumn,
      align: 'right',
      getValue: (g) => g.rows.length,
    },
    {
      key: 'expired',
      label: docsCopy.groupExpiredColumn,
      align: 'right',
      getValue: (g) => g.rows.filter((d) => d.status === 'expired').length,
      render: (g) => {
        const n = g.rows.filter((d) => d.status === 'expired').length
        return n > 0 ? <Badge tone={documentStatusTone('expired')}>{n}</Badge> : '—'
      },
    },
  ]

  const renderGroupDocs = (group: GroupRow) => (
    <div className="docs-group-inner">
      <TableWithPanel<FlotaDocument>
        rows={group.rows}
        columns={innerColumns}
        rowKey={(doc) => String(doc.id)}
        rowClassName={(doc) => (doc.status === 'expired' ? 'row-muted' : '')}
        enableColumnSort
        showControlPanel={false}
        enablePagination
        defaultPageSize={10}
        pageSizeOptions={[10, 25, 50]}
        emptyStateLabel={t.empty(true)}
      />
    </div>
  )

  if (loading) return <p className="loading-state" role="status">{t.loading}</p>

  return (
    <>
      {error && <div role="alert" className="form-error">{error}</div>}

      {/* Resumen por estado: cuántos hay de cada uno y filtro de un clic. */}
      {statusCounts.length > 0 && (
        <div className="doc-status-strip">
          <span className="doc-status-strip-label">{docsCopy.statusSummary}</span>
          {statusCounts.map((s) => {
            const on = statusFilter === s.value
            return (
              <button
                key={s.value}
                type="button"
                aria-pressed={on}
                title={on ? docsCopy.clearStatusFilter : docsCopy.filterByStatus(s.label)}
                className={`doc-status-chip tone-${documentStatusTone(s.value)}${on ? ' is-on' : ''}`}
                onClick={() => setStatusFilter(on ? '' : s.value)}
              >
                <span className="doc-status-chip-count">{s.count}</span> {s.label}
              </button>
            )
          })}
        </div>
      )}

      {/* `inline`: con 5 filtros y 2 acciones, la franja normal se partía en
          tres filas; en línea cabe en una y envuelve solo en pantallas estrechas. */}
      <TableInfoBar
        inline
        count={visible.length}
        recordsLabel={t.records}
        searchLabel={t.searchLabel}
        searchPlaceholder={t.searchPlaceholder}
        search={search}
        onSearchChange={setSearch}
        actions={
          <>
            <Button variant="primary" onClick={openCreate}>{docsCopy.newDocument}</Button>
            <Button
              variant="secondary"
              disabled={visible.length === 0}
              onClick={() => exportCsv(`documentos-${type || 'todos'}`, csvColumns, visible)}
            >
              {t.exportCsv}
            </Button>
          </>
        }
      >
        <VehicleSelect
          label={vehicleLabel}
          vehicles={vehicles}
          value={vehicleFilter}
          onChange={setVehicleFilter}
          copy={{ all: t.allVehicles, searchPlaceholder: t.vehicleSearchPlaceholder, noResults: t.noResults }}
        />
        {/* «De quién es»: titular personal o conductor actual del coche. */}
        <div className="filter-field filter-field--role">
          <label>{docsCopy.userFilterLabel}</label>
          <SelectField
            aria-label={docsCopy.userFilterLabel}
            containerClassName="role-filter"
            required
            enableSearchFilter
            searchInputPlaceholder={docsCopy.userSearchPlaceholder}
            options={[
              { value: '', label: docsCopy.allUsers },
              ...users.map((u) => ({ value: String(u.id), label: u.label })),
            ]}
            value={userFilter}
            onValueChange={setUserFilter}
          />
        </div>
        {/* «Subido por»: la columna «Por» (quién subió el documento). */}
        <div className="filter-field filter-field--role">
          <label>{docsCopy.uploaderFilterLabel}</label>
          <SelectField
            aria-label={docsCopy.uploaderFilterLabel}
            containerClassName="role-filter"
            required
            enableSearchFilter
            searchInputPlaceholder={docsCopy.userSearchPlaceholder}
            options={[
              { value: '', label: docsCopy.allUsers },
              ...users.map((u) => ({ value: String(u.id), label: u.label })),
            ]}
            value={uploaderFilter}
            onValueChange={setUploaderFilter}
          />
        </div>
        <div className="filter-field filter-field--role">
          <label>{t.columns.status}</label>
          <SelectField
            aria-label={t.columns.status}
            containerClassName="role-filter"
            required
            enableSearchFilter
            options={[
              { value: '', label: t.allStatuses },
              ...statusCounts.map((s) => ({ value: s.value, label: s.label })),
            ]}
            value={statusFilter}
            onValueChange={setStatusFilter}
          />
        </div>
        {/* Vista agrupada: un acordeón por matrícula (personales por titular). */}
        <div className="filter-toggles">
          <label className="baja-toggle">
            <input
              type="checkbox"
              checked={grouped}
              onChange={(e) => setGrouped(e.target.checked)}
            />
            {docsCopy.groupByPlate}
          </label>
        </div>
      </TableInfoBar>

      {grouped ? (
        <TableWithPanel<GroupRow>
          rows={groups}
          columns={groupCols}
          rowKey={(g) => g.key}
          renderExpandedRow={renderGroupDocs}
          enableColumnSort
          showControlPanel={false}
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={t.empty(
            Boolean(search || vehicleFilter || userFilter || uploaderFilter || statusFilter),
          )}
        />
      ) : (
        <TableWithPanel<FlotaDocument>
          rows={visible}
          columns={columns}
          rowKey={(doc) => String(doc.id)}
          rowClassName={(doc) => (doc.status === 'expired' ? 'row-muted' : '')}
          enableColumnSort
          showControlPanel={false}
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={t.empty(
            Boolean(search || vehicleFilter || userFilter || uploaderFilter || statusFilter),
          )}
        />
      )}

      {/* Alta de documento: el titular es un coche O un usuario (elegir uno
          limpia el otro); el back valida el XOR y el ámbito. */}
      <Modal open={modalOpen} title={docsCopy.newDocument} onClose={closeModal}>
        <form className="modal-form" onSubmit={handleSubmit}>
          <p className="muted" style={{ margin: 0 }}>{docsCopy.ownerHint}</p>
          <SelectField
            label={t.typeLabel}
            options={DOC_TYPE_VALUES.map((value) => ({ value, label: t.typeOptions[value] }))}
            value={form.type}
            onValueChange={(value) => setForm((f) => ({ ...f, type: value }))}
          />
          <VehicleSelect
            label={docsCopy.ownerVehicleLabel}
            vehicles={vehicles}
            value={form.vehicle}
            onChange={(value) =>
              setForm((f) => ({ ...f, vehicle: value, user: value ? '' : f.user }))
            }
            copy={{
              all: docsCopy.ownerNone,
              searchPlaceholder: t.vehicleSearchPlaceholder,
              noResults: t.noResults,
            }}
          />
          <SelectField
            label={docsCopy.ownerUserLabel}
            enableSearchFilter
            searchInputPlaceholder={docsCopy.userSearchPlaceholder}
            options={[
              { value: '', label: docsCopy.ownerNone },
              ...users.map((u) => ({ value: String(u.id), label: u.label })),
            ]}
            value={form.user}
            onValueChange={(value) =>
              setForm((f) => ({ ...f, user: value, vehicle: value ? '' : f.vehicle }))
            }
          />
          <TextInputField
            label={t.expiryLabel}
            type="date"
            value={form.expiry_date}
            onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
          />
          <TextInputField
            label={t.notesLabel}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <div className="doc-attach">
            <span className="doc-attach-label">{t.fileLabel}</span>
            <label className="file-field">
              <span>{t.filePickLabel}</span>
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
                onChange={(e) => setAttach({ file: e.target.files?.[0] ?? null, manualUrl: '' })}
              />
            </label>
            <TextInputField
              label={t.urlLabel}
              value={attach.manualUrl}
              onChange={(e) => setAttach({ file: null, manualUrl: e.target.value })}
              placeholder="https://drive.google.com/…"
              disabled={Boolean(attach.file)}
            />
          </div>
          {formError && <div role="alert" className="form-error">{formError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={closeModal}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? t.saving : t.save}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
