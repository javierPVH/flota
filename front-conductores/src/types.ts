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

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}
