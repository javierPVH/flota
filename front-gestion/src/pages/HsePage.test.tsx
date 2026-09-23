import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HsePage } from './HsePage.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  listIncidents: vi.fn(),
  listAlerts: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  listIncidents: mocks.listIncidents,
  listAlerts: mocks.listAlerts,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const VEHICLE = {
  id: 21,
  plate: '1234KLM',
  brand: 'Seat',
  model: 'Leon',
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  driver_id: 7,
  driver_name: 'Carlos Pérez',
  supervisor: 3,
  supervisor_name: 'Sara Ruiz',
  site_display: 'Madrid',
  next_itv_date: '2030-01-15',
  insurance_expiry_date: '2030-02-01',
  km_current: 53730,
  km_reading_date: '2026-09-20',
  fuel: 'Diésel',
}

const OPEN = {
  id: 4,
  vehicle: 21,
  vehicle_plate: '1234KLM',
  vehicle_state: 'active',
  type: 'breakdown',
  type_display: 'Avería',
  priority: 'critical',
  priority_display: 'Crítica',
  date: '2026-08-20',
  description: 'No arranca en frío',
  mileage: null,
  workshop_postal_code: '28045',
  workshop_name: 'Talleres Ejemplo',
  details: {},
  accident_report: null,
  status: 'open',
  status_display: 'Abierta',
  cost: null,
}
const CLOSED = {
  ...OPEN,
  id: 5,
  type: 'tires',
  type_display: 'Avería de neumáticos',
  description: 'Rueda cambiada',
  status: 'closed',
  status_display: 'Cerrada',
  cost: '210.00',
}
const ACCIDENT = {
  ...OPEN,
  id: 7,
  type: 'accident',
  type_display: 'Accidente',
  description: 'Alcance por detrás',
  accident_report: {
    street: 'Calle Mayor',
    street_number: '12',
    postal_code: '28013',
    locality: 'Madrid',
    province: 'Madrid',
    occurred_at: '2026-08-20T14:35:00Z',
    phone: '600111222',
    police_report_ref: 'ATG-2026-77',
    third_parties: [
      {
        id: 1,
        name: 'Lucía Ramos',
        plate: '9999ZZZ',
        brand: 'Renault',
        model: 'Clio',
        phone: '600333444',
        insurance_company: 'Aseguradora Ejemplo',
        policy_number: 'POL-123',
        damage_description: 'Paragolpes delantero',
      },
    ],
    injured: [],
  },
}

