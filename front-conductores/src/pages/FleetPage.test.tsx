import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FleetPage } from './FleetPage.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  fetchVehicleSummaries: vi.fn(),
  remindVehicle: vi.fn(),
  createKmReading: vi.fn(),
  listMaintenancePlans: vi.fn(),
  markMaintenanceDone: vi.fn(),
  listIncidents: vi.fn(),
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
  remindVehicle: mocks.remindVehicle,
  createKmReading: mocks.createKmReading,
  listMaintenancePlans: mocks.listMaintenancePlans,
  markMaintenanceDone: mocks.markMaintenanceDone,
  listIncidents: mocks.listIncidents,
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
    mocks.listVehicles.mockResolvedValue({
      count: 3,
      results: [
        vehicle(1, '1111AAA'),
        vehicle(2, '2222BBB', 'maintenance', 'En taller'),
        vehicle(3, '3333CCC'),
      ],
    })
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

    // "Todos" + un grupo por estado presente, cada uno con su recuento.
    const filter = screen.getByRole('combobox', { name: 'Grupos de la flota' })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Todos (3)',
      'Activo (2)',
      'En taller (1)',
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
    expect(screen.getAllByRole('button', { name: 'Avería' }).length).toBe(3)
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

  it('el modal de actualización registra km, mantenimiento y partes en nombre del conductor', async () => {
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
    }
    mocks.listIncidents.mockResolvedValue({ count: 1, results: [incident] })
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
    await userEvent.click(screen.getAllByRole('button', { name: 'Actualizar datos' })[0])

    // El div informativo: la responsabilidad es del conductor, no del responsable.
    expect(screen.getByText(/responsabilidad de registrar los km/)).toBeInTheDocument()

    // Km: registra la lectura de hoy para ESTE coche.
    expect(screen.getByText('Última lectura: 1000 km · 10/8/2026')).toBeInTheDocument()
    const kmRow = screen.getByLabelText(/Lectura del cuentakilómetros/).closest('.update-km-row')
    expect(kmRow).toContainElement(screen.getByRole('button', { name: 'Registrar lectura' }))
    await userEvent.type(screen.getByLabelText(/Lectura del cuentakilómetros/), '4750')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar lectura' }))
    expect(mocks.createKmReading).toHaveBeenCalledWith(
      expect.objectContaining({ vehicle: 1, km_reading: 4750 }),
    )

    // Mantenimiento: lista los planes y "Realizado hoy" reancla y cierra alertas.
    await userEvent.click(screen.getByRole('tab', { name: 'Mantenimiento' }))
    expect(await screen.findByText('Revisión general')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Más información' }))
    expect(screen.getByText('Periodicidad')).toBeInTheDocument()
    expect(screen.getByText('Última realización')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Realizado en:' }))
    const dateDialog = screen.getByRole('dialog', { name: /Realizar mantenimiento/ })
    expect(within(dateDialog).getByRole('button', { name: 'Realizado hoy' })).toBeInTheDocument()
    fireEvent.change(within(dateDialog).getByLabelText('Fecha de realización'), {
      target: { value: '2026-08-24' },
    })
    await userEvent.click(within(dateDialog).getByRole('button', { name: 'Aceptar fecha' }))
    expect(mocks.markMaintenanceDone).toHaveBeenCalledWith(9, { date: '2026-08-24' })
    expect(await screen.findByText('Mantenimiento realizado el 24/8/2026.')).toBeInTheDocument()
    expect(await screen.findByText(/2 alertas resueltas/)).toBeInTheDocument()

    // El ciclo de la avería: fase 2 (ubicación preferente) y fase 3 (solución).
    await userEvent.click(screen.getByRole('tab', { name: 'Averías / Incidencias' }))
    expect(await screen.findByRole('button', { name: 'Ver' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gestión' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Solucionar' })).toBeInTheDocument()
    // El nav del modal sigue visible mientras se abre cada acción.
    expect(screen.getByRole('tab', { name: 'Km' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ver' }))
    const viewDialog = screen.getByRole('dialog', { name: 'Detalle · Avería' })
    expect(screen.getAllByText('No arranca.')).toHaveLength(2)
    await userEvent.click(within(viewDialog).getAllByRole('button', { name: 'Cerrar' })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Gestión' }))
    const manageDialog = screen.getByRole('dialog', { name: 'Gestión · Avería' })
    const preferredCp = within(manageDialog).getByLabelText('Código postal de la ubicación preferente')
    expect(within(manageDialog).queryByLabelText('Taller')).toBeNull()
    await userEvent.type(preferredCp, '28001')
    await userEvent.click(within(manageDialog).getByRole('button', { name: 'Guardar gestión' }))
    expect(mocks.manageIncident).toHaveBeenCalledWith(4, {
      workshop_postal_code: '28001',
    })
    expect(await screen.findByText(/queda en curso/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Solucionar' }))
    const resolveDialog = screen.getByRole('dialog', { name: 'Solución · Avería' })
    await userEvent.type(within(resolveDialog).getByLabelText('Tiempo parado (días)'), '3')
    await userEvent.click(within(resolveDialog).getByRole('button', { name: 'Cerrar incidencia' }))
    expect(mocks.resolveIncident).toHaveBeenCalledWith(4, { downtime_days: 3 })
    expect(await screen.findByText('Incidencia cerrada.')).toBeInTheDocument()
  })

  it('el botón Avería abre el modal en dos pasos y solo pide la ubicación preferente', async () => {
    mocks.createIncident.mockResolvedValue({ id: 30, vehicle: 1, type: 'breakdown' })
    renderPage()
    await screen.findByText('1111AAA')

    // La marca 🔧 de incidencias abiertas (el 2222BBB trae dos).
    expect(screen.getByTitle('2 incidencias abiertas')).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: 'Avería' })[0])
    expect(screen.getByText('Comunicar avería · 1111AAA')).toBeInTheDocument()
    // El coche viene decidido por la tarjeta: el selector va deshabilitado.
    const breakdownDialog = screen.getByRole('dialog', { name: 'Comunicar avería · 1111AAA' })
    expect(within(breakdownDialog).getByRole('combobox')).toBeDisabled()
    // En el primer paso no se comunica nada: se pasa a la gestión.
    expect(screen.queryByRole('button', { name: 'Comunicar avería' })).toBeNull()

    await userEvent.type(screen.getByLabelText('Descripción'), 'No arranca.')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    await screen.findByLabelText('Código postal de la ubicación preferente')
    expect(screen.queryByLabelText('Taller')).toBeNull()

    // "Atrás" vuelve al primer paso sin perder lo escrito.
    await userEvent.click(screen.getByRole('button', { name: 'Atrás' }))
    expect(screen.getByLabelText('Descripción')).toHaveValue('No arranca.')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(screen.getByRole('button', { name: 'Comunicar avería' })).toBeDisabled()
    expect(screen.queryByLabelText('Día y hora')).toBeNull()
    expect(screen.queryByLabelText('Coste (€)')).toBeNull()
    await userEvent.type(screen.getByLabelText('Código postal de la ubicación preferente'), '28001')
    await userEvent.click(screen.getByRole('button', { name: 'Comunicar avería' }))
    expect(mocks.createIncident).toHaveBeenCalledWith({
      vehicle: 1,
      type: 'breakdown',
      date: expect.any(String),
      description: 'No arranca.',
      workshop_postal_code: '28001',
    })
    expect(await screen.findByText('Avería comunicada.')).toBeInTheDocument()
  })

  it('el botón Incidencia abre el parte y después pasa a Gestión', async () => {
    mocks.createIncident.mockResolvedValue({ id: 31, vehicle: 1, type: 'general' })
    renderPage()
    await screen.findByText('1111AAA')

    await userEvent.click(screen.getAllByRole('button', { name: 'Incidencia' })[0])
    expect(screen.getByText('Incidencia · 1111AAA')).toBeInTheDocument()

    // Sin tipo (y sin descripción) no permite pasar a Gestión.
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Comunicar incidencia' })).toBeNull()

    // Cada tipo trae su div informativo.
    const kindSelect = screen.getByLabelText('Tipo')
    await userEvent.selectOptions(kindSelect, 'tires')
    expect(screen.getByText(/desgaste o pinchazo/)).toBeInTheDocument()
    await userEvent.selectOptions(kindSelect, 'maintenance')
    expect(screen.getByText(/no impiden conducir/)).toBeInTheDocument()
    await userEvent.selectOptions(kindSelect, 'general')
    expect(screen.getByText(/quizá no tienen que ver con el vehículo/)).toBeInTheDocument()

    await userEvent.type(
      screen.getByLabelText('Descripción'),
      'Necesito la tarjeta de combustible.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    const preferredCp = await screen.findByLabelText('Código postal de la ubicación preferente')
    expect(screen.queryByLabelText('Taller')).toBeNull()
    await userEvent.type(preferredCp, '28001')
    await userEvent.click(screen.getByRole('button', { name: 'Comunicar incidencia' }))
    expect(mocks.createIncident).toHaveBeenCalledWith({
      vehicle: 1,
      type: 'general',
      date: expect.any(String),
      description: 'Necesito la tarjeta de combustible.',
      workshop_postal_code: '28001',
    })
    expect(await screen.findByText('Incidencia comunicada.')).toBeInTheDocument()
  })

  it('Neumáticos usa los mismos campos y contrato guiado que Gestión', async () => {
    mocks.createIncident.mockResolvedValue({ id: 32, vehicle: 1, type: 'tires' })
    renderPage()
    await screen.findByText('1111AAA')
    await userEvent.click(screen.getAllByRole('button', { name: 'Incidencia' })[0])

    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'tires')
    // CP y fecha/hora ya no están en el parte inicial: viven en Gestión.
    expect(screen.queryByLabelText('Código postal del taller')).toBeNull()
    expect(screen.queryByLabelText('Fecha y hora de preferencia')).toBeNull()
    await userEvent.type(screen.getByLabelText('Kilometraje actual'), '45000')
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
    const preferredCp = await screen.findByLabelText('Código postal de la ubicación preferente')
    expect(screen.getByRole('button', { name: 'Comunicar incidencia' })).toBeDisabled()
    await userEvent.type(preferredCp, '28001')
    await userEvent.click(screen.getByRole('button', { name: 'Comunicar incidencia' }))

    expect(mocks.createIncident).toHaveBeenCalledWith({
      vehicle: 1,
      type: 'tires',
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
    })
  })

  it('la búsqueda recorta y el selector se recalcula sobre el recorte', async () => {
    renderPage()
    await screen.findByText('1111AAA')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar vehículo' }), '2222')
    // Solo queda el grupo del coche encontrado (y "Todos" con su nuevo total).
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Todos (1)',
      'En taller (1)',
    ])
    expect(screen.getByText('2222BBB')).toBeInTheDocument()
    expect(screen.queryByText('1111AAA')).not.toBeInTheDocument()
  })

  it('sin rol supervisor no existe: redirige fuera', async () => {
    mocks.roles = ['driver']
    renderPage()
    expect(screen.queryByText('Flota a cargo')).not.toBeInTheDocument()
    expect(mocks.listVehicles).not.toHaveBeenCalled()
  })
})
