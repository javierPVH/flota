/**
 * Los gestos de gestión recorridos con el ratón (docs/E2E_PLAYWRIGHT.md
 * §6.2): decidir en /solicitudes, cambiar conductor (y el 409 del bloqueo
 * optimista en dos pestañas), devolver un vehículo, subir un documento desde
 * la ficha, resolver una incidencia y registrar una ITV desde su alerta.
 * Escribe: resiembra al empezar.
 */
import {
  JPEG_BYTES,
  PLATES,
  expect,
  findVehicle,
  loginAs,
  reseed,
  rowsOf,
  test,
  todayIso,
} from '../../fixtures'

const HEAD = { timeout: 30_000 }

/** Despliega una tarjeta de la ficha si está plegada (las de lo pendiente
 * nacen abiertas y un clic a ciegas las cerraría). */
async function abrirTarjeta(page: import('@playwright/test').Page, nombre: RegExp) {
  const boton = page.getByRole('button', { name: nombre }).first()
  await expect(boton).toBeVisible(HEAD)
  if ((await boton.getAttribute('aria-expanded')) !== 'true') await boton.click()
}

test.beforeAll(() => reseed())

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'admin')
})

test('solicitudes: conceder un coche a quien lo pide', async ({ page }) => {
  type Req = { id: number; requester: number | null; requester_name: string; status: string }
  const pendientes = rowsOf<Req>(
    await (await page.request.get('/api/v1/vehicle-requests/?status=pending&page_size=500')).json(),
  ).filter((r) => r.requester !== null)
  expect(pendientes.length, 'el seed deja solicitudes de coche pendientes').toBeGreaterThan(0)
  const pedida = pendientes[0]

  await page.goto('/solicitudes')
  await expect(page.getByRole('heading', { level: 1, name: 'Solicitudes' })).toBeVisible(HEAD)
  const fila = page.getByRole('row').filter({ hasText: pedida.requester_name }).first()
  await expect(fila).toBeVisible(HEAD)
  await fila.getByRole('button', { name: 'Conceder…' }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByText(`Conceder vehículo a ${pedida.requester_name}`)).toBeVisible()
  // Un coche libre del desplegable.
  const libre = modal.getByRole('option', { name: /\(libre\)/ }).first()
  const matricula = ((await libre.textContent()) ?? '').trim().split(' ')[0]
  await modal.getByLabel('Vehículo').selectOption({ label: (await libre.textContent())!.trim() })
  await modal.getByRole('button', { name: 'Conceder', exact: true }).click()
  await expect(page.getByText(`Concedido ${matricula} a ${pedida.requester_name}`)).toBeVisible()

  const ahora = await (await page.request.get(`/api/v1/vehicle-requests/${pedida.id}/`)).json()
  // Concedida = asignada: el solicitante ya tiene el coche.
  expect(ahora.status).toBe('assigned')
})

