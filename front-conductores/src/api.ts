import { getJson, postJson } from '@flota/ui/http'

import type {
  AuthConfig,
  DevUser,
  FlotaUser,
  MyRequestInput,
  MyVehicleRequest,
  Paginated,
  Vehicle,
} from './types'

// API de negocio versionada (M0): auth en /api/v1/auth/, dominio en /api/v1/.
const AUTH = '/api/v1/auth'
const API = '/api/v1'

/** Fija la cookie CSRF antes de cualquier POST. */
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

// --- Vehículos (el back acota: conductor los suyos; supervisor su grupo) --
export const listVehicles = () => getJson<Paginated<Vehicle>>(`${API}/vehicles/`)

// --- Portón de acceso: mi solicitud con ticket Jira (Fase A2) -------------
export const listMyRequests = () => getJson<MyVehicleRequest[]>(`${API}/vehicle-requests/mine/`)

/** Crea mi solicitud `pending` o ACTUALIZA la abierta (p. ej. añadir la clave). */
export const submitMyRequest = (data: MyRequestInput) =>
  postJson<MyVehicleRequest>(`${API}/vehicle-requests/mine/`, data)
