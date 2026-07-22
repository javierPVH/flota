import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Modal, Panel, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  createVehicleFull,
  listUsers,
  fetchVehicle,
  listCatalog,
  listDrivers,
  previewVehicle,
  updateVehicleFields,
  type CatalogEntry,
  type VehicleFullInput,
} from '../api.ts'
import type { Driver, Vehicle } from '../types.ts'

// Listas cerradas del back (etiquetas locales; el serializer valida).
const FUEL_OPTIONS = [
  { value: 'gasoline', label: 'Gasolina' },
  { value: 'diesel', label: 'Diésel' },
  { value: 'LPG', label: 'GLP' },
  { value: 'hybrid', label: 'Híbrido' },
  { value: 'other', label: 'Otro' },
]
const TYPE_OPTIONS = [
  { value: 'car', label: 'Turismo' },
  { value: 'van', label: 'Furgoneta' },
  { value: 'truck', label: 'Camión' },
  { value: 'motorcycle', label: 'Motocicleta' },
]
const SIZE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'small', label: 'Pequeño' },
  { value: 'medium', label: 'Mediano' },
  { value: 'big', label: 'Grande' },
]
const SEGMENT_OPTIONS = [
  { value: '', label: '—' },
  { value: 'mini', label: 'Mini' },
  { value: 'supermini', label: 'Supermini' },
  { value: 'med_low', label: 'Mediano inferior' },
  { value: 'med_sup', label: 'Mediano superior' },
  { value: 'executive', label: 'Ejecutivo' },
  { value: 'luxury', label: 'Lujo' },
]
const VEH_USE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'passengers', label: 'Pasajeros' },
  { value: 'freight', label: 'Mercancía' },
]
const BUSINESS_USE_OPTIONS = [
  { value: 'personal', label: 'Personal' },
  { value: 'works', label: 'Obras' },
  { value: 'on_project', label: 'Proyecto' },
]
const PROPERTY_OPTIONS = [
  { value: 'propio', label: 'Propio' },
  { value: 'renting', label: 'Renting' },
]

// Campos del vehículo que emiten evento al cambiar (HU-1.4): badge `histórico`.
const HISTORIC_FIELDS = new Set(['business_use', 'project', 'cost_center'])

// Etiquetas legibles del diff del preview.
const FIELD_LABEL: Record<string, string> = {
  plate: 'Matrícula',
  vin: 'Bastidor (VIN)',
  brand: 'Marca',
  model: 'Modelo',
  version: 'Versión',
  year: 'Año',
  fuel: 'Combustible',
  type: 'Tipo',
  size: 'Tamaño',
  market_segment: 'Segmento',
  veh_use: 'Uso pasajeros/mercancía',
  consumption: 'Consumo',
  business_use: 'Tipo de uso',
  project: 'Proyecto',
  business_unit: 'Unidad de negocio',
  cost_center: 'CECO',
  country: 'País',
  property: 'Propiedad',
  supervisor: 'Supervisor',
  registration_date: 'Matriculación',
}

interface FormState {
  plate: string
  vin: string
  brand: string
  model: string
  version: string
  year: string
  registration_date: string
  fuel: string
  type: string
  size: string
  market_segment: string
  veh_use: string
  consumption: string
  km_start: string
  business_use: string
  project: string
  business_unit: string
  cost_center: string
  country: string
  property: string
  supervisor: string
  driver: string
  // Contrato (solo alta, con propiedad = renting)
  renting: string
  contract_number: string
  contract_time: string
  contract_km: string
  month_fee: string
  penalty_per_km: string
  contract_start: string
  contract_end: string
}

const EMPTY: FormState = {
  plate: '',
  vin: '',
  brand: '',
  model: '',
  version: '',
  year: '',
  registration_date: '',
  fuel: 'diesel',
  type: 'car',
  size: '',
  market_segment: '',
  veh_use: '',
  consumption: '',
  km_start: '',
  business_use: 'personal',
  project: '',
  business_unit: '',
  cost_center: '',
  country: '',
  property: 'renting',
  supervisor: '',
  driver: '',
  renting: '',
  contract_number: '',
  contract_time: '',
  contract_km: '',
  month_fee: '',
  penalty_per_km: '',
  contract_start: '',
  contract_end: '',
}

