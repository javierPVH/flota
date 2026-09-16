import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DashboardPage } from './DashboardPage.tsx'
import { ConfirmProvider } from '../components/ConfirmDialog.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  fetchFleetSummary: vi.fn(),
  listAlerts: vi.fn(),
  listIncidents: vi.fn(),
  listOpenIncidents: vi.fn(),
  listVehicles: vi.fn(),
  listVehicleLinks: vi.fn(),
  registerItv: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  fetchFleetSummary: mocks.fetchFleetSummary,
  listAlerts: mocks.listAlerts,
  listIncidents: mocks.listIncidents,
  listOpenIncidents: mocks.listOpenIncidents,
  listVehicles: mocks.listVehicles,
  listVehicleLinks: mocks.listVehicleLinks,
  registerItv: mocks.registerItv,
}))

const SUMMARY = {
  total: 5,
  by_state: { active: 3, maintenance: 1 },
  by_business_use: { personal: 2, works: 2, on_project: 1 },
  assigned: 3,
  unassigned: 2,
  monthly_cost: '2100.00',
  invoiced_this_month: '997.00',
  invoiced_previous_month: '940.00',
  itv_next_30d: 1,
  itv_overdue: 1,
  // GAP-8: obligación de mantenimiento anual (KPI propio en la vista general).
  maintenance_next_30d: 1,
  maintenance_overdue: 1,
  maintenance_no_plan: 2,
  maintenance_ok: 1,
  open_alerts: { itv_due: 2 },
}

const VEHICLE = {
  id: 21,
  plate: '1234KLM',
  brand: 'Mercedes',
  model: 'Sprinter',
  state: 'active',
  state_display: 'Activo',
  business_use: 'works',
  is_substitute: false,
  driver_name: 'Carlos Ruiz',
  driver_id: 4,
  supervisor: 7,
  supervisor_name: 'Sara Supervisora',
  next_itv_date: null,
  // Última lectura y gasto del mes: las dos columnas de «cómo va».
  km_current: 53730,
  km_reading_date: '2026-09-10',
  km_estimated: false,
  fuel_avg_consumption: '6.80',
  fuel_avg_date: '2026-09-10',
  fuel: 'Diésel',
}

/** Otro coche de flota, de otro supervisor y sin exceso de km. */
const OTHER = {
  ...VEHICLE,
  id: 23,
  plate: '5678XYZ',
  brand: 'Ford',
  model: 'Transit',
  driver_name: 'Lucía Conductora',
  driver_id: 9,
  supervisor: 8,
  supervisor_name: 'Marta Supervisora',
}

/** El coche que cubre al de arriba (cuelga de su fila, plegado). */
const SUBSTITUTE = {
  ...VEHICLE,
  id: 22,
  plate: '2001CNY',
  brand: 'Kia',
  model: 'Sportage',
  is_substitute: true,
  driver_name: '',
  km_current: 1200,
  km_reading_date: null,
  fuel_avg_consumption: null,
  fuel_avg_date: null,
}

const LINK = {
  id: 5,
  main_vehicle: 21,
  substitute_vehicle: 22,
  main_vehicle_plate: '1234KLM',
  substitute_vehicle_plate: '2001CNY',
  reason: 'breakdown',
  start_date: '2026-09-01',
  end_date: null,
}

