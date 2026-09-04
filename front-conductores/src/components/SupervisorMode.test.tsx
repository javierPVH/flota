// IndexedDB no existe en jsdom: fake-indexeddb lo aporta ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { Suspense } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  fetchVehicleSummaries: vi.fn(),
  listAlerts: vi.fn(),
  listIncidents: vi.fn(),
  listDocuments: vi.fn(),
  roles: ['driver', 'supervisor'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  fetchVehicleSummaries: mocks.fetchVehicleSummaries,
  listAlerts: mocks.listAlerts,
  listIncidents: mocks.listIncidents,
  listDocuments: mocks.listDocuments,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({
    user: { id: 1, username: 'sara', first_name: 'Sara', last_name: 'S', roles: mocks.roles },
    logout: vi.fn(),
  }),
}))

import { Layout } from './Layout.tsx'
import { HomePage } from '../pages/HomePage.tsx'
import { LanguageProvider } from '../i18n.tsx'

const OWN = {
  id: 3,
  plate: '7890NPQ',
  brand: 'Toyota',
  model: 'Corolla',
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  next_itv_date: null,
  supervisor_name: '',
}
const TEAM = { ...OWN, id: 2, plate: '5678BCD', state: 'maintenance', state_display: 'En taller' }

function renderShell() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <Suspense fallback={<p>cargando</p>}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
            </Route>
          </Routes>
        </Suspense>
      </MemoryRouter>
    </LanguageProvider>,
  )
}

