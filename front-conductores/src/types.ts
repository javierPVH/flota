// Contrato v1 del backend (M0): multi-rol + esquema nuevo + portón de acceso.

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
  version: string
  state: VehicleState
  state_display: string
  is_substitute: boolean
  supervisor: number | null
  supervisor_name: string
  fuel: string
  type: string
  business_use: string
  km_start: number | null
  /** Denormalizado del último EventItv; lo mantiene el back. */
  next_itv_date: string | null
  created_at: string
  updated_at: string
}

/** Solicitud propia (portón de acceso, Fase A2 del back). */
export type RequestStatus = 'pending' | 'approved' | 'assigned' | 'rejected' | 'closed'

export interface MyVehicleRequest {
  id: number
  requested_type: string
  start_date: string | null
  end_date: string | null
  jira_key: string
  notes: string
  status: RequestStatus
  status_display: string
  vehicle: number | null
  vehicle_plate: string
  created_at: string
  updated_at: string
}

export interface MyRequestInput {
  requested_type?: string
  start_date?: string | null
  end_date?: string | null
  jira_key?: string
  notes?: string
}

/** GET /vehicles/{id}/summary/ — métricas de campo (HU-1.2/3.4). */
export interface VehicleSummary {
  vehicle: number
  plate: string
  state: VehicleState
  next_itv_date: string | null
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
  } | null
}

/** Alerta del motor de avisos (Épica 10). Solo lectura + resolver/descartar. */
export type AlertLevel = 'info' | 'warning' | 'critical'
export type AlertStatus = 'open' | 'resolved' | 'dismissed'

export interface Alert {
  id: number
  type: string
  type_display: string
  level: AlertLevel
  level_display: string
  status: AlertStatus
  status_display: string
  vehicle: number | null
  vehicle_plate: string
  user: number | null
  message: string
  due_date: string | null
  created_at: string
}

/** Asignación (aquí solo lectura de propuestas propias — HU-2.3). */
export interface AssignmentRow {
  id: number
  vehicle: number
  driver: number
  driver_name: string
  start_date: string
  end_date: string | null
  status: 'proposed' | 'accepted' | 'rejected' | 'finished'
}

/** Lectura de odómetro acumulado (HU-3.1). */
export interface KmReading {
  id: number
  vehicle: number
  reading_date: string | null
  km_reading: number | null
}

// --- M2: documentación de campo (Épica 4) ---------------------------------

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
  /** webViewLink en Google Drive (Fase A3); vacío hasta que se archiva. */
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
  replaces: number | null
  notes: string
  created_at: string
  updated_at: string
}

/** Incidencia (el supervisor las crea/consulta; liga documentos a ellas). */
export interface Incident {
  id: number
  vehicle: number
  type: string
  type_display: string
  date: string | null
  description: string
  status: string
  status_display: string
}

// --- M6: modo supervisor (HU-2.5, 3.4/3.6, Épica 6) ------------------------

/** Conductor compacto para desplegables (GET /auth/drivers/, solo gestión). */
export interface Driver {
  id: number
  username: string
  name: string
}

/** Fila del reparto de uso (HU-2.5). El nombre se resuelve vía `Driver`. */
export interface VehicleUsageRow {
  id: number
  vehicle: number
  driver: number
  usage_percent: string | null
  start_date: string | null
  end_date: string | null
}

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}
