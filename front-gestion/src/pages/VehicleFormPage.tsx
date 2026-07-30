import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Modal, PageHeader, Panel, SelectField, TextInputField } from '@flota/ui/ui'
import { ApiError, asErrorMessage } from '@flota/ui/http'

import { useVehicleFormCopy, type VehicleFormCopy } from '../translations/vehicleForm.ts'

import {
  createCatalogEntry,
  createVehicleFull,
  listUsers,
  fetchVehicle,
  listCatalog,
  listDrivers,
  listVehicleModels,
  previewVehicle,
  updateVehicleFields,
  type CatalogEntry,
  type VehicleFullInput,
} from '../api.ts'
import type { Driver, Vehicle } from '../types.ts'

// Listas cerradas del back (etiquetas i18n del diccionario; el serializer valida).
function toOptions(labels: Record<string, string>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }))
}
function closedListOptions(t: VehicleFormCopy) {
  const empty = { value: '', label: '—' }
  return {
    fuel: toOptions(t.fuelLabels),
    type: toOptions(t.typeLabels),
    size: [empty, ...toOptions(t.sizeLabels)],
    segment: [empty, ...toOptions(t.segmentLabels)],
    vehUse: [empty, ...toOptions(t.vehUseLabels)],
    businessUse: toOptions(t.businessUseLabels),
    property: toOptions(t.propertyLabels),
  }
}

// Campos del vehículo que emiten evento al cambiar (HU-1.4): badge `histórico`.
const HISTORIC_FIELDS = new Set(['business_use', 'project', 'cost_center'])

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
  // N9: tipo fijado al crear (flota / sustitución); inmutable después.
  is_substitute: boolean
  // N5: marca/modelo por catálogo (selects dependientes) + sociedad
  brand_ref: string
  model_ref: string
  company: string
  // N3/N2: sin proyección de km · vencimiento del seguro
  unlimited_km: boolean
  insurance_expiry_date: string
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
  is_substitute: false,
  brand_ref: '',
  model_ref: '',
  company: '',
  unlimited_km: false,
  insurance_expiry_date: '',
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
    is_substitute: v.is_substitute,
    brand_ref: v.brand_ref != null ? String(v.brand_ref) : '',
    model_ref: v.model_ref != null ? String(v.model_ref) : '',
    company: v.company != null ? String(v.company) : '',
    unlimited_km: v.unlimited_km ?? false,
    insurance_expiry_date: v.insurance_expiry_date ?? '',
  }
}

