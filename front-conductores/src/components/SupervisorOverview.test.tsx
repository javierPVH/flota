// IndexedDB no existe en jsdom: fake-indexeddb ANTES de importar la cola (los
// modales de resolver escriben en ella cuando no hay red).
import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  fetchVehicleSummaries: vi.fn(),
  listAlerts: vi.fn(),
  listIncidents: vi.fn(),
  resolveAlert: vi.fn(),
  resolveIncident: vi.fn(),
  roles: ['driver', 'supervisor'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  listVehiclesCached: mocks.listVehicles,
  fetchVehicleSummaries: mocks.fetchVehicleSummaries,
  fetchVehicleSummariesCached: mocks.fetchVehicleSummaries,
  listAlerts: mocks.listAlerts,
  listIncidents: mocks.listIncidents,
  resolveAlert: mocks.resolveAlert,
  resolveIncident: mocks.resolveIncident,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'sara', roles: mocks.roles } }),
}))

import { SupervisorOverview } from './SupervisorOverview.tsx'

const CAR = {
  id: 3,
  plate: '7890NPQ',
  brand: 'Tesla',
  model: 'Model 3',
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  next_itv_date: null,
}
// Un coche SIN conductor: es el que descuadra el recuento de gente si el
// filtro se despista (no puede contar como conductor un null).
const EMPTY_CAR = { ...CAR, id: 4, plate: '2003FGG', state_display: 'Activo' }
// El coche 9 («9999ZZZ») NO se supervisa: lo conduce ella, así que llega en el
// ámbito del back —en los resúmenes, en sus alertas y en sus incidencias— y no
// debe sumar en «a tu cargo». Por eso no está en `listVehicles`.

const ALERT = {
  id: 11,
  vehicle: 3,
  vehicle_plate: '7890NPQ',
  type: 'insurance_due',
  type_display: 'Seguro próximo / vencido',
  level: 'warning',
  level_display: 'Aviso',
  status: 'open',
  status_display: 'Abierta',
  message: 'Seguro en 15 días',
  due_date: null,
}
const INCIDENT = {
  id: 21,
  vehicle: 3,
  type: 'breakdown',
  type_display: 'Avería',
  date: '2026-09-01',
  description: 'No arranca',
  status: 'open',
  status_display: 'Abierta',
  details: {},
  mileage: null,
  workshop_postal_code: '',
  cost: null,
}
const ACCIDENT = { ...INCIDENT, id: 22, type: 'accident', type_display: 'Accidente' }
// Cerrada: no cuenta (las cifras son de lo ABIERTO).
const CLOSED = { ...INCIDENT, id: 23, status: 'closed', status_display: 'Cerrada' }

function renderOverview() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <SupervisorOverview />
      </MemoryRouter>
    </LanguageProvider>,
  )
}

/** La cifra que pinta un botón («Coches: 2» va en su aria-label). */
const figure = (label: string) =>
  screen.getByRole('button', { name: new RegExp(`^${label}: `) }).getAttribute('aria-label')

