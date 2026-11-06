/**
 * Lo que el conductor registra desde el nav de «Mi vehículo»
 * (docs/E2E_PLAYWRIGHT.md §6.5): la lectura de km, el consumo medio y una
 * incidencia, cada uno con su modal, y su rastro en la API. Escribe:
 * resiembra al empezar.
 */
import { PLATES, expect, findVehicle, loginAs, reseed, rowsOf, test } from '../../fixtures'

const HEAD = { timeout: 30_000 }

test.beforeAll(() => reseed())

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'carlos')
  await page.goto('/')
  // El tablero de su coche (con un solo coche no hay título).
  await expect(page.getByRole('heading', { name: /^Alertas \d+/ })).toBeVisible(HEAD)
})

function nav(page: import('@playwright/test').Page) {
  return page.getByRole('navigation', { name: 'Navegación principal' })
}

test('registrar la lectura de km con conexión', async ({ page }) => {
  const mio = await findVehicle(page.request, PLATES.carlos)
  const nextKm = (mio.km_current ?? 0) + 15
  await nav(page).getByRole('button', { name: 'Km', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  await modal.getByLabel(/Odómetro/).fill(String(nextKm))
  await modal.getByRole('button', { name: 'Guardar lectura' }).click()
  // Guardada, la ventana se cierra y el tablero enseña la lectura de hoy.
  await expect(modal).toBeHidden()
  await expect(page.getByText(/Lectura del \d{1,2}\/\d{1,2}\/\d{4}/)).toBeVisible()
  const res = await page.request.get(
    `/api/v1/km-readings/?vehicle=${mio.id}&ordering=-reading_date&page_size=50`,
  )
  const kms = rowsOf<{ km_reading: number | string }>(await res.json()).map((r) =>
    Number(r.km_reading),
  )
  expect(kms).toContain(nextKm)
})

test('anotar el consumo medio', async ({ page }) => {
  const mio = await findVehicle(page.request, PLATES.carlos)
  await nav(page).getByRole('button', { name: 'Combustible', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  await modal.getByLabel(/Consumo medio real/).fill('6.8')
  await modal.getByRole('button', { name: 'Guardar consumo' }).click()
  await expect(modal).toBeHidden()
  const res = await page.request.get(`/api/v1/fuel-consumptions/?vehicle=${mio.id}&page_size=50`)
  const valores = rowsOf<{ avg_consumption: string }>(await res.json()).map((r) =>
    Number(r.avg_consumption),
  )
  expect(valores).toContain(6.8)
})

test('comunicar una incidencia por el modal del nav', async ({ page }) => {
  const mio = await findVehicle(page.request, PLATES.carlos)
  await nav(page).getByRole('button', { name: 'Incidencia', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  await expect(modal.getByText(`Incidencia · ${PLATES.carlos}`)).toBeVisible()
  await modal.getByLabel('Tipo', { exact: true }).selectOption({ label: 'Avería' })
  await modal.getByLabel('Descripción', { exact: true }).fill('Testigo de motor encendido (e2e).')
  // Los pasos que haga falta hasta el que comunica.
  for (let i = 0; i < 6; i++) {
    const enviar = modal.getByRole('button', { name: 'Comunicar incidencia' })
    if (await enviar.isVisible()) break
    await modal.getByRole('button', { name: 'Continuar' }).click()
  }
  await modal.getByRole('button', { name: 'Comunicar incidencia' }).click()
  await expect(modal.getByText('Incidencia comunicada.')).toBeVisible()
  const res = await page.request.get(
    `/api/v1/incidents/?vehicle=${mio.id}&status=open&page_size=50`,
  )
  const descripciones = rowsOf<{ description: string }>(await res.json()).map(
    (i) => i.description,
  )
  expect(descripciones).toContain('Testigo de motor encendido (e2e).')
})
