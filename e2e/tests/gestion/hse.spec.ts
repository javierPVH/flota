/**
 * La vista de HSE (docs/E2E_PLAYWRIGHT.md §6.2): un HSE puro no sale de
 * `/hse`, y esa pantalla enseña CÓMO SE USA la flota —las cuatro cifras, la
 * tabla de vehículos con sus grupos de columnas y el informe— y nada más.
 */
import { PLATES, expect, loginAs, test } from '../../fixtures'

const HEAD = { timeout: 30_000 }

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'hse')
})

test('la pantalla: cifras, pestañas y la tabla con sus grupos', async ({ page }) => {
  await page.goto('/hse')
  await expect(page.getByRole('heading', { level: 1, name: 'HSE', exact: true })).toBeVisible(HEAD)
  await expect(page.getByRole('tab', { name: 'Vehículos' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Informe' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: PLATES.carlos }).first()).toBeVisible(HEAD)
  // La cabecera de grupos sobre las columnas.
  for (const grupo of ['Vehículo', 'Contrato', 'Kilometraje', 'Combustible']) {
    await expect(page.getByRole('columnheader', { name: grupo, exact: true })).toBeVisible()
  }
  // Lo que HSE no mira no es columna: ni conductor ni supervisor.
  await expect(page.getByRole('columnheader', { name: 'Conductor', exact: true })).toHaveCount(0)
})

test('el informe de HSE: portada y hojas', async ({ page }) => {
  await page.goto('/hse')
  await page.getByRole('tab', { name: 'Informe' }).click({ timeout: 30_000 })
  await expect(page.getByText('Resumen').first()).toBeVisible(HEAD)
  const res = await page.request.get('/api/v1/reports/?kind=hse&fmt=csv')
  expect(res.status()).toBe(200)
})

test('un HSE puro no sale de su pantalla', async ({ page }) => {
  for (const ruta of ['/vehiculos', '/solicitudes', '/ajustes/catalogos', '/']) {
    await page.goto(ruta)
    await expect(page).toHaveURL(/\/hse$/, HEAD)
  }
})
