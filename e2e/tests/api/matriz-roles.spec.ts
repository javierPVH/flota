/**
 * Matriz rol × endpoint (docs/E2E_PLAYWRIGHT.md §6.1): cada lista de la API
 * contestada por los seis perfiles que existen en el seed.
 *
 * Es la tabla de `accounts/permissions.py` leída desde fuera: lo que cada
 * clase de permiso promete, comprobado endpoint a endpoint con sesiones de
 * verdad. Si alguien cambia una `permission_classes`, aquí se ve a quién le
 * abre o le cierra la puerta.
 *
 *   admin  → superusuario con los cuatro roles
 *   sara   → supervisora + conductora (gestión sin ser admin)
 *   carlos → conductor puro
 *   hse    → HSE puro (solo lectura y solo CUATRO endpoints)
 *   nuevo  → con sesión pero sin ningún rol
 *   anon   → sin sesión
 */
import type { APIRequestContext } from '@playwright/test'
import { anonymous, expect, sessionFor, test } from '../../fixtures'

type Who = 'admin' | 'sara' | 'carlos' | 'hse' | 'nuevo' | 'anon'
const WHO: Who[] = ['admin', 'sara', 'carlos', 'hse', 'nuevo', 'anon']

/** Lo que cada clase de permiso contesta a un GET. */
const OK = 200
const NO = 403
const P = {
  /** `AdminWriteManagementRead`: lee gestión. */
  management: { admin: OK, sara: OK, carlos: NO, hse: NO, nuevo: NO, anon: NO },
  /** `IsManagement | HseReadOnly` (vehículos, km, consumo): HSE también lee. */
  managementDriverHse: { admin: OK, sara: OK, carlos: OK, hse: OK, nuevo: NO, anon: NO },
  /** Gestión o conductor (`AdminWriteManagementOrDriverRead`, `EventPermission`…). */
  managementDriver: { admin: OK, sara: OK, carlos: OK, hse: NO, nuevo: NO, anon: NO },
  /** `IsAdmin`. */
  admin: { admin: OK, sara: NO, carlos: NO, hse: NO, nuevo: NO, anon: NO },
  /** `IsAuthenticated`: cualquiera con sesión, también sin rol. */
  authenticated: { admin: OK, sara: OK, carlos: OK, hse: OK, nuevo: OK, anon: NO },
  /** `AllowAny`. */
  anyone: { admin: OK, sara: OK, carlos: OK, hse: OK, nuevo: OK, anon: OK },
} satisfies Record<string, Record<Who, number>>

type Expected = Record<Who, number>