/** Campos editables del vehículo (sin contrato/conductor: flujos propios). */
function vehiclePayload(form: FormState): Record<string, unknown> {
  return {
    plate: form.plate,
    vin: form.vin,
    // N5: catálogo primero; el texto solo viaja si no hay ref (legado).
    ...(form.brand_ref
      ? { brand_ref: Number(form.brand_ref) }
      : form.brand
        ? { brand: form.brand }
        : {}),
    ...(form.model_ref
      ? { model_ref: Number(form.model_ref) }
      : form.model
        ? { model: form.model }
        : {}),
    company: form.company ? Number(form.company) : null,
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
    is_substitute: form.is_substitute,
    unlimited_km: form.unlimited_km,
    insurance_expiry_date: form.insurance_expiry_date || null,
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
  const t = useVehicleFormCopy()
  return kind === 'historic' ? (
    <span className="field-badge historic" title={t.historicBadgeTitle}>
      {t.historicBadge}
    </span>
  ) : (
    <span className="field-badge locked" title={t.lockedBadgeTitle}>
      {t.lockedBadge}
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
  const t = useVehicleFormCopy()
  const opts = useMemo(() => closedListOptions(t), [t])

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
  // N5: marca/modelo (dependiente) y sociedad.
  const [brands, setBrands] = useState<CatalogEntry[]>([])
  const [models, setModels] = useState<CatalogEntry[]>([])
  const [companies, setCompanies] = useState<CatalogEntry[]>([])
  // Alta rápida de modelo (admin) sin salir del formulario.
  const [addingModel, setAddingModel] = useState(false)
  const [newModelName, setNewModelName] = useState('')
  const [addModelError, setAddModelError] = useState('')

  const [preview, setPreview] = useState<Record<string, [unknown, unknown]> | null>(null)

  // UX5: un desplegable VACÍO por un fallo de carga en un formulario
  // transaccional es una trampa — si algo falla, banner + reintento.
  const [catalogError, setCatalogError] = useState(false)
  const [catalogRetry, setCatalogRetry] = useState(0)

  useEffect(() => {
    const loads: Array<Promise<unknown>> = [
      listDrivers().then(setDrivers),
      // Supervisores (HU-2.7): usuarios activos con ese rol.
      listUsers().then((page) =>
        setSupervisors(
          page.results
            .filter((u) => u.is_active && u.roles.includes('supervisor'))
            .map((u) => ({ id: u.id, name: u.name })),
        ),
      ),
      listCatalog('projects').then((p) => setProjects(p.results)),
      listCatalog('peps').then((p) => setPeps(p.results)),
      listCatalog('business-units').then((p) => setUnits(p.results)),
      listCatalog('rentings').then((p) => setRentings(p.results)),
      listCatalog('countries').then((p) => setCountries(p.results)),
      listCatalog('brands').then((p) => setBrands(p.results)),
      listCatalog('companies').then((p) => setCompanies(p.results)),
    ]
    void Promise.allSettled(loads).then((results) =>
      setCatalogError(results.some((r) => r.status === 'rejected')),
    )
  }, [catalogRetry])

  // N5: el desplegable de modelos depende de la marca elegida.
  useEffect(() => {
    if (!form.brand_ref) {
      setModels([])
      return
    }
    listVehicleModels(Number(form.brand_ref))
      .then((p) => setModels(p.results))
      .catch(() => setModels([]))
  }, [form.brand_ref])

  useEffect(() => {
    if (!vehicleId) return
    fetchVehicle(vehicleId)
      .then((v) => {
        setVehicle(v)
        const state = fromVehicle(v)
        setForm(state)
        setInitial(state)
      })
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
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
        setError(asErrorMessage(err, t.previewError))
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
      setError(asErrorMessage(err, t.createError))
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
      // BG9: el 409 (bloqueo optimista) se decide por status, no por el texto
      // del detail — el sniffing de mensaje se rompe al traducir.
      if (err instanceof ApiError && err.status === 409) setConflict(true)
      else setError(asErrorMessage(err, t.saveError))
    } finally {
      setSaving(false)
    }
  }

  const onProject = form.business_use === 'on_project'
  const isRenting = form.property === 'renting'
  const title = editing ? t.editTitle(vehicle?.plate ?? '') : t.newTitle

  if (editing && !vehicle && !error) return <p className="loading-state" role="status">{t.loading}</p>

  return (
    <div className="vehicle-form">
      <PageHeader
        breadcrumb={<Link to={editing && vehicleId ? `/vehiculos/${vehicleId}` : '/'}>{t.back}</Link>}
        title={title}
        subtitle={editing ? t.editSubtitle : t.newSubtitle}
      />

      {editing && (
        <Panel tone="info" className="form-banner">
          {t.bannerFieldsPrefix} <span className="field-badge historic">{t.historicBadge}</span>{' '}
          {t.bannerHistoricNote} <span className="field-badge locked">{t.lockedBadge}</span>{' '}
          {t.bannerLockedNote}
        </Panel>
      )}

      {conflict && (
        <Panel tone="warning" className="form-banner">
          {t.conflictBanner}{' '}
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            {t.conflictReload}
          </Button>
        </Panel>
      )}

      {catalogError && (
        <Panel tone="warning" className="form-banner">
          {t.catalogsLoadError}{' '}
          <Button variant="secondary" size="sm" onClick={() => setCatalogRetry((n) => n + 1)}>
            {t.catalogsRetry}
          </Button>
        </Panel>
      )}

      <form onSubmit={handleSubmit} className={form.is_substitute ? 'substitute-form' : undefined}>
        {/* N9: el tipo se elige AL CREAR y queda fijado (sustituto→flota va por
            la acción 'Convertir en flota' de la ficha; la inversa, prohibida). */}
        <section className="card">
          <h3>{t.typeSectionTitle}</h3>
          {editing ? (
            <p className="muted">
              {form.is_substitute ? t.substituteVehicle : t.fleetVehicle} {t.typeFixedNote}{' '}
              {form.is_substitute && t.convertibleNote}
            </p>
          ) : (
            <div className="type-switch" role="radiogroup" aria-label={t.typeAria}>
              <label className="baja-toggle">
                <input
                  type="radio"
                  name="vehicle-type"
                  checked={!form.is_substitute}
                  onChange={() => setForm((f) => ({ ...f, is_substitute: false }))}
                />
                {t.fleetOption}
              </label>
              <label className="baja-toggle">
                <input
                  type="radio"
                  name="vehicle-type"
                  checked={form.is_substitute}
                  onChange={() => setForm((f) => ({ ...f, is_substitute: true }))}
                />
                {t.substituteOption}
              </label>
            </div>
          )}
          {form.is_substitute && (
            <p className="substitute-note">
              {t.substituteNotePrefix} <strong>{t.substituteNoteStrong}</strong>
              {t.substituteNoteSuffix}
            </p>
          )}
        </section>
        <section className="card">
          <h3>{t.identificationTitle}{form.is_substitute && <span className="substitute-badge">{t.substituteBadge}</span>}</h3>
          <div className="form-grid">
            <TextInputField label={t.plate} requiredVisual value={form.plate} onChange={setInput('plate')} required />
            <TextInputField label={t.vin} value={form.vin} onChange={setInput('vin')} />
            <SelectField
              label={t.brand}
              requiredVisual
              required
              options={catalogOptions(brands, t.chooseBrand)}
              value={form.brand_ref}
              onValueChange={(value) =>
                // Cambiar de marca invalida el modelo elegido (dependiente).
                setForm((f) => ({ ...f, brand_ref: value, model_ref: '' }))
              }
            />
            <div className="field-with-badge">
              <SelectField
                label={t.model}
                requiredVisual
                required
                options={catalogOptions(
                  models,
                  form.brand_ref ? t.chooseModel : t.chooseBrandFirst,
                )}
                value={form.model_ref}
                onValueChange={set('model_ref')}
                disabled={!form.brand_ref}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!form.brand_ref}
                title={t.newModelButtonTitle}
                onClick={() => {
                  setNewModelName('')
                  setAddModelError('')
                  setAddingModel(true)
                }}
              >
                {t.newModelButton}
              </Button>
            </div>
            <TextInputField label={t.version} value={form.version} onChange={setInput('version')} />
            <TextInputField label={t.year} type="number" value={form.year} onChange={setInput('year')} />
            <TextInputField
              label={t.registrationDate}
              type="date"
              value={form.registration_date}
              onChange={setInput('registration_date')}
            />
          </div>
        </section>

        <section className="card">
          <h3>{t.technicalTitle}{form.is_substitute && <span className="substitute-badge">{t.substituteBadge}</span>}</h3>
          <div className="form-grid">
            <SelectField label={t.fuel} requiredVisual options={opts.fuel} value={form.fuel} onValueChange={set('fuel')} />
            <SelectField label={t.type} requiredVisual options={opts.type} value={form.type} onValueChange={set('type')} />
            <SelectField label={t.size} options={opts.size} value={form.size} onValueChange={set('size')} />
            <SelectField
              label={t.segment}
              options={opts.segment}
              value={form.market_segment}
              onValueChange={set('market_segment')}
            />
            <SelectField
              label={t.vehUse}
              options={opts.vehUse}
              value={form.veh_use}
              onValueChange={set('veh_use')}
            />
            <TextInputField
              label={t.consumption}
              type="number"
              value={form.consumption}
              onChange={setInput('consumption')}
            />
            <Labeled badge={editing ? 'locked' : undefined}>
              <TextInputField
                label={t.kmStart}
                type="number"
                value={form.km_start}
                onChange={setInput('km_start')}
                disabled={editing}
                title={editing ? t.kmStartLockedTitle : undefined}
              />
            </Labeled>
          </div>
          {!editing && <p className="muted">{t.kmStartNote}</p>}
        </section>

        <section className="card">
          <h3>{t.usageTitle}{form.is_substitute && <span className="substitute-badge">{t.substituteBadge}</span>}</h3>
          <div className="form-grid">
            <Labeled badge={editing ? 'historic' : undefined}>
              <SelectField
                label={t.businessUse}
                requiredVisual
                options={opts.businessUse}
                value={form.business_use}
                onValueChange={set('business_use')}
              />
            </Labeled>
            <Labeled badge={editing ? 'historic' : undefined}>
              <SelectField
                label={t.project}
                requiredVisual={onProject}
                options={catalogOptions(projects, onProject ? t.choose : t.projectOnlyUse)}
                value={form.project}
                onValueChange={(value) => {
                  set('project')(value)
                  // El proyecto lleva su CECO asociado: autorrellena el del
                  // vehículo si está vacío (el usuario puede cambiarlo después).
                  const projectCeco = projects.find((p) => String(p.id) === value)?.cost_center
                  if (projectCeco != null) {
                    setForm((f) =>
                      f.cost_center ? f : { ...f, cost_center: String(projectCeco) },
                    )
                  }
                }}
                disabled={!onProject}
              />
            </Labeled>
            <Labeled badge={editing ? 'locked' : undefined}>
              <SelectField
                label={t.driver}
                options={[
                  { value: '', label: t.unassigned },
                  ...drivers.map((d) => ({ value: String(d.id), label: d.name })),
                ]}
                value={form.driver}
                onValueChange={set('driver')}
                disabled={editing}
                title={editing ? t.driverLockedTitle : undefined}
              />
            </Labeled>
            <SelectField
              label={t.supervisor}
              options={[
                { value: '', label: t.noSupervisor },
                ...supervisors.map((u) => ({ value: String(u.id), label: u.name })),
              ]}
              value={form.supervisor}
              onValueChange={set('supervisor')}
            />
            <SelectField
              label={t.businessUnit}
              options={catalogOptions(units)}
              value={form.business_unit}
              onValueChange={set('business_unit')}
            />
            <Labeled badge={editing ? 'historic' : undefined}>
              <SelectField
                label={t.costCenter}
                options={catalogOptions(peps)}
                value={form.cost_center}
                onValueChange={set('cost_center')}
              />
            </Labeled>
            <SelectField
              label={t.country}
              options={catalogOptions(countries)}
              value={form.country}
              onValueChange={set('country')}
            />
          </div>
        </section>

        <section className="card">
          <h3>{t.propertyTitle}{form.is_substitute && <span className="substitute-badge">{t.substituteBadge}</span>}</h3>
          <div className="form-grid">
            <SelectField
              label={t.property}
              requiredVisual
              options={opts.property}
              value={form.property}
              onValueChange={set('property')}
            />
            <SelectField
              label={t.company}
              options={catalogOptions(companies, t.noCompany)}
              value={form.company}
              onValueChange={set('company')}
            />
            <TextInputField
              label={t.insuranceExpiry}
              type="date"
              value={form.insurance_expiry_date}
              onChange={setInput('insurance_expiry_date')}
            />
            <label className="baja-toggle" title={t.unlimitedKmTitle}>
              <input
                type="checkbox"
                checked={form.unlimited_km}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    unlimited_km: e.target.checked,
                    // Con km ilimitados, los km contratados no aplican.
                    contract_km: e.target.checked ? '' : f.contract_km,
                  }))
                }
              />
              {t.unlimitedKm}
            </label>
            {!editing && isRenting && (
              <>
                <SelectField
                  label={t.rentingCompany}
                  options={catalogOptions(rentings)}
                  value={form.renting}
                  onValueChange={set('renting')}
                />
                <TextInputField
                  label={t.contractNumber}
                  value={form.contract_number}
                  onChange={setInput('contract_number')}
                />
                <TextInputField
                  label={t.contractTime}
                  type="number"
                  value={form.contract_time}
                  onChange={setInput('contract_time')}
                />
                <TextInputField
                  label={t.contractKm}
                  type="number"
                  value={form.contract_km}
                  onChange={setInput('contract_km')}
                  disabled={form.unlimited_km}
                />
                <TextInputField
                  label={t.monthFee}
                  type="number"
                  value={form.month_fee}
                  onChange={setInput('month_fee')}
                />
                <TextInputField
                  label={t.penaltyPerKm}
                  type="number"
                  value={form.penalty_per_km}
                  onChange={setInput('penalty_per_km')}
                />
                <TextInputField
                  label={t.contractStart}
                  type="date"
                  value={form.contract_start}
                  onChange={setInput('contract_start')}
                />
                <TextInputField
                  label={t.contractEnd}
                  type="date"
                  value={form.contract_end}
                  onChange={setInput('contract_end')}
                />
              </>
            )}
          </div>
          {editing ? (
            <p className="muted">{t.contractEditNote}</p>
          ) : (
            isRenting && <p className="muted">{t.contractCreateNote}</p>
          )}
        </section>

        {error && <div role="alert" className="form-error">{error}</div>}

        <div className="form-footer">
          <span className="muted">
            {editing ? (dirty ? t.unsavedChanges : t.noChangesYet) : ''}
          </span>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(editing && vehicleId ? `/vehiculos/${vehicleId}` : '/')}
            >
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={saving || (editing && !dirty)}>
              {saving ? t.saving : editing ? t.reviewChanges : t.createVehicle}
            </Button>
          </div>
        </div>
      </form>

      {/* Preview de cambios (HU-1.4): confirmar antes de guardar */}
      <Modal
        open={preview !== null}
        title={t.confirmChanges}
        onClose={() => setPreview(null)}
      >
        {preview && Object.keys(preview).length === 0 ? (
          <p className="muted">{t.noEffectiveChanges}</p>
        ) : (
          <table className="data preview-table">
            <thead>
              <tr>
                <th>{t.fieldCol}</th>
                <th>{t.beforeCol}</th>
                <th>{t.afterCol}</th>
              </tr>
            </thead>
            <tbody>
              {preview &&
                Object.entries(preview).map(([field, [before, after]]) => (
                  <tr key={field}>
                    <td>
                      {t.fieldLabels[field] ?? field}
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
            {t.keepEditing}
          </Button>
          <Button
            variant="primary"
            disabled={saving || !preview || Object.keys(preview).length === 0}
            onClick={confirmSave}
          >
            {saving ? t.saving : t.saveChanges}
          </Button>
        </div>
      </Modal>

      {/* N5: alta rápida de modelo para la marca elegida (solo admin en el back). */}
      <Modal
        open={addingModel}
        title={t.newModelTitle(
          brands.find((b) => String(b.id) === form.brand_ref)?.name ?? t.theBrandFallback,
        )}
        onClose={() => setAddingModel(false)}
      >
        <form
          className="modal-form"
          onSubmit={async (event) => {
            event.preventDefault()
            setAddModelError('')
            try {
              const created = await createCatalogEntry('vehicle-models', {
                brand: form.brand_ref,
                name: newModelName.trim(),
              })
              const page = await listVehicleModels(Number(form.brand_ref))
              setModels(page.results)
              setForm((f) => ({ ...f, model_ref: String(created.id) }))
              setAddingModel(false)
            } catch (err) {
              setAddModelError(asErrorMessage(err, t.createModelError))
            }
          }}
        >
          <TextInputField
            label={t.modelName}
            value={newModelName}
            onChange={(e) => setNewModelName(e.target.value)}
            required
          />
          {addModelError && <div role="alert" className="form-error">{addModelError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setAddingModel(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={!newModelName.trim()}>
              {t.createAndSelect}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
