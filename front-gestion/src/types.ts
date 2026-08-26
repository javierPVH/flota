// Contrato v1 del backend (G0): multi-rol + esquema nuevo de vehículo.

export type Role = 'admin' | 'supervisor' | 'driver'

export interface FlotaUser {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  /** Multi-rol: una persona puede acumular varios (p. ej. supervisor+driver). */
  roles: Role[]
  fuel_card: boolean
  dni: string | null
  phone: string
  license_type: string
  is_staff: boolean
  is_superuser: boolean
}

/** GET /auth/config/ — qué métodos de login pinta la UI. */
export interface AuthConfig {
  password_enabled: boolean
  registration_enabled: boolean
  google_enabled: boolean
  google_client_id: string
  /** Solo desarrollo (DEBUG + FLEET_SEED_DATA): selector de usuarios de prueba. */
  dev_login_enabled: boolean
}

/** Usuario del selector de desarrollo (GET /auth/dev-login/). */
export interface DevUser {
  username: string
  name: string
  roles: Role[]
}

export interface Driver {
  id: number
  username: string
  name: string
}

/** Estado técnico (lista cerrada del back; `retired` = baja). */
export type VehicleState =
  | 'active'
  | 'maintenance'
  | 'itv'
  | 'broken'
  | 'retired'
  | 'non_active'
  | 'accidente'
  | ''

export interface Vehicle {
  id: number
  plate: string
  brand: string
  model: string
  year: number | null
  vin: string
  registration_date: string | null
  version: string
  state: VehicleState
  state_display: string
  is_substitute: boolean
  supervisor: number | null
  supervisor_name: string
  business_unit: number | null
  country: number | null
  project: number | null
  cost_center: number | null
  /** GAP-4: sede/oficina cuando no está en obra. */
  site: number | null
  site_display: string
  /** GAP-1: el texto queda denormalizado desde el catálogo (como brand). */
  fuel: string
  fuel_ref: number | null
  /** GAP-3: ¿reposta con tarjeta de combustible? */
  fuel_card: boolean
  type: string
  size: string
  market_segment: string
  veh_use: string
  property: string
  business_use: string
  consumption: number | null
  km_start: number | null
  km_end: number | null
  /** N5: marca/modelo por catálogo (el texto brand/model queda denormalizado). */
  brand_ref: number | null
  model_ref: number | null
  company: number | null
  company_display: string
  /** N3: sin proyección de km ni alertas de exceso. */
  unlimited_km: boolean
  /** N2: vencimiento del seguro (editable; lo sincroniza también la póliza). */
  insurance_expiry_date: string | null
  /** Denormalizado del último EventItv; lo mantiene el back. */
  next_itv_date: string | null
  /** Conductor con asignación aceptada vigente (lo resuelve el back en bloque). */
  driver_name: string
  /** Id del conductor vigente (para enlazar a su ficha); null si no hay. */
  driver_id: number | null
  /** Carpeta documental del vehículo en Google Drive (Fase A3). */
  drive_folder_url: string
  drive_folder_id: string
  created_at: string
  updated_at: string
}

// --- G1: alertas de la vista general ---------------------------------------

export type AlertType =
  | 'itv_due'
  | 'insurance_due'
  | 'km_reading_pending'
  | 'km_overage'
  | 'maintenance_due'
  | 'no_driver'
export type AlertLevel = 'info' | 'warning' | 'critical'

export interface Alert {
  id: number
  type: AlertType
  type_display: string
  level: AlertLevel
  level_display: string
  /** Solo dos estados: o está abierta o se resolvió (descartar se retiró). */
  status: 'open' | 'resolved'
  status_display: string
  vehicle: number | null
  vehicle_plate: string
  user: number | null
  message: string
  due_date: string | null
  created_at: string
  /** Conductor vigente del vehículo (lo resuelve el back en bloque). */
  driver_id: number | null
  driver_name: string
  /** Responsable del vehículo (`Vehicle.supervisor`). */
  supervisor_id: number | null
  supervisor_name: string
  /** Cierre: cuándo, quién y qué se hizo. Nulos/vacía mientras está abierta. */
  resolved_at: string | null
  resolved_by: number | null
  resolved_by_name: string
  resolution_note: string
}