const MATRIX: Array<[string, Expected]> = [
  // --- sesión y arranque -------------------------------------------------
  ['/api/health/', P.anyone],
  ['/api/ready/', P.anyone],
  ['/api/v1/auth/config/', P.anyone],
  ['/api/v1/auth/csrf/', P.anyone],
  ['/api/v1/auth/me/', P.authenticated],
  ['/api/v1/push/config/', P.authenticated],
  ['/api/v1/auth/drivers/', P.management],
  ['/api/v1/auth/users/', P.admin],
  // --- flota -------------------------------------------------------------
  ['/api/v1/vehicles/', P.managementDriverHse],
  ['/api/v1/summary/vehicles/', P.managementDriver],
  ['/api/v1/summary/', P.management],
  ['/api/v1/contracts/', P.management],
  ['/api/v1/km-readings/', P.managementDriverHse],
  ['/api/v1/km-readings/window/', P.authenticated],
  ['/api/v1/fuel-consumptions/', P.managementDriverHse],
  ['/api/v1/assignments/', P.managementDriver],
  ['/api/v1/vehicle-usages/', P.management],
  // `IsDriver | IsManagement`: la cara «Reparto» de la PWA.
  ['/api/v1/vehicle-usages/mine/', P.managementDriver],
  ['/api/v1/supervisor-periods/', P.management],
  ['/api/v1/vehicle-links/', P.management],
  ['/api/v1/events/', P.managementDriver],
  ['/api/v1/invoices/', P.management],
  ['/api/v1/invoice-allocations/', P.management],
  ['/api/v1/incidents/', P.managementDriver],
  ['/api/v1/alerts/', P.managementDriver],
  ['/api/v1/maintenance-plans/', P.managementDriver],
  ['/api/v1/maintenance-programs/', P.management],
  ['/api/v1/workshops/', P.managementDriver],
  // --- documentos --------------------------------------------------------
  ['/api/v1/documents/', P.managementDriver],
  ['/api/v1/document-deletion-requests/', P.managementDriver],
  ['/api/v1/document-supply-requests/', P.managementDriver],
  ['/api/v1/document-type-access/', P.admin],
  // --- bandejas de solicitudes ------------------------------------------
  ['/api/v1/vehicle-requests/', P.management],
  ['/api/v1/vehicle-requests/mine/', P.authenticated],
  ['/api/v1/driver-change-requests/', P.managementDriver],
  ['/api/v1/driver-change-requests/candidates/', P.managementDriver],
  ['/api/v1/profile-change-requests/', P.managementDriver],
  ['/api/v1/incident-change-requests/', P.managementDriver],
  // --- catálogos ---------------------------------------------------------
  ['/api/v1/catalogs/', P.management],
  ['/api/v1/countries/', P.management],
  ['/api/v1/business-units/', P.management],
  ['/api/v1/projects/', P.management],
  ['/api/v1/peps/', P.management],
  ['/api/v1/rentings/', P.management],
  ['/api/v1/brands/', P.management],
  ['/api/v1/vehicle-models/', P.management],
  ['/api/v1/companies/', P.management],
  ['/api/v1/fuel-types/', P.management],
  ['/api/v1/sites/', P.management],
  // --- informes ----------------------------------------------------------
  ['/api/v1/reports/?kind=fleet&fmt=csv', P.management],
  // El de HSE lo bajan gestión y HSE; el conductor, no.
  ['/api/v1/reports/?kind=hse&fmt=csv', { ...P.management, hse: OK }],
  ['/api/v1/report-exports/', P.admin],
  // --- correo, ajustes y erratas (solo admin) ---------------------------
  ['/api/v1/email-templates/', P.admin],
  ['/api/v1/email-templates/defaults/', P.admin],
  ['/api/v1/email-signatures/', P.admin],
  ['/api/v1/email-logs/', P.admin],
  ['/api/v1/email-settings/', P.admin],
  ['/api/v1/notification-schedules/', P.management],
  ['/api/v1/erratas/', P.admin],
  ['/api/v1/erratas/items/?type=vehicles', P.admin],
]

const sessions: Partial<Record<Who, APIRequestContext>> = {}

test.beforeAll(async ({ playwright, baseURL }) => {
  for (const who of WHO) {
    sessions[who] =
      who === 'anon'
        ? await anonymous(playwright, baseURL!)
        : await sessionFor(playwright, baseURL!, who)
  }
})

test.afterAll(async () => {
  for (const ctx of Object.values(sessions)) await ctx?.dispose()
})

for (const [url, expected] of MATRIX) {
  test(`GET ${url}`, async () => {
    for (const who of WHO) {
      const res = await sessions[who]!.get(url)
      expect
        .soft(res.status(), `${who} → GET ${url}`)
        .toBe(expected[who])
    }
  })
}

test('sin sesión, las escrituras tampoco entran (403, no 404)', async () => {
  const anon = sessions.anon!
  for (const url of ['/api/v1/km-readings/', '/api/v1/incidents/', '/api/v1/documents/']) {
    const res = await anon.post(url, { data: {} })
    expect.soft(res.status(), `anon → POST ${url}`).toBe(403)
  }
})

test('HSE no escribe ni donde lee', async () => {
  const hse = sessions.hse!
  const res = await hse.post('/api/v1/km-readings/', { data: {} })
  expect(res.status()).toBe(403)
})
