import { getJson, postJson, patchJson, deleteJson } from '@flota/ui/http'

import type { Driver, FlotaUser, Paginated, Vehicle } from './types'

/** Fija la cookie CSRF antes de cualquier POST/PATCH/DELETE. */
export const ensureCsrf = () => getJson('/api/auth/csrf/')

export const fetchMe = () => getJson<FlotaUser>('/api/auth/me/')

export async function login(username: string, password: string): Promise<FlotaUser> {
  await ensureCsrf()
  return postJson<FlotaUser>('/api/auth/login/', { username, password })
}

export async function logout(): Promise<void> {
  await postJson('/api/auth/logout/', {})
}

/** Conductores para el desplegable de asignación (solo gestión). Sin paginar. */
export const listDrivers = () => getJson<Driver[]>('/api/auth/drivers/')

// --- Vehículos ------------------------------------------------------------
export const listVehicles = () => getJson<Paginated<Vehicle>>('/api/vehicles/')

export type VehicleInput = Partial<
  Pick<Vehicle, 'plate' | 'brand' | 'model' | 'year' | 'status' | 'assigned_driver' | 'notes'>
>

export const createVehicle = (data: VehicleInput) =>
  postJson<Vehicle>('/api/vehicles/', data)

export const updateVehicle = (id: number, data: VehicleInput) =>
  patchJson<Vehicle>(`/api/vehicles/${id}/`, data)

export const deleteVehicle = (id: number) => deleteJson(`/api/vehicles/${id}/`)
