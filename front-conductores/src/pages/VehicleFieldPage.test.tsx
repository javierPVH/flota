// IndexedDB no existe en jsdom: fake-indexeddb lo aporta ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  fetchVehicle: vi.fn(),
  fetchVehicleSummary: vi.fn(),
  fetchKmWindow: vi.fn(),
  listDocuments: vi.fn(),
  listIncidents: vi.fn(),
  listAlerts: vi.fn(),
  listKmReadings: vi.fn(),
  listDriverCandidates: vi.fn(),
  scheduleItv: vi.fn(),
  listMaintenancePrograms: vi.fn(),
  createMaintenancePlan: vi.fn(),
  listMaintenancePlans: vi.fn(),
  uploadDocument: vi.fn(),
  createKmReading: vi.fn(),
  resolveIncident: vi.fn(),
  roles: ['driver', 'supervisor'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  fetchVehicle: mocks.fetchVehicle,
  fetchVehicleSummary: mocks.fetchVehicleSummary,
  fetchKmWindow: mocks.fetchKmWindow,
  listDocuments: mocks.listDocuments,
  listIncidents: mocks.listIncidents,
  listAlerts: mocks.listAlerts,
  listKmReadings: mocks.listKmReadings,
  listDriverCandidates: mocks.listDriverCandidates,
  scheduleItv: mocks.scheduleItv,
  listMaintenancePrograms: mocks.listMaintenancePrograms,
  createMaintenancePlan: mocks.createMaintenancePlan,
  listMaintenancePlans: mocks.listMaintenancePlans,
  uploadDocument: mocks.uploadDocument,
  createKmReading: mocks.createKmReading,
  resolveIncident: mocks.resolveIncident,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'sara', roles: mocks.roles } }),
}))

import { VehicleFieldPage } from './VehicleFieldPage.tsx'
import { FleetModeContext } from '../fleetMode.ts'
import { LanguageProvider } from '../i18n.tsx'

const VEHICLE = {
  id: 1,
  plate: '1234KLM',
  brand: 'Mercedes',
  model: 'Sprinter',
  year: 2022,
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  next_itv_date: '2026-09-30',
  supervisor_name: 'Sara S',
  business_use: '',
}

const SUMMARY = {
  vehicle: 1,
  plate: '1234KLM',
  state: 'active',
  next_itv_date: '2026-09-30',
  next_maintenance_date: '2026-09-15',
  unlimited_km: false,
  is_substitute: false,
  blocked_by_link: null,
  substituting_for: null,
  km_current: 4679,
  km_reading_date: '2026-07-26',
  km_driven: 31000,
  driver: { id: 5, name: 'Carlos C' },
  contract: {
    id: 1,
    month_fee: null,
    contract_km: 50000,
    contract_time: null,
    penalty_per_km: null,
    start_date: '2026-01-01',
    planned_end_date: '2026-12-31',
  },
  projection: {
    km_remaining: 19000,
    monthly_avg: 4000,
    contracted_rate: null,
    projected_end: 62000,
    pct_of_limit: 72.4,
    level: 'watch',
    overage_km: 0,
    estimated_penalty: null,
  },
}

/** La alerta de exceso ABIERTA del coche: lo que pone «Resolver» en la
 * tarjeta de proyección —no el nivel de la barra—. */
const OVERAGE_ALERT = {
  id: 91,
  type: 'km_overage',
  type_display: 'Exceso de km proyectado',
  level: 'warning',
  level_display: 'Aviso',
  status: 'open',
  status_display: 'Abierta',
  message: 'Proyección 62000 km supera los 50000 km contratados (124%).',
  message_code: 'km_overage',
  message_args: { projected: 62000, contracted: 50000, pct: 124 },
  vehicle: 1,
  vehicle_plate: '1234KLM',
  user: null,
  due_date: '2026-12-31',
  created_at: '2026-09-01T08:00:00Z',
  resolved_at: null,
  resolved_by: null,
  resolved_by_name: '',
  note: '',
}

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/vehiculos/1']}>
        <Routes>
          <Route path="/vehiculos/:id" element={<VehicleFieldPage />} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  )
}

/** Como el shell real: la ficha cuelga de un Outlet con el modo y la pareja.
 *
 * El modo viaja por DOS sitios, igual que en el `Layout`: el contexto del
 * Outlet (lo lee la página) y `FleetModeContext` (lo leen los componentes que
 * sirven a las dos vistas y los modales del nav, que viven fuera del Outlet).
 * Sin el segundo, aquí todo se pintaba siempre en modo «Flota». */
