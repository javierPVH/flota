import { getJson, postJson } from '@flota/ui/http'

import type { FlotaUser, Paginated, Vehicle } from './types'

/** Fija la cookie CSRF antes de cualquier POST. */
export const ensureCsrf = () => getJson('/api/auth/csrf/')

export const fetchMe = () => getJson<FlotaUser>('/api/auth/me/')

export async function login(username: string, password: string): Promise<FlotaUser> {
  await ensureCsrf()
  return postJson<FlotaUser>('/api/auth/login/', { username, password })
}

export async function logout(): Promise<void> {
  await postJson('/api/auth/logout/', {})
}

// --- Vehículos (solo lectura: el back devuelve solo los asignados) --------
export const listVehicles = () => getJson<Paginated<Vehicle>>('/api/vehicles/')