const ALERT = {
  id: 9,
  type: 'itv_due',
  type_display: 'ITV programada',
  level: 'warning',
  level_display: 'Aviso',
  status: 'open',
  status_display: 'Abierta',
  vehicle: 21,
  vehicle_plate: '1234KLM',
  vehicle_state: 'active',
  user: null,
  message: 'La ITV del 1234KLM vence en 20 días',
  due_date: '2030-01-15',
  created_at: '2026-09-01T00:00:00Z',
  dedup_key: 'itv:21',
  driver_id: 7,
  driver_name: 'Carlos Pérez',
  supervisor_id: 3,
  supervisor_name: 'Sara Ruiz',
  resolved_at: null,
  resolved_by: null,
  resolved_by_name: '',
  resolution_note: '',
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <HsePage />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

/** Lo que una vista de solo lectura no puede tener: acciones sobre las filas. */
const ACCIONES = /^(Resolver|Editar|Documentos|Ver la incidencia|Acciones|Nueva incidencia|Nuevo vehículo|Mandar correo|Registrar ITV|Cambiar conductor)$/

describe('HsePage (vista de solo lectura)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    vi.clearAllMocks()
    mocks.listVehicles.mockResolvedValue(page([VEHICLE]))
    mocks.listIncidents.mockResolvedValue(page([OPEN, CLOSED, ACCIDENT]))
    mocks.listAlerts.mockResolvedValue(page([ALERT]))
  })

  it('cuatro pestañas con su recuento y, de salida, los vehículos sin enlaces ni acciones', async () => {
    renderPage()
    expect(await screen.findByText('1234KLM')).toBeInTheDocument()

    // Vehículos · Incidencias (las 2 abiertas) · Accidentes (1) · Alertas (1).
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((b) => b.textContent)).toEqual([
      'Vehículos 1',
      'Incidencias 2',
      'Accidentes 1',
      'Alertas 1',
    ])

    // La fila dice quién lo lleva y quién responde de él.
    const fila = screen.getByText('1234KLM').closest('tr') as HTMLElement
    expect(within(fila).getByText('Carlos Pérez')).toBeInTheDocument()
    expect(within(fila).getByText('Sara Ruiz')).toBeInTheDocument()
    expect(within(fila).getByText('Seat Leon')).toBeInTheDocument()
    expect(within(fila).getByText('53.730 km')).toBeInTheDocument()

    // Ni enlaces a la ficha ni columna de acciones: aquí solo se mira.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ACCIONES })).not.toBeInTheDocument()
    expect(screen.queryByText('Acciones')).not.toBeInTheDocument()
    // Exportar lo que se ve es lo único que se hace.
    expect(screen.getByRole('button', { name: /Exportar CSV/ })).toBeEnabled()
  })

  it('incidencias: de salida las pendientes, y el estado cambia el corte', async () => {
    renderPage()
    await screen.findByText('1234KLM')
    await userEvent.click(screen.getByRole('tab', { name: /^Incidencias/ }))

    expect(await screen.findByText('No arranca en frío')).toBeInTheDocument()
    expect(screen.getByText('Alcance por detrás')).toBeInTheDocument()
    expect(screen.queryByText('Rueda cambiada')).not.toBeInTheDocument()
    // Lo que el parte trae y la bandeja también enseña: CP, taller, prioridad.
    const fila = screen.getByText('No arranca en frío').closest('tr') as HTMLElement
    expect(within(fila).getByText('28045')).toBeInTheDocument()
    expect(within(fila).getByText('Talleres Ejemplo')).toBeInTheDocument()
    expect(within(fila).getByText('Crítica')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ACCIONES })).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'closed')
    expect(await screen.findByText('Rueda cambiada')).toBeInTheDocument()
    expect(screen.queryByText('No arranca en frío')).not.toBeInTheDocument()
  })

  it('accidentes: solo los de ese tipo, y la fila despliega el parte', async () => {
    renderPage()
    await screen.findByText('1234KLM')
    await userEvent.click(screen.getByRole('tab', { name: /^Accidentes/ }))

    expect(await screen.findByText('Alcance por detrás')).toBeInTheDocument()
    expect(screen.queryByText('No arranca en frío')).not.toBeInTheDocument()
    // Lo propio del accidente ya va en columnas: atestado y lugar.
    expect(screen.getByText('ATG-2026-77')).toBeInTheDocument()
    expect(screen.getByText('Calle Mayor 12 · 28013 · Madrid · Madrid')).toBeInTheDocument()

    // Y el parte entero, debajo: terceros con su aseguradora.
    const flechas = screen.getAllByRole('button', { name: 'Desplegar fila' })
    expect(flechas).toHaveLength(1)
    await userEvent.click(flechas[0])
    expect(await screen.findByText('Terceros implicados (1)')).toBeInTheDocument()
    expect(screen.getByText('Aseguradora Ejemplo')).toBeInTheDocument()
    expect(screen.getByText('9999ZZZ')).toBeInTheDocument()
  })

  it('alertas: las abiertas de salida, y «Resueltas» las pide al back', async () => {
    renderPage()
    await screen.findByText('1234KLM')
    await waitFor(() => expect(mocks.listAlerts).toHaveBeenCalledWith({ status: 'open' }, expect.anything()))
    await userEvent.click(screen.getByRole('tab', { name: /^Alertas/ }))

    expect(await screen.findByText('La ITV del 1234KLM vence en 20 días')).toBeInTheDocument()
    const fila = screen.getByText('La ITV del 1234KLM vence en 20 días').closest('tr') as HTMLElement
    expect(within(fila).getByText('Carlos Pérez')).toBeInTheDocument()
    expect(within(fila).getByText('1234KLM')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ACCIONES })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Alertas/ })).toHaveTextContent('1')

    mocks.listAlerts.mockResolvedValue(page([]))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'resolved')
    await waitFor(() =>
      expect(mocks.listAlerts).toHaveBeenCalledWith({ status: 'resolved' }, expect.anything()),
    )
    expect(await screen.findByText('Sin alertas con estos filtros.')).toBeInTheDocument()
    // El recuento de la pestaña es lo ABIERTO, no lo que se está mirando.
    expect(screen.getByRole('tab', { name: /^Alertas/ })).toHaveTextContent('1')
  })

  it('la búsqueda es de la pestaña: al cambiar se empieza en limpio', async () => {
    mocks.listVehicles.mockResolvedValue(page([VEHICLE, { ...VEHICLE, id: 22, plate: '5678XYZ', driver_name: 'Lucía Gil' }]))
    renderPage()
    await screen.findByText('5678XYZ')

    await userEvent.type(screen.getByRole('searchbox'), 'lucía')
    expect(screen.queryByText('1234KLM')).not.toBeInTheDocument()
    expect(screen.getByText('5678XYZ')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /^Incidencias/ }))
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(await screen.findByText('No arranca en frío')).toBeInTheDocument()
  })
})