function renderWithMode(ctx: {
  fleetMode: boolean
  ownPair: { ids: number[]; target: number | null }
}) {
  return render(
    <LanguageProvider>
      <FleetModeContext.Provider value={ctx.fleetMode}>
        <MemoryRouter initialEntries={['/vehiculos/1']}>
          <Routes>
            <Route element={<Outlet context={{ ...ctx, setFleetMode: () => {} }} />}>
              <Route path="/vehiculos/:id" element={<VehicleFieldPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </FleetModeContext.Provider>
    </LanguageProvider>,
  )
}

describe('VehicleFieldPage (ficha de campo)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.roles = ['driver', 'supervisor']
    mocks.fetchVehicle.mockResolvedValue(VEHICLE)
    mocks.fetchVehicleSummary.mockResolvedValue(SUMMARY)
    // N8a: ventana del 20 a fin de mes → el mejor día para registrar es el 31.
    mocks.fetchKmWindow.mockResolvedValue({
      open: true,
      enabled: true,
      start_day: 20,
      last_day: 31,
      today: '2026-08-28',
      admin_exempt: false,
    })
    mocks.listDocuments.mockResolvedValue({ count: 0, results: [] })
    mocks.listIncidents.mockResolvedValue({ count: 0, results: [] })
    mocks.listAlerts.mockResolvedValue({ count: 0, results: [] })
    mocks.listKmReadings.mockResolvedValue({ count: 0, results: [] })
    mocks.listDriverCandidates.mockResolvedValue([])
    mocks.scheduleItv.mockResolvedValue({ ...VEHICLE, next_itv_date: '2027-03-01' })
    mocks.listMaintenancePrograms.mockResolvedValue({
      count: 1,
      results: [
        {
          id: 4,
          name: 'Revisión anual',
          every_km: 30000,
          every_months: 12,
          cycle_label: '30000 km / 12 meses',
          notes: '',
        },
      ],
    })
    mocks.createMaintenancePlan.mockResolvedValue({ id: 8, vehicle: 1, name: 'Revisión anual' })
    mocks.listMaintenancePlans.mockResolvedValue({ count: 0, results: [] })
    mocks.uploadDocument.mockResolvedValue({ id: 7, status: 'archived' })
    mocks.createKmReading.mockResolvedValue({ id: 20, vehicle: 1, km_reading: 5000, reading_date: '2026-08-27' })
  })

  it('quien supervisa cita la ITV desde la ficha', async () => {
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(screen.getByRole('button', { name: 'Programar ITV' }))
    const dialog = await screen.findByRole('dialog', { name: 'Programar ITV · 1234KLM' })
    // La cita que ya tiene se lee ahí: esto la CORRIGE, no añade otra.
    expect(dialog).toHaveTextContent(/Ahora está citada el 30\/9\/2026/)

    fireEvent.change(within(dialog).getByLabelText('Fecha de la ITV'), {
      target: { value: '2027-03-01' },
    })
    await userEvent.type(within(dialog).getByLabelText('CP preferente'), '28100')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Programar' }))

    await waitFor(() =>
      expect(mocks.scheduleItv).toHaveBeenCalledWith(1, {
        date: '2027-03-01',
        postal_code: '28100',
      }),
    )
  })

  it('y programa el mantenimiento con un programa del catálogo', async () => {
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(screen.getByRole('button', { name: 'Programar mantenimiento' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Programar mantenimiento · 1234KLM',
    })
    await userEvent.selectOptions(
      await within(dialog).findByLabelText('Qué mantenimiento'),
      '4',
    )
    // El ancla por km se carga del coche de un toque (4679, del resumen).
    await userEvent.click(
      within(dialog).getByRole('button', { name: /Cargar los del coche/ }),
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Programar' }))

    await waitFor(() =>
      expect(mocks.createMaintenancePlan).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicle: 1,
          program: 4,
          name: 'Revisión anual',
          // El ciclo se COPIA del catálogo, como en gestión.
          every_km: 30000,
          every_months: 12,
          last_done_km: 4679,
        }),
      ),
    )
  })

  it('la proyección se despliega para ver la gráfica, y con la alerta de exceso se resuelve ahí', async () => {
    mocks.listAlerts.mockResolvedValue({ count: 1, results: [OVERAGE_ALERT] })
    mocks.listKmReadings.mockResolvedValue({
      count: 2,
      results: [
        { id: 1, vehicle: 1, reading_date: '2026-03-01', km_reading: 20000 },
        { id: 2, vehicle: 1, reading_date: '2026-07-26', km_reading: 31000 },
      ],
    })

    renderPage()
    await screen.findByText('1234KLM')

    // Plegada de salida, pero el resumen se lee igual: es a lo que se viene.
    const toggle = screen.getByRole('button', { name: /Proyección/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('72%')).toHaveClass('km-pct')
    expect(screen.getByText('31.000 km de 50.000 km contratados')).toBeInTheDocument()
    // Y la gráfica no se pide hasta que hace falta.
    expect(mocks.listKmReadings).not.toHaveBeenCalled()

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(mocks.listKmReadings).toHaveBeenCalledWith(1))
    await waitFor(() => expect(document.querySelector('.km-chart svg')).not.toBeNull())

    // Y se resuelve desde la propia tarjeta, con el modal de siempre: el de
    // km contratados, que propone otro conductor.
    await userEvent.click(
      screen.getByRole('button', { name: 'Resolver el exceso de km de 1234KLM' }),
    )
    expect(await screen.findByText('¿Debería llevarlo otra persona?')).toBeInTheDocument()
  })

  it('sin alerta de exceso abierta, la proyección no ofrece «Resolver»', async () => {
    renderPage()
    await screen.findByText('1234KLM')
    // El nivel de la barra no basta: lo que se cierra es la ALERTA.
    expect(screen.queryByRole('button', { name: /Resolver el exceso de km/ })).toBeNull()
  })

  it('supervisor: mantenimiento, proyección y herramientas de gestión', async () => {
    renderPage()
    expect(await screen.findByText('1234KLM')).toBeInTheDocument()

    // El div de km es el COMPARTIDO con la home: última lectura y mejor día.
    expect(screen.getByText('Lectura del 26/7/2026')).toBeInTheDocument()
    expect(await screen.findByText('Mejor día para registrar los km: el 31')).toBeInTheDocument()

    // Y las MISMAS «Próximas citas» que la home: cada línea con la fecha y
    // cuántos días faltan (GAP-8: el próximo mantenimiento, entre ellas).
    expect(screen.getByText('Próximas citas')).toBeInTheDocument()
    expect(screen.getByText('Próx. mantenimiento')).toBeInTheDocument()
    expect(screen.getByText(/15\/9\/2026 · /)).toBeInTheDocument()
    expect(screen.getByText(/30\/9\/2026 · /)).toBeInTheDocument()
    // La lectura pendiente también es una cita: el último día de la ventana.
    expect(screen.getByText(/el día 31 · /)).toBeInTheDocument()

    // Proyección compacta contra el contrato, como en la vista del grupo.
    expect(screen.getByText('72%')).toHaveClass('km-pct')
    expect(screen.getByText('31.000 km de 50.000 km contratados')).toBeInTheDocument()

    // Sus herramientas de tarjeta, también aquí.
    expect(screen.getByRole('button', { name: 'Actualizar mantenimiento' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar recordatorio' })).toBeInTheDocument()

    const actions = document.querySelector('.quick-actions')
    expect(Array.from(actions?.children ?? []).map((action) => action.textContent?.trim())).toEqual([
      'Registrar km',
      // GAP-2: el consumo medio va junto a los km (los dos se apuntan a la vuelta).
      'Consumo medio',
      'Registrar ITV',
      'Actualizar mantenimiento',
      // Programar no es registrar: son gestos de gestión sobre la cita.
      'Programar ITV',
      'Programar mantenimiento',
      'Incidencia',
      'Accidente',
      'Subir documento',
      'Enviar recordatorio',
    ])

    // El botón abre «Actualizar», que es UNA ventana con una pestaña por cosa
    // que se actualiza, abierta por la que se pidió.
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar mantenimiento' }))
    expect(
      await screen.findByRole('dialog', { name: 'Actualizar · 1234KLM' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/responsabilidad de registrar los km/)).toBeInTheDocument()
    // Cada pestaña sale SOLO si el coche tiene eso: este no tiene plan de
    // mantenimiento, así que no hay pestaña que abrir y manda la primera.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Km',
      'Combustible',
      'ITV',
    ])
    expect(screen.getByRole('tab', { name: 'Km' })).toHaveAttribute('aria-selected', 'true')
  })

  it('conductor: sin proyección ni herramientas de gestión', async () => {
    mocks.roles = ['driver']
    renderPage()
    await screen.findByText('1234KLM')

    expect(screen.queryByText('72%')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Actualizar mantenimiento' })).not.toBeInTheDocument()
    // El parte de accidente de la ficha es de la supervisora; el conductor lo
    // tiene en el nav, donde viven sus acciones.
    expect(screen.queryByRole('button', { name: 'Accidente' })).not.toBeInTheDocument()
    // Registrar km permanece en la ficha y abre un modal.
    await userEvent.click(screen.getByRole('button', { name: /Registrar km/ }))
    expect(screen.getByRole('dialog', { name: 'Registrar km · 1234KLM' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/Odómetro/), '5000')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar lectura' }))
    expect(mocks.createKmReading).toHaveBeenCalledWith({
      vehicle: 1,
      km_reading: 5000,
      reading_date: expect.any(String),
      client_ref: expect.any(String),
    })
  })

  /** Avanzar `veces` pasos del carrusel de cierre. Los flujos tienen seis
   * (cuándo · detalles · taller · notas · factura · cierre) y cada uno usa los
   * suyos, así que cada caso dice cuántos le quedan hasta el repaso. */
  async function continuar(dialog: HTMLElement, veces: number) {
    for (let i = 0; i < veces; i += 1) {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }))
    }
  }

  /** Incidencia abierta de fixture (avería comunicada desde campo). */
  function openIncident(extra: Record<string, unknown> = {}) {
    return {
      id: 31,
      vehicle: 1,
      type: 'breakdown',
      type_display: 'Avería',
      date: '2026-08-25',
      description: 'Testigo de motor encendido.',
      mileage: null,
      workshop_postal_code: '',
      details: {},
      status: 'open',
      status_display: 'Abierta',
      cost: null,
      ...extra,
    }
  }

  it('debajo de Situación, las TRES tarjetas de lo pendiente, plegadas y con su recuento', async () => {
    mocks.listAlerts.mockResolvedValue({
      count: 1,
      results: [{
        id: 8,
        type: 'itv_due',
        type_display: 'ITV próxima',
        level: 'warning',
        level_display: 'Aviso',
        status: 'open',
        status_display: 'Abierta',
        vehicle: 1,
        vehicle_plate: '1234KLM',
        user: null,
        message: 'La ITV vence pronto.',
        due_date: '2026-09-30',
        created_at: '2026-08-20',
      }],
    })
    mocks.listIncidents.mockResolvedValue({
      count: 2,
      results: [
        openIncident(),
        // Neumáticos sin comentario: la fila se explica con el parte guiado.
        openIncident({
          id: 32,
          type: 'tires',
          type_display: 'Cambio de neumático',
          description: '',
          details: { report_version: 1, change_reason: 'wear', wheel_scope: 'rear', rear_measure: '225/45 R17' },
        }),
      ],
    })
    renderPage()
    await screen.findByText('1234KLM')

    expect(await screen.findByText('Desgaste · Traseras · 225/45 R17')).toBeInTheDocument()
    const situationTitle = screen.getByText('Situación')
    const alertsTitle = screen.getByRole('heading', { name: /^Alertas/ })
    expect(situationTitle.compareDocumentPosition(alertsTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('La ITV vence pronto.').closest('.doc-item')).toHaveClass('level-warning')
    // Cada familia en su tarjeta, y el recuento se lee sin abrir ninguna.
    // Alertas: la `itv_due` del motor más los avisos de km, combustible y
    // mantenimiento. El aviso de ITV no se suma —lo dice ya la alerta—.
    expect(await screen.findByText(/Testigo de motor encendido/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Alertas/ })).toHaveTextContent(/Alertas\s*4/)
    expect(screen.getByRole('button', { name: /^Incidencias/ })).toHaveTextContent(/Incidencias\s*2/)
    expect(screen.getByRole('button', { name: /^Accidentes/ })).toHaveTextContent(/Accidentes\s*0/)

    // Nacen PLEGADAS: nada se ve hasta abrir la que interesa.
    expect(screen.getByText('La ITV vence pronto.').closest('.acc-body')).toHaveAttribute('hidden')
    expect(screen.getByText(/Testigo de motor encendido/).closest('.acc-body')).toHaveAttribute('hidden')
    await userEvent.click(screen.getByRole('button', { name: /^Alertas/ }))
    expect(screen.getByText('La ITV vence pronto.').closest('.acc-body')).not.toHaveAttribute('hidden')
    // Abrir las alertas no abre las incidencias: son tarjetas distintas.
    expect(screen.getByText(/Testigo de motor encendido/).closest('.acc-body')).toHaveAttribute('hidden')
    await userEvent.click(screen.getByRole('button', { name: /^Incidencias/ }))
    expect(screen.getByText(/Testigo de motor encendido/).closest('.acc-body')).not.toHaveAttribute('hidden')
  })

  it('desplegada, la tarjeta ofrece filtrar por tipo (y con un solo tipo, no)', async () => {
    mocks.listAlerts.mockResolvedValue({ count: 1, results: [openAlert('itv_due', 'ITV programada')] })
    mocks.listIncidents.mockResolvedValue({
      count: 2,
      results: [
        openIncident(),
        openIncident({ id: 32, type: 'tires', type_display: 'Avería de neumáticos', description: 'Pinchazo' }),
      ],
    })
    renderPage()
    await screen.findByText('1234KLM')

    // Plegada no hay nada que filtrar: el desplegable aparece al abrirla.
    expect(screen.queryByLabelText('Filtrar por tipo')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Incidencias/ }))
    const filtro = screen.getByLabelText('Filtrar por tipo')
    expect(filtro).toHaveValue('')

    await userEvent.selectOptions(filtro, 'tires')
    expect(screen.getByText(/Pinchazo/)).toBeInTheDocument()
    expect(screen.queryByText(/Testigo de motor encendido/)).not.toBeInTheDocument()
    // El recuento del título sigue diciendo lo que HAY, no lo que se está viendo.
    expect(screen.getByRole('button', { name: /^Incidencias/ })).toHaveTextContent(/Incidencias\s*2/)

    // La de alertas tiene un solo tipo: ahí el filtro no filtraría nada.
    await userEvent.click(screen.getByRole('button', { name: /^Alertas/ }))
    expect(screen.getAllByLabelText('Filtrar por tipo')).toHaveLength(1)
  })

  /** Alerta abierta del coche, por tipo (para el enrutado de Resolver). */
  function openAlert(type: string, typeDisplay: string) {
    return {
      id: 8,
      type,
      type_display: typeDisplay,
      level: 'warning',
      level_display: 'Aviso',
      status: 'open',
      status_display: 'Abierta',
      vehicle: 1,
      vehicle_plate: '1234KLM',
      user: null,
      message: `Aviso de ${typeDisplay}.`,
      due_date: '2026-09-30',
      created_at: '2026-08-20',
    }
  }

  // Resolver va por TIPO, como en la bandeja: cada alerta abre el MISMO modal
  // que su botón del nav/página (ITV → Registrar ITV…); solo las que no tienen
  // registro propio (seguro…) van al modal genérico de observaciones.
  // La fila la nombra el TIPO traducido por código (domainLabels), no el
  // `type_display` del back; el botón «Solucionar» lleva ese nombre en su
  // etiqueta accesible, igual que los avisos de vencimiento llevan el suyo.
  it.each([
    ['itv_due', 'ITV programada', 'Registrar ITV · 1234KLM'],
    ['km_reading_pending', 'Lectura de km pendiente', 'Registrar km · 1234KLM'],
    ['maintenance_due', 'Mantenimiento programado', 'Actualizar mantenimiento · 1234KLM'],
  ])('Resolver una alerta %s abre el mismo modal que su botón', async (type, label, dialogName) => {
    mocks.listAlerts.mockResolvedValue({ count: 1, results: [openAlert(type, label)] })
    renderPage()
    await screen.findByText('1234KLM')

    // La tarjeta nace plegada: se abre y desde ahí se resuelve. Misma fila
    // que una incidencia: su botón dice «Solucionar» y nombra la alerta.
    await userEvent.click(await screen.findByRole('button', { name: /^Alertas/ }))
    await userEvent.click(await screen.findByRole('button', { name: `Solucionar: ${label}` }))
    expect(await screen.findByRole('dialog', { name: dialogName })).toBeInTheDocument()
  })

  it('el seguro no se enseña en campo, y el exceso de km solo en «Flota»', async () => {
    // El back ya se los quita a quien conduce y —el seguro— a quien supervisa,
    // pero a un ADMIN que además conduce se los manda enteros: su front es el
    // otro. Aquí se termina la regla. El exceso se queda en «Flota», que es
    // donde quien supervisa lo atiende (proponiendo otro conductor).
    mocks.listAlerts.mockResolvedValue({
      count: 2,
      results: [
        openAlert('insurance_due', 'Seguro próximo / vencido'),
        { ...openAlert('km_overage', 'Exceso de km proyectado'), id: 45 },
      ],
    })

    // «Flota» (el modo por defecto del contexto): el exceso sí.
    const { unmount } = renderPage()
    await screen.findByText('1234KLM')
    await userEvent.click(await screen.findByRole('button', { name: /^Alertas/ }))
    expect(screen.queryByText('Seguro próximo / vencido')).toBeNull()
    expect(screen.getByText('Exceso de km proyectado')).toBeInTheDocument()
    unmount()

    // «Mi vehículo»: ninguno de los dos —ahí se mira el coche que uno conduce
    // y lo que arregla el exceso no está en su mano—.
    renderWithMode({ fleetMode: false, ownPair: { ids: [1], target: 1 } })
    await screen.findByText('1234KLM')
    await userEvent.click(await screen.findByRole('button', { name: /^Alertas/ }))
    expect(screen.queryByText('Seguro próximo / vencido')).toBeNull()
    expect(screen.queryByText('Exceso de km proyectado')).toBeNull()
  })

  it('el supervisor SOLUCIONA una incidencia desde su tarjeta', async () => {
    // Tras resolver, la recarga ya no la trae.
    mocks.listIncidents
      .mockResolvedValueOnce({ count: 1, results: [openIncident()] })
      .mockResolvedValue({ count: 0, results: [] })
    mocks.resolveIncident.mockResolvedValue({ id: 31, status: 'closed' })
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(await screen.findByRole('button', { name: /^Incidencias/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Solucionar' }))
    // El título dice QUÉ se cierra: cada tipo tiene su formulario.
    const dialog = screen.getByRole('dialog', { name: 'Solucionar avería · 1234KLM' })
    // Se rellena POR PASOS (cuándo → taller → notas → factura → cierre): el
    // botón de guardar no existe hasta el último, para no cerrarla a medias.
    expect(within(dialog).queryByRole('button', { name: 'Cerrar incidencia' })).toBeNull()
    await continuar(dialog, 4)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar incidencia' }))

    await waitFor(() =>
      expect(mocks.resolveIncident).toHaveBeenCalledWith(31, {
        resolution_date: expect.any(String),
      }),
    )
    // La recarga ya no la trae: desaparece de la tarjeta.
    await waitFor(() =>
      expect(screen.queryByText(/Testigo de motor encendido/)).not.toBeInTheDocument(),
    )
  })

  it('cada tipo tiene SU formulario de cierre: neumáticos pregunta qué se montó', async () => {
    // El mismo reparto que gestión: un parte de neumáticos no se cierra con un
    // cajón de observaciones, y lo que el parte ya decía viene prellenado.
    mocks.listIncidents.mockResolvedValue({
      count: 1,
      results: [
        openIncident({
          id: 32,
          type: 'tires',
          type_display: 'Cambio de neumáticos',
          details: { wheel_scope: 'front', front_measure: '205/55 R16' },
        }),
      ],
    })
    mocks.resolveIncident.mockResolvedValue({ id: 32, status: 'closed' })
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(await screen.findByRole('button', { name: /^Incidencias/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Solucionar' }))
    const dialog = screen.getByRole('dialog', { name: 'Solucionar neumáticos · 1234KLM' })
    // Medida y ruedas viven en su propio paso, tomadas del parte.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }))
    expect(within(dialog).getByDisplayValue('205/55 R16')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Delantera izquierda')).toBeChecked()
    expect(within(dialog).getByLabelText('Trasera derecha')).not.toBeChecked()

    // Taller → notas → factura → el repaso, y ahí se cierra.
    await continuar(dialog, 4)
    expect(within(dialog).getByText('Lo que vas a guardar')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar incidencia' }))
    await waitFor(() =>
      expect(mocks.resolveIncident).toHaveBeenCalledWith(32, {
        resolution_date: expect.any(String),
        tires: { size: '205/55 R16', quantity: 2, positions: ['front_left', 'front_right'] },
      }),
    )
  })

  it('el accidente se cierra con su expediente y quién asume el coste', async () => {
    mocks.listIncidents.mockResolvedValue({
      count: 1,
      results: [openIncident({ id: 33, type: 'accident', type_display: 'Accidente' })],
    })
    mocks.resolveIncident.mockResolvedValue({ id: 33, status: 'closed' })
    renderPage()
    await screen.findByText('1234KLM')

    // El accidente vive en SU tarjeta, no entre las incidencias.
    await userEvent.click(await screen.findByRole('button', { name: /^Accidentes/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Solucionar' }))
    const dialog = screen.getByRole('dialog', { name: 'Solucionar accidente · 1234KLM' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }))
    await userEvent.type(within(dialog).getByLabelText(/Expediente/), 'SIN-2026-14')
    await userEvent.selectOptions(within(dialog).getByLabelText(/Quién asume/), 'third_party')

    // Las notas y la factura tienen su propio paso: el cierre ya no pregunta
    // nada, solo repasa.
    await continuar(dialog, 2)
    await userEvent.type(
      within(dialog).getByLabelText('Notas u observaciones'),
      'Reparado en el concesionario.',
    )
    await continuar(dialog, 1)
    expect(within(dialog).getByLabelText(/Factura del taller/)).toBeInTheDocument()
    await continuar(dialog, 1)

    // Llegar al repaso NO cierra la incidencia: se lee y DESPUÉS se acepta.
    // Ni entrando en el paso ni enviando el formulario (Intro): cerrarla es
    // pulsar su botón, que es lo único que guarda.
    expect(mocks.resolveIncident).not.toHaveBeenCalled()
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement)
    expect(mocks.resolveIncident).not.toHaveBeenCalled()

    // El último paso REPASA lo rellenado —al llegar al botón que cierra ya no
    // se ve— y dice lo que se dejó en blanco, que es lo que hay que decidir si
    // se vuelve a por ello. Y no pregunta nada: ni notas ni factura.
    const repaso = within(dialog).getByText('Lo que vas a guardar')
      .nextElementSibling as HTMLElement
    expect(within(repaso).getByText('SIN-2026-14')).toBeInTheDocument()
    expect(within(repaso).getByText('El tercero')).toBeInTheDocument()
    expect(within(repaso).getByText('Reparado en el concesionario.')).toBeInTheDocument()
    expect(within(repaso).getAllByText('Sin indicar').length).toBeGreaterThan(0)
    expect(within(dialog).queryByLabelText('Notas u observaciones')).toBeNull()
    expect(within(dialog).queryByLabelText(/Factura del taller/)).toBeNull()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar incidencia' }))

    await waitFor(() =>
      expect(mocks.resolveIncident).toHaveBeenCalledWith(33, {
        resolution_date: expect.any(String),
        observations: 'Reparado en el concesionario.',
        accident: { claim_ref: 'SIN-2026-14', liability: 'third_party' },
      }),
    )
  })

  it('la petición general se cierra con fecha y observaciones: el taller solo si lo hubo', async () => {
    // Puede no ir del coche (documentación, tarjetas, dudas), así que km,
    // coste, CP y factura no se preguntan hasta marcar que hubo taller.
    mocks.listIncidents.mockResolvedValue({
      count: 1,
      results: [
        openIncident({ id: 34, type: 'general', type_display: 'Petición general' }),
      ],
    })
    mocks.resolveIncident.mockResolvedValue({ id: 34, status: 'closed' })
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(await screen.findByRole('button', { name: /^Incidencias/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Solucionar' }))
    const dialog = screen.getByRole('dialog', { name: 'Cerrar petición · 1234KLM' })
    // La casilla del taller vive en el paso de las notas: es lo que añade los
    // suyos, así que se pregunta ANTES.
    await continuar(dialog, 1)
    expect(within(dialog).queryByLabelText('Kilometraje')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Coste (€)')).not.toBeInTheDocument()

    // Marcarlo AÑADE el taller y su factura; desmarcarlo se los lleva, y lo
    // que se hubiera escrito NO viaja.
    await userEvent.click(within(dialog).getByLabelText(/Requirió pasar por el taller/))
    await continuar(dialog, 1)
    await userEvent.type(within(dialog).getByLabelText('Coste (€)'), '40')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Atrás' }))
    await userEvent.click(within(dialog).getByLabelText(/Requirió pasar por el taller/))
    await userEvent.type(
      within(dialog).getByLabelText('Notas u observaciones'),
      'Tarjeta entregada',
    )

    // Sin taller, del paso de las notas se pasa al repaso y ahí se cierra.
    await continuar(dialog, 1)
    expect(within(dialog).queryByText('Coste (€)')).toBeNull()
    expect(within(dialog).getByText('Tarjeta entregada')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar incidencia' }))
    await waitFor(() =>
      expect(mocks.resolveIncident).toHaveBeenCalledWith(34, {
        resolution_date: expect.any(String),
        observations: 'Tarjeta entregada',
      }),
    )
  })

  it('el kilometraje se carga del propio coche: en el taller no ha rodado', async () => {
    mocks.listIncidents.mockResolvedValue({ count: 1, results: [openIncident()] })
    mocks.resolveIncident.mockResolvedValue({ id: 31, status: 'closed' })
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(await screen.findByRole('button', { name: /^Incidencias/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Solucionar' }))
    const dialog = screen.getByRole('dialog', { name: 'Solucionar avería · 1234KLM' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }))
    await userEvent.click(within(dialog).getByRole('button', { name: /Cargar los del coche/ }))
    // La última lectura del resumen (4679 km), sin teclear cinco dígitos.
    expect(within(dialog).getByLabelText('Kilometraje')).toHaveValue('4679')

    await continuar(dialog, 3)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar incidencia' }))
    await waitFor(() =>
      expect(mocks.resolveIncident).toHaveBeenCalledWith(31, {
        resolution_date: expect.any(String),
        km: 4679,
      }),
    )
  })

  it('el conductor ve la incidencia en la tarjeta pero SIN botón de solucionar', async () => {
    mocks.roles = ['driver']
    mocks.listIncidents.mockResolvedValue({ count: 1, results: [openIncident()] })
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(await screen.findByRole('button', { name: /^Incidencias/ }))
    expect(await screen.findByText(/Testigo de motor encendido/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Solucionar' })).not.toBeInTheDocument()
  })

  it('abre Subir documento en un modal con el vehículo fijado', async () => {
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(screen.getByRole('button', { name: 'Subir documento' }))
    const dialog = screen.getByRole('dialog', { name: 'Subir documento · 1234KLM' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText(/responsabilidad de registrar los km/)).toBeInTheDocument()

    // Tres pasos: tipo y documento · ligado a · notas. Solo el último sube.
    const file = new File(['parte'], 'parte.pdf', { type: 'application/pdf' })
    await userEvent.upload(within(dialog).getByLabelText(/Foto o PDF/), file)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }))
    // «Otro» no exige incidencia y este coche no tiene ninguna que ofrecer.
    expect(await within(dialog).findByText(/no se liga a ninguna incidencia/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Subir' }))

    expect(mocks.uploadDocument).toHaveBeenCalledWith({
      vehicle: 1,
      type: 'other',
      expiry_date: null,
      incident: null,
      notes: '',
      client_ref: expect.any(String),
    }, file)
    expect(await screen.findByText('Documento subido')).toBeInTheDocument()
  })

  it('principal bloqueado (N9): km, documento y avería apagados; la ITV sigue', async () => {
    mocks.fetchVehicleSummary.mockResolvedValue({
      ...SUMMARY,
      blocked_by_link: {
        substitute_id: 9,
        plate: '4567JKL',
        reason: 'Mantenimiento',
        since: '2026-08-01',
      },
    })
    renderPage()
    await screen.findByText('1234KLM')

    expect(screen.getByText('🔒 Bloqueado por sustitución')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Registrar km/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Subir documento/ })).not.toBeInTheDocument()
    // Km, combustible, avería, accidente y documento apagados (5): sin coche
    // operativo no se apunta nada de consumo. La ITV es del coche físico y sigue.
    expect(document.querySelectorAll('.quick-action.is-disabled').length).toBe(5)
    // La ITV es del coche físico: sigue disponible aunque esté cubierto.
    expect(screen.getByRole('button', { name: 'Registrar ITV' })).toBeInTheDocument()
  })

  it('la ITV se registra aunque la tarjeta de documentos esté plegada (BG)', async () => {
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(screen.getByRole('button', { name: 'Plegar todo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Registrar ITV' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Registrar ITV · 1234KLM')).toBeInTheDocument()
  })

  it('en Mi vehículo, la ficha del coche operativo NO repite las acciones del nav', async () => {
    renderWithMode({ fleetMode: false, ownPair: { ids: [1], target: 1 } })
    await screen.findByText('1234KLM')

    expect(document.querySelector('.quick-actions')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Registrar km' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar ITV' })).not.toBeInTheDocument()
  })

  it('la ficha de un coche que NO es el operativo del nav conserva sus acciones', async () => {
    // P. ej. el principal bloqueado de la pareja: el nav apunta al sustituto.
    renderWithMode({ fleetMode: false, ownPair: { ids: [1, 9], target: 9 } })
    await screen.findByText('1234KLM')

    expect(document.querySelector('.quick-actions')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Registrar km' })).toBeInTheDocument()
  })
})
