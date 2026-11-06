/**
 * Las bandejas de gestión (docs/E2E_PLAYWRIGHT.md §6.2): incidencias,
 * accidentes, solicitudes, documentos, usuarios, kilometraje e informes.
 * Cada una carga con las filas del seed y sus pestañas o filtros.
 */
import { PLATES, expect, loginAs, test } from '../../fixtures'

const HEAD = { timeout: 30_000 }

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'admin')
})

test('incidencias lista las del escaparate y no mezcla accidentes', async ({ page }) => {
  await page.goto('/incidencias')
  await expect(page.getByRole('heading', { level: 1, name: 'Incidencias' })).toBeVisible(HEAD)
  await expect(page.getByRole('row').filter({ hasText: PLATES.showcase }).first()).toBeVisible(HEAD)
  // El filtro de tipo no ofrece «Accidente»: tienen su propia bandeja.
  await expect(page.getByRole('option', { name: 'Accidente', exact: true })).toHaveCount(0)
  // Y la cabecera lleva a la otra bandeja.
  await page.getByRole('button', { name: 'Ver accidentes' }).click()
  await expect(page).toHaveURL(/\/accidentes$/)
})

test('accidentes lista el abierto de alba con los meses desde la creación', async ({ page }) => {
  await page.goto('/accidentes')
  await expect(page.getByRole('heading', { level: 1, name: 'Accidentes' })).toBeVisible(HEAD)
  // La bandeja abre por lo abierto: el accidente del 2022DXP (los del
  // 5678BCD están cerrados y viven en su pestaña).
  await expect(page.getByRole('row').filter({ hasText: PLATES.alba }).first()).toBeVisible(HEAD)
  await expect(page.getByRole('columnheader', { name: /Meses desde la creación/ })).toBeVisible()
})

test('solicitudes tiene sus seis bandejas y abre por lo pendiente', async ({ page }) => {
  await page.goto('/solicitudes')
  await expect(page.getByRole('heading', { level: 1, name: 'Solicitudes' })).toBeVisible(HEAD)
  for (const pestana of [
    'Coche pedido',
    'Sobre un documento que ya está',
    'Documento que falta',
    'Otro conductor propuesto',
    'Corregir una ficha personal',
    'Modificar el parte de una incidencia',
  ]) {
    await expect(page.getByRole('tab', { name: new RegExp(pestana) })).toBeVisible()
  }
  // La barra de estado: «Pendientes» marcada de salida.
  await expect(page.getByRole('checkbox', { name: /Pendientes/ })).toBeChecked()
  // Cambiar de bandeja: la de fichas personales (el seed deja una pendiente).
  await page.getByRole('tab', { name: /Corregir una ficha personal/ }).click()
  await expect(page.getByRole('row').first()).toBeVisible()
})

test('documentos: pestañas, listado por tipo y los de alba', async ({ page }) => {
  await page.goto('/documentos?tab=documentos')
  await expect(page.getByRole('heading', { level: 1, name: 'Documentos' })).toBeVisible(HEAD)
  await expect(page.getByRole('row').filter({ hasText: PLATES.alba }).first()).toBeVisible(HEAD)
  // El tipo elegido va en la URL: su sub-pestaña queda marcada y la tabla
  // solo trae los de ese tipo (el permiso de conducir es personal: sin matrícula).
  await page.goto('/documentos?tipo=driving_license')
  await expect(page.getByRole('tab', { name: /^Permiso de conducir/ })).toHaveAttribute(
    'aria-selected',
    'true',
    HEAD,
  )
  await expect(page.getByRole('row').filter({ hasText: PLATES.alba })).toHaveCount(0)
  // Y la pestaña de Ajustes: quién lee cada tipo.
  await page.getByRole('tab', { name: 'Ajustes' }).click()
  await expect(page.getByText('Quién lee cada tipo de documento')).toBeVisible()
})

test('usuarios: la tabla, las dos cuentas aparte y las pestañas por rol', async ({ page }) => {
  await page.goto('/conductores')
  await expect(page.getByRole('heading', { level: 1, name: 'Usuarios' })).toBeVisible(HEAD)
  await expect(page.getByRole('row').filter({ hasText: 'carlos' }).first()).toBeVisible(HEAD)
  await expect(page.getByRole('tablist', { name: 'Usuarios por rol' })).toBeVisible()
  await page.getByRole('tab', { name: /^HSE/ }).click()
  await expect(page.getByRole('row').filter({ hasText: 'carlos' })).toHaveCount(0)
  await expect(page.getByRole('row').filter({ hasText: 'hse' }).first()).toBeVisible()
})

test('kilometraje: sus cuatro pestañas con filas', async ({ page }) => {
  await page.goto('/kilometraje')
  await expect(page.getByRole('heading', { level: 1, name: 'Kilometraje' })).toBeVisible(HEAD)
  for (const pestana of [
    'Lecturas',
    'Lecturas pendientes de este mes',
    'Proyección a fin de contrato/año',
    'Flota con km ilimitados',
  ]) {
    await expect(page.getByRole('tab', { name: pestana, exact: true })).toBeVisible()
  }
  await page.getByRole('tab', { name: 'Proyección a fin de contrato/año' }).click()
  // El 1234KLM va camino de pasarse y tiene la alerta abierta: «Resolver»
  // solo sale en el coche que la tiene.
  const fila = page.getByRole('row').filter({ hasText: PLATES.carlos }).first()
  await expect(fila).toBeVisible(HEAD)
  await expect(
    fila.getByRole('button', { name: `Resolver el exceso de km de ${PLATES.carlos}` }),
  ).toBeVisible()
})

test('informes: Descargas y Facturas, y la descarga del informe de flota', async ({ page }) => {
  await page.goto('/informes')
  await expect(page.getByRole('heading', { level: 1, name: 'Informes' })).toBeVisible(HEAD)
  await expect(page.getByRole('tab', { name: 'Descargas' })).toBeVisible()
  await page.getByRole('tab', { name: 'Facturas' }).click()
  await expect(page.getByRole('tab', { name: 'Facturas' })).toHaveAttribute('aria-selected', 'true')
  // Lo que descarga esa pantalla sale por la misma puerta que la API.
  const res = await page.request.get('/api/v1/reports/?kind=fleet&fmt=csv')
  expect(res.status()).toBe(200)
})

test('alertas: la bandeja filtra por tipo desde la URL', async ({ page }) => {
  await page.goto('/alertas?type=insurance_due')
  await expect(page.getByRole('heading', { level: 1, name: 'Alertas' })).toBeVisible(HEAD)
  await expect(page.getByRole('row').filter({ hasText: PLATES.showcase }).first()).toBeVisible(HEAD)
  await expect(page.getByRole('row').filter({ hasText: 'Lectura de km pendiente' })).toHaveCount(0)
})
