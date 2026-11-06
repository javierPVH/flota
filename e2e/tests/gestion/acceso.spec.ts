/**
 * Quién entra en gestión (docs/E2E_PLAYWRIGHT.md §6.2): admin y HSE sí; un
 * conductor o una supervisora sin rol de admin ven el 403 de `AdminGate` con
 * su «Cerrar sesión» (no un login en bucle); y la pantalla de login con una
 * clave mala dice que no pudo entrar.
 */
import { expect, loginAs, test } from '../../fixtures'

test('admin entra y ve el panel con su menú', async ({ page }) => {
  await loginAs(page, 'admin')
  await page.goto('/')
  await expect(page).not.toHaveURL(/\/login/)
  // La primera carga del chunk del panel tarda (Vite lo transforma al vuelo).
  await expect(page.getByRole('heading', { name: 'Vista general' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('button', { name: 'Menú' })).toBeVisible()
})

test('un conductor no entra en gestión: «Sin acceso» y cerrar sesión', async ({ page }) => {
  await loginAs(page, 'carlos')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sin acceso' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible()
})

test('una supervisora sin rol de admin tampoco entra', async ({ page }) => {
  await loginAs(page, 'sara')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sin acceso' })).toBeVisible({
    timeout: 30_000,
  })
})

test('HSE puro entra y cae en su pantalla', async ({ page }) => {
  await loginAs(page, 'hse')
  await page.goto('/')
  await expect(page).toHaveURL(/\/hse$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'HSE', exact: true })).toBeVisible()
})

test('cerrar sesión desde el 403 lleva al login', async ({ page }) => {
  await loginAs(page, 'carlos')
  await page.goto('/')
  await page.getByRole('button', { name: 'Cerrar sesión' }).click({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: 'Inicia sesión' })).toBeVisible()
})

test('el login con una contraseña incorrecta no entra y lo dice', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Inicia sesión' })).toBeVisible({
    timeout: 30_000,
  })
  await page.getByLabel('Usuario o email').fill('carlos')
  await page.getByLabel('Contraseña').fill('esta-no-es')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Credenciales incorrectas')
  await expect(page).toHaveURL(/\/login/)
})
