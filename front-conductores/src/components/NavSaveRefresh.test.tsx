// IndexedDB no existe en jsdom: fake-indexeddb lo aporta ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  fetchVehicleSummaries: vi.fn(),
  fetchKmWindow: vi.fn(),
  listIncidents: vi.fn(),
  listDocuments: vi.fn(),
  registerItv: vi.fn(),
  listMaintenancePlans: vi.fn(),
  markMaintenanceDone: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  fetchVehicleSummaries: mocks.fetchVehicleSummaries,
  fetchKmWindow: mocks.fetchKmWindow,
  listIncidents: mocks.listIncidents,
  listDocuments: mocks.listDocuments,
  registerItv: mocks.registerItv,
  listMaintenancePlans: mocks.listMaintenancePlans,
  markMaintenanceDone: mocks.markMaintenanceDone,
}))

// Supervisora que conduce (como sara en el seed): es quien marca un plan como
// realizado — el back exige gestión para eso.
vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({
    user: {
      id: 1,
      username: 'sara',
      first_name: 'Sara',
      last_name: 'S',
      roles: ['driver', 'supervisor'],
    },
    logout: vi.fn(),
  }),
}))

import { Layout } from './Layout.tsx'
import { HomePage } from '../pages/HomePage.tsx'
import { LanguageProvider } from '../i18n.tsx'

/** Fecha ISO a N días de hoy, con partes LOCALES (doctrina E2/E6): las citas
 * se comparan con hoy, así que fijarlas a mano dejaría el test caduco. */
function inDays(days: number): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const VEHICLE = {
  id: 3,
  plate: '7890NPQ',
  brand: 'Toyota',
  model: 'Corolla',
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  next_itv_date: inDays(12),
  supervisor_name: '',
}
const SUMMARY = {
  vehicle: 3,
  km_current: 1000,
  km_reading_date: inDays(-11),
  next_itv_date: inDays(12),
  driver: { id: 1, name: 'Sara S' },
}
const PLAN = {
  id: 9,
  vehicle: 3,
  vehicle_plate: '7890NPQ',
  name: 'Revisión anual',
  every_km: null,
  every_months: 12,
  last_done_date: inDays(-351),
  last_done_km: null,
}

function renderShell() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  )
}

/**
 * Los modales del bottom-nav viven FUERA del Outlet: al guardar, la página que
 * hay debajo tiene que releerse. Sin esto, la home seguía anunciando «Próx.
 * ITV» de una ITV ya registrada hasta recargar la app a mano.
 */
describe('guardar desde el bottom-nav refresca la página', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.lang = 'es'
    mocks.listVehicles.mockResolvedValue({ count: 1, results: [VEHICLE] })
    mocks.fetchVehicleSummaries.mockResolvedValue([SUMMARY])
    mocks.fetchKmWindow.mockResolvedValue(null)
    mocks.listIncidents.mockResolvedValue({ count: 0, results: [] })
    mocks.listDocuments.mockResolvedValue({ count: 0, results: [] })
    mocks.registerItv.mockResolvedValue({ id: 9 })
    mocks.listMaintenancePlans.mockResolvedValue({ count: 1, results: [PLAN] })
    mocks.markMaintenanceDone.mockResolvedValue({
      ...PLAN,
      last_done_date: inDays(0),
      alerts_resolved: 1,
    })
  })

  it('registrar la ITV quita su cita de «Próximas citas», sin recargar', async () => {
    renderShell()

    // La cita está a la vista (fecha + cuántos días faltan).
    expect(await screen.findByText('Próx. ITV')).toBeInTheDocument()
    expect(screen.getByText(/· en 12 días/)).toBeInTheDocument()

    // El back deja el coche SIN cita al registrar la favorable sin fecha.
    mocks.listVehicles.mockResolvedValue({
      count: 1,
      results: [{ ...VEHICLE, next_itv_date: null }],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([{ ...SUMMARY, next_itv_date: null }])

    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    await userEvent.click(await waitFor(() => within(nav).getByRole('button', { name: 'ITV' })))
    const dialog = screen.getByRole('dialog', { name: 'Registrar ITV · 7890NPQ' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar ITV' }))

    await waitFor(() => expect(mocks.registerItv).toHaveBeenCalled())
    // La cita desaparece sola: ya se ha realizado.
    await waitFor(() => expect(screen.queryByText('Próx. ITV')).not.toBeInTheDocument())
  })

  it('marcar el mantenimiento realizado quita su cita (el ciclo va a un año)', async () => {
    mocks.listVehicles.mockResolvedValue({
      count: 1,
      results: [{ ...VEHICLE, next_itv_date: null }],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { ...SUMMARY, next_itv_date: null, next_maintenance_date: inDays(14) },
    ])
    renderShell()

    expect(await screen.findByText('Próx. mantenimiento')).toBeInTheDocument()
    expect(screen.getByText(/· en 14 días/)).toBeInTheDocument()

    // Al reanclar el plan, el back devuelve la cita a 12 meses.
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { ...SUMMARY, next_itv_date: null, next_maintenance_date: inDays(365) },
    ])

    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    await userEvent.click(
      await waitFor(() => within(nav).getByRole('button', { name: 'Mantenimiento' })),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Realizado en:' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aceptar fecha' }))

    await waitFor(() => expect(mocks.markMaintenanceDone).toHaveBeenCalledWith(9, { date: inDays(0) }))
    // El tablero de detrás ya no anuncia una cita cumplida.
    await waitFor(() =>
      expect(screen.queryByText('Próx. mantenimiento')).not.toBeInTheDocument(),
    )
  })
})
