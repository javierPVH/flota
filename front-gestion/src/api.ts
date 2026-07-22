import { deleteJson, getJson, patchJson, postJson } from '@flota/ui/http'

import type {
  AuthConfig,
  DevUser,
  Driver,
  FleetSummary,
  FlotaUser,
  Paginated,
  Vehicle,
} from './types'

// API de negocio versionada (G0): auth en /api/v1/auth/, dominio en /api/v1/.
const AUTH = '/api/v1/auth'
const API = '/api/v1'

/** Fija la cookie CSRF antes de cualquier POST/PATCH/DELETE. */
export const ensureCsrf = () => getJson(`${AUTH}/csrf/`)

export const fetchAuthConfig = () => getJson<AuthConfig>(`${AUTH}/config/`)

export const fetchMe = () => getJson<FlotaUser>(`${AUTH}/me/`)

export async function login(username: string, password: string): Promise<FlotaUser> {
  await ensureCsrf()
  return postJson<FlotaUser>(`${AUTH}/login/`, { username, password })
}

export async function logout(): Promise<void> {
  await postJson(`${AUTH}/logout/`, {})
}

// --- Login de DESARROLLO (selector de usuarios; 404 fuera de dev) ---------
export const listDevUsers = () => getJson<DevUser[]>(`${AUTH}/dev-login/`)

export async function devLogin(username: string): Promise<FlotaUser> {
  await ensureCsrf()
  return postJson<FlotaUser>(`${AUTH}/dev-login/`, { username })
}

/** Conductores para el desplegable de asignación (solo gestión). Sin paginar. */
export const listDrivers = () => getJson<Driver[]>(`${AUTH}/drivers/`)

// --- Dashboard (Fase A1) --------------------------------------------------
export const fetchFleetSummary = () => getJson<FleetSummary>(`${API}/summary/`)

// --- Vehículos ------------------------------------------------------------
export const listVehicles = () => getJson<Paginated<Vehicle>>(`${API}/vehicles/`)

export type VehicleInput = Partial<
  Pick<Vehicle, 'plate' | 'brand' | 'model' | 'year' | 'state' | 'vin' | 'business_use'>
>

export const createVehicle = (data: VehicleInput) => postJson<Vehicle>(`${API}/vehicles/`, data)

export const updateVehicle = (id: number, data: VehicleInput) =>
  patchJson<Vehicle>(`${API}/vehicles/${id}/`, data)

export const deleteVehicle = (id: number) => deleteJson(`${API}/vehicles/${id}/`)
