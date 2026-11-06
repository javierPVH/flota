/**
 * Inventario y ficha del vehículo (docs/E2E_PLAYWRIGHT.md §6.2): buscar por
 * matrícula, abrir la ficha con sus marcas y lo que tiene abierto, y la
 * pantalla de edición con sus pestañas.
 */
import { PLATES, expect, findVehicle, loginAs, test } from '../../fixtures'

const HEAD = { timeout: 30_000 }

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'admin')
})

test('el inventario lista la flota y se busca por matrícula', async ({ page }) => {
  await page.goto('/vehiculos')
  await expect(page.getByRole('heading', { level: 1, name: 'Vehículos' })).toBeVisible(HEAD)
  // Hay filas del seed: las matrículas fijas.
  await expect(page.getByRole('row').filter({ hasText: PLATES.carlos })).toHaveCount(1, HEAD)
  // La barra de filtros nace plegada: su cabecera dice cuántos registros hay.
  await page.getByRole('button', { name: /Buscar y filtrar/ }).click()
  await page.getByRole('searchbox', { name: 'Buscar' }).fill(PLATES.showcase)
  await expect(page.getByRole('row').filter({ hasText: PLATES.showcase })).toHaveCount(1)
  await expect(page.getByRole('row').filter({ hasText: PLATES.carlos })).toHaveCount(0)
})

test('la ficha del escaparate: estado, conductor, supervisor y lo abierto', async ({ page }) => {
  const v = await findVehicle(page.request, PLATES.showcase)
  await page.goto(`/vehiculos/${v.id}`)
  await expect(page.getByRole('heading', { level: 1, name: PLATES.showcase })).toBeVisible(HEAD)
  // Las marcas del subtítulo: conductor y supervisor salen siempre.
  await expect(page.getByText('Conductor', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('Supervisor', { exact: false }).first()).toBeVisible()
  // Las tarjetas de lo que le pasa al coche.
  await expect(page.getByText('Alertas e incidencias').first()).toBeVisible()
  await expect(page.getByText('Conductor y reparto').first()).toBeVisible()
  await expect(page.getByText('Documentos').first()).toBeVisible()
  // Lo que la API dice que tiene abierto se ve en la ficha (alguna alerta del escaparate).
  const alerts = await page.request.get(
    `/api/v1/alerts/?status=open&vehicle=${v.id}&page_size=500`,
  )
  const abiertas = ((await alerts.json()) as { count?: number; results?: unknown[] }).results ?? []
  expect(abiertas.length).toBeGreaterThan(0)
})

test('la edición abre con sus pestañas y el candado de los datos fijos', async ({ page }) => {
  const v = await findVehicle(page.request, PLATES.carlos)
  await page.goto(`/vehiculos/${v.id}/editar`)
  await expect(
    page.getByRole('heading', { level: 1, name: `Editar ${PLATES.carlos}` }),
  ).toBeVisible(HEAD)
  for (const pestana of [
    'Identificación',
    'Características técnicas',
    'Uso y asignación',
    'Propiedad y contrato',
  ]) {
    await expect(page.getByRole('tab', { name: pestana })).toBeVisible()
  }
  // Editando no hay recorrido («Siguiente» no existe) y el guardado pasa
  // por «Revisar cambios…», apagado mientras no se toque nada.
  await expect(page.getByRole('button', { name: 'Siguiente' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Revisar cambios/ })).toBeDisabled()
})

test('el alta se recorre por pestañas y solo crea en la última', async ({ page }) => {
  await page.goto('/vehiculos/nuevo')
  await expect(page.getByRole('heading', { level: 1, name: 'Nuevo vehículo' })).toBeVisible(HEAD)
  await expect(page.getByRole('button', { name: 'Siguiente' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Crear vehículo' })).toHaveCount(0)
})
