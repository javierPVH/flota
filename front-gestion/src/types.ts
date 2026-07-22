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
  /** Denormalizado del último EventItv; lo mantiene el back. */
  next_itv_date: string | null
  created_at: string
  updated_at: string
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
  open_alerts: Record<string, number>
}

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}
