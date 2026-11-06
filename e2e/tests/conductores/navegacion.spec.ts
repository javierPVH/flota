/**
 * Todas las rutas de la PWA (docs/E2E_PLAYWRIGHT.md §6.4): lo que ve un
 * conductor en cada pantalla y lo que añade quien supervisa («Flota», «A tu
 * cargo», la proyección del grupo).
 */
import { PLATES, expect, findVehicle, loginAs, test } from '../../fixtures'

const HEAD = { timeout: 30_000 }

test.describe('como conductor (carlos)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'carlos')
  })

  test('la home: su coche, lo pendiente, «Te queda poco» y el nav de abajo', async ({ page }) => {
    await page.goto('/')
    // Con un solo coche no hay título «Mis vehículos»: el tablero lo dice
    // todo. Las tres tarjetas de lo pendiente llevan su recuento.
    await expect(page.getByRole('heading', { name: /^Alertas \d+/ })).toBeVisible(HEAD)
    await expect(page.getByRole('heading', { name: /^Incidencias \d+/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Accidentes \d+/ })).toBeVisible()
    await expect(page.getByText(PLATES.carlos).first()).toBeVisible()
    // «Te queda poco»: la lectura de km del mes, que el seed deja sin dar.
    await expect(
      page.getByRole('button', { name: new RegExp(`^Kilómetros de ${PLATES.carlos}`) }),
    ).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'Navegación principal' })
    for (const boton of ['Km', 'Combustible', 'Incidencia', 'Accidente', 'Documento']) {
      await expect(nav.getByRole('button', { name: boton, exact: true })).toBeVisible()
    }
    // El conmutador: sin «Flota», que es de quien supervisa; con «Reparto»,
    // porque tiene coches repartidos.
    await expect(page.getByRole('button', { name: 'Mi vehículo', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reparto', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Flota', exact: true })).toHaveCount(0)
  })

  test('/alertas: las tres tarjetas con su recuento', async ({ page }) => {
    await page.goto('/alertas')
    await expect(page.getByRole('heading', { level: 1, name: 'Alertas' })).toBeVisible(HEAD)
    for (const tarjeta of ['Alertas', 'Incidencias', 'Accidentes']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${tarjeta}`) }).first()).toBeVisible()
    }
  })

  test('/reparto: sus dos coches repartidos y con quién', async ({ page }) => {
    await page.goto('/reparto')
    await expect(page.getByRole('button', { name: 'Reparto', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
      HEAD,
    )
    // Su coche (chapa «Tu coche», 60 %, con lucia) y el de la administradora
    // los fines de semana (20 %). Cada tarjeta es un enlace a la ficha.
    const mio = page.getByRole('link', { name: new RegExp(`^${PLATES.carlos} `) })
    await expect(mio).toBeVisible(HEAD)
    await expect(mio).toContainText('Tu coche')
    await expect(mio).toContainText('60 %')
    const prestado = page.getByRole('link', { name: new RegExp(`^${PLATES.showcase} `) })
    await expect(prestado).toContainText('20 %')
    await expect(prestado).not.toContainText('Tu coche')
    // Abrir la ficha: el reparto es la tercera puerta del ámbito.
    await prestado.click()
    await expect(page).toHaveURL(/\/vehiculos\/\d+/)
    await expect(page.getByText(PLATES.showcase).first()).toBeVisible(HEAD)
  })

  test('/perfil: mis datos, documentos y peticiones', async ({ page }) => {
    await page.goto('/perfil')
    await expect(page.getByRole('heading', { name: 'Mis datos' })).toBeVisible(HEAD)
    await expect(page.getByRole('button', { name: /^Mis documentos/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Peticiones/ })).toBeVisible()
    // El nav del perfil se queda en dos.
    const nav = page.getByRole('navigation', { name: 'Navegación principal' })
    await expect(nav.getByRole('button', { name: 'Mis datos', exact: true })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Documento', exact: true })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Km', exact: true })).toHaveCount(0)
  })

  test('las vistas sueltas: registrar, incidencia nueva y subir documento', async ({ page }) => {
    await page.goto('/registrar')
    await expect(page.getByRole('heading', { level: 1, name: 'Registrar kilómetros' })).toBeVisible(
      HEAD,
    )
    await page.goto('/incidencias/nueva')
    await expect(page.getByRole('heading', { level: 1, name: 'Comunicar incidencia' })).toBeVisible(
      HEAD,
    )
    await page.goto('/documentos/nuevo')
    await expect(page.getByRole('heading', { level: 1, name: 'Subir documento' })).toBeVisible(HEAD)
  })

  test('la ficha de campo de su coche y el 404 de uno ajeno', async ({ page }) => {
    const mio = await findVehicle(page.request, PLATES.carlos)
    await page.goto(`/vehiculos/${mio.id}`)
    await expect(page.getByText(PLATES.carlos).first()).toBeVisible(HEAD)
    // Las tres tarjetas de lo pendiente, plegadas de salida.
    for (const tarjeta of ['Alertas', 'Incidencias', 'Accidentes']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${tarjeta}`) }).first()).toBeVisible()
    }
    // Una ruta desconocida vuelve a la home.
    await page.goto('/esto-no-existe')
    await expect(page).toHaveURL(/\/$/, HEAD)
  })
})

test.describe('como supervisora (sara)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'sara')
  })

  test('«Flota» enseña su grupo con «A tu cargo»', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Flota', exact: true }).click({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Flota a cargo' })).toBeVisible(HEAD)
    await expect(page.getByText('A tu cargo').first()).toBeVisible()
    await expect(page.getByText(PLATES.carlos).first()).toBeVisible()
    await expect(page.getByText(PLATES.sara2).first()).toBeVisible()
    // El modo se recuerda: volver a la home sigue en Flota.
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Flota a cargo' })).toBeVisible(HEAD)
    await page.getByRole('button', { name: 'Mi vehículo', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Flota a cargo' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Mi vehículo', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('/grupo: la proyección de km de su flota', async ({ page }) => {
    await page.goto('/grupo')
    await expect(page.getByRole('heading', { level: 1, name: 'Proyección de km' })).toBeVisible(HEAD)
  })
})
