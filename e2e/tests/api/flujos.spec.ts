/**
 * Flujos de escritura por la API (docs/E2E_PLAYWRIGHT.md §6.1): lo que el
 * campo REGISTRA y PIDE y lo que la gestión DECIDE, de punta a punta y con
 * las dos sesiones a la vez. Escribe, así que resiembra al empezar.
 *
 * Es el recorrido de `fleet/tests/test_driver_journey.py` contado por HTTP:
 * misma idempotencia (`client_ref`), mismo ámbito (404 en lo ajeno) y mismos
 * 403 en lo que es de gestión.
 */
import type { APIRequestContext } from '@playwright/test'
import {
  PLATES,
  deleteReq,
  expect,
  findVehicle,
  patchJson,
  postJson,
  reseed,
  rowsOf,
  sessionFor,
  test,
  todayIso,
  uploadDocument,
  type VehicleRow,
} from '../../fixtures'

let admin: APIRequestContext
let sara: APIRequestContext
let carlos: APIRequestContext
let hse: APIRequestContext
let mio: VehicleRow
let ajeno: VehicleRow

test.beforeAll(async ({ playwright, baseURL }) => {
  reseed()
  admin = await sessionFor(playwright, baseURL!, 'admin')
  sara = await sessionFor(playwright, baseURL!, 'sara')
  carlos = await sessionFor(playwright, baseURL!, 'carlos')
  hse = await sessionFor(playwright, baseURL!, 'hse')
  mio = await findVehicle(carlos, PLATES.carlos)
  ajeno = await findVehicle(admin, PLATES.sara2)
})

test.afterAll(async () => {
  for (const ctx of [admin, sara, carlos, hse]) await ctx?.dispose()
})

// --- ámbito --------------------------------------------------------------

test('el ámbito de cada rol: lo suyo, 404 en lo ajeno, 403 en lo de gestión', async () => {
  // carlos: su coche sí, el de al lado no existe para él.
  expect((await carlos.get(`/api/v1/vehicles/${mio.id}/`)).status()).toBe(200)
  expect((await carlos.get(`/api/v1/vehicles/${ajeno.id}/`)).status()).toBe(404)
  expect((await carlos.get(`/api/v1/vehicles/${mio.id}/summary/`)).status()).toBe(200)
  expect((await carlos.get(`/api/v1/vehicles/${mio.id}/history/`)).status()).toBe(403)
  // Al conductor el resumen le llega sin proyección: es de gestión.
  const resumen = await (await carlos.get(`/api/v1/vehicles/${mio.id}/summary/`)).json()
  expect(resumen.projection).toBeNull()
  // sara supervisa los dos: los lee, con su histórico, y ve la proyección.
  expect((await sara.get(`/api/v1/vehicles/${ajeno.id}/`)).status()).toBe(200)
  expect((await sara.get(`/api/v1/vehicles/${ajeno.id}/history/`)).status()).toBe(200)
  // HSE lee toda la flota pero recortada: sin conductor y con el contrato.
  const fila = await findVehicle(hse, PLATES.carlos)
  expect(fila).not.toHaveProperty('driver')
  expect(fila).toHaveProperty('contract_start_date')
})

test('las alertas de gestión no viajan al conductor', async () => {
  const res = await carlos.get('/api/v1/alerts/?status=open&page_size=500')
  const tipos = new Set(rowsOf<{ type: string }>(await res.json()).map((a) => a.type))
  expect(tipos.has('insurance_due')).toBe(false)
  expect(tipos.has('km_overage')).toBe(false)
  expect(tipos.size).toBeGreaterThan(0)
})

// --- lo que el conductor registra ----------------------------------------

