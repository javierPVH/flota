import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VehiclesPage } from './VehiclesPage.tsx'
import { ConfirmProvider } from '../components/ConfirmDialog.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  listVehicleLinks: vi.fn(),
  listMaintenancePlans: vi.fn(),
  fetchVehicle: vi.fn(),
  listAlerts: vi.fn(),
  listOpenIncidents: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  listVehicleLinks: mocks.listVehicleLinks,
  listMaintenancePlans: mocks.listMaintenancePlans,
  fetchVehicle: mocks.fetchVehicle,
  // Las pide «Alertas e incidencias» (la tarjeta de la ficha, en modal).
  listAlerts: mocks.listAlerts,
  listOpenIncidents: mocks.listOpenIncidents,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

function vehicle(id: number, plate: string, brand: string, model: string) {
  return {
    id,
    plate,
    brand,
    model,
    state: 'active',
    state_display: 'Activo',
    is_substitute: false,
    supervisor: null,
    supervisor_name: '',
    driver_name: '',
    driver_id: null,
    next_itv_date: null,
    insurance_expiry_date: null,
    business_use: 'works',
    // Cómo va el coche (mismas columnas que el panel).
    km_current: 53730,
    km_reading_date: '2026-09-10',
    km_estimated: false,
    fuel: 'Diésel',
    fuel_month_liters: '55.50',
    fuel_month_amount: '77.00',
  }
}

