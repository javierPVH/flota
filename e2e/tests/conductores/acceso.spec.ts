/**
 * El portón y la home de la app de campo (docs/E2E_PLAYWRIGHT.md §6.4).
 *
 * `AccessGate` decide: con coche se entra; sin coche (david) se va a
 * «Solicita tu vehículo»; y gestión o HSE sin rol de campo (hse) ve el 403
 * con cerrar sesión, porque esta app no es para ellos.
 */
import { PLATES, expect, loginAs, reseed, test } from '../../fixtures'

// Solo lee, pero lee el seed TAL CUAL (carlos con su coche, david sin él),
// y la suite de gestión que corre antes se lo cambia (el 1234KLM pasa a
// david al probar «Cambiar conductor»): se vuelve a sembrar.
test.beforeAll(() => reseed())

test('carlos ve su vehículo', async ({ page }) => {
  await loginAs(page, 'carlos')
  await page.goto('/')
  // El conmutador de arriba son botones con `aria-pressed`, no pestañas.
  const miVehiculo = page.getByRole('button', { name: 'Mi vehículo' })
  await expect(miVehiculo).toBeVisible()
  await expect(miVehiculo).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(PLATES.carlos).first()).toBeVisible()
})

test('david (sin coche) ve el portón de acceso', async ({ page }) => {
  await loginAs(page, 'david')
  await page.goto('/')
  await expect(page).toHaveURL(/\/solicitar/)
  await expect(page.getByRole('heading', { name: 'Solicita tu vehículo' })).toBeVisible()
})

test('un usuario de gestión sin rol de campo no entra en la PWA', async ({ page }) => {
  await loginAs(page, 'hse')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sin acceso' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
})