test('lectura de km: idempotente por client_ref, sin retroceso, append-only', async () => {
  const base = mio.km_current ?? 0
  const body = {
    vehicle: mio.id,
    km_reading: base + 25,
    reading_date: todayIso(),
    client_ref: 'e2e-km-1',
  }
  const first = await postJson(carlos, '/api/v1/km-readings/', body)
  expect(first.status(), await first.text()).toBe(201)
  const id = (await first.json()).id
  // El reenvío de la cola offline no duplica.
  const again = await postJson(carlos, '/api/v1/km-readings/', body)
  expect([200, 201]).toContain(again.status())
  expect((await again.json()).id).toBe(id)
  // No se retrocede.
  const atras = await postJson(carlos, '/api/v1/km-readings/', {
    vehicle: mio.id,
    km_reading: base,
    reading_date: todayIso(),
  })
  expect(atras.status()).toBe(400)
  // Ni se escribe en un coche ajeno.
  const fuera = await postJson(carlos, '/api/v1/km-readings/', {
    vehicle: ajeno.id,
    km_reading: 1,
    reading_date: todayIso(),
  })
  expect([400, 403, 404]).toContain(fuera.status())
  // Lo propio no se corrige ni se borra desde el campo.
  expect(
    (await patchJson(carlos, `/api/v1/km-readings/${id}/`, { km_reading: base + 30 })).status(),
  ).toBe(403)
  expect((await deleteReq(carlos, `/api/v1/km-readings/${id}/`)).status()).toBe(403)
})

test('consumo medio: por /add/ y no por el CRUD', async () => {
  const body = {
    vehicle: mio.id,
    avg_consumption: '6.4',
    reading_date: todayIso(),
    client_ref: 'e2e-fuel-1',
  }
  const first = await postJson(carlos, '/api/v1/fuel-consumptions/add/', body)
  expect(first.status(), await first.text()).toBe(201)
  const again = await postJson(carlos, '/api/v1/fuel-consumptions/add/', body)
  expect((await again.json()).id).toBe((await first.json()).id)
  expect((await postJson(carlos, '/api/v1/fuel-consumptions/', body)).status()).toBe(403)
})

// --- incidencia → solicitud de sustituto → decisión de gestión -------------

test('una avería con sustituto abre una solicitud que la gestión decide', async () => {
  const abierta = await postJson(carlos, '/api/v1/incidents/', {
    vehicle: mio.id,
    type: 'breakdown',
    description: 'No arranca en frío (e2e).',
    priority: 'critical',
    details: { availability: 'substitute' },
    client_ref: 'e2e-inc-sub',
  })
  expect(abierta.status(), await abierta.text()).toBe(201)
  const incidencia = await abierta.json()
  expect(incidencia.status).toBe('open')
  // Decir que queda parado no cambia el estado: eso es gestión.
  expect((await findVehicle(carlos, PLATES.carlos)).state).toBe('active')
  // La solicitud nace con la incidencia, pendiente, en la bandeja de gestión.
  const bandeja = rowsOf<{ id: number; incident: number | null; status: string }>(
    await (await admin.get('/api/v1/vehicle-requests/?status=pending&page_size=500')).json(),
  )
  const solicitud = bandeja.find((r) => r.incident === incidencia.id)
  expect(solicitud, 'la solicitud ligada a la incidencia').toBeTruthy()
  // El conductor la ve entre las suyas.
  const mias = (await (await carlos.get('/api/v1/vehicle-requests/mine/')).json()) as Array<{
    id: number
  }>
  expect(mias.map((r) => r.id)).toContain(solicitud!.id)
  // Lo que el conductor NO hace.
  expect(
    (
      await postJson(carlos, `/api/v1/incidents/${incidencia.id}/resolve/`, {
        resolution_date: todayIso(),
      })
    ).status(),
  ).toBe(403)
  expect(
    (await postJson(carlos, `/api/v1/vehicle-requests/${solicitud!.id}/reject/`, {})).status(),
  ).toBe(403)
  // La gestión rechaza la solicitud y cierra la incidencia.
  const rechazo = await postJson(admin, `/api/v1/vehicle-requests/${solicitud!.id}/reject/`, {})
  expect(rechazo.ok(), await rechazo.text()).toBeTruthy()
  expect((await rechazo.json()).status).toBe('rejected')
  const cierre = await postJson(admin, `/api/v1/incidents/${incidencia.id}/resolve/`, {
    resolution_date: todayIso(),
    observations: 'Cerrada por la prueba e2e',
  })
  expect(cierre.ok(), await cierre.text()).toBeTruthy()
  const cerrada = await (await admin.get(`/api/v1/incidents/${incidencia.id}/`)).json()
  expect(cerrada.status).toBe('closed')
})

