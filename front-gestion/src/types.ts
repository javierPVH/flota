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
  fuel: string
  type: string
  size: string
  market_segment: string
  veh_use: string
  property: string
  business_use: string
  consumption: number | null
  km_start: number | null
  km_end: number | null
  /** N3: sin proyección de km ni alertas de exceso. */
  unlimited_km: boolean
  /** N2: vencimiento del seguro (editable; lo sincroniza también la póliza). */
  insurance_expiry_date: string | null
  /** Denormalizado del último EventItv; lo mantiene el back. */
  next_itv_date: string | null
  /** Conductor con asignación aceptada vigente (lo resuelve el back en bloque). */
  driver_name: string
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
  | 'no_driver'
export type AlertLevel = 'info' | 'warning' | 'critical'

export interface Alert {
  id: number
  type: AlertType
  type_display: string
  level: AlertLevel
  level_display: string
  status: 'open' | 'resolved' | 'dismissed'
  status_display: string
  vehicle: number | null
  vehicle_plate: string
  user: number | null
  message: string
  due_date: string | null
  created_at: string
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
  km_current: number | null
  km_reading_date: string | null
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

/** Entrada de auditoría de campos (GET /vehicles/{id}/history/). */
export interface AuditEntry {
  id: number
  action: string
  actor: string
  changes: Record<string, [string, string]>
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
  | 'other'

export type DocumentStatus = 'valid' | 'expired' | 'pending_archive'

export interface FlotaDocument {
  id: number
  vehicle: number
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

export type IncidentType = 'breakdown' | 'maintenance' | 'inspection' | 'accident'
export type IncidentStatus = 'open' | 'on_going' | 'closed'

export interface Incident {
  id: number
  vehicle: number
  type: IncidentType
  type_display: string
  date: string | null
  description: string
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
  open_alerts: Record<string, number>
}

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}
