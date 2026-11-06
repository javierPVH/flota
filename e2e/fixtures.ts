/**
 * Fixtures compartidas (ver docs/E2E_PLAYWRIGHT.md §5): entrar como alguien del
 * seed, resembrar la BD de pruebas y hablar con la API con su CSRF.
 */
import { execFileSync } from 'node:child_process'
import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test'
import { BACK, PYTHON, backEnv } from './env'

/** Usuarios del seed (ver back/SEED_DEV.md). */
export type SeedUser =
  | 'admin'
  | 'sara'
  | 'marta'
  | 'carlos'
  | 'lucia'
  | 'david'
  | 'nuevo'
  | 'alba'
  | 'hse'

/** Matrículas fijas del seed que usan las pruebas. */
export const PLATES = {
  /** El escaparate de la administradora: todos los avisos y peticiones. */
  showcase: '8888TRX',
  /** El coche de carlos (grupo de sara). */
  carlos: '1234KLM',
  /** El segundo del grupo de sara: en mantenimiento, con accidentes cerrados. */
  sara2: '5678BCD',
  /** El de alba (volumen): carlos no lo alcanza por ningún camino. */
  alba: '2022DXP',
} as const

/**
 * Borra y vuelve a sembrar la BD de pruebas. Destructivo, tarda unos
 * segundos: solo en los ficheros que ESCRIBEN (`test.beforeAll(() => reseed())`).
 */
export function reseed() {
  execFileSync(PYTHON, ['manage.py', 'seed_dev_data', '--force'], {
    cwd: BACK,
    env: backEnv,
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
  })
}

/**
 * Inicia sesión por dev-login (solo existe con DEBUG + FLEET_SEED_DATA).
 * `page.request` comparte las cookies del contexto del navegador, así que la
 * página queda con la sesión puesta sin pasar por la pantalla de login.
 */
export async function loginAs(page: Page, username: SeedUser) {
  await loginRequest(page.request, username)
}

export async function loginRequest(request: APIRequestContext, username: SeedUser) {
  await request.get('/api/v1/auth/csrf/')
  const res = await request.post('/api/v1/auth/dev-login/', { data: { username } })
  expect(res.ok(), `dev-login como ${username}: ${res.status()}`).toBeTruthy()
}

/**
 * Un contexto de API propio con la sesión de esa persona. Para las pruebas
 * que hablan con varios usuarios a la vez (la matriz de roles, los flujos
 * campo → gestión): cada uno con sus cookies.
 */
export async function sessionFor(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string,
  username: SeedUser,
): Promise<APIRequestContext> {
  const ctx = await playwright.request.newContext({ baseURL })
  await loginRequest(ctx, username)
  return ctx
}

/** Un contexto SIN sesión (para lo que debe contestar 403). */
export async function anonymous(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string,
): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL })
}

/**
 * Cabecera CSRF de Django para escribir por la API fuera del navegador: el
 * token es la cookie `csrftoken` que dejó `/auth/csrf/` o el login.
 */
export async function csrfHeaders(ctx: APIRequestContext): Promise<Record<string, string>> {
  const state = await ctx.storageState()
  const token = state.cookies.find((c) => c.name === 'csrftoken')?.value ?? ''
  return { 'X-CSRFToken': token }
}

export async function postJson(ctx: APIRequestContext, url: string, data: unknown) {
  return ctx.post(url, { data, headers: await csrfHeaders(ctx) })
}

export async function patchJson(ctx: APIRequestContext, url: string, data: unknown) {
  return ctx.patch(url, { data, headers: await csrfHeaders(ctx) })
}

export async function deleteReq(ctx: APIRequestContext, url: string, data?: unknown) {
  return ctx.delete(url, { data, headers: await csrfHeaders(ctx) })
}

/** Un JPEG mínimo (cabecera SOI): al archivador local le basta. */
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

/** Sube un documento por `POST /documents/` (multipart). */
export async function uploadDocument(
  ctx: APIRequestContext,
  fields: Record<string, string | number>,
  fileName = 'foto.jpg',
) {
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {}
  for (const [k, v] of Object.entries(fields)) multipart[k] = String(v)
  multipart.file = { name: fileName, mimeType: 'image/jpeg', buffer: JPEG_BYTES }
  return ctx.post('/api/v1/documents/', { multipart, headers: await csrfHeaders(ctx) })
}

/** Las filas de una respuesta de lista, esté paginada o no. */
export function rowsOf<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  const page = body as { results?: T[] }
  return page.results ?? []
}

export type VehicleRow = {
  id: number
  plate: string
  state: string
  km_current: number | null
  updated_at?: string
  supervisor?: number | null
}

/** La fila de un vehículo del seed, por matrícula, con la sesión que se pase. */
export async function findVehicle(ctx: APIRequestContext, plate: string): Promise<VehicleRow> {
  const res = await ctx.get(`/api/v1/vehicles/?search=${plate}&page_size=50`)
  expect(res.ok(), `GET /vehicles/?search=${plate}: ${res.status()}`).toBeTruthy()
  const row = rowsOf<VehicleRow>(await res.json()).find((v) => v.plate === plate)
  expect(row, `el ${plate} del seed`).toBeTruthy()
  return row!
}

/** Hoy en ISO (fecha local), para las lecturas y los cierres. */
export function todayIso(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * `YYYY-MM-DDTHH:MM` local de hace `hours` horas, para un `datetime-local`
 * que el back exige que no sea futuro: «hoy a las 09:30» es futuro si la
 * suite corre de madrugada.
 */
export function hoursAgoLocal(hours: number): string {
  const d = new Date(Date.now() - hours * 3_600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export const test = base.extend<{ asUser: (u: SeedUser) => Promise<void> }>({
  asUser: async ({ page }, use) => {
    await use((u) => loginAs(page, u))
  },
})

export { expect }