// --- documentos: subir, ver, bajar, pedir y decidir ------------------------

test('el documento del campo: se sube, se ve, se baja, se pide borrar y gestión decide', async () => {
  const inc = await postJson(carlos, '/api/v1/incidents/', {
    vehicle: mio.id,
    type: 'breakdown',
    description: 'Golpe en la aleta (e2e).',
    client_ref: 'e2e-inc-doc',
  })
  expect(inc.status(), await inc.text()).toBe(201)
  const incidencia = await inc.json()

  const subida = await uploadDocument(carlos, {
    vehicle: mio.id,
    type: 'damage_photos',
    incident: incidencia.id,
    notes: 'Aleta delantera (e2e)',
  })
  expect(subida.status(), await subida.text()).toBe(201)
  const doc = await subida.json()

  // Lo que sube, lo ve y lo baja por el back (sin Drive), sin copia cacheada.
  const vista = await carlos.get(`/api/v1/documents/${doc.id}/preview/`)
  expect(vista.status()).toBe(200)
  expect(vista.headers()['content-type']).toContain('image/jpeg')
  expect(vista.headers()['cache-control']).toContain('no-store')
  const bajada = await carlos.get(`/api/v1/documents/${doc.id}/download/`)
  expect(bajada.headers()['content-disposition']).toMatch(/^attachment/)

  // Editar, borrar o verificar es de gestión.
  expect((await patchJson(carlos, `/api/v1/documents/${doc.id}/`, { notes: 'x' })).status()).toBe(
    403,
  )
  expect((await deleteReq(carlos, `/api/v1/documents/${doc.id}/`)).status()).toBe(403)
  expect((await postJson(carlos, '/api/v1/documents/verify/', { ids: [doc.id] })).status()).toBe(
    403,
  )
  // Las reglas de tipo: una factura sin nada a lo que acompañar, 400.
  const suelta = await uploadDocument(carlos, { vehicle: mio.id, type: 'workshop_invoice' })
  expect(suelta.status()).toBe(400)

  // La papelera del campo PIDE: una petición viva por documento.
  const pedida = await postJson(carlos, '/api/v1/document-deletion-requests/', {
    document: doc.id,
    reason: 'Foto repetida (e2e)',
  })
  expect(pedida.status(), await pedida.text()).toBe(201)
  const peticion = await pedida.json()
  expect(peticion.kind).toBe('delete')
  const marcado = rowsOf<{ id: number; deletion_pending: boolean }>(
    await (await carlos.get(`/api/v1/documents/?vehicle=${mio.id}&page_size=500`)).json(),
  ).find((d) => d.id === doc.id)
  expect(marcado?.deletion_pending).toBe(true)

  // Gestión la ve pendiente y la rechaza: el documento se queda y la marca se va.
  const pendientes = rowsOf<{ id: number }>(
    await (
      await admin.get('/api/v1/document-deletion-requests/?status=pending&page_size=500')
    ).json(),
  )
  expect(pendientes.map((p) => p.id)).toContain(peticion.id)
  const decision = await postJson(admin, `/api/v1/document-deletion-requests/${peticion.id}/resolve/`, {
    decision: 'reject',
    note: 'Se conserva (e2e)',
  })
  expect(decision.ok(), await decision.text()).toBeTruthy()
  const despues = rowsOf<{ id: number; deletion_pending: boolean }>(
    await (await carlos.get(`/api/v1/documents/?vehicle=${mio.id}&page_size=500`)).json(),
  ).find((d) => d.id === doc.id)
  expect(despues?.deletion_pending).toBe(false)

  // N7: la gestión lo borra → se desactiva, va a erratas y se restaura.
  expect((await deleteReq(admin, `/api/v1/documents/${doc.id}/`)).status()).toBe(204)
  const grupos = (await (await admin.get('/api/v1/erratas/')).json()) as Array<{
    type: string
    count: number
  }>
  const tipoDoc = grupos.find((g) => g.type.includes('document'))
  expect(tipoDoc, 'el grupo de documentos en erratas').toBeTruthy()
  expect(tipoDoc!.count).toBeGreaterThan(0)
  const restaurado = await postJson(admin, '/api/v1/erratas/restore/', {
    type: tipoDoc!.type,
    id: doc.id,
  })
  expect(restaurado.ok(), await restaurado.text()).toBeTruthy()
  expect((await admin.get(`/api/v1/documents/${doc.id}/`)).status()).toBe(200)
})

