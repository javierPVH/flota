import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react'
import { Button, IconButton, Modal, PageHeader, SelectField, TabButton, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import type { CatalogCreateFieldDefinition } from '@flota/ui/forms'
import { asErrorMessage } from '@flota/ui/http'
import { Pencil, Trash2 } from 'lucide-react'

import {
  createCatalogEntry,
  deleteCatalogEntry,
  listCatalog,
  updateCatalogEntry,
  type CatalogEntry,
  type CatalogResource,
} from '../api.ts'
import { useDeactivateConfirm } from '../components/ConfirmDialog.tsx'
import { exportCsv } from '../csv.ts'

interface CatalogDef {
  resource: CatalogResource
  title: string
  singular: string
  fields: CatalogCreateFieldDefinition[]
}

// Los selects del alta/edición del vehículo (G3) y la refacturación (G10)
// consumen estos catálogos; aquí se mantienen sin salir de la app (HU G11).
const CATALOGS: CatalogDef[] = [
  {
    resource: 'projects',
    title: 'Proyectos',
    singular: 'proyecto',
    fields: [
      { key: 'project_name', label: 'Nombre del proyecto', required: true },
      // Las opciones (catálogo de CECO) se inyectan en render — ver `activeFields`.
      { key: 'cost_center', label: 'Centro de coste (CECO)', kind: 'select', required: true },
    ],
  },
  {
    resource: 'peps',
    title: 'PEP / CECO',
    singular: 'CECO',
    fields: [
      { key: 'code', label: 'Código' },
      { key: 'name', label: 'Nombre', required: true },
    ],
  },
  {
    resource: 'business-units',
    title: 'Unidades de negocio',
    singular: 'unidad de negocio',
    fields: [
      { key: 'code', label: 'Código' },
      { key: 'name', label: 'Nombre', required: true },
    ],
  },
  {
    resource: 'rentings',
    title: 'Rentings',
    singular: 'compañía de renting',
    fields: [
      { key: 'name', label: 'Nombre', required: true },
      // N10a: destinatario de los avisos de seguro (insurance_due).
      { key: 'email', label: 'Email de contacto' },
      { key: 'contact_name', label: 'Persona de contacto' },
    ],
  },
  {
    resource: 'countries',
    title: 'Países',
    singular: 'país',
    fields: [{ key: 'name', label: 'Nombre', required: true }],
  },
  // N5: marca, modelo (depende de la marca) y sociedad.
  {
    resource: 'brands',
    title: 'Marcas',
    singular: 'marca',
    fields: [{ key: 'name', label: 'Nombre', required: true }],
  },
  {
    resource: 'vehicle-models',
    title: 'Modelos',
    singular: 'modelo',
    fields: [
      // Las opciones (catálogo de marcas) se inyectan en render — ver `activeFields`.
      { key: 'brand', label: 'Marca', kind: 'select', required: true },
      { key: 'name', label: 'Nombre', required: true },
    ],
  },
  {
    resource: 'companies',
    title: 'Sociedades',
    singular: 'sociedad',
    fields: [
      { key: 'code', label: 'Código', required: true },
      { key: 'name', label: 'Nombre', required: true },
      { key: 'description', label: 'Descripción' },
    ],
  },
]

function entryLabel(entry: CatalogEntry): string {
  return entry.project_name ?? (entry.code ? `${entry.code} · ${entry.name}` : (entry.name ?? `#${entry.id}`))
}

/** Valor a mostrar de un campo del catálogo (resuelve displays de FKs). */
function cellValue(entry: CatalogEntry, key: string): string {
  if (key === 'cost_center') return entry.cost_center_display || ''
  if (key === 'brand') return entry.brand_display || ''
  return String((entry as unknown as Record<string, unknown>)[key] ?? '')
}

/** Catálogos (G11): CRUD de los maestros que alimentan los selects de la app. */
export function CatalogsPage() {
  const deactivateConfirm = useDeactivateConfirm()
  const [active, setActive] = useState<CatalogDef>(CATALOGS[0])
  const [entries, setEntries] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  // Alta (modal): campos dinámicos según el catálogo activo.
  const [creating, setCreating] = useState(false)
  const [createValues, setCreateValues] = useState<Record<string, string>>({})
  const [createError, setCreateError] = useState('')

  // Edición (modal).
  const [editing, setEditing] = useState<CatalogEntry | null>(null)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)

  // Catálogo de CECO para el select de proyectos (proyecto → centro de coste).
  const [peps, setPeps] = useState<CatalogEntry[]>([])
  useEffect(() => {
    listCatalog('peps')
      .then((page) => setPeps(page.results))
      .catch(() => setPeps([]))
  }, [])
  const pepOptions = useMemo(
    () =>
      peps.map((p) => ({
        value: String(p.id),
        label: p.code ? `${p.code} · ${p.name}` : (p.name ?? `#${p.id}`),
      })),
    [peps],
  )

  // N5: catálogo de marcas para el select de modelos (modelo → marca).
  const [brands, setBrands] = useState<CatalogEntry[]>([])
  useEffect(() => {
    listCatalog('brands')
      .then((page) => setBrands(page.results))
      .catch(() => setBrands([]))
  }, [])
  const brandOptions = useMemo(
    () => brands.map((b) => ({ value: String(b.id), label: b.name ?? `#${b.id}` })),
    [brands],
  )

  // Inyecta las opciones de las FKs en la definición declarativa del catálogo.
  const activeFields = useMemo(
    () =>
      active.fields.map((f) => {
        if (f.kind !== 'select') return f
        if (f.key === 'cost_center') return { ...f, options: pepOptions }
        if (f.key === 'brand') return { ...f, options: brandOptions }
        return f
      }),
    [active, pepOptions, brandOptions],
  )

  const load = useCallback(() => {
    setLoading(true)
    listCatalog(active.resource)
      .then((page) => {
        setEntries(page.results)
        // Mantiene fresco el select de marcas de la pestaña Modelos.
        if (active.resource === 'brands') setBrands(page.results)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudo cargar el catálogo.')))
      .finally(() => setLoading(false))
  }, [active.resource])

  useEffect(load, [load])

  function selectCatalog(catalog: CatalogDef) {
    setActive(catalog)
    setQuery('')
  }

  // Filtrado en cliente por la barra de búsqueda (los catálogos son pequeños).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((entry) =>
      activeFields
        .map((f) => cellValue(entry, f.key))
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [entries, query, activeFields])

  // Campos del formulario (alta/edición comparten el mismo render dinámico).
  const renderFields = (
    values: Record<string, string>,
    setValues: Dispatch<SetStateAction<Record<string, string>>>,
  ) =>
    activeFields.map((f) =>
      f.kind === 'select' ? (
        <SelectField
          key={f.key}
          label={f.label}
          options={[{ value: '', label: '— Elegir —' }, ...(f.options ?? [])]}
          value={values[f.key] ?? ''}
          onValueChange={(value) => setValues((v) => ({ ...v, [f.key]: value }))}
          required={f.required}
        />
      ) : (
        <TextInputField
          key={f.key}
          label={f.label}
          value={values[f.key] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          required={f.required}
        />
      ),
    )

  const columns: Array<TableWithPanelColumn<CatalogEntry>> = [
    ...activeFields.map((f) => ({
      key: f.key,
      label: f.label,
      getValue: (entry: CatalogEntry) => cellValue(entry, f.key),
      render: (entry: CatalogEntry) => cellValue(entry, f.key) || '—',
    })),
    {
      key: '__actions',
      label: 'Acciones',
      align: 'right' as const,
      sortable: false,
      render: (entry: CatalogEntry) => (
        <div className="row-actions">
          <IconButton aria-label="Editar" title="Editar" onClick={() => openEdit(entry)}>
            <Pencil size={15} />
          </IconButton>
          <IconButton
            variant="danger"
            aria-label="Eliminar"
            title="Eliminar"
            onClick={() => handleDelete(entry)}
          >
            <Trash2 size={15} />
          </IconButton>
        </div>
      ),
    },
  ]

  function openCreate() {
    setCreateValues(Object.fromEntries(activeFields.map((f) => [f.key, ''])))
    setCreateError('')
    setCreating(true)
  }

  // Los selects sin valor se omiten del payload: el back rechazaría el string vacío.
  function cleanPayload(values: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(values).filter(
        ([key, value]) => value !== '' || activeFields.find((f) => f.key === key)?.kind !== 'select',
      ),
    )
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setCreateError('')
    try {
      await createCatalogEntry(active.resource, cleanPayload(createValues))
      setCreating(false)
      load()
    } catch (err) {
      setCreateError(asErrorMessage(err, 'No se pudo crear.'))
    } finally {
      setSaving(false)
    }
  }

  function openEdit(entry: CatalogEntry) {
    setEditing(entry)
    setEditValues(
      Object.fromEntries(activeFields.map((f) => [f.key, cellValueForEdit(entry, f.key)])),
    )
    setEditError('')
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    setSaving(true)
    setEditError('')
    try {
      await updateCatalogEntry(active.resource, editing.id, cleanPayload(editValues))
      setEditing(null)
      load()
    } catch (err) {
      setEditError(asErrorMessage(err, 'No se pudo guardar.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(entry: CatalogEntry) {
    // N7: nada se borra — doble confirmación y desactivación con motivo.
    const reason = await deactivateConfirm(`${active.singular} "${entryLabel(entry)}"?`)
    if (reason === null) return
    try {
      await deleteCatalogEntry(active.resource, entry.id, reason)
      load()
    } catch (err) {
      setError(
        asErrorMessage(err, 'No se pudo desactivar (puede estar en uso por algún vehículo o factura).'),
      )
    }
  }

  return (
    <div>
      <PageHeader
        title="Configuración de catálogos"
        subtitle="Gestión de los maestros que alimentan los desplegables de vehículos y facturas."
      />

      <div className="chips-row catalog-tabs">
        {CATALOGS.map((catalog) => (
          <TabButton
            key={catalog.resource}
            active={active.resource === catalog.resource}
            onClick={() => selectCatalog(catalog)}
          >
            {catalog.title}
          </TabButton>
        ))}
      </div>

      {error && <div role="alert" className="form-error">{error}</div>}

      <div className="list-tools">
        <input
          className="search-input"
          type="search"
          placeholder={`Buscar ${active.singular}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="catalog-toolbar-end">
          <span className="catalog-count muted">
            {filtered.length}/{entries.length}
          </span>
          <Button
            variant="secondary"
            disabled={filtered.length === 0}
            onClick={() => exportCsv(active.resource, columns, filtered)}
          >
            Exportar CSV
          </Button>
          <Button variant="primary" onClick={openCreate}>
            Crear
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="loading-state" role="status">Cargando…</p>
      ) : (
        <TableWithPanel<CatalogEntry>
          rows={filtered}
          columns={columns}
          rowKey={(entry) => String(entry.id)}
          enableColumnSort
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={
            query ? 'Sin resultados para la búsqueda.' : 'Vacío: crea el primero con «Crear».'
          }
        />
      )}

      {/* Alta (HU G11): botón «Crear» → modal con los campos del catálogo activo. */}
      <Modal open={creating} title={`Nuevo ${active.singular}`} onClose={() => setCreating(false)}>
        <form className="modal-form" onSubmit={submitCreate}>
          {renderFields(createValues, setCreateValues)}
          {createError && <div role="alert" className="form-error">{createError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Creando…' : 'Crear'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={editing !== null} title={`Editar ${active.singular}`} onClose={() => setEditing(null)}>
        <form className="modal-form" onSubmit={submitEdit}>
          {renderFields(editValues, setEditValues)}
          {editError && <div role="alert" className="form-error">{editError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
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

/** Valor inicial de un campo al editar: las FKs usan el id (para el select). */
function cellValueForEdit(entry: CatalogEntry, key: string): string {
  if (key === 'cost_center') return entry.cost_center != null ? String(entry.cost_center) : ''
  if (key === 'brand') return entry.brand != null ? String(entry.brand) : ''
  return String((entry as unknown as Record<string, unknown>)[key] ?? '')
}
