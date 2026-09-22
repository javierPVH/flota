import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FleetPage } from './FleetPage.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  listVehiclesCached: vi.fn(),
  fetchVehicleSummaries: vi.fn(),
  remindVehicle: vi.fn(),
  createKmReading: vi.fn(),
  listMaintenancePlans: vi.fn(),
  markMaintenanceDone: vi.fn(),
  listIncidents: vi.fn(),
  // La página encabeza con «A tu cargo», que pide también las alertas.
  listAlerts: vi.fn(),
  listWorkshops: vi.fn(),
  manageIncident: vi.fn(),
  resolveIncident: vi.fn(),
  createIncident: vi.fn(),
  uploadDocument: vi.fn(),
  roles: ['driver', 'supervisor'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  fetchVehicleSummaries: mocks.fetchVehicleSummaries,
  // R3-28: los componentes leen las variantes cacheadas — sin TTL en el test.
  // El grupo (`listVehicles` con `supervisor`) y el ámbito personal completo
  // (`listVehiclesCached`) son consultas distintas: spies separados.
  listVehiclesCached: mocks.listVehiclesCached,
  fetchVehicleSummariesCached: mocks.fetchVehicleSummaries,
  remindVehicle: mocks.remindVehicle,
  createKmReading: mocks.createKmReading,
  listMaintenancePlans: mocks.listMaintenancePlans,
  markMaintenanceDone: mocks.markMaintenanceDone,
  listIncidents: mocks.listIncidents,
  listAlerts: mocks.listAlerts,
  listWorkshops: mocks.listWorkshops,
  manageIncident: mocks.manageIncident,
  resolveIncident: mocks.resolveIncident,
  createIncident: mocks.createIncident,
  uploadDocument: mocks.uploadDocument,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'sara', roles: mocks.roles } }),
}))

function vehicle(
  id: number,
  plate: string,
  state = 'active',
  stateDisplay = 'Activo',
  model = 'Sprinter',
) {
  return {
    id,
    plate,
    brand: 'Mercedes',
    model,
    state,
    state_display: stateDisplay,
    is_substitute: false,
    next_itv_date: null,
    supervisor_name: '',
  }
}