// --- la ficha personal se PIDE y la gestión la aplica ----------------------

test('corregir la ficha personal: el campo pide, la gestión aplica', async () => {
  // Es idempotente por persona: si el seed le deja una pendiente, el alta
  // devolvería ESA. Se despeja antes.
  const previas = rowsOf<{ id: number; user: number }>(
    await (await admin.get('/api/v1/profile-change-requests/?status=pending&page_size=500')).json(),
  )
  const yo = (await (await carlos.get('/api/v1/auth/me/')).json()).id as number
  for (const previa of previas.filter((p) => p.user === yo)) {
    const res = await postJson(admin, `/api/v1/profile-change-requests/${previa.id}/resolve/`, {
      decision: 'reject',
    })
    expect(res.ok(), await res.text()).toBeTruthy()
  }
  const pedida = await postJson(carlos, '/api/v1/profile-change-requests/', {
    changes: { phone: '600112233' },
    note: 'Teléfono nuevo (e2e)',
  })
  expect(pedida.status(), await pedida.text()).toBe(201)
  const peticion = await pedida.json()
  // Solo las suyas: sara no las lee aunque supervise.
  const deSara = rowsOf<{ id: number }>(
    await (await sara.get('/api/v1/profile-change-requests/?page_size=500')).json(),
  )
  expect(deSara.map((p) => p.id)).not.toContain(peticion.id)
  // Un campo que no se puede pedir, 400 con su nombre.
  const mala = await postJson(carlos, '/api/v1/profile-change-requests/', {
    changes: { username: 'otro' },
  })
  expect(mala.status()).toBe(400)
  // La gestión la aplica y la ficha cambia.
  const aplicada = await postJson(admin, `/api/v1/profile-change-requests/${peticion.id}/resolve/`, {
    decision: 'done',
  })
  expect(aplicada.ok(), await aplicada.text()).toBeTruthy()
  const me = await (await carlos.get('/api/v1/auth/me/')).json()
  expect(me.phone).toBe('600112233')
})

// --- alertas -------------------------------------------------------------

