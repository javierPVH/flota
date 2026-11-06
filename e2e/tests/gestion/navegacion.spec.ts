/**
 * Todas las rutas de gestión (docs/E2E_PLAYWRIGHT.md §6.2): cada pantalla
 * carga con su título, las redirecciones de las rutas antiguas llevan a donde
 * dicen y el menú de la cabecera navega.
 *
 * Es una prueba de humo a propósito: un `h1` por pantalla (el `PageHeader`
 * del DS) y, en los listados, que haya filas del seed. Lo que cada pantalla
 * HACE está en su propio fichero.
 */
import { PLATES, expect, findVehicle, loginAs, rowsOf, test } from '../../fixtures'

const HEAD = { timeout: 30_000 }

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'admin')
})

const PANTALLAS: Array<[string, string]> = [
  ['/', 'Vista general'],
  ['/vehiculos', 'Vehículos'],
  ['/vehiculos/nuevo', 'Nuevo vehículo'],
  ['/incidencias', 'Incidencias'],
  ['/accidentes', 'Accidentes'],
  ['/kilometraje', 'Kilometraje'],
  ['/alertas', 'Alertas'],
  ['/solicitudes', 'Solicitudes'],
  ['/informes', 'Informes'],
  ['/documentos', 'Documentos'],
  ['/ajustes/catalogos', 'Ajustes'],
  ['/ajustes/borrado', 'Ajustes'],
  ['/ajustes/plantillas', 'Ajustes'],
  ['/conductores', 'Usuarios'],
  ['/hse', 'HSE'],
]

for (const [ruta, titulo] of PANTALLAS) {
  test(`${ruta} carga con el título «${titulo}»`, async ({ page }) => {
    await page.goto(ruta)
    await expect(page.getByRole('heading', { level: 1, name: titulo, exact: true })).toBeVisible(
      HEAD,
    )
  })
}

test('la ficha y la edición de un vehículo llevan su matrícula', async ({ page }) => {
  const v = await findVehicle(page.request, PLATES.showcase)
  await page.goto(`/vehiculos/${v.id}`)
  await expect(page.getByRole('heading', { level: 1, name: PLATES.showcase })).toBeVisible(HEAD)
  await page.goto(`/vehiculos/${v.id}/editar`)
  await expect(
    page.getByRole('heading', { level: 1, name: `Editar ${PLATES.showcase}` }),
  ).toBeVisible(HEAD)
})

test('la ficha de una persona lleva su nombre y su usuario', async ({ page }) => {
  const res = await page.request.get('/api/v1/auth/users/?search=carlos&page_size=50')
  const carlos = rowsOf<{ id: number; username: string; first_name: string }>(
    await res.json(),
  ).find((u) => u.username === 'carlos')
  expect(carlos, 'carlos en /auth/users/').toBeTruthy()
  await page.goto(`/conductores/${carlos!.id}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(carlos!.first_name, HEAD)
  await expect(page.getByText('carlos', { exact: false }).first()).toBeVisible()
})

const REDIRECCIONES: Array<[string, RegExp]> = [
  ['/ajustes', /\/ajustes\/catalogos$/],
  ['/ajustes/facturas', /\/informes\?tab=facturas$/],
  ['/facturas', /\/informes\?tab=facturas$/],
  ['/catalogos', /\/ajustes\/catalogos$/],
  ['/erratas', /\/ajustes\/borrado$/],
  ['/plantillas', /\/ajustes\/plantillas$/],
  ['/informes?tab=documentos', /\/documentos/],
  ['/informes?tab=insurance', /\/documentos\?tipo=insurance/],
  ['/esta-ruta-no-existe', /\/$/],
]

for (const [desde, hasta] of REDIRECCIONES) {
  test(`${desde} redirige a ${hasta}`, async ({ page }) => {
    await page.goto(desde)
    await expect(page).toHaveURL(hasta, HEAD)
  })
}

test('el menú de la cabecera navega entre pantallas', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Vista general' })).toBeVisible(HEAD)
  await page.getByRole('button', { name: 'Menú' }).click()
  await page.getByRole('link', { name: 'Vehículos', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Vehículos' })).toBeVisible(HEAD)
  await expect(page).toHaveURL(/\/vehiculos$/)
  await page.getByRole('button', { name: 'Menú' }).click()
  await page.getByRole('link', { name: 'Solicitudes', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Solicitudes' })).toBeVisible(HEAD)
})

test('«Salir» cierra la sesión y vuelve al login', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Vista general' })).toBeVisible(HEAD)
  await page.getByRole('button', { name: 'Menú' }).click()
  await page.getByRole('button', { name: 'Salir' }).click()
  await expect(page).toHaveURL(/\/login/)
  // El POST de logout sale en paralelo a la navegación: se espera a que llegue.
  await expect
    .poll(async () => (await page.request.get('/api/v1/auth/me/')).status())
    .toBe(403)
})