function fromVehicle(v: Vehicle): FormState {
  return {
    ...EMPTY,
    plate: v.plate,
    vin: v.vin,
    brand: v.brand,
    model: v.model,
    version: v.version,
    year: v.year != null ? String(v.year) : '',
    registration_date: v.registration_date ?? '',
    fuel: v.fuel || 'diesel',
    type: v.type || 'car',
    size: v.size,
    market_segment: v.market_segment,
    veh_use: v.veh_use,
    consumption: v.consumption != null ? String(v.consumption) : '',
    km_start: v.km_start != null ? String(v.km_start) : '',
    business_use: v.business_use || 'personal',
    project: v.project != null ? String(v.project) : '',
    business_unit: v.business_unit != null ? String(v.business_unit) : '',
    cost_center: v.cost_center != null ? String(v.cost_center) : '',
    country: v.country != null ? String(v.country) : '',
    property: v.property || 'renting',
    supervisor: v.supervisor != null ? String(v.supervisor) : '',
  }
}

/** Campos editables del vehículo (sin contrato/conductor: flujos propios). */
function vehiclePayload(form: FormState): Record<string, unknown> {
  return {
    plate: form.plate,
    vin: form.vin,
    brand: form.brand,
    model: form.model,
    version: form.version,
    year: form.year ? Number(form.year) : null,
    registration_date: form.registration_date || null,
    fuel: form.fuel,
    type: form.type,
    size: form.size,
    market_segment: form.market_segment,
    veh_use: form.veh_use,
    consumption: form.consumption ? Number(form.consumption) : null,
    business_use: form.business_use,
    project: form.project ? Number(form.project) : null,
    business_unit: form.business_unit ? Number(form.business_unit) : null,
    cost_center: form.cost_center ? Number(form.cost_center) : null,
    country: form.country ? Number(form.country) : null,
    property: form.property,
    supervisor: form.supervisor ? Number(form.supervisor) : null,
  }
}

function catalogOptions(entries: CatalogEntry[], empty = '—') {
  return [
    { value: '', label: empty },
    ...entries.map((e) => ({
      value: String(e.id),
      label: e.project_name ?? (e.code ? `${e.code} · ${e.name}` : (e.name ?? `#${e.id}`)),
    })),
  ]
}

function FieldBadge({ kind }: { kind: 'historic' | 'locked' }) {
  return kind === 'historic' ? (
    <span className="field-badge historic" title="Su cambio queda registrado como evento">
      histórico
    </span>
  ) : (
    <span className="field-badge locked" title="Tiene un flujo propio; no se edita aquí">
      bloqueado
    </span>
  )
}

function Labeled({ children, badge }: { children: ReactNode; badge?: 'historic' | 'locked' }) {
  if (!badge) return <>{children}</>
  return (
    <div className="field-with-badge">
      {children}
      <FieldBadge kind={badge} />
    </div>
  )
}