// El snapshot que dejaría la lista al salir a una ficha (lo que guarda al
// desmontar). La clave debe coincidir con VIEW_KEY del componente.
const VIEW_KEY = 'gestion.vehiclesView'
function seedView(search: string) {
  sessionStorage.setItem(
    VIEW_KEY,
    JSON.stringify({
      tab: 'fleet',
      search,
      stateFilter: '',
      supervisorFilter: '',
      dueItv: false,
      dueInsurance: false,
      showBajas: false,
      appliedFrom: '',
      appliedTo: '',
      scrollTop: 0,
    }),
  )
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/vehiculos']}>
      <LanguageProvider>
        <ConfirmProvider>
          <VehiclesPage />
        </ConfirmProvider>
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('VehiclesPage — volver a donde estábamos', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    sessionStorage.clear()
    mocks.listVehicles.mockResolvedValue(
      page([vehicle(1, '1111AAA', 'Seat', 'Ibiza'), vehicle(2, '2222BBB', 'Ford', 'Focus')]),
    )
    mocks.listVehicleLinks.mockResolvedValue(page([]))
    mocks.listMaintenancePlans.mockResolvedValue(page([]))
    // El formulario de edición pide la ficha al abrirse; el resto de sus
    // catálogos no hace falta para comprobar que el modal sale.
    mocks.fetchVehicle.mockResolvedValue(vehicle(1, '1111AAA', 'Seat', 'Ibiza'))
    mocks.listAlerts.mockResolvedValue(page([]))
    mocks.listOpenIncidents.mockResolvedValue([])
  })
  afterEach(() => sessionStorage.clear())

  it('al VOLVER (POP) restaura el filtro guardado de la lista', async () => {
    // Simula que salimos a una ficha con la lista filtrada por «2222».
    seedView('2222')
    const { container } = renderList()

    // La lista aparece filtrada como estaba (solo el 2222BBB)…
    await waitFor(() => expect(screen.getByText('2222BBB')).toBeInTheDocument())
    expect(screen.queryByText('1111AAA')).not.toBeInTheDocument()
    // …con su buscador cargado (id propio: hay otro buscador igual en el modal
    // de exportación).
    const search = container.querySelector<HTMLInputElement>('#veh-search')
    expect(search?.value).toBe('2222')
  })

  it('sin snapshot (entrada nueva) la lista arranca limpia y completa', async () => {
    const { container } = renderList()

    await waitFor(() => expect(screen.getByText('1111AAA')).toBeInTheDocument())
    expect(screen.getByText('2222BBB')).toBeInTheDocument()
    // La barra está a la vista y su buscador, vacío.
    const search = container.querySelector<HTMLInputElement>('#veh-search')
    expect(search?.value).toBe('')
  })

  /** El menú ⋮ resuelve en MODAL, sin salir del listado (antes «Editar»
   * navegaba a /vehiculos/:id/editar y se perdían filtros y posición). */
  it('la tabla trae kilómetros y combustible, y el sustituto cuelga de su fila', async () => {
    const sub = { ...vehicle(3, '3333CCC', 'Kia', 'Sportage'), is_substitute: true }
    mocks.listVehicles.mockResolvedValue(
      page([vehicle(1, '1111AAA', 'Seat', 'Ibiza'), vehicle(2, '2222BBB', 'Ford', 'Focus'), sub]),
    )
    mocks.listVehicleLinks.mockResolvedValue(
      page([
        {
          id: 7,
          main_vehicle: 1,
          substitute_vehicle: 3,
          main_vehicle_plate: '1111AAA',
          substitute_vehicle_plate: '3333CCC',
          reason: 'breakdown',
          start_date: '2026-09-01',
          end_date: null,
        },
      ]),
    )
    renderList()
    await waitFor(() => expect(screen.getByText('1111AAA')).toBeInTheDocument())

    // Kilómetros con su antigüedad, y combustible en litros + tipo (sin importe).
    expect(screen.getAllByText('53.730 km').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/sin lectura/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('55,50 l').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Diésel').length).toBeGreaterThan(0)
    expect(screen.queryByText(/77,00/)).toBeNull()

    // «Exportar CSV» sigue en la cabecera de la página.
    expect(screen.getByRole('button', { name: /Exportar CSV/ })).toBeInTheDocument()

    // Solo el coche cubierto lleva flecha, y debajo sale su sustituto.
    const flechas = screen.getAllByRole('button', { name: 'Desplegar fila' })
    expect(flechas).toHaveLength(1)
    await userEvent.click(flechas[0])
    expect(await screen.findByText(/Coche de sustitución/)).toBeInTheDocument()
    expect(screen.getByText(/Cubre desde/)).toBeInTheDocument()
  })

  it('«Editar» abre el formulario del vehículo en un modal, sin navegar', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('1111AAA')).toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('button', { name: 'Acciones' })[0])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Editar' }))
    expect(await screen.findByText('Editar 1111AAA')).toBeInTheDocument()
  })

  /** La tarjeta de la ficha tiene una segunda cara: el mismo cuerpo en modal,
   * para repasar y cerrar lo del coche sin salir del listado. */
  it('«Alertas e incidencias» abre la tarjeta del coche en un modal', async () => {
    mocks.listOpenIncidents.mockResolvedValue([
      {
        id: 4,
        vehicle: 1,
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
    renderList()
    await waitFor(() => expect(screen.getByText('1111AAA')).toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('button', { name: 'Acciones' })[0])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Alertas e incidencias' }))

    const dialog = await screen.findByRole('dialog', { name: 'Alertas e incidencias · 1111AAA' })
    // Abre en «Nuevo estado»: el formulario que antes era otra acción del menú.
    expect(within(dialog).getByRole('tab', { name: 'Nuevo estado' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(dialog).getByRole('combobox', { name: 'Nuevo estado' })).toBeInTheDocument()

    // Y las otras dos pestañas llevan a lo mismo que la tarjeta de la ficha.
    await userEvent.click(within(dialog).getByRole('tab', { name: 'Incidencias 1' }))
    expect(within(dialog).getByRole('tab', { name: 'Cerradas' })).toBeInTheDocument()
    expect(within(dialog).getByText('No arranca en frío')).toBeInTheDocument()
    // Filtrar y ordenar, sí; abrir cosas nuevas, no: para eso ya está el ⋮.
    expect(within(dialog).getByRole('combobox', { name: 'Tipo' })).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: 'Ordenar' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Nueva incidencia' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Parte de accidente' })).toBeNull()
  })

  it('«Programar ITV y mantenimiento» abre su modal desde el menú', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('1111AAA')).toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('button', { name: 'Acciones' })[0])
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Programar ITV y mantenimiento' }),
    )
    expect(
      await screen.findByText('Programar ITV y mantenimiento · 1111AAA'),
    ).toBeInTheDocument()
    // Sin fecha de ITV, el bloque ofrece programarla (no hay nada que enseñar).
    expect(screen.getByText(/No hay ninguna ITV a la vista/)).toBeInTheDocument()
  })
})