function renderHome() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <ConfirmProvider>
          <DashboardPage />
        </ConfirmProvider>
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('DashboardPage (vista general)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.fetchFleetSummary.mockResolvedValue(SUMMARY)
    mocks.listAlerts.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 1,
          type: 'itv_due',
          type_display: 'ITV programada',
          level: 'critical',
          level_display: 'Crítica',
          status: 'open',
          status_display: 'Abierta',
          vehicle: 21,
          vehicle_plate: '1234KLM',
          user: null,
          message: 'ITV vencida hace 6 días',
          due_date: null,
          created_at: '2026-07-22T00:00:00Z',
        },
      ],
    })
    mocks.listVehicles.mockResolvedValue({ count: 1, next: null, previous: null, results: [VEHICLE] })
    mocks.listVehicleLinks.mockResolvedValue({ count: 0, next: null, previous: null, results: [] })
    // Cuatro abiertas, una de ellas «En ITV»: el panel debe dejarla fuera.
    const incident = (id: number, type: string, type_display: string) => ({
      id,
      vehicle: 21,
      vehicle_plate: '1234KLM',
      type,
      type_display,
      status: 'open',
      status_display: 'Abierta',
      date: '2026-09-01',
      description: `Petición ${id}`,
    })
    // El panel carga las SIN cerrar con `listOpenIncidents` (filas directas).
    mocks.listOpenIncidents.mockResolvedValue([
      incident(1, 'breakdown', 'Avería'),
      incident(2, 'tires', 'Avería de neumáticos'),
      incident(3, 'general', 'Petición general'),
      incident(4, 'inspection', 'ITV'),
    ])
    mocks.listIncidents.mockResolvedValue({ count: 0, next: null, previous: null, results: [] })
  })

  it('«Añadir vehículo» avisa del salto y lleva a Vehículos pidiendo el alta', async () => {
    // Un testigo del destino: dice a dónde se ha ido y con qué intención.
    function Destino() {
      const { pathname, state } = useLocation()
      return <p>{`destino:${pathname}:${(state as { crear?: boolean } | null)?.crear ?? false}`}</p>
    }
    render(
      <MemoryRouter>
        <LanguageProvider>
          <ConfirmProvider>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/vehiculos" element={<Destino />} />
              <Route path="/conductores" element={<Destino />} />
            </Routes>
          </ConfirmProvider>
        </LanguageProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Vista general')

    // No se salta sin avisar: primero el modal, y cancelar deja todo igual.
    await userEvent.click(screen.getByRole('button', { name: /Añadir vehículo/ }))
    expect(await screen.findByText(/Vas a salir de la vista general/)).toBeInTheDocument()
    expect(screen.getByText(/pantalla de Vehículos/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByText(/Vas a salir/)).toBeNull())
    expect(screen.queryByText(/^destino:/)).toBeNull()

    // Aceptando, se va a Vehículos pidiendo que se abra el alta.
    await userEvent.click(screen.getByRole('button', { name: /Añadir vehículo/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ir y crear' }))
    expect(await screen.findByText('destino:/vehiculos:true')).toBeInTheDocument()
  })

  it('«Añadir conductor» lleva a Conductores con la misma advertencia', async () => {
    function Destino() {
      const { pathname, state } = useLocation()
      return <p>{`destino:${pathname}:${(state as { crear?: boolean } | null)?.crear ?? false}`}</p>
    }
    render(
      <MemoryRouter>
        <LanguageProvider>
          <ConfirmProvider>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/conductores" element={<Destino />} />
            </Routes>
          </ConfirmProvider>
        </LanguageProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Vista general')

    await userEvent.click(screen.getByRole('button', { name: /Añadir conductor/ }))
    expect(await screen.findByText(/pantalla de Conductores/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ir y crear' }))
    expect(await screen.findByText('destino:/conductores:true')).toBeInTheDocument()
  })

  it('pinta KPIs, fila del listado y el detalle de la alerta en su modal', async () => {
    renderHome()
    expect(await screen.findByText('Vista general')).toBeInTheDocument()
    expect(await screen.findByText('3 activos · 1 en taller')).toBeInTheDocument()
    // GAP-8: el KPI de mantenimiento anual anuncia los incumplimientos.
    expect(screen.getByText('Mantenimiento anual (30 días)')).toBeInTheDocument()
    expect(screen.getByText('1 vencido · 2 sin plan')).toBeInTheDocument()
    // El listado muestra la matrícula (una vez) y el conductor.
    expect(await screen.findByText('Carlos Ruiz')).toBeInTheDocument()
    expect(screen.getByText('1234KLM')).toBeInTheDocument()
    // La tira abre la MISMA lista que la ficha, pero de toda la flota: entra
    // por la pestaña de alertas, con la matrícula en cada fila.
    await userEvent.click(
      screen.getByRole('button', { name: /Alertas que requieren atención/i }),
    )
    expect(await screen.findByText('ITV vencida hace 6 días')).toBeInTheDocument()
    expect(screen.getAllByText('1234KLM').length).toBeGreaterThanOrEqual(2)
    // Las dos pestañas de la lista, con lo abierto de cada una.
    expect(screen.getByRole('tab', { name: /Alertas/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: /Incidencias/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Abiertas' })).toBeInTheDocument()
  })

  it('la única ITV es la alerta «ITV programada»: el panel de incidencias cataloga sin ITV', async () => {
    renderHome()
    // Chip de la tira de alertas con el nombre nuevo.
    expect(await screen.findByRole('button', { name: /ITV programada/ })).toBeInTheDocument()

    // Tira de incidencias: categorías del catálogo, con la «En ITV» filtrada
    // (4 abiertas en el back → 3 en el panel).
    const lead = await screen.findByRole('button', { name: /Incidencias abiertas/ })
    const strip = lead.closest('.alerts-strip') as HTMLElement
    expect(within(strip).getByRole('button', { name: 'Averías 1' })).toBeInTheDocument()
    expect(within(strip).getByRole('button', { name: 'Averías de neumáticos 1' })).toBeInTheDocument()
    expect(within(strip).getByRole('button', { name: 'Peticiones generales 1' })).toBeInTheDocument()
    expect(within(strip).queryByRole('button', { name: /ITV/ })).not.toBeInTheDocument()
    expect(within(strip).getByText(/3 abiertas/)).toBeInTheDocument()
  })

  it('un chip de la tira abre la lista ya filtrada, y la «En ITV» no está', async () => {
    renderHome()
    const lead = await screen.findByRole('button', { name: /Incidencias abiertas/ })
    const strip = lead.closest('.alerts-strip') as HTMLElement
    await userEvent.click(within(strip).getByRole('button', { name: 'Averías 1' }))
    // Abre en Incidencias y con el tipo del chip ya puesto en el filtro.
    expect(await screen.findByText('Petición 1')).toBeInTheDocument()
    expect(screen.queryByText('Petición 2')).toBeNull()
    // Sin filtro salen las demás, pero la «En ITV» sigue fuera: la única ITV
    // que enseña el panel es su alerta.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), '')
    expect(await screen.findByText('Petición 2')).toBeInTheDocument()
    expect(screen.queryByText('Petición 4')).toBeNull()
  })

  it('la tabla dice cómo va el coche: km con su antigüedad y gasto del mes', async () => {
    renderHome()
    // Odómetro y, debajo, cuánto lleva sin leerse (hoy es 2026-09-14 en el
    // entorno de pruebas solo si se congela; por eso se busca por patrón).
    expect(await screen.findByText('53.730 km')).toBeInTheDocument()
    expect(screen.getByText(/sin lectura/)).toBeInTheDocument()
    // Consumo medio: la última anotación arriba y, debajo, el TIPO y el día.
    expect(screen.getByText('6,80')).toBeInTheDocument()
    expect(screen.getByText(/Diésel · 10 sept 2026/)).toBeInTheDocument()
    expect(screen.queryByText(/Litros|Importe/)).toBeNull()
  })

  it('un coche cubierto despliega a su sustituto; el que no lo está, no', async () => {
    mocks.listVehicles.mockResolvedValue({
      count: 2,
      next: null,
      previous: null,
      results: [VEHICLE, SUBSTITUTE],
    })
    mocks.listVehicleLinks.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [LINK],
    })
    renderHome()
    // Una sola flecha: la del coche cubierto (el sustituto está en su pestaña).
    const flechas = await screen.findAllByRole('button', { name: 'Desplegar fila' })
    expect(flechas).toHaveLength(1)

    await userEvent.click(flechas[0])
    // La fila de debajo trae al sustituto, con desde cuándo lo cubre.
    expect(await screen.findByText(/Coche de sustitución/)).toBeInTheDocument()
    expect(screen.getByText(/Cubre desde/)).toBeInTheDocument()
    expect(screen.getAllByText('2001CNY').length).toBeGreaterThanOrEqual(1)
  })

  it('la tabla filtra por supervisor y por cortes, y «Exportar» no se esconde', async () => {
    mocks.listVehicles.mockResolvedValue({
      count: 2,
      next: null,
      previous: null,
      results: [VEHICLE, OTHER],
    })
    // El exceso de km sale de su alerta abierta: la tiene solo el 1234KLM.
    mocks.listAlerts.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [
        {
          id: 9,
          type: 'km_overage',
          type_display: 'Exceso de km',
          level: 'warning',
          level_display: 'Aviso',
          status: 'open',
          status_display: 'Abierta',
          vehicle: 21,
          vehicle_plate: '1234KLM',
          user: null,
          message: 'Proyección por encima del contrato',
          due_date: null,
          created_at: '2026-09-01T00:00:00Z',
        },
      ],
    })
    renderHome()

    // La columna de supervisor sale en la tabla…
    expect(await screen.findByRole('columnheader', { name: /Supervisor/ })).toBeInTheDocument()
    expect(await screen.findByText('Sara Supervisora')).toBeInTheDocument()
    // …y «Exportar CSV» está a la vista SIN abrir el acordeón.
    expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Buscar y exportar/i }))
    // Las matrículas de la TABLA (los nombres también están en el desplegable).
    const tabla = () => within(screen.getByRole('table'))
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filtrar por supervisor' }),
      '8',
    )
    expect(tabla().queryByText('1234KLM')).toBeNull()
    expect(tabla().getByText('5678XYZ')).toBeInTheDocument()

    // Los cortes van en su desplegable y se combinan con lo demás: con el de
    // km sobrepasados, el coche de Marta (sin alerta) se cae.
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filtrar por supervisor' }),
      '',
    )
    await userEvent.click(screen.getByText('Ninguno'))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Km sobrepasados' }))
    expect(tabla().getByText('1234KLM')).toBeInTheDocument()
    expect(tabla().queryByText('5678XYZ')).toBeNull()
  })

  it('el filtro "Sin conductor" pide assigned=false al back', async () => {
    renderHome()
    await screen.findAllByText('1234KLM')
    // La franja de filtros es un acordeón colapsado: hay que abrirlo primero.
    await userEvent.click(screen.getByRole('button', { name: /Buscar y exportar/i }))
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filtrar por asignación' }),
      'unassigned',
    )
    // M14: el segundo argumento es el transporte (`signal`) de la carga en curso.
    expect(mocks.listVehicles).toHaveBeenLastCalledWith(
      expect.objectContaining({ assigned: false }),
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it('resolver una alerta de ITV abre «Registrar ITV», no una nota suelta', async () => {
    renderHome()
    await userEvent.click(
      await screen.findByRole('button', { name: /Alertas que requieren atención/i }),
    )
    // El ✓ de la fila (la alerta del mock es una ITV) abre el registro de la
    // ITV. En la lista de la flota, el botón dice de qué coche es.
    await userEvent.click(
      await screen.findByRole('button', { name: 'Resolver · 1234KLM · ITV programada' }),
    )
    expect(
      await screen.findByRole('dialog', { name: 'Registrar ITV · 1234KLM' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Resultado' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/taller avisado/)).toBeNull()
  })

  it('una incidencia EN CURSO sale en el modal y su ✓ abre el cierre de su tipo', async () => {
    mocks.listOpenIncidents.mockResolvedValue([
      {
        id: 4,
        vehicle: 21,
        type: 'breakdown',
        type_display: 'Avería',
        date: '2026-08-20',
        description: 'No arranca en frío',
        details: {},
        status: 'on_going',
        status_display: 'En curso',
        cost: null,
      },
    ])
    renderHome()
    await userEvent.click(await screen.findByRole('button', { name: /Incidencias abiertas/i }))
    expect(await screen.findByText('No arranca en frío')).toBeInTheDocument()
    expect(screen.getByText('En curso')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Resolver · 1234KLM · Avería' }))
    expect(
      await screen.findByRole('dialog', { name: 'Resolver avería · 1234KLM' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolver y cerrar' })).toBeInTheDocument()
  })

  it('R5-37: resolver dentro de la lista de la flota recarga el panel UNA vez, al cerrar', async () => {
    mocks.registerItv.mockResolvedValue({
      id: 9,
      alerts_resolved: 1,
      incident_closed: null,
      vehicle_reactivated: false,
    })
    renderHome()
    await userEvent.click(
      await screen.findByRole('button', { name: /Alertas que requieren atención/i }),
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Resolver · 1234KLM · ITV programada' }),
    )
    await screen.findByRole('dialog', { name: 'Registrar ITV · 1234KLM' })
    // Hasta aquí: el panel y la lista del modal han pedido las alertas.
    const antes = mocks.listAlerts.mock.calls.length
    const incidenciasAntes = mocks.listOpenIncidents.mock.calls.length
    await userEvent.type(screen.getByLabelText('Próxima ITV'), '2028-09-01')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }))
    await waitFor(() => expect(mocks.registerItv).toHaveBeenCalled())
    // La lista del modal se recarga (una petición más); el panel, que está
    // debajo y no se ve, todavía no.
    await waitFor(() => expect(mocks.listAlerts.mock.calls.length).toBe(antes + 1))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Registrar ITV · 1234KLM' })).toBeNull(),
    )
    expect(mocks.listOpenIncidents.mock.calls.length).toBe(incidenciasAntes + 1)
    // Al cerrar el modal, el panel pide lo suyo: una vez.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(mocks.listAlerts.mock.calls.length).toBe(antes + 2))
    expect(mocks.listOpenIncidents.mock.calls.length).toBe(incidenciasAntes + 2)
  })
})
