/**
 * Resolver una alerta del escaparate (docs/E2E_PLAYWRIGHT.md §6.3).
 *
 * Se elige la de «Lectura de km pendiente» del 8888TRX: su modal de resolver
 * (`ResolveAlertModal`, variante `km`) pide la lectura y una nota, y cerrarla
 * deja rastro comprobable en la API (la alerta resuelta y la lectura nueva).
 */
import { PLATES, expect, loginAs, reseed, rowsOf, test } from '../../fixtures'

test.beforeAll(() => reseed())

type VehicleRow = { id: number; plate: string; km_current: number | null }
type AlertRow = { id: number; vehicle_plate: string; type: string; status: string }

test('resolver la lectura de km pendiente del 8888TRX la saca de abiertas', async ({ page }) => {
  await loginAs(page, 'admin')

  // La última lectura conocida, para no retroceder el odómetro.
  const vehiclesRes = await page.request.get(`/api/v1/vehicles/?search=${PLATES.showcase}`)
  const vehicle = rowsOf<VehicleRow>(await vehiclesRes.json()).find(
    (v) => v.plate === PLATES.showcase,
  )
  expect(vehicle, `el ${PLATES.showcase} del seed`).toBeTruthy()
  const nextKm = (vehicle!.km_current ?? 0) + 50

  await page.goto('/alertas?type=km_reading_pending')
  const fila = page.getByRole('row').filter({ hasText: PLATES.showcase })
  await expect(fila).toHaveCount(1)

  await fila.getByRole('button', { name: 'Resolver' }).click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  await modal.getByLabel('Lectura de km').fill(String(nextKm))
  await modal.getByLabel('Nota de resolución').fill('Resuelta por la prueba e2e')
  await modal.getByRole('button', { name: 'Registrar lectura y resolver' }).click()

  await expect(modal).toBeHidden()
  await expect(page.getByRole('row').filter({ hasText: PLATES.showcase })).toHaveCount(0)

  // Y en la API: ya no hay esa alerta abierta para ese coche.
  const alertsRes = await page.request.get(
    `/api/v1/alerts/?status=open&type=km_reading_pending&vehicle=${vehicle!.id}`,
  )
  expect(alertsRes.ok()).toBeTruthy()
  const abiertas = rowsOf<AlertRow>(await alertsRes.json()).filter(
    (a) => a.vehicle_plate === PLATES.showcase,
  )
  expect(abiertas).toHaveLength(0)
})