describe('switch del supervisor (Mi vehículo ↔ Flota)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear() // el modo se recuerda por dispositivo
    document.documentElement.lang = 'es'
    mocks.roles = ['driver', 'supervisor']
    mocks.listAlerts.mockResolvedValue({ count: 0, results: [] })
    mocks.listIncidents.mockResolvedValue({ count: 0, results: [] })
    mocks.listDocuments.mockResolvedValue({ count: 0, results: [] })
    mocks.listVehicles.mockResolvedValue({ count: 2, results: [OWN, TEAM] })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { vehicle: 3, km_current: 1000, km_reading_date: null, driver: { id: 1, name: 'Sara S' } },
      { vehicle: 2, km_current: 2000, km_reading_date: null, driver: { id: 5, name: 'Carlos' } },
    ])
  })

  it('arranca en Mi vehículo: nav de campo completo y SU coche en la home', async () => {
    renderShell()

    // El switch, con "Mi vehículo" activo.
    const vehicleBtn = screen.getByRole('button', { name: 'Mi vehículo' })
    expect(vehicleBtn).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Flota' })).toHaveAttribute('aria-pressed', 'false')

    // La home carga directa SU coche; el del equipo no está.
    expect(await screen.findByText('7890NPQ')).toBeInTheDocument()
    expect(screen.queryByText('5678BCD')).not.toBeInTheDocument()

    // La barra personal: Inicio primero (como en Flota) + las siete acciones,
    // con sus etiquetas CORTAS (Km · ITV · Mantenimiento).
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Km' })).toBeEnabled())
    expect(Array.from(nav.children).map((item) => item.textContent?.trim())).toEqual([
      'Inicio', 'Km', 'Combustible', 'ITV', 'Mantenimiento', 'Avería', 'Accidente', 'Subir documento',
    ])
    expect(within(nav).getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/')

    // En Mi vehículo actúa sobre SU coche: el aviso de "quedará registrado a
    // tu nombre" (que sí sale en Flota) aquí no pinta nada.
    await userEvent.click(within(nav).getByRole('button', { name: 'Km' }))
    expect(screen.getByRole('dialog', { name: 'Registrar km · 7890NPQ' })).toBeInTheDocument()
    expect(screen.queryByText(/responsabilidad de registrar los km/)).not.toBeInTheDocument()
  })

  it('en Flota: la home es la lista a cargo y el nav queda en Alertas + Proyección', async () => {
    renderShell()
    await screen.findByText('7890NPQ')

    await userEvent.click(screen.getByRole('button', { name: 'Flota' }))
    expect(screen.getByRole('button', { name: 'Flota' })).toHaveAttribute('aria-pressed', 'true')

    // La home pasa a la flota, con sus grupos de estado como pestañas.
    // La home de flota es una página `lazy` (PF2): con la máquina cargada el
    // segundo de cortesía de `findBy` no le da, y las filas llegan aún después.
    expect(await screen.findByText('Flota a cargo', undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(await screen.findByText('5678BCD', undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(
      within(screen.getByRole('combobox', { name: 'Grupos de la flota' })).getByRole('option', {
        name: /En taller/,
      }),
    ).toBeInTheDocument()

    // Nav en modo flota: inicio, alertas y proyección de km.
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    expect(within(nav).getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/')
    expect(within(nav).getByRole('link', { name: 'Alertas' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Proyección km' })).toHaveAttribute('href', '/grupo')
    expect(within(nav).queryByRole('button', { name: 'Km' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('button', { name: 'Avería' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Incidencia' })).not.toBeInTheDocument()

    // Y de vuelta a Mi vehículo.
    await userEvent.click(screen.getByRole('button', { name: 'Mi vehículo' }))
    expect(await screen.findByText('7890NPQ')).toBeInTheDocument()
    expect(within(screen.getByRole('navigation')).getByRole('button', { name: 'Km' })).toBeInTheDocument()
  })

  it('sin coche propio, las acciones del nav van desactivadas', async () => {
    // Nadie conduce para sara: los dos coches los llevan otros.
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { vehicle: 3, km_current: 1000, km_reading_date: null, driver: { id: 5, name: 'Carlos' } },
      { vehicle: 2, km_current: 2000, km_reading_date: null, driver: { id: 6, name: 'Lucía' } },
    ])
    renderShell()

    // La home lo dice y ofrece girar a Flota.
    expect(
      await screen.findByText('No conduces ningún vehículo ahora mismo.'),
    ).toBeInTheDocument()

    // Sin objeto sobre el que actuar: dejan de ser enlaces y van apagadas.
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Km' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: 'Avería' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.bottom-tab.is-disabled').length).toBe(7)
  })

  it('el modo se recuerda por dispositivo', async () => {
    renderShell()
    await screen.findByText('7890NPQ')
    await userEvent.click(screen.getByRole('button', { name: 'Flota' }))
    await screen.findByText('Flota a cargo')
    expect(localStorage.getItem('flota:vista')).toBe('flota')
  })

  it('el conductor solo tiene Mi vehículo y las mismas siete acciones sin aviso', async () => {
    mocks.roles = ['driver']
    // El endpoint del conductor devuelve únicamente sus vehículos.
    mocks.listVehicles.mockResolvedValue({ count: 1, results: [OWN] })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { vehicle: 3, km_current: 1000, km_reading_date: null, driver: { id: 1, name: 'Sara S' } },
    ])
    localStorage.setItem('flota:vista', 'flota')
    renderShell()
    expect(screen.queryByRole('button', { name: 'Flota' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mi vehículo' })).toHaveAttribute('aria-pressed', 'true')
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Km' })).toBeEnabled())
    expect(Array.from(nav.children).map((item) => item.textContent?.trim())).toEqual([
      'Inicio', 'Km', 'Combustible', 'ITV', 'Mantenimiento', 'Avería', 'Accidente', 'Subir documento',
    ])
    await userEvent.click(within(nav).getByRole('button', { name: 'Km' }))
    expect(screen.getByRole('dialog', { name: 'Registrar km · 7890NPQ' })).toBeInTheDocument()
    expect(screen.queryByText(/responsabilidad de registrar los km/)).not.toBeInTheDocument()
  })

  it('el administrador conductor habilita el nav sobre su coche, no sobre toda la flota', async () => {
    mocks.roles = ['admin', 'driver']
    const lauraCar = { ...OWN, plate: '5960JSF' }
    const otherVehicles = [
      { ...TEAM, id: 4, plate: '1234ASD' },
      { ...TEAM, id: 5, plate: '3546LKR' },
      { ...TEAM, id: 6, plate: '7198LRY' },
      { ...TEAM, id: 7, plate: '9357MGD' },
    ]
    mocks.listVehicles.mockResolvedValue({
      count: 5,
      results: [lauraCar, ...otherVehicles],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { vehicle: 3, km_current: 1000, km_reading_date: null, driver: { id: 1, name: 'Laura' } },
      ...otherVehicles.map((vehicle, index) => ({
        vehicle: vehicle.id,
        km_current: 2000 + index,
        km_reading_date: null,
        driver: { id: 10 + index, name: `Conductor ${index}` },
      })),
    ])

    renderShell()
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    const km = await waitFor(() => within(nav).getByRole('button', { name: 'Km' }))
    expect(km).toBeEnabled()
    await userEvent.click(km)
    expect(screen.getByRole('dialog', { name: 'Registrar km · 5960JSF' })).toBeInTheDocument()
  })
})