// --- G2: ficha del vehículo -------------------------------------------------

/** GET /vehicles/{id}/summary/ — métricas de la ficha (HU-1.2/3.4). */
export interface VehicleSummary {
  vehicle: number
  plate: string
  state: VehicleState
  next_itv_date: string | null
  insurance_expiry_date: string | null
  unlimited_km: boolean
  is_substitute: boolean
  /** N9: principal bloqueado mientras el sustituto opera por él. */
  blocked_by_link: {
    substitute_id: number
    plate: string
    reason: string
    since: string
  } | null
  km_current: number | null
  km_reading_date: string | null
  /** ¿La última lectura fue generada automáticamente (estimada)? */
  km_estimated: boolean
  km_driven: number | null
  driver: { id: number; name: string } | null
  contract: {
    id: number
    month_fee: string | null
    contract_km: number | null
    contract_time: number | null
    penalty_per_km: string | null
    start_date: string
    planned_end_date: string
    /** Enlace al contrato en Google Drive (carpeta o fichero). */
    drive_url: string
  } | null
  projection: {
    km_remaining: number
    monthly_avg: number
    contracted_rate: number | null
    projected_end: number
    pct_of_limit: number
    level: 'within' | 'watch' | 'over'
    overage_km: number
    estimated_penalty: string | null
    // Enfoque anual proporcional (HU-3.4): cupo por año y proyección del año en curso.
    contract_years: number
    annual_km: number
    year_index: number
    year_start_date: string
    year_end_date: string
    year_start_km: number
    annual_projected: number
    annual_pct: number
    annual_level: 'within' | 'watch' | 'over'
    annual_overage_km: number
    annual_estimated_penalty: string | null
  } | null
}

export interface KmReading {
  id: number
  vehicle: number
  reading_date: string | null
  km_reading: number | null
  /** N8b: creada por "completar km faltantes" (media de N meses). */
  estimated?: boolean
}

export interface FlotaEvent {
  id: number
  vehicle: number
  event_type: string
  event_type_display: string
  event_date: string | null
  notes: string
  /** Detalle anidado según el tipo (itv/fee_change/location_change…). */
  details: Record<string, unknown> | null
}

/** Entrada de auditoría de campos (GET /vehicles/{id}/history/).
 * El histórico es exhaustivo: `model` indica el modelo de origen del cambio
 * (vehicle/contract/assignment/kmreading/document/invoice/…). */
export interface AuditEntry {
  id: number
  action: string
  actor: string
  changes: Record<string, [string, string]>
  /** Modelo de origen del cambio (para etiquetar de dónde viene). */
  model: string
  /** Representación del objeto modificado (p. ej. la matrícula, el nº de factura). */
  object_repr: string
  timestamp: string
}

export interface AssignmentRow {
  id: number
  vehicle: number
  driver: number
  driver_name: string
  start_date: string
  end_date: string | null
  status: string
}

/** Vínculo principal ↔ sustitución (HU-1.8). */
export interface VehicleLinkRow {
  id: number
  main_vehicle: number
  substitute_vehicle: number
  /** M11: matrículas de los dos extremos (las da el serializer del back). */
  main_vehicle_plate: string
  substitute_vehicle_plate: string
  reason: string
  start_date: string
  end_date: string | null
}

/** Detalle de usuario gestionado (GET /auth/users/{id}/, solo admin). */
export interface ManagedUser {
  id: number
  username: string
  first_name: string
  last_name: string
  license_type: string
  fuel_card: boolean
  roles: Role[]
}

// --- G7: documentación e incidencias --------------------------------------

