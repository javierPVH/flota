/**
 * Lo que el campo comunica y PIDE desde la PWA (docs/E2E_PLAYWRIGHT.md
 * §6.3): el parte de accidente guiado, subir y pedir un documento, pedir el
 * borrado de uno, registrar la ITV citada y proponer cambios al parte de una
 * incidencia. Escribe: resiembra al empezar.
 */
import {
  JPEG_BYTES,
  PLATES,
  expect,
  findVehicle,
  hoursAgoLocal,
  loginAs,
  postJson,
  reseed,
  rowsOf,
  test,
  todayIso,
} from '../../fixtures'

const HEAD = { timeout: 30_000 }

test.beforeAll(() => reseed())

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'carlos')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /^Alertas \d+/ })).toBeVisible(HEAD)
})

function nav(page: import('@playwright/test').Page) {
  return page.getByRole('navigation', { name: 'Navegación principal' })
}

/** Pulsa «Continuar» hasta que asome el botón que cierra el carrusel. */
async function hastaElBoton(modal: import('@playwright/test').Locator, nombre: string | RegExp) {
  for (let i = 0; i < 6; i++) {
    if (await modal.getByRole('button', { name: nombre }).isVisible()) return
    await modal.getByRole('button', { name: 'Continuar' }).click()
  }
}

