/**
 * Ajustes (docs/E2E_PLAYWRIGHT.md §6.2): sus tres pestañas van en la URL y
 * cada una monta su pantalla: catálogos, borrado definitivo (erratas) y
 * plantillas de correo.
 */
import { expect, loginAs, test } from '../../fixtures'

const HEAD = { timeout: 30_000 }

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'admin')
})

test('catálogos: la pestaña activa y los maestros', async ({ page }) => {
  await page.goto('/ajustes/catalogos')
  await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible(HEAD)
  await expect(page.getByRole('tab', { name: 'Catálogos' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Programas de mantenimiento' })).toBeVisible()
})

test('borrado definitivo: el espacio de erratas con sus grupos', async ({ page }) => {
  await page.goto('/ajustes/borrado')
  await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible(HEAD)
  await expect(page.getByRole('tab', { name: 'Borrado definitivo' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  // Lo que la API cuenta se pinta: el grupo de vehículos fuera de la flota,
  // una opción del desplegable de tipos (con su recuento).
  await expect(
    page.getByRole('option', { name: /Vehículos fuera de la flota \(\d+\)/ }),
  ).toBeAttached(HEAD)
})

test('plantillas de correo: los tipos y la configuración', async ({ page }) => {
  await page.goto('/ajustes/plantillas')
  await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible(HEAD)
  await expect(page.getByRole('tab', { name: 'Plantillas de correo' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  // Los tres grupos del segundo nivel.
  for (const grupo of ['Trazas', 'Configuración', 'Plantillas por tipo de correo']) {
    await expect(page.getByRole('tab', { name: grupo })).toBeVisible(HEAD)
  }
  await page.getByRole('tab', { name: 'Configuración' }).click()
  await expect(page.getByRole('tab', { name: 'Recordatorio de km' })).toBeVisible()
})

test('las pestañas de Ajustes cambian la URL', async ({ page }) => {
  await page.goto('/ajustes/catalogos')
  await page.getByRole('tab', { name: 'Borrado definitivo' }).click({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/ajustes\/borrado$/)
  await page.getByRole('tab', { name: 'Plantillas de correo' }).click()
  await expect(page).toHaveURL(/\/ajustes\/plantillas$/)
})
