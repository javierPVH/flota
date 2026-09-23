import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AlertsPage } from './AlertsPage.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  listIncidents: vi.fn(),
  fetchVehicleSummaries: vi.fn(),
  createKmReading: vi.fn(),
  registerItv: vi.fn(),
  listMaintenancePlans: vi.fn(),
  markMaintenanceDone: vi.fn(),
  resolveAlert: vi.fn(),
  listDriverCandidates: vi.fn(),
  proposeDriverChange: vi.fn(),
  listVehiclesCached: vi.fn(),
  fetchVehicleSummariesCached: vi.fn(),
  fetchKmWindow: vi.fn(),
  listVehicles: vi.fn(),
  roles: ['driver'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listAlerts: mocks.listAlerts,
  listIncidents: mocks.listIncidents,
  fetchVehicleSummaries: mocks.fetchVehicleSummaries,
  createKmReading: mocks.createKmReading,
  registerItv: mocks.registerItv,
  listMaintenancePlans: mocks.listMaintenancePlans,
  markMaintenanceDone: mocks.markMaintenanceDone,
  resolveAlert: mocks.resolveAlert,
  listDriverCandidates: mocks.listDriverCandidates,
  proposeDriverChange: mocks.proposeDriverChange,
  listVehiclesCached: mocks.listVehiclesCached,
  fetchVehicleSummariesCached: mocks.fetchVehicleSummariesCached,
  fetchKmWindow: mocks.fetchKmWindow,
  listVehicles: mocks.listVehicles,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'x', roles: mocks.roles } }),
}))

// El push (M8) no aplica en jsdom: estado 'disabled' oculta su panel.
vi.mock('../push.ts', () => ({
  pushState: () => Promise.resolve('disabled'),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}))

const KM_ALERT = {
  id: 1,
  type: 'km_reading_pending',
  type_display: 'Lectura de km pendiente',
  level: 'warning',
  level_display: 'Aviso',
  status: 'open',
  status_display: 'Abierta',
  vehicle: 7,
  vehicle_plate: '7890NPQ',
  user: null,
  message: 'Falta la lectura de km de 2026-07.',
  due_date: null,
  created_at: '2026-07-22T00:00:00Z',
}

// Segunda alerta del MISMO coche y una crítica de otro: entre las tres se lee
// el orden (por nivel y, a igualdad, la más reciente) y la búsqueda.
const ITV_ALERT = {
  ...KM_ALERT,
  id: 2,
  type: 'itv_due',
  type_display: 'ITV próxima',
  message: 'La ITV vence el 2026-09-01.',
  created_at: '2026-07-25T00:00:00Z',
}
// Km contratados: la única alerta que se arregla cambiando quién lo lleva.
const OVERAGE_ALERT = {
  ...KM_ALERT,
  id: 4,
  type: 'km_overage',
  type_display: 'Exceso de km proyectado',
  message: 'Proyección 83767 km supera los 60000 km contratados (140%).',
}
const OTHER_CAR_ALERT = {
  ...KM_ALERT,
  id: 3,
  type: 'itv_due',
  type_display: 'ITV próxima',
  level: 'critical',
  level_display: 'Crítica',
  vehicle: 8,
  vehicle_plate: '1111AAA',
  message: 'ITV vencida.',
  created_at: '2026-07-20T00:00:00Z',
}

/** Las peticiones abiertas del ámbito: dos de taller y un accidente, que se
 * lee en su propia tarjeta. */
const AVERIA = {
  id: 11,
  vehicle: 7,
  type: 'breakdown',
  type_display: 'Avería',
  priority: 'informative' as const,
  priority_display: 'Informativa',
  date: '2026-07-01',
  description: 'No arranca en frío',
  mileage: null,
  workshop_postal_code: '',
  details: {},
  status: 'open',
  status_display: 'Abierta',
  cost: null,
}
const NEUMATICOS = {
  ...AVERIA,
  id: 12,
  type: 'tires',
  type_display: 'Cambio de neumáticos',
  priority: 'critical' as const,
  priority_display: 'Crítica',
  date: '2026-06-01',
  description: 'Rueda pinchada',
}
const ACCIDENTE = {
  ...AVERIA,
  id: 13,
  type: 'accident',
  type_display: 'Accidente',
  description: 'Alcance en el parking',
}