export function VehicleFormPage() {
  const { id } = useParams()
  const editing = id !== undefined
  const vehicleId = editing ? Number(id) : null
  const navigate = useNavigate()

  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [initial, setInitial] = useState<FormState>(EMPTY)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)

  const [drivers, setDrivers] = useState<Driver[]>([])
  const [supervisors, setSupervisors] = useState<Array<{ id: number; name: string }>>([])
  const [projects, setProjects] = useState<CatalogEntry[]>([])
  const [peps, setPeps] = useState<CatalogEntry[]>([])
  const [units, setUnits] = useState<CatalogEntry[]>([])
  const [rentings, setRentings] = useState<CatalogEntry[]>([])
  const [countries, setCountries] = useState<CatalogEntry[]>([])

  const [preview, setPreview] = useState<Record<string, [unknown, unknown]> | null>(null)

  useEffect(() => {
    listDrivers().then(setDrivers).catch(() => setDrivers([]))
    // Supervisores (HU-2.7): usuarios activos con ese rol.
    listUsers()
      .then((page) =>
        setSupervisors(
          page.results
            .filter((u) => u.is_active && u.roles.includes('supervisor'))
            .map((u) => ({ id: u.id, name: u.name })),
        ),
      )
      .catch(() => setSupervisors([]))
    listCatalog('projects').then((p) => setProjects(p.results)).catch(() => {})
    listCatalog('peps').then((p) => setPeps(p.results)).catch(() => {})
    listCatalog('business-units').then((p) => setUnits(p.results)).catch(() => {})
    listCatalog('rentings').then((p) => setRentings(p.results)).catch(() => {})
    listCatalog('countries').then((p) => setCountries(p.results)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!vehicleId) return
    fetchVehicle(vehicleId)
      .then((v) => {
        setVehicle(v)
        const state = fromVehicle(v)
        setForm(state)
        setInitial(state)
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudo cargar el vehículo.')))
  }, [vehicleId])

  const set = (key: keyof FormState) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }))
  const setInput = (key: keyof FormState) => (e: { target: { value: string } }) =>
    set(key)(e.target.value)

  const dirty = useMemo(
    () => (Object.keys(form) as Array<keyof FormState>).some((k) => form[k] !== initial[k]),
    [form, initial],
  )

  /** Solo los campos que han cambiado (PATCH mínimo y preview honesto). */
  function changedPayload(): Record<string, unknown> {
    const full = vehiclePayload(form)
    const before = vehiclePayload(initial)
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(full)) {
      if (JSON.stringify(full[key]) !== JSON.stringify(before[key])) out[key] = full[key]
    }
    return out
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (editing && vehicleId) {
      // HU-1.4: preview de cambios antes de guardar.
      try {
        const result = await previewVehicle(vehicleId, changedPayload())
        setPreview(result.changes)
      } catch (err) {
        setError(asErrorMessage(err, 'No se pudo previsualizar los cambios.'))
      }
      return
    }
    // Alta transaccional (HU-1.3): un fallo no crea nada.
    setSaving(true)
    try {
      const payload: VehicleFullInput = { ...vehiclePayload(form) }
      if (form.km_start) payload.km_start = Number(form.km_start)
      if (form.driver) payload.driver = Number(form.driver)
      if (form.property === 'renting' && form.contract_start && form.contract_end) {
        payload.contract = {
          contract_number: form.contract_number || undefined,
          contract_time: form.contract_time ? Number(form.contract_time) : null,
          contract_km: form.contract_km ? Number(form.contract_km) : null,
          renting: form.renting ? Number(form.renting) : null,
          start_date: form.contract_start,
          planned_end_date: form.contract_end,
          month_fee: form.month_fee || null,
          penalty_per_km: form.penalty_per_km || null,
        }
      }
      const created = await createVehicleFull(payload)
      navigate(`/vehiculos/${created.id}`, { replace: true })
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo crear el vehículo (no se ha guardado nada).'))
    } finally {
      setSaving(false)
    }
  }

  async function confirmSave() {
    if (!vehicleId || !vehicle) return
    setSaving(true)
    setError('')
    try {
      await updateVehicleFields(vehicleId, {
        ...changedPayload(),
        // Bloqueo optimista: si la ficha cambió entre medias, el back devuelve 409.
        expected_updated_at: vehicle.updated_at,
      })
      navigate(`/vehiculos/${vehicleId}`, { replace: true })
    } catch (err) {
      setPreview(null)
      const message = asErrorMessage(err, 'No se pudo guardar.')
      // Detail del 409 del back: "El registro ha cambiado desde que lo cargaste…"
      if (message.includes('ha cambiado desde que lo cargaste')) setConflict(true)
      else setError(message)
    } finally {
      setSaving(false)
    }
  }

  const onProject = form.business_use === 'on_project'
  const isRenting = form.property === 'renting'
  const title = editing ? `Editar ${vehicle?.plate ?? ''}` : 'Nuevo vehículo'

  if (editing && !vehicle && !error) return <p>Cargando…</p>

  return (
    <div className="vehicle-form">
      <p className="breadcrumbs">
        <Link to={editing && vehicleId ? `/vehiculos/${vehicleId}` : '/'}>← Volver</Link>
      </p>
      <div className="page-head">
        <h2>{title}</h2>
      </div>

      {editing && (
        <div className="edit-banner">
          Los campos <span className="field-badge historic">histórico</span> registran un evento al
          cambiar; los <span className="field-badge locked">bloqueado</span> tienen flujo propio
          (el kilometraje va por lecturas y el conductor por «Cambiar conductor»).
        </div>
      )}

      {conflict && (
        <div className="form-error conflict-banner">
          La ficha cambió mientras editabas (otra sesión guardó antes).{' '}
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            Recargar con los datos actuales
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <Panel>
          <h3>Identificación</h3>
          <div className="form-grid">
            <TextInputField label="Matrícula *" value={form.plate} onChange={setInput('plate')} required />
            <TextInputField label="Bastidor (VIN)" value={form.vin} onChange={setInput('vin')} />
            <TextInputField label="Marca *" value={form.brand} onChange={setInput('brand')} required />
            <TextInputField label="Modelo *" value={form.model} onChange={setInput('model')} required />
            <TextInputField label="Versión" value={form.version} onChange={setInput('version')} />
            <TextInputField label="Año" type="number" value={form.year} onChange={setInput('year')} />
            <TextInputField
              label="Matriculación"
              type="date"
              value={form.registration_date}
              onChange={setInput('registration_date')}
            />
          </div>
        </Panel>

        <Panel>
          <h3>Características técnicas</h3>
          <div className="form-grid">
            <SelectField label="Combustible *" options={FUEL_OPTIONS} value={form.fuel} onValueChange={set('fuel')} />
            <SelectField label="Tipo *" options={TYPE_OPTIONS} value={form.type} onValueChange={set('type')} />
            <SelectField label="Tamaño" options={SIZE_OPTIONS} value={form.size} onValueChange={set('size')} />
            <SelectField
              label="Segmento"
              options={SEGMENT_OPTIONS}
              value={form.market_segment}
              onValueChange={set('market_segment')}
            />
            <SelectField
              label="Uso pasajeros/mercancía"
              options={VEH_USE_OPTIONS}
              value={form.veh_use}
              onValueChange={set('veh_use')}
            />
            <TextInputField
              label="Consumo (l/100km)"
              type="number"
              value={form.consumption}
              onChange={setInput('consumption')}
            />
            <Labeled badge={editing ? 'locked' : undefined}>
              <TextInputField
                label="Odómetro inicial (km)"
                type="number"
                value={form.km_start}
                onChange={setInput('km_start')}
                disabled={editing}
                title={editing ? 'El kilometraje se actualiza registrando lecturas' : undefined}
              />
            </Labeled>
          </div>
          {!editing && (
            <p className="muted">El odómetro inicial crea la primera lectura de km del vehículo.</p>
          )}
        </Panel>

        <Panel>
          <h3>Uso y asignación</h3>
          <div className="form-grid">
            <Labeled badge={editing ? 'historic' : undefined}>
              <SelectField
                label="Tipo de uso *"
                options={BUSINESS_USE_OPTIONS}
                value={form.business_use}
                onValueChange={set('business_use')}
              />
            </Labeled>
            <Labeled badge={editing ? 'historic' : undefined}>
              <SelectField
                label={onProject ? 'Proyecto *' : 'Proyecto'}
                options={catalogOptions(projects, onProject ? '— Elegir —' : '— (solo uso Proyecto)')}
                value={form.project}
                onValueChange={set('project')}
                disabled={!onProject}
              />
            </Labeled>
            <Labeled badge={editing ? 'locked' : undefined}>
              <SelectField
                label="Conductor"
                options={[
                  { value: '', label: 'Sin asignar' },
                  ...drivers.map((d) => ({ value: String(d.id), label: d.name })),
                ]}
                value={form.driver}
                onValueChange={set('driver')}
                disabled={editing}
                title={editing ? 'El conductor se cambia desde la ficha (Cambiar conductor)' : undefined}
              />
            </Labeled>
            <SelectField
              label="Supervisor"
              options={[
                { value: '', label: 'Sin supervisor' },
                ...supervisors.map((u) => ({ value: String(u.id), label: u.name })),
              ]}
              value={form.supervisor}
              onValueChange={set('supervisor')}
            />
            <SelectField
              label="Unidad de negocio"
              options={catalogOptions(units)}
              value={form.business_unit}
              onValueChange={set('business_unit')}
            />
            <Labeled badge={editing ? 'historic' : undefined}>
              <SelectField
                label="CECO"
                options={catalogOptions(peps)}
                value={form.cost_center}
                onValueChange={set('cost_center')}
              />
            </Labeled>
            <SelectField
              label="País"
              options={catalogOptions(countries)}
              value={form.country}
              onValueChange={set('country')}
            />
          </div>
        </Panel>

        <Panel>
          <h3>Propiedad y contrato</h3>
          <div className="form-grid">
            <SelectField
              label="Propiedad *"
              options={PROPERTY_OPTIONS}
              value={form.property}
              onValueChange={set('property')}
            />
            {!editing && isRenting && (
              <>
                <SelectField
                  label="Compañía de renting"
                  options={catalogOptions(rentings)}
                  value={form.renting}
                  onValueChange={set('renting')}
                />
                <TextInputField
                  label="Nº de contrato"
                  value={form.contract_number}
                  onChange={setInput('contract_number')}
                />
                <TextInputField
                  label="Duración (meses)"
                  type="number"
                  value={form.contract_time}
                  onChange={setInput('contract_time')}
                />
                <TextInputField
                  label="Km contratados"
                  type="number"
                  value={form.contract_km}
                  onChange={setInput('contract_km')}
                />
                <TextInputField
                  label="Cuota mensual (€)"
                  type="number"
                  value={form.month_fee}
                  onChange={setInput('month_fee')}
                />
                <TextInputField
                  label="Penalización (€/km)"
                  type="number"
                  value={form.penalty_per_km}
                  onChange={setInput('penalty_per_km')}
                />
                <TextInputField
                  label="Inicio del contrato"
                  type="date"
                  value={form.contract_start}
                  onChange={setInput('contract_start')}
                />
                <TextInputField
                  label="Fin previsto"
                  type="date"
                  value={form.contract_end}
                  onChange={setInput('contract_end')}
                />
              </>
            )}
          </div>
          {editing ? (
            <p className="muted">
              El contrato vigente se consulta en la ficha; los cambios de cuota se registran como
              evento (G8) y los contratos tienen su propio CRUD.
            </p>
          ) : (
            isRenting && (
              <p className="muted">
                El contrato se crea junto al vehículo: si algo falla, no se guarda nada.
              </p>
            )
          )}
        </Panel>

        {error && <div className="form-error">{error}</div>}

        <div className="form-footer">
          <span className="muted">
            {editing ? (dirty ? 'Hay cambios sin guardar.' : 'Sin cambios todavía.') : ''}
          </span>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(editing && vehicleId ? `/vehiculos/${vehicleId}` : '/')}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving || (editing && !dirty)}>
              {saving ? 'Guardando…' : editing ? 'Revisar cambios…' : 'Crear vehículo'}
            </Button>
          </div>
        </div>
      </form>

      {/* Preview de cambios (HU-1.4): confirmar antes de guardar */}
      <Modal
        open={preview !== null}
        title="Confirmar cambios"
        onClose={() => setPreview(null)}
      >
        {preview && Object.keys(preview).length === 0 ? (
          <p className="muted">El servidor no detecta cambios efectivos.</p>
        ) : (
          <table className="data preview-table">
            <thead>
              <tr>
                <th>Campo</th>
                <th>Antes</th>
                <th>Después</th>
              </tr>
            </thead>
            <tbody>
              {preview &&
                Object.entries(preview).map(([field, [before, after]]) => (
                  <tr key={field}>
                    <td>
                      {FIELD_LABEL[field] ?? field}
                      {HISTORIC_FIELDS.has(field) && <FieldBadge kind="historic" />}
                    </td>
                    <td>{String(before ?? '—')}</td>
                    <td>
                      <strong>{String(after ?? '—')}</strong>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <Button variant="secondary" onClick={() => setPreview(null)}>
            Seguir editando
          </Button>
          <Button
            variant="primary"
            disabled={saving || !preview || Object.keys(preview).length === 0}
            onClick={confirmSave}
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