const summary = (id: number, extra: Record<string, unknown> = {}) => ({
  vehicle: id,
  km_current: 1000,
  km_reading_date: null,
  driver: { id: 40 + id, name: `Conductor ${id}` },
  ...extra,
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/flota']}>
      <LanguageProvider>
        <FleetPage />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('FleetPage (flota a cargo del supervisor)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.roles = ['driver', 'supervisor']
    const group = [
      vehicle(1, '1111AAA'),
      vehicle(2, '2222BBB', 'maintenance', 'En taller'),
      vehicle(3, '3333CCC'),
    ]
    mocks.listVehicles.mockResolvedValue({ count: 3, results: group })
    mocks.listAlerts.mockResolvedValue({ count: 0, results: [] })
    mocks.listIncidents.mockResolvedValue({ count: 0, results: [] })
    // El ámbito personal por defecto = el grupo (ninguno lo conduce el usuario,
    // así que no se añade ni marca ningún «Tu coche»): los casos base no cambian.
    mocks.listVehiclesCached.mockResolvedValue({ count: 3, results: group })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      // El 1111AAA lleva lectura reciente y proyección; los otros dos, nada.
      summary(1, {
        km_reading_date: '2026-08-10',
        next_maintenance_date: '2026-09-15',
        projection: {
          km_remaining: 8000,
          monthly_avg: 1200,
          contracted_rate: null,
          projected_end: 43000,
          pct_of_limit: 72.4,
          level: 'watch',
          overage_km: 0,
          estimated_penalty: null,
        },
      }),
      summary(2, { open_incidents: 2 }),
      summary(3),
    ])
    // Catálogo de talleres: la estación solo-ITV no vale para averías.
    mocks.listWorkshops.mockResolvedValue({
      count: 2,
      results: [
        { id: 1, name: 'Talleres Norte', kind: 'workshop', address: '', postal_code: '', phone: '' },
        { id: 2, name: 'ITV Sur', kind: 'itv', address: '', postal_code: '', phone: '' },
      ],
    })
  })

  it('agrupa por estado en un selector con recuento, y el selector corta la lista', async () => {
    renderPage()
    expect(await screen.findByText('Flota a cargo')).toBeInTheDocument()
    // El espacio de supervisor pide SOLO su grupo: los roles se suman y sin
    // el filtro un supervisor-admin vería aquí toda la flota.
    expect(mocks.listVehicles).toHaveBeenCalledWith({ supervisor: 1 })

    // Arriba lo que se mira a diario —los que ruedan, los que no y los
    // cubiertos por un sustituto—, un filete, y debajo el desglose por estado.
    const filter = screen.getByRole('combobox', { name: 'Grupos de la flota' })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Todos (3)',
      'Activo (2)',
      'No activos (1)',
      'Con coche de sustitución (0)',
      '──────────',
      'No activo - Mantenimiento (1)',
    ])
    expect(filter).toHaveValue('')
    expect(screen.getByText('1111AAA')).toBeInTheDocument()
    expect(screen.getByText('2222BBB')).toBeInTheDocument()

    // El selector corta la lista a su grupo.
    await userEvent.selectOptions(filter, 'maintenance')
    expect(filter).toHaveValue('maintenance')
    expect(screen.getByText('2222BBB')).toBeInTheDocument()
    expect(screen.queryByText('1111AAA')).not.toBeInTheDocument()
    expect(screen.queryByText('3333CCC')).not.toBeInTheDocument()

    // Y de vuelta a "Todos".
    await userEvent.selectOptions(filter, '')
    expect(screen.getByText('1111AAA')).toBeInTheDocument()
  })

  it('los dos cortes de arriba: lo que no rueda y lo que tiene sustituto', async () => {
    // El 3333CCC está parado sin causa con estado propio y al 1111AAA le cubre
    // un sustituto: un coche por corte, y ninguno es el otro.
    mocks.listVehicles.mockResolvedValue({
      count: 3,
      results: [
        vehicle(1, '1111AAA'),
        vehicle(2, '2222BBB', 'maintenance', 'En taller'),
        vehicle(3, '3333CCC', 'non_active', 'No activo sin justificación'),
      ],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      summary(1, {
        blocked_by_link: { substitute_id: 9, plate: '9999ZZZ', reason: 'breakdown', since: '2026-09-01' },
      }),
      summary(2),
      summary(3),
    ])
    renderPage()
    const filter = await screen.findByRole('combobox', { name: 'Grupos de la flota' })

    // «No activos» los agrupa a TODOS, sea cual sea la causa: el que está en
    // taller y el que está parado sin justificación.
    await userEvent.selectOptions(filter, screen.getByRole('option', { name: 'No activos (2)' }))
    expect(screen.getByText('2222BBB')).toBeInTheDocument()
    expect(screen.getByText('3333CCC')).toBeInTheDocument()
    expect(screen.queryByText('1111AAA')).not.toBeInTheDocument()

    // Y el otro corte no va del estado: va de tener quien te cubra.
    await userEvent.selectOptions(
      filter,
      screen.getByRole('option', { name: 'Con coche de sustitución (1)' }),
    )
    expect(screen.getByText('1111AAA')).toBeInTheDocument()
    expect(screen.queryByText('2222BBB')).not.toBeInTheDocument()

    // El filete no se puede elegir.
    expect(screen.getByRole('option', { name: '──────────' })).toBeDisabled()
  })

  it('cada tarjeta lleva conductor, última lectura y proyección; sin acceso a /grupo', async () => {
    renderPage()
    expect(await screen.findByText('Conductor 1')).toBeInTheDocument()

    // La proyección con su nivel y la fecha de la última lectura del cuenta-km.
    expect(screen.getByText('72% · A vigilar')).toBeInTheDocument()
    expect(screen.getByText('10/8/2026')).toBeInTheDocument()
    // Sin lectura se dice en claro; sin contrato no hay fila de proyección.
    expect(screen.getAllByText('Sin lectura').length).toBe(2)
    expect(screen.getAllByText('Proyección').length).toBe(1)

    // GAP-8: el próximo mantenimiento sale solo si hay plan anclado.
    expect(screen.getByText('Próx. mantenimiento')).toBeInTheDocument()
    expect(screen.getByText('15/9/2026')).toBeInTheDocument()

    // Altas de campo por tarjeta, con el coche ya preseleccionado.
    // Ese botón se llamaba «Avería» y ofrecía tres tipos suyos; ahora es
    // «Incidencia» con el catálogo de gestión, avería incluida.
    expect(screen.getAllByRole('button', { name: 'Incidencia' }).length).toBe(3)
    expect(screen.getAllByRole('button', { name: 'Accidente' }).length).toBe(3)

    // El acceso a la proyección del grupo vive en el bottom-nav, no aquí.
    expect(
      screen.queryByRole('link', { name: /Proyección de km del grupo/ }),
    ).not.toBeInTheDocument()
  })

  it('el botón de correo abre el modal y manda el recordatorio elegido', async () => {
    mocks.remindVehicle.mockResolvedValue({
      alert_created: true,
      email_sent: true,
      email_skipped: '',
    })
    renderPage()
    await screen.findByText('1111AAA')

    // Un botón de recordatorio por tarjeta; el primero es el del 1111AAA.
    await userEvent.click(screen.getAllByRole('button', { name: 'Enviar recordatorio' })[0])
    expect(screen.getByText('Recordatorio · 1111AAA')).toBeInTheDocument()
    expect(screen.getByText('Conductor: Conductor 1')).toBeInTheDocument()

    // Se elige el motivo (ITV) y se envía por los dos canales (por defecto).
    await userEvent.click(screen.getByRole('radio', { name: /ITV/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(mocks.remindVehicle).toHaveBeenCalledWith(1, {
      kind: 'itv_due',
      send_email: true,
      create_alert: true,
      message: '',
    })
    expect(await screen.findByText(/Alerta creada en la app\. Correo enviado\./)).toBeInTheDocument()
  })

  it('el modal personalizado solo actualiza mantenimiento en nombre del conductor', async () => {
    mocks.createKmReading.mockResolvedValue({})
    mocks.listMaintenancePlans.mockResolvedValue({
      count: 1,
      results: [
        {
          id: 9,
          vehicle: 1,
          vehicle_plate: '1111AAA',
          name: 'Revisión general',
          every_km: null,
          every_months: 12,
          last_done_date: '2026-01-10',
          last_done_km: null,
        },
      ],
    })
    mocks.markMaintenanceDone.mockResolvedValue({
      id: 9,
      vehicle: 1,
      vehicle_plate: '1111AAA',
      name: 'Revisión general',
      every_km: null,
      every_months: 12,
      last_done_date: '2026-08-25',
      last_done_km: null,
      alerts_resolved: 2,
    })
    const incident = {
      id: 4,
      vehicle: 1,
      type: 'breakdown',
      type_display: 'Avería',
      status: 'open',
      status_display: 'Abierta',
      date: '2026-08-20',
      description: 'No arranca.',
      details: {},
      cost: null,
      // La urgencia con la que se abrió: la pestaña la pinta y ordena por ella.
      priority: 'critical',
      priority_display: 'Crítica',
    }
    // Una segunda, MENOS urgente y más reciente: sirve para ver que manda la
    // prioridad sobre la fecha y que con dos filas aparece la barra de filtro.
    const menor = {
      ...incident,
      id: 5,
      type: 'maintenance',
      type_display: 'Mantenimiento puntual',
      date: '2026-08-28',
      description: 'Escobillas gastadas.',
      priority: 'informative',
      priority_display: 'Informativa',
    }
    mocks.listIncidents.mockResolvedValue({ count: 2, results: [menor, incident] })
    mocks.manageIncident.mockResolvedValue({
      ...incident,
      status: 'on_going',
      status_display: 'En curso',
      details: { management: { workshop: 'Talleres Norte' } },
      cost: '180.50',
    })
    mocks.resolveIncident.mockResolvedValue({ ...incident, status: 'closed' })

    renderPage()
    await screen.findByText('1111AAA')
    await userEvent.click(screen.getAllByRole('button', { name: 'Actualizar mantenimiento' })[0])

    // El div informativo: la responsabilidad es del conductor, no del responsable.
    expect(screen.getByText(/responsabilidad de registrar los km/)).toBeInTheDocument()
    expect(await screen.findByRole('dialog', { name: 'Actualizar · 1111AAA' })).toBeInTheDocument()

    // UNA ventana con una pestaña por cosa que actualizar, y solo las que ese
    // coche TIENE: sin ITV programada, no hay pestaña de ITV. Ninguna de
    // «Alertas»: cada alerta se cierra haciendo lo suyo en su pestaña.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Km',
      'Combustible',
      'Mantenimiento',
      // La chapa dice cuántas hay abiertas sin entrar en la pestaña.
      'Incidencias2',
    ])
    // Se abre por la que se pidió al abrirla.
    expect(screen.getByRole('tab', { name: 'Mantenimiento' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // La pestaña del mantenimiento lista los planes y registra su fecha.
    expect(await screen.findByText('Revisión general')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalles' }))
    expect(screen.getByText('Periodicidad')).toBeInTheDocument()
    expect(screen.getByText('Última realización')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como realizado' }))
    const dateDialog = screen.getByRole('dialog', { name: /Cuándo se hizo/ })
    expect(within(dateDialog).getByRole('button', { name: 'Hoy' })).toBeInTheDocument()
    fireEvent.change(within(dateDialog).getByLabelText(/Fecha de realización/), {
      target: { value: '2026-08-24' },
    })
    await userEvent.click(within(dateDialog).getByRole('button', { name: 'Marcar como realizado' }))
    expect(mocks.markMaintenanceDone).toHaveBeenCalledWith(9, { date: '2026-08-24' })
    expect(await screen.findByText('Mantenimiento realizado el 24/8/2026.')).toBeInTheDocument()
    expect(await screen.findByText(/2 alertas resueltas/)).toBeInTheDocument()

    // Y las otras pestañas son los MISMOS formularios que sus ventanas
    // sueltas: la de km pide la lectura y la de incidencias lista lo abierto.
    await userEvent.click(screen.getByRole('tab', { name: 'Km' }))
    expect(screen.getByLabelText(/Odómetro|Lectura/)).toBeInTheDocument()
    // Y la fila se recorre con las flechas, como cualquier `tablist` (con el
    // foco en la pestaña: al entrar en «Km» se lo lleva el campo del odómetro).
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Km' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Combustible' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await userEvent.click(screen.getByRole('tab', { name: 'Incidencias' }))
    // Dentro del diálogo: «Avería» es también una opción del filtro por tipo.
    const modal = screen.getByRole('dialog', { name: 'Actualizar · 1111AAA' })
    // La prioridad SALE (chapa) y se lee en el color de la fila; lo crítico va
    // primero aunque sea lo más antiguo, que es para lo que se marca.
    const filas = within(modal).getAllByRole('listitem')
    expect(filas).toHaveLength(2)
    expect(filas[0]).toHaveTextContent('Avería')
    expect(filas[0]).toHaveTextContent(/No arranca/)
    expect(filas[0]).toHaveTextContent('Crítica')
    expect(filas[0].className).toContain('pri-critical')
    expect(filas[1]).toHaveTextContent('Informativa')
    expect(filas[1].className).toContain('pri-informative')

    // Y con dos filas la lista se puede acotar.
    await userEvent.type(within(modal).getByRole('searchbox', { name: 'Buscar' }), 'escobillas')
    const queda = within(modal).getAllByRole('listitem')
    expect(queda).toHaveLength(1)
    expect(queda[0]).toHaveTextContent('Mantenimiento puntual')

    // El aviso se puede callar con su X, y se queda callado el resto de la
    // sesión (no del dispositivo: es un recordatorio de responsabilidad).
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar el aviso en esta sesión' }))
    expect(screen.queryByText(/responsabilidad de registrar los km/)).not.toBeInTheDocument()
    expect(sessionStorage.getItem('flota:update-notice-hidden')).toBe('1')

    // Y en su hueco queda el icono que lo devuelve: cerrado no es perdido.
    await userEvent.click(screen.getByRole('button', { name: 'Ver el aviso de responsabilidad' }))
    expect(screen.getByText(/responsabilidad de registrar los km/)).toBeInTheDocument()
    expect(sessionStorage.getItem('flota:update-notice-hidden')).toBeNull()
  })

  it('el botón Incidencia abre el modal por pasos y solo pide la ubicación preferente', async () => {
    mocks.createIncident.mockResolvedValue({ id: 30, vehicle: 1, type: 'general' })
    renderPage()
    await screen.findByText('1111AAA')

    // La marca 🔧 de averías abiertas (el 2222BBB trae dos).
    expect(screen.getByTitle('2 incidencias abiertas')).toHaveTextContent('Incidencia 2')

    await userEvent.click(screen.getAllByRole('button', { name: 'Incidencia' })[0])
    expect(screen.getByText('Comunicar incidencia · 1111AAA')).toBeInTheDocument()
    const breakdownDialog = screen.getByRole('dialog', { name: 'Comunicar incidencia · 1111AAA' })
    const typeSelect = within(breakdownDialog).getByLabelText('Tipo')
    // El catálogo es el MISMO que el de gestión («Nuevo estado»), en su orden:
    // el campo y la oficina tienen que llamar igual a lo que se comunica.
    expect(typeSelect).toHaveValue('breakdown')
    expect(within(typeSelect).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Mantenimiento puntual', 'Cambio de neumáticos', 'Avería', 'Petición general',
    ])
    // En el primer paso no se comunica nada: se pasa a la gestión.
    expect(screen.queryByRole('button', { name: 'Comunicar incidencia' })).toBeNull()

    await userEvent.type(screen.getByLabelText('Descripción'), 'No arranca.')
    // La prioridad la marca quien abre la petición, en el primer paso.
    await userEvent.selectOptions(screen.getByLabelText('Prioridad'), 'critical')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // Segundo paso (avería y mantenimiento): cómo queda el coche. Nace «sigue
    // en servicio» — una avería no lo para por sí sola — y se pasa de largo.
    expect(await screen.findByRole('radio', { name: /Sigue en servicio/ })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // Tercero: los documentos, que aquí son opcionales — se pasa de largo.
    expect(await screen.findByText(/fotos del daño/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    await screen.findByLabelText('Código postal de la ubicación preferente')
    expect(screen.queryByLabelText('Taller')).toBeNull()

    // "Atrás" vuelve paso a paso sin perder lo escrito.
    await userEvent.click(screen.getByRole('button', { name: 'Atrás' }))
    await userEvent.click(screen.getByRole('button', { name: 'Atrás' }))
    await userEvent.click(screen.getByRole('button', { name: 'Atrás' }))
    expect(screen.getByLabelText('Descripción')).toHaveValue('No arranca.')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(screen.getByRole('button', { name: 'Comunicar incidencia' })).toBeDisabled()
    expect(screen.queryByLabelText('Día y hora')).toBeNull()
    expect(screen.queryByLabelText('Coste (€)')).toBeNull()
    await userEvent.type(screen.getByLabelText('Código postal de la ubicación preferente'), '28001')
    await userEvent.click(screen.getByRole('button', { name: 'Comunicar incidencia' }))
    expect(mocks.createIncident).toHaveBeenCalledWith({
      vehicle: 1,
      type: 'breakdown',
      priority: 'critical',
      date: expect.any(String),
      description: 'No arranca.',
      workshop_postal_code: '28001',
      // Lo que dice el conductor de cómo queda el coche viaja en el parte; el
      // estado del vehículo NO lo toca esto (lo decide la gestión).
      details: { availability: 'active' },
      client_ref: expect.any(String),
    })
    expect(await screen.findByText('Incidencia comunicada.')).toBeInTheDocument()
  })

  it('pedir coche de sustitución EXIGE adjuntar algo y deja la solicitud en administración', async () => {
    mocks.createIncident.mockResolvedValue({ id: 34, vehicle: 1, type: 'breakdown' })
    mocks.uploadDocument.mockResolvedValue({ id: 71 })
    renderPage()
    await screen.findByText('1111AAA')
    await userEvent.click(screen.getAllByRole('button', { name: 'Incidencia' })[0])

    await userEvent.type(screen.getByLabelText('Descripción'), 'Se ha parado en ruta.')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(await screen.findByRole('radio', { name: /Necesito coche de sustitución/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    // Es lo ÚNICO que se le exige: sin documento no se pasa del paso.
    expect(await screen.findByText(/hay que adjuntar al menos un documento/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    await userEvent.upload(
      screen.getByLabelText('Adjuntar documento o foto (opcional)'),
      new File(['1'], 'parte.pdf', { type: 'application/pdf' }),
    )
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    await userEvent.type(
      await screen.findByLabelText('Código postal de la ubicación preferente'),
      '28001',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Comunicar incidencia' }))

    expect(mocks.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'breakdown', details: { availability: 'substitute' } }),
    )
    // Solo el justificante: la caja del coche de sustitución se queda vacía
    // porque al comunicarlo aún no hay coche.
    expect(mocks.uploadDocument).toHaveBeenCalledTimes(1)
    // La solicitud de coche la abre el BACK con el parte (una sola llamada, y
    // así el parte encolado sin cobertura la arrastra al reenviarse).
    expect(await screen.findByText(/queda pendiente de administración/)).toBeInTheDocument()
  })

  it('si ya le han dado un coche de sustitución, sube su documentación aparte', async () => {
    mocks.createIncident.mockResolvedValue({ id: 35, vehicle: 1, type: 'breakdown' })
    mocks.uploadDocument.mockResolvedValue({ id: 72 })
    renderPage()
    await screen.findByText('1111AAA')
    await userEvent.click(screen.getAllByRole('button', { name: 'Incidencia' })[0])

    await userEvent.type(screen.getByLabelText('Descripción'), 'Se ha parado en ruta.')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(await screen.findByRole('radio', { name: /Necesito coche de sustitución/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    await userEvent.upload(
      await screen.findByLabelText('Adjuntar documento o foto (opcional)'),
      new File(['1'], 'parte.pdf', { type: 'application/pdf' }),
    )
    // Caja aparte, y VARIOS papeles: el permiso y la ficha del coche prestado.
    const substitute = screen.getByLabelText('Adjuntar documentación del coche de sustitución')
    await userEvent.upload(substitute, new File(['2'], 'permiso.pdf', { type: 'application/pdf' }))
    await userEvent.upload(substitute, new File(['3'], 'ficha.pdf', { type: 'application/pdf' }))
    expect(screen.getByText('permiso.pdf')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.type(
      await screen.findByLabelText('Código postal de la ubicación preferente'),
      '28001',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Comunicar incidencia' }))

    await waitFor(() => expect(mocks.uploadDocument).toHaveBeenCalledTimes(3))
    // El justificante es del coche averiado; los del prestado van como «Otro»
    // y con su nota (el sustituto puede no estar todavía en la flota).
    expect(mocks.uploadDocument.mock.calls[0][0]).toMatchObject({ type: 'damage_photos' })
    expect(mocks.uploadDocument.mock.calls[1][0]).toMatchObject({
      vehicle: 1,
      incident: 35,
      type: 'other',
      notes: 'Documentación del coche de sustitución facilitado al conductor.',
    })
    expect(mocks.uploadDocument.mock.calls[2][1].name).toBe('ficha.pdf')
  })

  it('sin pedir coche de sustitución, esa caja no existe', async () => {
    renderPage()
    await screen.findByText('1111AAA')
    await userEvent.click(screen.getAllByRole('button', { name: 'Incidencia' })[0])

    await userEvent.type(screen.getByLabelText('Descripción'), 'Ruido raro.')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Continuar' }))

    expect(await screen.findByLabelText('Adjuntar documento o foto (opcional)')).toBeInTheDocument()
    expect(
      screen.queryByLabelText('Adjuntar documentación del coche de sustitución'),
    ).not.toBeInTheDocument()
  })

  it('Incidencia permite registrar un mantenimiento puntual y después pasa a Gestión', async () => {
    mocks.createIncident.mockResolvedValue({ id: 31, vehicle: 1, type: 'general' })
    renderPage()
    await screen.findByText('1111AAA')

    await userEvent.click(screen.getAllByRole('button', { name: 'Incidencia' })[0])
    expect(screen.getByText('Comunicar incidencia · 1111AAA')).toBeInTheDocument()

    // Avería es el tipo predeterminado; sin descripción no permite continuar.
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Comunicar incidencia' })).toBeNull()

    // Cada tipo trae su div informativo.
    const kindSelect = screen.getByLabelText('Tipo')
    await userEvent.selectOptions(kindSelect, 'maintenance')
    expect(screen.getByText(/no impiden conducir/)).toBeInTheDocument()

    await userEvent.type(
      screen.getByLabelText('Descripción'),
      'Instalar una baliza adicional.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    // El mantenimiento puntual también pregunta cómo queda el coche.
    expect(await screen.findByRole('radio', { name: /Sigue en servicio/ })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    const preferredCp = await screen.findByLabelText('Código postal de la ubicación preferente')
    expect(screen.queryByLabelText('Taller')).toBeNull()
    await userEvent.type(preferredCp, '28001')
    await userEvent.click(screen.getByRole('button', { name: 'Comunicar incidencia' }))
    expect(mocks.createIncident).toHaveBeenCalledWith({
      vehicle: 1,
      type: 'maintenance',
      priority: 'moderate',
      date: expect.any(String),
      description: 'Instalar una baliza adicional.',
      workshop_postal_code: '28001',
      details: { availability: 'active' },
      client_ref: expect.any(String),
    })
    expect(await screen.findByText('Incidencia comunicada.')).toBeInTheDocument()
  })

  it('Neumáticos usa los mismos campos y contrato guiado que Gestión', async () => {
    mocks.createIncident.mockResolvedValue({ id: 32, vehicle: 1, type: 'tires' })
    renderPage()
    await screen.findByText('1111AAA')
    await userEvent.click(screen.getAllByRole('button', { name: 'Incidencia' })[0])

    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'tires')
    // El parte de neumáticos tiene su PROPIO paso: en el primero no está (eran
    // diez campos seguidos), y como su comentario es opcional, se pasa sin más.
    expect(screen.queryByLabelText('Kilometraje actual')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(await screen.findByText(/Obligatorios para continuar/)).toBeInTheDocument()

    // CP y fecha/hora ya no están en el parte inicial: viven en Gestión.
    expect(screen.queryByLabelText('Código postal del taller')).toBeNull()
    expect(screen.queryByLabelText('Fecha y hora de preferencia')).toBeNull()
    // El odómetro viene PRECARGADO con la última lectura conocida del coche
    // (y se dice de dónde sale); el conductor lo corrige si ha rodado más.
    const mileage = screen.getByLabelText('Kilometraje actual')
    expect(mileage).toHaveValue(1000)
    expect(screen.getByText(/Última lectura conocida/)).toBeInTheDocument()
    await userEvent.clear(mileage)
    await userEvent.type(mileage, '45000')
    // En desgaste, selector y primera medida comparten fila.
    await userEvent.selectOptions(screen.getByLabelText('Motivo del cambio'), 'wear')
    expect(screen.getByLabelText('¿Qué ruedas?').closest('.incident-grid')).toContainElement(
      screen.getByLabelText('Medidas delanteras'),
    )
    await userEvent.selectOptions(screen.getByLabelText('Motivo del cambio'), 'puncture')
    await userEvent.selectOptions(screen.getByLabelText('¿Qué rueda?'), 'front_left')
    await userEvent.type(screen.getByLabelText('Medidas del neumático'), '205/55 R16')
    await userEvent.type(screen.getByLabelText('Comentario'), 'Rueda pinchada en obra')
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    const preferredCp = await screen.findByLabelText('Código postal de la ubicación preferente')
    expect(screen.getByRole('button', { name: 'Comunicar incidencia' })).toBeDisabled()
    await userEvent.type(preferredCp, '28001')
    await userEvent.click(screen.getByRole('button', { name: 'Comunicar incidencia' }))

    expect(mocks.createIncident).toHaveBeenCalledWith({
      vehicle: 1,
      type: 'tires',
      priority: 'moderate',
      date: expect.any(String),
      description: 'Rueda pinchada en obra',
      mileage: 45000,
      workshop_postal_code: '28001',
      details: {
        report_version: 1,
        change_reason: 'puncture',
        wheel: 'front_left',
        tire_measure: '205/55 R16',
      },
      client_ref: expect.any(String),
    })
    // Los neumáticos no preguntan disponibilidad: su paso propio es el parte.
    expect(screen.queryByRole('radio', { name: /coche de sustitución/ })).toBeNull()
  })

  it('el paso Documentos admite varios adjuntos y se puede quitar uno antes de enviar', async () => {
    mocks.createIncident.mockResolvedValue({ id: 33, vehicle: 1, type: 'general' })
    mocks.uploadDocument.mockResolvedValue({ id: 70 })
    renderPage()
    await screen.findByText('1111AAA')
    await userEvent.click(screen.getAllByRole('button', { name: 'Incidencia' })[0])

    await userEvent.type(screen.getByLabelText('Descripción'), 'Golpe en el paragolpes.')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    // Disponibilidad (el tipo por defecto es avería): se pasa sin tocarla.
    await userEvent.click(await screen.findByRole('button', { name: 'Continuar' }))

    // Dos archivos en dos tandas: el segundo SE SUMA al ya elegido (la foto del
    // daño y el presupuesto del taller no se eligen a la vez).
    const picker = await screen.findByLabelText('Adjuntar documento o foto (opcional)')
    await userEvent.upload(picker, new File(['1'], 'golpe.jpg', { type: 'image/jpeg' }))
    await userEvent.upload(picker, new File(['2'], 'presupuesto.pdf', { type: 'application/pdf' }))
    expect(screen.getByText('golpe.jpg')).toBeInTheDocument()
    expect(screen.getByText('2 archivos seleccionados')).toBeInTheDocument()

    // Quitar uno deja el otro donde estaba.
    await userEvent.click(screen.getByRole('button', { name: 'Quitar golpe.jpg' }))
    expect(screen.queryByText('golpe.jpg')).not.toBeInTheDocument()
    expect(screen.getByText('1 archivo seleccionado')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.type(screen.getByLabelText('Código postal de la ubicación preferente'), '28001')
    await userEvent.click(screen.getByRole('button', { name: 'Comunicar incidencia' }))

    expect(await screen.findByText('Incidencia comunicada.')).toBeInTheDocument()
    // Solo el que quedaba, ligado a la incidencia recién creada y archivado
    // como el alta de la PWA: donde hay daño, «Fotos de daños».
    expect(mocks.uploadDocument).toHaveBeenCalledTimes(1)
    expect(mocks.uploadDocument).toHaveBeenCalledWith(
      { vehicle: 1, incident: 33, type: 'damage_photos', client_ref: expect.any(String) },
      expect.objectContaining({ name: 'presupuesto.pdf' }),
    )
  })

  it('la búsqueda recorta y el selector se recalcula sobre el recorte', async () => {
    renderPage()
    await screen.findByText('1111AAA')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar vehículo' }), '2222')
    // Solo queda el grupo del coche encontrado, y todos los recuentos se
    // recalculan sobre el recorte. Los dos cortes de arriba siguen ahí aunque
    // se queden a cero: son fijos, y un menú que cambia de opciones mientras
    // tecleas se lee peor que un cero.
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Todos (1)',
      'No activos (1)',
      'Con coche de sustitución (0)',
      '──────────',
      'No activo - Mantenimiento (1)',
    ])
    expect(screen.getByText('2222BBB')).toBeInTheDocument()
    expect(screen.queryByText('1111AAA')).not.toBeInTheDocument()
  })

  it('marca «Tu coche» el vehículo de la flota que conduce el propio supervisor', async () => {
    // El supervisor (id 1) conduce el 1111AAA, que además está en su grupo.
    mocks.fetchVehicleSummaries.mockResolvedValue([
      summary(1, { driver: { id: 1, name: 'Sara' } }),
      summary(2),
      summary(3),
    ])
    renderPage()
    await screen.findByText('1111AAA')

    // La chapa «Tu coche» aparece una sola vez y en la tarjeta del 1111AAA.
    expect(screen.getAllByText('Tu coche')).toHaveLength(1)
    const card = screen.getByText('1111AAA').closest('.card')
    expect(card).toHaveClass('card-own')
    expect(within(card as HTMLElement).getByText('Tu coche')).toBeInTheDocument()
    // Los coches del equipo (que conducen otros) NO llevan la marca.
    const other = screen.getByText('2222BBB').closest('.card')
    expect(other).not.toHaveClass('card-own')
  })

  it('añade a la flota el coche propio aunque lo supervise otra persona', async () => {
    // El grupo que superviso trae solo el 2222BBB…
    mocks.listVehicles.mockResolvedValue({ count: 1, results: [vehicle(2, '2222BBB')] })
    // …pero mi ámbito personal completo incluye mi 9999ZZZ (lo conduzco yo).
    mocks.listVehiclesCached.mockResolvedValue({
      count: 2,
      results: [vehicle(2, '2222BBB'), vehicle(9, '9999ZZZ')],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      summary(2),
      summary(9, { driver: { id: 1, name: 'Sara' } }),
    ])
    renderPage()

    // Mi coche aparece en la flota aunque no lo supervise, y va marcado.
    expect(await screen.findByText('9999ZZZ')).toBeInTheDocument()
    const card = screen.getByText('9999ZZZ').closest('.card')
    expect(card).toHaveClass('card-own')
    expect(within(card as HTMLElement).getByText('Tu coche')).toBeInTheDocument()
  })

  it('sin rol supervisor no existe: redirige fuera', async () => {
    mocks.roles = ['driver']
    renderPage()
    expect(screen.queryByText('Flota a cargo')).not.toBeInTheDocument()
    expect(mocks.listVehicles).not.toHaveBeenCalled()
  })
})
