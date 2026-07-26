import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, Chip, IconButton, Modal, PageHeader, SelectField, TextInputField } from '@flota/ui/ui'
import { CatalogEntityCreateForm, type CatalogCreateFieldDefinition } from '@flota/ui/forms'
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
import { useConfirm } from '../components/ConfirmDialog.tsx'

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
    fields: [{ key: 'name', label: 'Nombre', required: true }],
  },
  {
    resource: 'countries',
    title: 'Países',
    singular: 'país',
    fields: [{ key: 'name', label: 'Nombre', required: true }],
  },
]

function entryLabel(entry: CatalogEntry): string {
  return entry.project_name ?? (entry.code ? `${entry.code} · ${entry.name}` : (entry.name ?? `#${entry.id}`))
}

/** Catálogos (G11): CRUD de los maestros que alimentan los selects de la app. */
export function CatalogsPage() {
  const confirm = useConfirm()
  const [active, setActive] = useState<CatalogDef>(CATALOGS[0])
  const [entries, setEntries] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  // Inyecta las opciones de CECO en la definición declarativa del catálogo.
  const activeFields = useMemo(
    () =>
      active.fields.map((f) =>
        f.kind === 'select' && f.key === 'cost_center' ? { ...f, options: pepOptions } : f,
      ),
    [active, pepOptions],
  )

  const load = useCallback(() => {
    setLoading(true)
    listCatalog(active.resource)
      .then((page) => {
        setEntries(page.results)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudo cargar el catálogo.')))
      .finally(() => setLoading(false))
  }, [active.resource])

  useEffect(load, [load])

  function openEdit(entry: CatalogEntry) {
    setEditing(entry)
    setEditValues(
      Object.fromEntries(
        activeFields.map((f) => [f.key, String((entry as unknown as Record<string, unknown>)[f.key] ?? '')]),
      ),
    )
    setEditError('')
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    setSaving(true)
    setEditError('')
    try {
      // Los selects sin valor (p. ej. proyecto legacy sin CECO) se omiten del
      // PATCH: el parcial no los exige y el back rechazaría el string vacío.
      const payload = Object.fromEntries(
        Object.entries(editValues).filter(
          ([key, value]) =>
            value !== '' || activeFields.find((f) => f.key === key)?.kind !== 'select',
        ),
      )
      await updateCatalogEntry(active.resource, editing.id, payload)
      setEditing(null)
      load()
    } catch (err) {
      setEditError(asErrorMessage(err, 'No se pudo guardar.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(entry: CatalogEntry) {
    if (!(await confirm({ message: `¿Eliminar ${active.singular} "${entryLabel(entry)}"?` }))) return
    try {
      await deleteCatalogEntry(active.resource, entry.id)
      load()
    } catch (err) {
      setError(
        asErrorMessage(err, 'No se pudo eliminar (puede estar en uso por algún vehículo o factura).'),
      )
    }
  }

  return (
    <div>
      <PageHeader
        title="Catálogos"
        subtitle="Maestros que alimentan los desplegables de vehículos y facturas."
      />

      <div className="chips-row">
        {CATALOGS.map((catalog) => (
          <Chip
            key={catalog.resource}
            active={active.resource === catalog.resource}
            onClick={() => setActive(catalog)}
          >
            {catalog.title}
          </Chip>
        ))}
      </div>

      {error && <div role="alert" className="form-error">{error}</div>}

      <div className="catalog-grid">
        <section className="card">
          <h3>{active.title}</h3>
          {loading ? (
            <p className="loading-state" role="status">Cargando…</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  {activeFields.map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={activeFields.length + 1}>Vacío: crea el primero a la derecha.</td>
                  </tr>
                )}
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    {activeFields.map((f) => (
                      <td key={f.key}>
                        {f.key === 'cost_center'
                          ? entry.cost_center_display || '—'
                          : String((entry as unknown as Record<string, unknown>)[f.key] ?? '') || '—'}
                      </td>
                    ))}
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <CatalogEntityCreateForm
            key={active.resource}
            entity={active.resource}
            title={`Nuevo ${active.singular}`}
            submitLabel="Crear"
            fields={activeFields}
            submit={async ({ entity, data }) => {
              const created = await createCatalogEntry(entity as CatalogResource, data)
              return { id: created.id, code: created.code, name: created.name ?? created.project_name }
            }}
            onCreated={load}
          />
        </section>
      </div>

      <Modal
        open={editing !== null}
        title={`Editar ${active.singular}`}
        onClose={() => setEditing(null)}
      >
        <form className="modal-form" onSubmit={submitEdit}>
          {activeFields.map((f) =>
            f.kind === 'select' ? (
              <SelectField
                key={f.key}
                label={f.label}
                options={f.options ?? []}
                value={editValues[f.key] ?? ''}
                onValueChange={(value) => setEditValues((v) => ({ ...v, [f.key]: value }))}
                required={f.required}
              />
            ) : (
              <TextInputField
                key={f.key}
                label={f.label}
                value={editValues[f.key] ?? ''}
                onChange={(e) => setEditValues((v) => ({ ...v, [f.key]: e.target.value }))}
                required={f.required}
              />
            ),
          )}
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