test('comunicar un accidente con el parte guiado', async ({ page }) => {
  const mio = await findVehicle(page.request, PLATES.carlos)
  await nav(page).getByRole('button', { name: 'Accidente', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByText(`Comunicación de accidente · ${PLATES.carlos}`)).toBeVisible()
  // Paso 1: dónde y cuándo.
  await modal.getByLabel('Calle').fill('M-40, salida 12')
  await modal.getByLabel('Código postal').fill('28001')
  await modal.getByLabel('Localidad').fill('Madrid')
  await modal.getByLabel('Provincia').fill('Madrid')
  // Hace dos horas: el back rechaza una fecha de accidente futura, y «hoy
  // a las 09:30» lo es si la suite corre de madrugada.
  await modal.getByLabel('Fecha y hora').fill(hoursAgoLocal(2))
  await modal.getByLabel('Teléfono', { exact: true }).fill('600000000')
  await modal.getByRole('button', { name: 'Continuar' }).click()
  // Paso 2: los daños.
  await modal.getByLabel('Descripción de los daños').fill('Paragolpes trasero (e2e).')
  // Implicados y atestado son opcionales: hasta el botón que comunica.
  await hastaElBoton(modal, 'Comunicar accidente')
  await modal.getByRole('button', { name: 'Comunicar accidente' }).click()
  await expect(modal.getByText('Accidente comunicado correctamente.')).toBeVisible()

  const accidentes = rowsOf<{ id: number; type: string; details: { street?: string } }>(
    await (
      await page.request.get(`/api/v1/incidents/?vehicle=${mio.id}&type=accident&status=open`)
    ).json(),
  )
  expect(accidentes.some((a) => a.details?.street === 'M-40, salida 12')).toBe(true)
})

test('subir un documento del coche desde el nav', async ({ page }) => {
  const mio = await findVehicle(page.request, PLATES.carlos)
  await nav(page).getByRole('button', { name: 'Documento', exact: true }).click()
  const modal = page.getByRole('dialog')
  await modal.getByRole('button', { name: /^Subir un documento/ }).click()
  await modal.getByLabel('Tipo de documento').selectOption({ label: 'Ficha técnica' })
  await modal.getByLabel('Foto o PDF (cámara / galería)').setInputFiles({
    name: 'ficha.jpg',
    mimeType: 'image/jpeg',
    buffer: JPEG_BYTES,
  })
  await hastaElBoton(modal, 'Subir')
  await modal.getByRole('button', { name: 'Subir', exact: true }).click()
  await expect(modal.getByRole('heading', { name: 'Documento subido' })).toBeVisible()

  const docs = rowsOf<{ type: string }>(
    await (await page.request.get(`/api/v1/documents/?vehicle=${mio.id}&page_size=500`)).json(),
  )
  expect(docs.some((d) => d.type === 'technical_datasheet')).toBe(true)
})

test('pedir el documento que falta', async ({ page }) => {
  await nav(page).getByRole('button', { name: 'Documento', exact: true }).click()
  const modal = page.getByRole('dialog')
  await modal.getByRole('button', { name: /^Pedir un documento/ }).click()
  await modal.getByLabel('Documento que necesitas').selectOption({ label: 'Contrato' })
  await modal.getByLabel('¿Para qué lo necesitas?').fill('Para la gestoría (e2e).')
  await modal.getByRole('button', { name: 'Enviar la petición' }).click()
  await expect(modal.getByRole('heading', { name: 'Petición enviada' })).toBeVisible()

  const pedidas = rowsOf<{ type: string; note: string; status: string }>(
    await (await page.request.get('/api/v1/document-supply-requests/?page_size=500')).json(),
  )
  expect(pedidas.some((p) => p.type === 'contract' && p.status === 'pending')).toBe(true)
})

test('pedir el borrado de un documento propio desde la ficha de campo', async ({ page }) => {
  const mio = await findVehicle(page.request, PLATES.carlos)
  await page.goto(`/vehiculos/${mio.id}`)
  // La tarjeta «Documentos» de la ficha de campo nace desplegada; si no, se abre.
  const tarjeta = page.getByRole('button', { name: /^Documentos/ }).first()
  await expect(tarjeta).toBeVisible(HEAD)
  if ((await tarjeta.getAttribute('aria-expanded')) !== 'true') await tarjeta.click()
  // La ficha técnica que subió la prueba anterior: lo propio no se tapa nunca.
  const papelera = page.getByRole('button', { name: /^Pedir el borrado de Ficha técnica/ }).first()
  await expect(papelera).toBeVisible(HEAD)
  await papelera.click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Motivo (opcional)').fill('Subida dos veces (e2e)')
  await modal.getByRole('button', { name: 'Pedir borrado' }).click()

  await expect
    .poll(async () => {
      const docs = rowsOf<{ type: string; deletion_pending: boolean }>(
        await (await page.request.get(`/api/v1/documents/?vehicle=${mio.id}&page_size=500`)).json(),
      )
      return docs.some((d) => d.type === 'technical_datasheet' && d.deletion_pending)
    })
    .toBe(true)
  // Y la fila lo dice: pendiente de borrado, con la papelera apagada.
  await expect(page.getByText('Pendiente de borrado').first()).toBeVisible()
})

test('registrar la ITV citada la saca de «Te queda poco»', async ({ page }) => {
  const mio = await findVehicle(page.request, PLATES.carlos)
  const ficha = await (await page.request.get(`/api/v1/vehicles/${mio.id}/`)).json()
  expect(ficha.next_itv_date, 'el 1234KLM tiene la ITV citada').toBeTruthy()
  await expect(
    page.getByRole('button', { name: new RegExp(`^ITV de ${PLATES.carlos}`) }),
  ).toBeVisible()

  await nav(page).getByRole('button', { name: 'ITV', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  await modal.getByLabel('Fecha de la ITV').fill(todayIso())
  await modal.getByRole('radio', { name: /Favorable/ }).first().check()
  await modal.getByRole('button', { name: 'Registrar ITV' }).click()
  // Registrada, la ventana se cierra y el aviso de la ITV desaparece de
  // «Te queda poco». El registro de campo viaja sin próxima fecha: la cita
  // la programa gestión.
  await expect(modal).toBeHidden()
  await expect(
    page.getByRole('button', { name: new RegExp(`^ITV de ${PLATES.carlos}`) }),
  ).toHaveCount(0)
  await expect
    .poll(async () => (await (await page.request.get(`/api/v1/vehicles/${mio.id}/`)).json()).next_itv_date)
    .toBeNull()
  const eventos = rowsOf<{ event_type: string }>(
    await (await page.request.get(`/api/v1/events/?vehicle=${mio.id}&event_type=itv&page_size=50`)).json(),
  )
  expect(eventos.length).toBeGreaterThan(0)
})

test('proponer cambios al parte de una incidencia', async ({ page }) => {
  const mio = await findVehicle(page.request, PLATES.carlos)
  // Una incidencia abierta de la que proponer cambios.
  const abierta = await postJson(page.request, '/api/v1/incidents/', {
    vehicle: mio.id,
    type: 'breakdown',
    description: 'Ruido al frenar (e2e).',
    client_ref: 'e2e-pwa-change',
  })
  expect(abierta.status(), await abierta.text()).toBe(201)
  const incidencia = await abierta.json()

  await page.goto('/alertas')
  await page.getByRole('button', { name: /^Incidencias \d+/ }).click({ timeout: 30_000 })
  const fila = page.getByRole('listitem').filter({ hasText: 'Ruido al frenar (e2e).' })
  await fila.getByRole('button', { name: 'Proponer cambios al parte' }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByLabel('Descripción')).toHaveValue('Ruido al frenar (e2e).')
  const km = String((mio.km_current ?? 0) + 5)
  await modal.getByLabel('Kilometraje').fill(km)
  await modal.getByLabel(/^Por qué/).fill('El cuadro marcaba más (e2e).')
  await expect(modal.getByLabel('Kilometraje')).toHaveValue(km)
  await modal.getByRole('button', { name: 'Enviar propuesta' }).click()
  // El acuse se lee en el propio modal: la bandeja recarga por debajo sin
  // desmontarlo (antes pasaba por el portón de carga y el modal volvía en
  // blanco, como si no se hubiera enviado nada).
  await expect(modal.getByText(/^Propuesta enviada\./)).toBeVisible()
  // El del acuse, no la X de la cabecera (los dos se llaman «Cerrar»).
  await modal.getByRole('status').getByRole('button', { name: 'Cerrar' }).click()
  await expect(modal).toBeHidden()

  // Enviada: la fila queda marcada «Cambios propuestos».
  await expect
    .poll(async () => {
      const propuestas = rowsOf<{ incident: number; status: string }>(
        await (await page.request.get('/api/v1/incident-change-requests/?page_size=500')).json(),
      )
      return propuestas.some((p) => p.incident === incidencia.id && p.status === 'pending')
    })
    .toBe(true)
  await expect(fila.getByText('Cambios propuestos')).toBeVisible(HEAD)
  // Y mientras siga viva, el lápiz va apagado.
  await expect(fila.getByRole('button', { name: /cambios/i })).toBeDisabled()
})
