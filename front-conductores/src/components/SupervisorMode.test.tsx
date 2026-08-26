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
  roles: ['driver', 'supervisor'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  fetchVehicleSummaries: mocks.fetchVehicleSummaries,
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

    // Nav en modo vehículo: inicio, alertas, registrar km, avería e incidencia.
    // Las acciones van SOBRE su coche: el shell preselecciona el suyo (id 3).
    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Alertas' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Registrar km' })).toHaveAttribute(
        'href',
        '/registrar?vehiculo=3',
      ),
    )
    expect(screen.getByRole('link', { name: 'Avería' })).toHaveAttribute(
      'href',
      '/incidencias/nueva?tipo=breakdown&vehiculo=3',
    )
    expect(screen.getByRole('link', { name: 'Incidencia' })).toHaveAttribute(
      'href',
      '/incidencias/nueva?vehiculo=3',
    )
    expect(screen.queryByRole('link', { name: 'Proyección km' })).not.toBeInTheDocument()
  })

  it('en Flota: la home es la lista a cargo y el nav queda en Alertas + Proyección', async () => {
    renderShell()
    await screen.findByText('7890NPQ')

    await userEvent.click(screen.getByRole('button', { name: 'Flota' }))
    expect(screen.getByRole('button', { name: 'Flota' })).toHaveAttribute('aria-pressed', 'true')

    // La home pasa a la flota, con sus grupos de estado como pestañas.
    expect(await screen.findByText('Flota a cargo')).toBeInTheDocument()
    expect(screen.getByText('5678BCD')).toBeInTheDocument()
    expect(
      within(screen.getByRole('combobox', { name: 'Grupos de la flota' })).getByRole('option', {
        name: /En taller/,
      }),
    ).toBeInTheDocument()

    // Nav en modo flota: inicio, alertas y proyección de km.
    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Alertas' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Proyección km' })).toHaveAttribute('href', '/grupo')
    expect(screen.queryByRole('link', { name: 'Registrar km' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Avería' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Incidencia' })).not.toBeInTheDocument()

    // Y de vuelta a Mi vehículo.
    await userEvent.click(screen.getByRole('button', { name: 'Mi vehículo' }))
    expect(await screen.findByText('7890NPQ')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Registrar km' })).toBeInTheDocument()
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
      expect(screen.queryByRole('link', { name: 'Registrar km' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('link', { name: 'Avería' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Incidencia' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Alertas' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.bottom-tab.is-disabled').length).toBe(4)
    // Inicio sigue vivo (desde ahí se gira el switch a Flota).
    expect(screen.getByRole('link', { name: 'Inicio' })).toBeInTheDocument()
  })

  it('el modo se recuerda por dispositivo', async () => {
    renderShell()
    await screen.findByText('7890NPQ')
    await userEvent.click(screen.getByRole('button', { name: 'Flota' }))
    await screen.findByText('Flota a cargo')
    expect(localStorage.getItem('flota:vista')).toBe('flota')
  })

  it('el conductor no tiene switch y conserva su nav de siempre', async () => {
    mocks.roles = ['driver']
    renderShell()
    expect(screen.queryByRole('button', { name: 'Flota' })).not.toBeInTheDocument()
    // Su pestaña de inicio es "Vehículos": no hay un "Inicio" aparte.
    expect(screen.queryByRole('link', { name: 'Inicio' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Vehículos' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Registrar km' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Alertas' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Avería' })).not.toBeInTheDocument()
  })
})