describe('SupervisorOverview — las cifras que encabezan «Flota»', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.roles = ['driver', 'supervisor']
    mocks.listVehicles.mockResolvedValue({ count: 2, results: [CAR, EMPTY_CAR] })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { vehicle: 3, plate: '7890NPQ', driver: { id: 5, name: 'Carlos C' } },
      { vehicle: 4, plate: '2003FGG', driver: null },
      { vehicle: 9, plate: '9999ZZZ', driver: { id: 1, name: 'Sara S' } },
    ])
    mocks.listAlerts.mockResolvedValue({ count: 2, results: [ALERT, { ...ALERT, id: 12, vehicle: 9, vehicle_plate: '9999ZZZ' }] })
    mocks.listIncidents.mockResolvedValue({
      count: 4,
      results: [INCIDENT, ACCIDENT, CLOSED, { ...INCIDENT, id: 24, vehicle: 9 }],
    })
  })

  it('es UNA tarjeta plegable con los dos bloques de cifras dentro', async () => {
    const { container } = renderOverview()
    await screen.findByText('A tu cargo')

    // Un solo div, no dos: son dos preguntas —lo que tienes y lo que hay que
    // atender— pero del mismo resumen, y cada bloque conserva sus cifras.
    expect(container.querySelectorAll('section.card')).toHaveLength(1)
    expect(screen.getByText('Alertas e incidencias')).toBeInTheDocument()
    const bloques = container.querySelectorAll<HTMLElement>('.stat-row')
    expect(bloques).toHaveLength(2)
    expect(within(bloques[0]).getByLabelText(/^Coches:/)).toBeInTheDocument()
    expect(within(bloques[0]).getByLabelText(/^Conductores:/)).toBeInTheDocument()
    expect(within(bloques[0]).queryByLabelText(/^Alertas:/)).not.toBeInTheDocument()
    for (const nombre of [/^Alertas:/, /^Incidencias:/, /^Accidentes:/]) {
      expect(within(bloques[1]).getByLabelText(nombre)).toBeInTheDocument()
    }

    // Nace desplegada —es lo que se viene a ver— y se pliega entera, con los
    // dos bloques, para llegar antes a la lista de coches.
    const cuerpo = bloques[0].closest('.acc-body') as HTMLElement
    expect(cuerpo).not.toHaveAttribute('hidden')
    await userEvent.click(screen.getByRole('button', { name: /^A tu cargo/ }))
    expect(cuerpo).toHaveAttribute('hidden')
  })

  it('cuenta lo suyo y lo abierto: ni el coche ajeno, ni el cerrado, ni el hueco sin conductor', async () => {
    renderOverview()
    await screen.findByText('A tu cargo')

    expect(figure('Coches')).toBe('Coches: 2')
    // 2003FGG no tiene quien lo lleve y 9999ZZZ no es suyo → un conductor.
    expect(figure('Conductores')).toBe('Conductores: 1')
    // La del coche ajeno llega en el ámbito del back y no cuenta aquí.
    expect(figure('Alertas')).toBe('Alertas: 1')
    // La cerrada no, el accidente va a su propia cifra, la del coche ajeno no.
    expect(figure('Incidencias')).toBe('Incidencias: 1')
    expect(figure('Accidentes')).toBe('Accidentes: 1')
  })

  it('cada cifra abre su lista', async () => {
    renderOverview()
    await screen.findByText('A tu cargo')

    await userEvent.click(screen.getByRole('button', { name: /^Coches: / }))
    const dialog = await screen.findByRole('dialog', { name: 'Coches' })
    expect(dialog).toHaveTextContent('7890NPQ')
    expect(dialog).toHaveTextContent('2003FGG')
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }))

    await userEvent.click(screen.getByRole('button', { name: /^Conductores: / }))
    expect(await screen.findByRole('dialog', { name: 'Conductores' })).toHaveTextContent('Carlos C')
  })

  it('el accidente no se cuela entre las incidencias, y viceversa', async () => {
    renderOverview()
    await screen.findByText('A tu cargo')

    await userEvent.click(screen.getByRole('button', { name: /^Incidencias: / }))
    const incidencias = await screen.findByRole('dialog', { name: 'Incidencias' })
    expect(incidencias).toHaveTextContent('Avería')
    expect(incidencias).not.toHaveTextContent('Accidente')
  })

  it('las listas largas se acotan: por tipo y por lo que se escribe', async () => {
    // Tres incidencias abiertas de DOS tipos en coches suyos: con una sola
    // fila la barra no se pinta (no hay nada que acotar).
    mocks.listIncidents.mockResolvedValue({
      count: 3,
      results: [
        INCIDENT,
        { ...INCIDENT, id: 25, vehicle: 4, type: 'maintenance', type_display: 'Mantenimiento puntual', description: 'Revisión de frenos' },
        { ...INCIDENT, id: 26, vehicle: 4, description: 'Luna delantera con impacto' },
      ],
    })
    renderOverview()
    await screen.findByText('A tu cargo')

    await userEvent.click(screen.getByRole('button', { name: /^Incidencias: / }))
    const dialog = await screen.findByRole('dialog', { name: 'Incidencias' })
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(3)

    // Lo escrito busca en el tipo, la descripción y la MATRÍCULA, sin acentos.
    await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Buscar' }), 'revision')
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(1)
    expect(dialog).toHaveTextContent('Mantenimiento puntual')

    // El tipo se suma a lo escrito: juntos no dejan nada, y se dice.
    await userEvent.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Filtrar por tipo' }),
      'breakdown',
    )
    expect(within(dialog).getByText('Nada coincide con lo que buscas.')).toBeInTheDocument()

    // Sin texto, el tipo deja las dos averías.
    await userEvent.clear(within(dialog).getByRole('searchbox', { name: 'Buscar' }))
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(2)
  })

  it('la lista de alertas se busca por matrícula, y el filtro se olvida al abrir otra', async () => {
    mocks.listAlerts.mockResolvedValue({
      count: 2,
      results: [
        ALERT,
        { ...ALERT, id: 13, vehicle: 4, vehicle_plate: '2003FGG', type: 'itv_due', type_display: 'ITV próxima' },
      ],
    })
    renderOverview()
    await screen.findByText('A tu cargo')

    await userEvent.click(screen.getByRole('button', { name: /^Alertas: / }))
    const dialog = await screen.findByRole('dialog', { name: 'Alertas' })
    await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Buscar' }), '2003')
    // Queda la de ese coche y solo esa. (Se mira por la MATRÍCULA de la
    // tarjeta: los tipos siguen todos en el desplegable, que es su catálogo.)
    expect(within(dialog).getByText('2003FGG')).toBeInTheDocument()
    expect(within(dialog).queryByText('7890NPQ')).not.toBeInTheDocument()

    // Lo tecleado es de ESA lista: al abrir otra se empieza en limpio.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }))
    await userEvent.click(screen.getByRole('button', { name: /^Incidencias: / }))
    const incidencias = await screen.findByRole('dialog', { name: 'Incidencias' })
    expect(incidencias).toHaveTextContent('Avería')
  })

  it('resuelve una alerta SIN salir de la pantalla, y la cifra baja', async () => {
    mocks.resolveAlert.mockResolvedValue({})
    renderOverview()
    await screen.findByText('A tu cargo')

    await userEvent.click(screen.getByRole('button', { name: /^Alertas: / }))
    await screen.findByRole('dialog', { name: 'Alertas' })
    // El seguro no tiene formulario propio: se cierra con observaciones.
    await userEvent.click(screen.getByRole('button', { name: 'Resolver' }))

    // Al resolver, se relee todo: la alerta ya no está.
    mocks.listAlerts.mockResolvedValue({ count: 0, results: [] })
    const dialog = await screen.findByRole('dialog', { name: /Resolver/ })
    await userEvent.click(within(dialog).getByRole('button', { name: /Resolver|Guardar/ }))

    // Sin observaciones, el modal no manda nota (el back la deja vacía).
    await waitFor(() => expect(mocks.resolveAlert).toHaveBeenCalledWith(11, undefined))
    await waitFor(() => expect(figure('Alertas')).toBe('Alertas: 0'))
  })

  it('un conductor sin supervisión no ve el bloque', async () => {
    // El bloque lo monta la página solo para quien supervisa; aquí se
    // comprueba que, montado a mano, no pide nada raro ni cuenta coches
    // ajenos: sin coches supervisados, todas las cifras son cero.
    mocks.listVehicles.mockResolvedValue({ count: 0, results: [] })
    renderOverview()
    await screen.findByText('A tu cargo')
    expect(figure('Coches')).toBe('Coches: 0')
    expect(figure('Alertas')).toBe('Alertas: 0')
  })
})
