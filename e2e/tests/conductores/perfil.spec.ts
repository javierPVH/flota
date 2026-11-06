/**
 * «Mis datos» (docs/E2E_PLAYWRIGHT.md §6.4): la ficha personal se PIDE por
 * pasos desde el perfil, y la petición llega a la bandeja de gestión. Escribe:
 * resiembra al empezar.
 */
import { expect, loginAs, postJson, reseed, rowsOf, sessionFor, test } from '../../fixtures'

const HEAD = { timeout: 30_000 }

test.beforeAll(() => reseed())

test('pedir la corrección del teléfono llega a la gestión', async ({
  page,
  playwright,
  baseURL,
}) => {
  // Una petición viva por persona: si el seed le deja una pendiente, el
  // modal avisa y el alta devolvería esa. La gestión la despeja antes.
  const admin = await sessionFor(playwright, baseURL!, 'admin')
  const previas = rowsOf<{ id: number; user_username?: string; user: number }>(
    await (await admin.get('/api/v1/profile-change-requests/?status=pending&page_size=500')).json(),
  )
  await loginAs(page, 'lucia')
  const yo = (await (await page.request.get('/api/v1/auth/me/')).json()).id as number
  for (const previa of previas.filter((p) => p.user === yo)) {
    await postJson(admin, `/api/v1/profile-change-requests/${previa.id}/resolve/`, {
      decision: 'reject',
    })
  }
  await page.goto('/perfil')
  await expect(page.getByRole('heading', { name: 'Mis datos' })).toBeVisible(HEAD)
  await page
    .getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('button', { name: 'Mis datos', exact: true })
    .click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  await expect(modal.getByText('Desde aquí se PIDE, no se guarda')).toBeVisible()
  await modal.getByLabel('Teléfono').fill('611222333')
  await modal.getByRole('button', { name: 'Continuar' }).click()
  await expect(modal.getByText('Modificar los documentos subidos')).toBeVisible()
  await modal.getByRole('button', { name: 'Continuar' }).click()
  await expect(modal.getByText('Lo que vas a pedir')).toBeVisible()
  await expect(modal.getByText('611222333')).toBeVisible()
  await modal.getByRole('button', { name: 'Enviar petición' }).click()
  await expect(modal.getByRole('heading', { name: 'Petición enviada' })).toBeVisible()

  // Y en la bandeja de gestión espera una pendiente de lucia con ese cambio.
  const pendientes = rowsOf<{ changes: Record<string, string>; user: number }>(
    await (await admin.get('/api/v1/profile-change-requests/?status=pending&page_size=500')).json(),
  )
  expect(pendientes.some((p) => p.changes?.phone === '611222333')).toBe(true)
  await admin.dispose()
})
