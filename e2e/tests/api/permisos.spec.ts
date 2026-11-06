/**
 * El back acota por rol (docs/E2E_PLAYWRIGHT.md §6.1). La suite más robusta:
 * no depende de la UI, solo de la API y del seed.
 */
import { PLATES, expect, loginAs, rowsOf, test } from '../../fixtures'

type VehicleRow = { plate: string }

test('un conductor no lista usuarios', async ({ page }) => {
  await loginAs(page, 'carlos')
  const res = await page.request.get('/api/v1/auth/users/')
  expect(res.status()).toBe(403)
})

test('un conductor solo ve lo suyo: su coche y lo repartido, no el resto', async ({ page }) => {
  await loginAs(page, 'carlos')
  const res = await page.request.get('/api/v1/vehicles/')
  expect(res.ok()).toBeTruthy()
  const plates = rowsOf<VehicleRow>(await res.json()).map((v) => v.plate)
  expect(plates).toContain(PLATES.carlos)
  // El 8888TRX lo tiene en REPARTO (la tercera puerta del ámbito), así que
  // SÍ lo ve; el de alba no lo alcanza por ningún camino.
  expect(plates).not.toContain(PLATES.alba)
})

test('el admin ve toda la flota', async ({ page }) => {
  await loginAs(page, 'admin')
  const res = await page.request.get('/api/v1/vehicles/')
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { count?: number }
  const plates = rowsOf<VehicleRow>(body).map((v) => v.plate)
  expect(plates).toContain(PLATES.showcase)
  expect(plates).toContain(PLATES.carlos)
  expect(plates).toContain(PLATES.alba)
})

test('HSE lee los vehículos pero no los costes', async ({ page }) => {
  await loginAs(page, 'hse')
  const vehicles = await page.request.get('/api/v1/vehicles/')
  expect(vehicles.ok()).toBeTruthy()
  // Los contratos llevan la cuota: fuera de lo que HSE enseña.
  const contracts = await page.request.get('/api/v1/contracts/')
  expect(contracts.status()).toBe(403)
})