export type DocumentType =
  | 'registration_certificate'
  | 'technical_datasheet'
  | 'insurance'
  | 'contract'
  | 'delivery_report'
  | 'return_report'
  | 'accident_report'
  | 'damage_photos'
  | 'driving_license'
  | 'other'

export type DocumentStatus = 'valid' | 'expired' | 'pending_archive'

export interface FlotaDocument {
  id: number
  /** Titular: un vehículo O un usuario (exactamente uno; el otro llega null). */
  vehicle: number | null
  user: number | null
  user_name: string
  type: DocumentType
  type_display: string
  incident: number | null
  /** webViewLink en Google Drive (Fase A3); vacío si aún no está archivado. */
  drive_url: string
  drive_file_id: string
  /** Staging local del multipart; el archivador lo borra al subir a Drive. */
  file: string | null
  file_url: string
  uploaded_by: number | null
  uploaded_by_name: string
  expiry_date: string | null
  status: DocumentStatus
  status_display: string
  /** Versión anterior a la que sustituye (HU-4.4). */
  replaces: number | null
  notes: string
  created_at: string
  updated_at: string
}

export type IncidentType = 'breakdown' | 'maintenance' | 'tires' | 'inspection' | 'accident'
export type IncidentStatus = 'open' | 'on_going' | 'closed'

/** Tercero implicado en un accidente (tabla materializada del parte). */
export interface AccidentThirdParty {
  id: number
  name: string
  plate: string
  brand: string
  model: string
  phone: string
  insurance_company: string
  policy_number: string
  damage_description: string
}

/** Lesionado en un accidente. */
export interface AccidentInjured {
  id: number
  name: string
  phone: string
  email: string
  plate: string
  seat: 'driver' | 'passenger'
  seat_display: string
}

/** Parte de accidente materializado (solo lectura; el dato entra por `details`). */
export interface AccidentReport {
  street: string
  street_number: string
  postal_code: string
  locality: string
  province: string
  occurred_at: string
  phone: string
  police_report_ref: string
  third_parties: AccidentThirdParty[]
  injured: AccidentInjured[]
}

export interface Incident {
  id: number
  vehicle: number
  type: IncidentType
  type_display: string
  date: string | null
  description: string
  /** Parte guiado (GAP-6): kilometraje y CP del taller. */
  mileage: number | null
  workshop_postal_code: string
  /** Datos del parte + fases del ciclo (`management` / `resolution`). */
  details: Record<string, unknown>
  /** Solo accidentes con parte guiado; null en el resto. */
  accident_report: AccidentReport | null
  status: IncidentStatus
  status_display: string
  cost: string | null
  created_at: string
  updated_at: string
}

/** GET /api/v1/google/picker-config/ — config del Google Picker (Fase A3). */
export interface PickerConfig {
  enabled: boolean
  api_key?: string
  app_id?: string
  client_id?: string
  /** false = el usuario aún no ha concedido Drive → tarjeta "Conectar Google". */
  has_drive?: boolean
  access_token?: string | null
}

/** Fichero de la carpeta de Drive del vehículo (folder-files). */
export interface DriveFile {
  id: string
  name: string
  mime: string
  url: string
  iconUrl?: string
  thumbnailUrl?: string
}

/** GET /api/v1/summary/ — agregados del dashboard (Fase A1). */
export interface FleetSummary {
  total: number
  by_state: Record<string, number>
  by_business_use: Record<string, number>
  assigned: number
  unassigned: number
  monthly_cost: string
  invoiced_this_month: string
  invoiced_previous_month: string
  itv_next_30d: number
  itv_overdue: number
  insurance_next_30d: number
  insurance_overdue: number
  /** GAP-8: mantenimiento anual obligatorio — mismo criterio que las alertas
   * (ciclo efectivo = mín(ciclo del plan, 12 meses); solo acreditan planes con
   * ancla de fecha). `no_plan` = activos sin plan que acredite la anual. */
  maintenance_next_30d: number
  maintenance_overdue: number
  maintenance_no_plan: number
  maintenance_ok: number
  open_alerts: Record<string, number>
}

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}