function renderPage() {
  // AlertsPage usa useLang: el provider es obligatorio (idioma por defecto: es).
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <AlertsPage />
      </MemoryRouter>
    </LanguageProvider>,
  )
}

/** Abre una de las tres tarjetas (nacen plegadas), esperando a que la bandeja
 * haya cargado: su cabecera es lo primero que aparece. */
async function abrir(nombre: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name: nombre }))
}

/** Lo que enseña la tarjeta de alertas, EN ORDEN. */
function alertas(): string[] {
  return [...document.querySelectorAll('.alert-list .alert-card .alert-message')].map(
    (node) => node.textContent?.trim() ?? '',
  )
}

/** Y lo que enseña una tarjeta de peticiones, también en orden. */
function filas(): string[] {
  // Solo la tarjeta DESPLEGADA: las otras dos siguen montadas (`hidden`).
  return [
    ...document.querySelectorAll('.acc:not(.acc-closed) .vehicle-incidents-list .doc-item'),
  ].map((node) => node.textContent ?? '')
}

describe('AlertsPage (M5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.roles = ['driver']
    mocks.listAlerts.mockResolvedValue({
      count: 3,
      results: [KM_ALERT, ITV_ALERT, OTHER_CAR_ALERT],
    })
    mocks.listIncidents.mockResolvedValue({
      count: 3,
      results: [AVERIA, NEUMATICOS, ACCIDENTE],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { vehicle: 7, plate: '7890NPQ', km_reading_date: null, km_current: null, driver: null },
    ])
    mocks.registerItv.mockResolvedValue({})
    mocks.listMaintenancePlans.mockResolvedValue({ count: 0, results: [] })
    mocks.listDriverCandidates.mockResolvedValue([
      { id: 5, name: 'Carlos C', email: 'c@x.es', plate: '1111AAA', source: 'app' },
    ])
    mocks.proposeDriverChange.mockResolvedValue({ id: 99 })
    // Sin nada que vencer, «Te queda poco» no pinta nada (es un aviso, no
    // un panel de estado), así que el resto de casos se leen igual. Los
    // vehículos sí hacen falta: de ahí sale la matrícula de una petición.
    mocks.listVehiclesCached.mockResolvedValue({
      count: 2,
      results: [
        { id: 7, plate: '7890NPQ' },
        { id: 8, plate: '1111AAA' },
      ],
    })
    mocks.fetchVehicleSummariesCached.mockResolvedValue([])
    mocks.fetchKmWindow.mockResolvedValue(null)
    // En modo Flota la bandeja pide el grupo (`supervisor=<yo>`): por defecto
    // es el mismo par de coches del ámbito, así que nada se recorta.
    mocks.listVehicles.mockResolvedValue({
      count: 2,
      results: [
        { id: 7, plate: '7890NPQ' },
        { id: 8, plate: '1111AAA' },
      ],
    })
  })

  // --- Las tres familias, en tres tarjetas --------------------------------
  it('lo pendiente son TRES tarjetas plegadas, con su recuento en el título', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: /^Alertas/ })).toHaveTextContent(
      /Alertas\s*3/,
    )
    expect(screen.getByRole('button', { name: /^Incidencias/ })).toHaveTextContent(
      /Incidencias\s*2/,
    )
    expect(screen.getByRole('button', { name: /^Accidentes/ })).toHaveTextContent(
      /Accidentes\s*1/,
    )

    // Plegadas: el detalle no se lee hasta abrir la familia que interesa.
    expect(screen.getByText('Falta la lectura de km de 2026-07.')).not.toBeVisible()
    await abrir(/^Alertas/)
    expect(screen.getByText('Falta la lectura de km de 2026-07.')).toBeVisible()
    // El conductor no resuelve.
    expect(screen.queryByRole('button', { name: 'Resolver' })).not.toBeInTheDocument()
  })

  it('cada familia en la suya: el accidente no se lee entre las incidencias', async () => {
    renderPage()
    await abrir(/^Incidencias/)
    const incidencias = screen.getByText(/No arranca en frío/).closest('.acc')
    expect(screen.getByText(/No arranca en frío/)).toBeVisible()
    expect(screen.getByText(/Rueda pinchada/)).toBeVisible()
    expect(screen.getByText(/Alcance en el parking/).closest('.acc')).not.toBe(incidencias)

    await abrir(/^Accidentes/)
    expect(screen.getByText(/Alcance en el parking/)).toBeVisible()
    // Cada fila dice de qué coche es: aquí se mezclan los del ámbito.
    expect(within(incidencias as HTMLElement).getAllByText('7890NPQ')[0]).toBeVisible()
  })

  // --- Buscar, filtrar y ordenar ------------------------------------------
  it('la tarjeta de alertas se busca, se filtra por tipo y se ordena', async () => {
    renderPage()
    await abrir(/^Alertas/)

    // De salida, por prioridad: la crítica arriba y, a igualdad de nivel, la
    // más reciente antes.
    expect(alertas()).toEqual([
      expect.stringContaining('ITV vencida.'),
      expect.stringContaining('La ITV vence el 2026-09-01.'),
      expect.stringContaining('Falta la lectura de km de 2026-07.'),
    ])

    // Por fecha manda la de creación, sin mirar el nivel.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Ordenar' }), 'date')
    expect(alertas()).toEqual([
      expect.stringContaining('La ITV vence el 2026-09-01.'),
      expect.stringContaining('Falta la lectura de km de 2026-07.'),
      expect.stringContaining('ITV vencida.'),
    ])

    // El tipo recorta la lista; el recuento del título NO se filtra.
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filtrar por tipo' }),
      'km_reading_pending',
    )
    expect(alertas()).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^Alertas/ })).toHaveTextContent(/Alertas\s*3/)

    // Y lo escrito busca también por MATRÍCULA, que es como se distingue un
    // coche de otro en una bandeja de flota.
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filtrar por tipo' }),
      '',
    )
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar' }), '1111')
    expect(alertas()).toEqual([expect.stringContaining('ITV vencida.')])
  })

  it('las incidencias se ordenan por la prioridad con la que se abrieron', async () => {
    renderPage()
    await abrir(/^Incidencias/)

    // La crítica primero aunque sea la más antigua: ordenar por prioridad es
    // decidir por dónde empezar.
    expect(filas()[0]).toContain('Rueda pinchada')
    expect(filas()[0]).toContain('Crítica')
    expect(filas()[1]).toContain('No arranca en frío')

    const tarjeta = screen.getByText(/Rueda pinchada/).closest('.acc') as HTMLElement
    await userEvent.selectOptions(
      within(tarjeta).getByRole('combobox', { name: 'Ordenar' }),
      'date',
    )
    expect(filas()[0]).toContain('No arranca en frío')
  })

  it('con una sola fila no hay nada que acotar: la barra no se pinta', async () => {
    mocks.listIncidents.mockResolvedValue({ count: 1, results: [AVERIA] })
    renderPage()
    await abrir(/^Incidencias/)
    const tarjeta = screen.getByText(/No arranca en frío/).closest('.acc') as HTMLElement
    expect(within(tarjeta).queryByRole('combobox', { name: 'Ordenar' })).not.toBeInTheDocument()
  })

  it('R4-06: sin pendientes de km no se piden summaries (ids vacío = ámbito entero)', async () => {
    mocks.roles = ['driver', 'supervisor']
    // Solo alertas de ITV: ninguna lectura pendiente que necesite su summary.
    mocks.listAlerts.mockResolvedValue({ count: 2, results: [ITV_ALERT, OTHER_CAR_ALERT] })
    renderPage()
    await screen.findAllByText('7890NPQ')
    expect(mocks.fetchVehicleSummaries).not.toHaveBeenCalled()
  })

  it('el supervisor resuelve con un modal personalizado por tipo', async () => {
    mocks.roles = ['driver', 'supervisor']
    mocks.createKmReading.mockResolvedValue({})
    mocks.resolveAlert.mockResolvedValue({})
    renderPage()
    await screen.findAllByText('7890NPQ')
    // El panel de lecturas pendientes ya no existe; los summaries se siguen
    // pidiendo (M12: SOLO los pendientes) para la pista del modal de resolver.
    expect(screen.queryByText('Lecturas pendientes del grupo')).not.toBeInTheDocument()
    expect(mocks.fetchVehicleSummaries).toHaveBeenCalledWith([7])
    // Resolver es el único cierre: descartar ya no existe en el dominio.
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument()

    // Lectura pendiente: Resolver abre el FORMULARIO de registrar km (y el
    // enlace suelto de "Registrar km" desaparece para el supervisor).
    await abrir(/^Alertas/)
    expect(screen.queryByRole('link', { name: /Registrar km/ })).not.toBeInTheDocument()
    const kmCard = screen
      .getByText('Falta la lectura de km de 2026-07.')
      .closest('.alert-card') as HTMLElement
    await userEvent.click(within(kmCard).getByRole('button', { name: 'Resolver' }))
    const kmDialog = screen.getByRole('dialog', { name: 'Registrar km · 7890NPQ' })
    expect(kmDialog).toBeInTheDocument()
    await userEvent.type(within(kmDialog).getByLabelText(/Odómetro/), '4750')
    await userEvent.click(within(kmDialog).getByRole('button', { name: 'Guardar lectura' }))
    expect(mocks.createKmReading).toHaveBeenCalledWith({
      vehicle: 7,
      km_reading: 4750,
      reading_date: expect.any(String),
      client_ref: expect.any(String),
    })
    expect(mocks.resolveAlert).not.toHaveBeenCalled()
    expect(await screen.findByText('Alerta de 7890NPQ resuelta.')).toBeInTheDocument()

    // ITV: reutiliza exactamente el modal Registrar ITV de la ficha.
    const itvCard = screen
      .getByText('La ITV vence el 2026-09-01.')
      .closest('.alert-card') as HTMLElement
    await userEvent.click(within(itvCard).getByRole('button', { name: 'Resolver' }))
    const itvDialog = screen.getByRole('dialog', { name: 'Registrar ITV · 7890NPQ' })
    // La fecha de la inspección ya no viene puesta: se pone con su atajo.
    await userEvent.click(within(itvDialog).getByRole('button', { name: 'Hoy' }))
    fireEvent.change(within(itvDialog).getByLabelText('Próxima ITV'), {
      target: { value: '2027-09-01' },
    })
    await userEvent.click(within(itvDialog).getByRole('button', { name: 'Registrar ITV' }))
    expect(mocks.registerItv).toHaveBeenCalledWith({
      vehicle: 7,
      event_date: expect.any(String),
      itv: { result: 'done', next_due: '2027-09-01' },
      client_ref: expect.any(String),
    })
  })

  it('una alerta de mantenimiento abre el mismo modal exclusivo de la ficha', async () => {
    mocks.roles = ['driver', 'supervisor']
    mocks.listAlerts.mockResolvedValue({
      count: 1,
      results: [{
        ...KM_ALERT,
        id: 4,
        type: 'maintenance_due',
        type_display: 'Mantenimiento próximo',
        message: 'La revisión anual está pendiente.',
      }],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([])
    mocks.listMaintenancePlans.mockResolvedValue({
      count: 1,
      results: [{
        id: 9,
        vehicle: 7,
        vehicle_plate: '7890NPQ',
        name: 'Revisión anual',
        every_km: null,
        every_months: 12,
        last_done_date: '2025-08-20',
        last_done_km: null,
      }],
    })
    mocks.markMaintenanceDone.mockResolvedValue({
      id: 9,
      vehicle: 7,
      vehicle_plate: '7890NPQ',
      name: 'Revisión anual',
      every_km: null,
      every_months: 12,
      last_done_date: '2026-08-27',
      last_done_km: null,
      alerts_resolved: 1,
    })

    renderPage()
    await screen.findByRole('button', { name: /^Alertas/ })
    await abrir(/^Alertas/)
    const card = screen.getByText('La revisión anual está pendiente.').closest('.alert-card') as HTMLElement
    await userEvent.click(within(card).getByRole('button', { name: 'Resolver' }))

    const dialog = screen.getByRole('dialog', { name: 'Actualizar mantenimiento · 7890NPQ' })
    expect(within(dialog).queryByRole('tab')).not.toBeInTheDocument()
    expect(await within(dialog).findByText('Revisión anual')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Marcar como realizado' }))
    const dateDialog = screen.getByRole('dialog', { name: '¿Cuándo se hizo? · Revisión anual' })
    await userEvent.click(within(dateDialog).getByRole('button', { name: 'Marcar como realizado' }))
    expect(mocks.markMaintenanceDone).toHaveBeenCalledWith(9, { date: expect.any(String) })
  })

  it('en km contratados se puede proponer otro conductor, y eso NO resuelve la alerta', async () => {
    // El exceso de km no se arregla con una observación: se arregla si lo
    // lleva quien rueda menos, y eso lo decide administración.
    mocks.roles = ['driver', 'supervisor']
    mocks.listAlerts.mockResolvedValue({ count: 1, results: [OVERAGE_ALERT] })
    renderPage()
    await screen.findByRole('button', { name: /^Alertas/ })
    await abrir(/^Alertas/)
    const card = screen
      .getByText(/Proyección 83767 km/)
      .closest('.alert-card') as HTMLElement
    await userEvent.click(within(card).getByRole('button', { name: 'Resolver' }))

    const dialog = screen.getByRole('dialog', { name: /Resolver alerta/ })
    // Los candidatos son gente de su flota, con el coche que llevan.
    const selector = await within(dialog).findByRole('combobox', {
      name: /A quién propones/,
    })
    await userEvent.selectOptions(selector, '5')
    // Una sola caja de texto: la de notas hace también de observaciones —dos
    // obligaban a elegir en cuál escribir lo mismo—.
    expect(within(dialog).queryByText(/Observaciones/)).not.toBeInTheDocument()
    await userEvent.type(
      within(dialog).getByLabelText(/Nota \(queda en la propuesta/),
      'Hace menos ruta.',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar propuesta' }))

    expect(mocks.proposeDriverChange).toHaveBeenCalledWith({
      vehicle: 7,
      alert: 4,
      proposed_driver: 5,
      note: 'Hace menos ruta.',
    })
    // Nada ha cambiado todavía: la alerta sigue abierta hasta que se decida.
    expect(mocks.resolveAlert).not.toHaveBeenCalled()
    expect(await within(dialog).findByText(/Propuesta enviada/)).toBeInTheDocument()
  })

  it('la petición se cierra con el MISMO formulario que el tablero', async () => {
    mocks.roles = ['driver', 'supervisor']
    renderPage()
    await screen.findByRole('button', { name: /^Incidencias/ })
    await abrir(/^Incidencias/)
    const fila = screen.getByText(/No arranca en frío/).closest('.doc-item') as HTMLElement
    await userEvent.click(within(fila).getByRole('button', { name: 'Resolver' }))
    // El despachador monta el formulario del TIPO, con la matrícula en el
    // título: es la misma ventana que abre la ficha de campo.
    expect(screen.getByRole('dialog', { name: /7890NPQ/ })).toBeInTheDocument()
  })

  // --- «Te queda poco» también aquí ---------------------------------------
  // Lo que vence (la lectura de km, el combustible, la ITV, el mantenimiento)
  // se leía solo en la home. Es lo que hay que HACER, así que encabeza también
  // la bandeja —en «Mi vehículo»; en «Flota» eso se lee en «A tu cargo»—.
  describe('los vencimientos encabezan la bandeja', () => {
    /** Una ITV dentro de los 30 días: basta el vehículo, sin resumen. */
    function conItvProxima() {
      const dia = new Date()
      dia.setDate(dia.getDate() + 12)
      mocks.listVehiclesCached.mockResolvedValue({
        count: 1,
        results: [{ id: 7, plate: '7890NPQ', next_itv_date: dia.toISOString().slice(0, 10) }],
      })
    }

    it('en «Mi vehículo» sale, con su coche y sus días', async () => {
      conItvProxima()
      renderPage()
      expect(await screen.findByText('Te queda poco')).toBeInTheDocument()
      expect(screen.getByText('ITV de 7890NPQ')).toBeInTheDocument()
    })

    it('en «Flota» no: los del grupo se leen en «A tu cargo»', async () => {
      conItvProxima()
      mocks.roles = ['driver', 'supervisor']
      render(
        <LanguageProvider>
          <MemoryRouter>
            <Routes>
              <Route
                element={
                  <Outlet
                    context={{
                      fleetMode: true,
                      setFleetMode: () => {},
                      ownPair: null,
                      dataVersion: 0,
                    }}
                  />
                }
              >
                <Route path="/" element={<AlertsPage />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </LanguageProvider>,
      )
      expect(await screen.findAllByText('7890NPQ')).not.toHaveLength(0)
      expect(screen.queryByText('Te queda poco')).not.toBeInTheDocument()
    })
  })

  it('el supervisor con HSE, en «Flota», lee solo su grupo y su coche, y nunca el seguro', async () => {
    // A HSE el back le manda en LECTURA las alertas e incidencias de toda la
    // empresa, seguro incluido (X1: en gestión sí se revisa). Sin recorte
    // salían coches ajenos con un «Resolver» que el back rechaza (404).
    mocks.roles = ['supervisor', 'hse']
    // Su grupo: el 7. Toda la flota leída: 7, 8 y 9. Y el 9 lo conduce él.
    mocks.listVehicles.mockResolvedValue({ count: 1, results: [{ id: 7, plate: '7890NPQ' }] })
    mocks.listVehiclesCached.mockResolvedValue({
      count: 3,
      results: [
        { id: 7, plate: '7890NPQ' },
        { id: 8, plate: '1111AAA' },
        { id: 9, plate: '2222BBB' },
      ],
    })
    mocks.fetchVehicleSummariesCached.mockResolvedValue([
      { vehicle: 9, plate: '2222BBB', km_reading_date: null, km_current: null, driver: { id: 1, name: 'Yo' } },
    ])
    const PROPIO = {
      ...ITV_ALERT,
      id: 5,
      vehicle: 9,
      vehicle_plate: '2222BBB',
      message: 'ITV del coche propio.',
    }
    const SEGURO = {
      ...KM_ALERT,
      id: 6,
      type: 'insurance_due',
      type_display: 'Seguro próximo a vencer',
      message: 'El seguro del 7890NPQ vence pronto.',
    }
    mocks.listAlerts.mockResolvedValue({
      count: 4,
      results: [KM_ALERT, OTHER_CAR_ALERT, PROPIO, SEGURO],
    })
    mocks.listIncidents.mockResolvedValue({
      count: 2,
      results: [AVERIA, { ...AVERIA, id: 14, vehicle: 8, description: 'Del coche ajeno' }],
    })

    render(
      <LanguageProvider>
        <MemoryRouter>
          <Routes>
            <Route
              element={
                <Outlet
                  context={{ fleetMode: true, setFleetMode: () => {}, ownPair: null, dataVersion: 0 }}
                />
              }
            >
              <Route path="/" element={<AlertsPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    )

    // Dos alertas: la de su grupo y la de su coche. Ni la del ajeno ni el seguro.
    expect(await screen.findByRole('button', { name: /^Alertas/ })).toHaveTextContent(
      /Alertas\s*2/,
    )
    expect(mocks.listVehicles).toHaveBeenCalledWith({ supervisor: 1 })
    await abrir(/^Alertas/)
    // El orden lo decide la tarjeta (nivel y fecha); aquí importa QUÉ sale, y
    // en modo Flota cada fila dice de qué coche es.
    expect([...alertas()].sort()).toEqual(
      ['2222BBB ITV del coche propio.', '7890NPQ Falta la lectura de km de 2026-07.'].sort(),
    )
    expect(screen.queryByText('ITV vencida.')).not.toBeInTheDocument()
    expect(screen.queryByText(/El seguro del/)).not.toBeInTheDocument()
    // Y una sola incidencia: la de su grupo.
    expect(screen.getByRole('button', { name: /^Incidencias/ })).toHaveTextContent(
      /Incidencias\s*1/,
    )
    await abrir(/^Incidencias/)
    expect(filas()).toHaveLength(1)
    expect(filas()[0]).toContain('No arranca en frío')
  })

  it('sin nada abierto, estado vacío amable', async () => {
    mocks.listAlerts.mockResolvedValue({ count: 0, results: [] })
    mocks.listIncidents.mockResolvedValue({ count: 0, results: [] })
    renderPage()
    // Cada familia lo dice en la suya; el recuento del título ya lo adelanta.
    expect(await screen.findByRole('button', { name: /^Alertas/ })).toHaveTextContent(
      /Alertas\s*0/,
    )
    await abrir(/^Alertas/)
    expect(screen.getByText('Sin alertas abiertas. Todo al día.')).toBeVisible()
    await abrir(/^Incidencias/)
    expect(screen.getByText('Sin incidencias abiertas.')).toBeVisible()
  })

  it('si las incidencias no cargan, las alertas se leen igual', async () => {
    // Lo que no es una alerta no puede tumbar la bandeja de alertas.
    mocks.listIncidents.mockRejectedValue(new Error('sin red'))
    renderPage()
    expect(await screen.findByRole('button', { name: /^Alertas/ })).toHaveTextContent(
      /Alertas\s*3/,
    )
    expect(screen.getByRole('button', { name: /^Incidencias/ })).toHaveTextContent(
      /Incidencias\s*0/,
    )
  })

  // --- La FRASE del aviso, en el idioma de la app -------------------------
  // El back la componía en castellano y se pintaba tal cual, así que con la
  // app en inglés el aviso salía en castellano y no había nada que traducir:
  // era prosa. Ahora manda además su código con los números dentro.
  describe('el mensaje se escribe en el idioma de la app', () => {
    /** Un mantenimiento que toca por km Y por fecha: el aviso compuesto. */
    const MANTENIMIENTO = {
      ...KM_ALERT,
      id: 9,
      type: 'maintenance_due',
      type_display: 'Mantenimiento programado',
      message: 'Revisión anual: superado el objetivo de 10000 km (odómetro: 10500 km) '
        + 'y, por fecha, toca en 7 día(s) (el 2026-03-01).',
      message_code: 'maintenance',
      message_args: {
        plan: 'Revisión anual',
        km: { kind: 'over', target: 10000, current: 10500 },
        date: { kind: 'soon', days: 7, due: '2026-03-01' },
      },
    }

    beforeEach(() => {
      mocks.listAlerts.mockResolvedValue({ count: 1, results: [MANTENIMIENTO] })
    })

    afterEach(() => {
      localStorage.removeItem('gs_base_lang')
    })

    it('en castellano dice exactamente lo que decía el back', async () => {
      renderPage()
      expect(await screen.findByText(MANTENIMIENTO.message)).toBeInTheDocument()
    })

    it('en inglés lo dice en inglés, con sus dos tramos', async () => {
      // El provider aplica el idioma PERSISTIDO al montar.
      localStorage.setItem('gs_base_lang', 'en')
      renderPage()
      expect(
        await screen.findByText(
          'Revisión anual: target of 10000 km passed (odometer: 10500 km) '
            + 'and, by date, due in 7 day(s) (on 2026-03-01).',
        ),
      ).toBeInTheDocument()
    })

    it('una alerta SIN código —de antes de esto— sigue pintándose', async () => {
      const vieja = { ...KM_ALERT, message: 'Aviso antiguo, sin código.' }
      mocks.listAlerts.mockResolvedValue({ count: 1, results: [vieja] })
      localStorage.setItem('gs_base_lang', 'en')
      renderPage()
      expect(await screen.findByText('Aviso antiguo, sin código.')).toBeInTheDocument()
    })
  })
})
