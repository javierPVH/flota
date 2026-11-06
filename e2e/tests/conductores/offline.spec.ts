/**
 * La cola offline de la PWA (docs/E2E_PLAYWRIGHT.md §6.5): una lectura de km
 * registrada sin red se encola (IndexedDB) y se envía sola al volver la
 * conexión (evento `online`).
 */
import { PLATES, expect, loginAs, reseed, rowsOf, test } from '../../fixtures'

test.beforeAll(() => reseed())

type VehicleRow = { id: number; plate: string; km_current: number | null }

test('una lectura de km sin red se envía al volver la conexión', async ({ page, context }) => {
  await loginAs(page, 'carlos')

  const vehiclesRes = await page.request.get(`/api/v1/vehicles/?search=${PLATES.carlos}`)
  const vehicle = rowsOf<VehicleRow>(await vehiclesRes.json()).find(
    (v) => v.plate === PLATES.carlos,
  )
  expect(vehicle, `el ${PLATES.carlos} del seed`).toBeTruthy()
  const nextKm = (vehicle!.km_current ?? 0) + 10

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Mi vehículo' })).toBeVisible()

  // El modal se abre con red (sus módulos los sirve Vite) y se guarda sin ella.
  // En el nav inferior el botón lleva el rótulo corto («Km»).
  await page
    .getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: 'Km', exact: true })
    .click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()

  await context.setOffline(true)
  await modal.getByLabel(/Odómetro/).fill(String(nextKm))
  await modal.getByRole('button', { name: 'Guardar lectura' }).click()
  // Encolada: el modal se cierra y la cabecera cuenta lo que queda sin enviar.
  const pendiente = page.getByRole('button', { name: /1 registro sin enviar/ })
  await expect(pendiente).toBeVisible()

  // Al volver la red, la cola se vacía sola (evento `online`).
  const envio = page.waitForResponse(
    (r) => r.url().includes('/km-readings/') && r.request().method() === 'POST',
  )
  await context.setOffline(false)
  const respuesta = await envio
  expect(respuesta.ok(), `POST km-readings: ${respuesta.status()}`).toBeTruthy()
  await expect(pendiente).toBeHidden()

  // Y la lectura está en el back.
  const readings = await page.request.get(
    `/api/v1/km-readings/?vehicle=${vehicle!.id}&ordering=-reading_date`,
  )
  expect(readings.ok()).toBeTruthy()
  const kms = rowsOf<{ km_reading: number }>(await readings.json()).map((r) => r.km_reading)
  expect(kms).toContain(nextKm)
})
