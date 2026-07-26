import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AlertsPage } from './AlertsPage.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  fetchVehicleSummaries: vi.fn(),
  roles: ['driver'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listAlerts: mocks.listAlerts,
  fetchVehicleSummaries: mocks.fetchVehicleSummaries,
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

describe('AlertsPage (M5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.roles = ['driver']
    mocks.listAlerts.mockResolvedValue({ count: 1, results: [KM_ALERT] })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      { vehicle: 7, plate: '7890NPQ', km_reading_date: null, km_current: null, driver: null },
    ])
  })

  it('el conductor ve la alerta con su acción, pero SIN resolver/descartar', async () => {
    renderPage()
    expect(await screen.findByText('Falta la lectura de km de 2026-07.')).toBeInTheDocument()
    // Acción natural: registrar km con el vehículo preseleccionado.
    expect(screen.getByRole('link', { name: /Registrar km/ })).toHaveAttribute(
      'href',
      '/registrar?vehiculo=7',
    )
    expect(screen.queryByRole('button', { name: 'Resolver' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument()
  })

  it('el supervisor además resuelve/descarta y ve las lecturas pendientes del grupo', async () => {
    mocks.roles = ['driver', 'supervisor']
    renderPage()
    expect(await screen.findByRole('button', { name: 'Resolver' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument()
    expect(await screen.findByText('Lecturas pendientes del grupo')).toBeInTheDocument()
    expect(await screen.findByText('Nunca ha registrado lectura')).toBeInTheDocument()
  })

  it('sin alertas abiertas, estado vacío amable', async () => {
    mocks.listAlerts.mockResolvedValue({ count: 0, results: [] })
    renderPage()
    expect(await screen.findByText('Sin alertas abiertas. Todo al día.')).toBeInTheDocument()
  })
})