test('resolver una alerta es de gestión y deja de estar abierta', async () => {
  const escaparate = await findVehicle(admin, PLATES.showcase)
  const abiertas = rowsOf<{ id: number; type: string }>(
    await (
      await admin.get(`/api/v1/alerts/?status=open&vehicle=${escaparate.id}&page_size=500`)
    ).json(),
  )
  const seguro = abiertas.find((a) => a.type === 'insurance_due')
  expect(seguro, 'el seguro del escaparate').toBeTruthy()
  expect((await postJson(carlos, `/api/v1/alerts/${seguro!.id}/resolve/`, {})).status()).toBe(
    403,
  )
  const res = await postJson(admin, `/api/v1/alerts/${seguro!.id}/resolve/`, {
    note: 'Renovado (e2e)',
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  const ahora = await (await admin.get(`/api/v1/alerts/${seguro!.id}/`)).json()
  expect(ahora.status).toBe('resolved')
})

// --- catálogos: alta, baja lógica, restauración y purga --------------------

test('un catálogo: admin escribe, gestión solo lee, y nada se borra (N7)', async () => {
  expect((await postJson(sara, '/api/v1/brands/', { name: 'Marca E2E' })).status()).toBe(403)
  const alta = await postJson(admin, '/api/v1/brands/', { name: 'Marca E2E' })
  expect(alta.status(), await alta.text()).toBe(201)
  const marca = await alta.json()
  // Repetirla, 400 (único por nombre).
  expect((await postJson(admin, '/api/v1/brands/', { name: 'Marca E2E' })).status()).toBe(400)
  // La baja desactiva: desaparece del listado y sale con include_inactive.
  expect((await deleteReq(admin, `/api/v1/brands/${marca.id}/`)).status()).toBe(204)
  const activas = rowsOf<{ id: number }>(
    await (await admin.get('/api/v1/brands/?page_size=500')).json(),
  )
  expect(activas.map((b) => b.id)).not.toContain(marca.id)
  const todas = rowsOf<{ id: number; is_active: boolean }>(
    await (await admin.get('/api/v1/brands/?include_inactive=1&page_size=500')).json(),
  )
  expect(todas.find((b) => b.id === marca.id)?.is_active).toBe(false)
  // Erratas la lista y la restaura.
  const grupos = (await (await admin.get('/api/v1/erratas/')).json()) as Array<{ type: string }>
  const tipo = grupos.find((g) => g.type.includes('brand'))
  expect(tipo, 'el grupo de marcas en erratas').toBeTruthy()
  const items = await admin.get(`/api/v1/erratas/items/?type=${tipo!.type}&page_size=500`)
  expect(items.ok()).toBeTruthy()
  expect(rowsOf<{ id: number }>(await items.json()).map((i) => i.id)).toContain(marca.id)
  const restaurada = await postJson(admin, '/api/v1/erratas/restore/', {
    type: tipo!.type,
    id: marca.id,
  })
  expect(restaurada.ok(), await restaurada.text()).toBeTruthy()
  // Purgar es solo del superusuario: sara no, admin sí (tras volver a borrarla).
  expect((await deleteReq(admin, `/api/v1/brands/${marca.id}/`)).status()).toBe(204)
  expect(
    (await postJson(sara, '/api/v1/erratas/purge/', { type: tipo!.type, id: marca.id })).status(),
  ).toBe(403)
  // Purgar va en dos pasos: sin `confirm` solo informa de la cascada.
  const informe = await postJson(admin, '/api/v1/erratas/purge/', { type: tipo!.type, id: marca.id })
  expect(informe.ok(), await informe.text()).toBeTruthy()
  expect((await informe.json()).purged).toBe(false)
  expect((await admin.get(`/api/v1/brands/${marca.id}/?include_inactive=1`)).status()).toBe(200)
  const purga = await postJson(admin, '/api/v1/erratas/purge/', {
    type: tipo!.type,
    id: marca.id,
    confirm: true,
  })
  expect(purga.ok(), await purga.text()).toBeTruthy()
  expect((await purga.json()).purged).toBe(true)
  expect((await admin.get(`/api/v1/brands/${marca.id}/?include_inactive=1`)).status()).toBe(404)
})

// --- la ficha del vehículo: bloqueo optimista ------------------------------

test('el PATCH del vehículo con expected_updated_at viejo contesta 409', async () => {
  const ficha = await (await admin.get(`/api/v1/vehicles/${mio.id}/`)).json()
  const viejo = await patchJson(admin, `/api/v1/vehicles/${mio.id}/`, {
    year: ficha.year,
    expected_updated_at: '2000-01-01T00:00:00Z',
  })
  expect(viejo.status()).toBe(409)
  const bueno = await patchJson(admin, `/api/v1/vehicles/${mio.id}/`, {
    year: ficha.year,
    expected_updated_at: ficha.updated_at,
  })
  expect(bueno.status(), await bueno.text()).toBe(200)
})

// --- informes ----------------------------------------------------------

test('los informes salen en Excel y CSV, y un tipo desconocido es 400', async () => {
  const xlsx = await admin.get('/api/v1/reports/?kind=fleet&fmt=xlsx')
  expect(xlsx.status()).toBe(200)
  expect(xlsx.headers()['content-type']).toContain('spreadsheet')
  const csv = await admin.get('/api/v1/reports/?kind=fleet&fmt=csv')
  expect(csv.status()).toBe(200)
  expect(csv.headers()['content-type']).toContain('csv')
  expect((await admin.get('/api/v1/reports/?kind=no-existe')).status()).toBe(400)
  // El de usuarios es solo de admin.
  expect((await sara.get('/api/v1/reports/?kind=users&fmt=csv')).status()).toBe(403)
  // HSE baja el suyo y solo el suyo.
  expect((await hse.get('/api/v1/reports/?kind=hse&fmt=xlsx')).status()).toBe(200)
  expect((await hse.get('/api/v1/reports/?kind=fleet&fmt=xlsx')).status()).toBe(403)
})