test('solicitudes: rechazar una petición sobre un documento desde «Gestionar»', async ({ page }) => {
  const antes = rowsOf<{ id: number }>(
    await (
      await page.request.get('/api/v1/document-deletion-requests/?status=pending&page_size=500')
    ).json(),
  )
  expect(antes.length, 'el seed deja peticiones sobre documentos').toBeGreaterThan(0)

  await page.goto('/solicitudes')
  await page.getByRole('tab', { name: /Sobre un documento que ya está/ }).click({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Gestionar…' }).first().click()
  const modal = page.getByRole('dialog')
  // La decisión es un desplegable con las salidas de ESA clase de petición.
  await modal
    .getByLabel('Qué se hace con el documento')
    .selectOption({ label: 'Rechazar la petición' })
  await modal.getByLabel('Observaciones (opcional)').fill('Rechazada por la prueba e2e')
  await modal.getByRole('button', { name: 'Aplicar', exact: true }).click()
  await expect(modal).toBeHidden()

  const despues = rowsOf<{ id: number }>(
    await (
      await page.request.get('/api/v1/document-deletion-requests/?status=pending&page_size=500')
    ).json(),
  )
  expect(despues.length).toBe(antes.length - 1)
})

test('cambiar conductor desde la ficha, y el 409 de una segunda pestaña', async ({
  page,
  context,
}) => {
  const coche = await findVehicle(page.request, PLATES.carlos)
  type UserRow = { id: number; username: string; first_name: string; last_name: string }
  const david = rowsOf<UserRow>(
    await (await page.request.get('/api/v1/auth/users/?search=david&page_size=50')).json(),
  ).find((u) => u.username === 'david')!
  expect(david, 'david en /auth/users/').toBeTruthy()

  // Dos pestañas con la ficha cargada: la segunda se queda con el
  // `updated_at` de ahora y no vuelve a leer. (Una detrás de otra, no a la
  // vez: la BD de pruebas es SQLite y dos peticiones solapadas la bloquean.)
  const otra = await context.newPage()
  for (const p of [page, otra]) {
    await p.goto(`/vehiculos/${coche.id}`)
    await expect(p.getByRole('heading', { level: 1, name: PLATES.carlos })).toBeVisible(HEAD)
    await p.waitForLoadState('networkidle')
  }

  // La primera cambia el conductor y guarda.
  await abrirTarjeta(page, /^Conductor y reparto/)
  await page.getByRole('button', { name: 'Cambiar conductor' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Nuevo conductor').selectOption({ value: String(david.id) })
  await modal.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(modal).toBeHidden()
  const ficha = await (await page.request.get(`/api/v1/vehicles/${coche.id}/`)).json()
  expect(ficha.driver_id).toBe(david.id)

  // La segunda llega tarde: su `expected_updated_at` ya no vale y el back
  // contesta 409; el modal se queda abierto y lo dice.
  await abrirTarjeta(otra, /^Conductor y reparto/)
  await otra.getByRole('button', { name: 'Cambiar conductor' }).click()
  const tarde = otra.getByRole('dialog')
  await tarde.getByLabel('Nuevo conductor').selectOption({ value: String(david.id) })
  await tarde.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(tarde.getByRole('alert')).toBeVisible()
  await expect(tarde).toBeVisible()
  await otra.close()
})

test('devolver un vehículo desde «Editar ficha»', async ({ page }) => {
  // Un coche de volumen activo que no usan las demás pruebas.
  const todos = rowsOf<{ id: number; plate: string; state: string; km_current: number | null }>(
    await (await page.request.get('/api/v1/vehicles/?page_size=500')).json(),
  )
  const coche = todos.find(
    (v) => v.state === 'active' && /^20\d\d[A-Z]{3}$/.test(v.plate) && v.plate !== PLATES.alba,
  )
  expect(coche, 'un coche de volumen activo').toBeTruthy()

  await page.goto(`/vehiculos/${coche!.id}`)
  await expect(page.getByRole('heading', { level: 1, name: coche!.plate })).toBeVisible(HEAD)
  await page.getByRole('button', { name: 'Editar ficha' }).click()
  await page.getByRole('button', { name: 'Devolver', exact: true }).click()
  const modal = page.getByRole('dialog').filter({ hasText: `Devolver ${coche!.plate}` })
  await expect(modal).toBeVisible()
  await modal.getByLabel('Km de devolución').fill(String((coche!.km_current ?? 0) + 100))
  await modal.getByLabel('Fecha de devolución').fill(todayIso())
  await modal.getByLabel('Motivo').fill('Fin de contrato (e2e)')
  await modal.getByRole('button', { name: 'Devolver vehículo' }).click()

  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/vehicles/${coche!.id}/`)).json()).state)
    .toBe('returned')
})

test('subir un documento desde la ficha del vehículo', async ({ page }) => {
  const coche = await findVehicle(page.request, PLATES.carlos)
  await page.goto(`/vehiculos/${coche.id}`)
  await expect(page.getByRole('heading', { level: 1, name: PLATES.carlos })).toBeVisible(HEAD)
  await abrirTarjeta(page, /^Documentos$/)
  await page.getByRole('button', { name: 'Añadir documento' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Tipo de documento').selectOption({ label: 'Ficha técnica' })
  await modal.getByLabel('Foto o PDF (desde tu equipo)').setInputFiles({
    name: 'ficha-tecnica.jpg',
    mimeType: 'image/jpeg',
    buffer: JPEG_BYTES,
  })
  await modal.getByLabel('Notas').fill('Subida por la prueba e2e')
  await modal.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(modal).toBeHidden()

  const docs = rowsOf<{ type: string; notes: string }>(
    await (await page.request.get(`/api/v1/documents/?vehicle=${coche.id}&page_size=500`)).json(),
  )
  expect(docs.some((d) => d.type === 'technical_datasheet' && d.notes.includes('e2e'))).toBe(true)
})

test('resolver una avería desde la bandeja de incidencias', async ({ page }) => {
  const abiertas = () =>
    page.request
      .get('/api/v1/incidents/?type=breakdown&status=open&page_size=500')
      .then((r) => r.json())
      .then((b) => rowsOf<{ id: number }>(b).length)
  const antes = await abiertas()
  expect(antes, 'el seed deja averías abiertas').toBeGreaterThan(0)

  await page.goto('/incidencias')
  await expect(page.getByRole('heading', { level: 1, name: 'Incidencias' })).toBeVisible(HEAD)
  await page.getByRole('combobox', { name: 'Tipo' }).selectOption({ label: 'Avería' })
  // Una fila cuyo «Resolver» esté vivo: la del escaparate va apagada porque
  // tiene cambios propuestos sin decidir (el seed los deja a propósito).
  const fila = page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: 'Resolver', disabled: false }) })
    .first()
  await expect(fila).toBeVisible(HEAD)
  await fila.getByRole('button', { name: 'Resolver' }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByText(/^Resolver avería/)).toBeVisible()
  await modal.getByLabel('Fecha de solución').fill(todayIso())
  await modal.getByLabel('Observaciones').fill('Reparada (e2e)')
  await modal.getByRole('button', { name: 'Resolver y cerrar' }).click()
  await expect(modal).toBeHidden()
  await expect.poll(abiertas).toBe(antes - 1)
})

test('registrar la ITV desde su alerta cierra la alerta y fija la próxima', async ({ page }) => {
  const coche = await findVehicle(page.request, PLATES.showcase)
  await page.goto('/alertas?type=itv_due')
  const fila = page.getByRole('row').filter({ hasText: PLATES.showcase }).first()
  await expect(fila).toBeVisible(HEAD)
  await fila.getByRole('button', { name: 'Resolver' }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByText(`Registrar ITV · ${PLATES.showcase}`)).toBeVisible()
  await modal.getByLabel('Resultado').selectOption({ label: 'Favorable' })
  await modal.getByLabel('Fecha de la inspección').fill(todayIso())
  const proxima = `${new Date().getFullYear() + 1}-06-15`
  await modal.getByLabel('Próxima ITV').fill(proxima)
  await modal.getByRole('button', { name: 'Registrar', exact: true }).click()
  await expect(modal).toBeHidden()

  const abiertas = rowsOf<{ id: number }>(
    await (
      await page.request.get(`/api/v1/alerts/?status=open&type=itv_due&vehicle=${coche.id}`)
    ).json(),
  )
  expect(abiertas).toHaveLength(0)
  const ficha = await (await page.request.get(`/api/v1/vehicles/${coche.id}/`)).json()
  expect(ficha.next_itv_date).toBe(proxima)
})

test('«Enviar correo» abre el asistente de cuatro pasos', async ({ page }) => {
  const coche = await findVehicle(page.request, PLATES.showcase)
  await page.goto(`/vehiculos/${coche.id}`)
  await expect(page.getByRole('heading', { level: 1, name: PLATES.showcase })).toBeVisible(HEAD)
  await page.getByRole('button', { name: 'Enviar correo' }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByText(`Enviar correo · ${PLATES.showcase}`)).toBeVisible()
  await expect(modal.getByRole('tablist', { name: 'Pasos del correo' })).toBeVisible()
  // Sin tipo elegido no se avanza.
  await expect(modal.getByRole('button', { name: 'Siguiente' })).toBeVisible()
})
