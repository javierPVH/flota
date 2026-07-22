import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MyVehiclesPage } from './MyVehiclesPage.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  fetchVehicleSummary: vi.fn(),
  roles: ['driver'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  fetchVehicleSummary: mocks.fetchVehicleSummary,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'carlos', roles: mocks.roles } }),
}))

function vehicle(id: number, plate: string, brand = 'Mercedes', model = 'Sprinter') {
  return {
    id,
    plate,
    brand,
    model,
    state: 'active',
    state_display: 'Activo',
    is_substitute: false,
    next_itv_date: null,
    supervisor_name: '',
  }
}

function summary(id: number, km: number, readingDate: string | null) {
  return { vehicle: id, km_current: km, km_reading_date: readingDate, driver: null }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <MyVehiclesPage />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('MyVehiclesPage (M1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.roles = ['driver']
  })

  it('pinta la tarjeta con km y píldora de lectura pendiente', async () => {
    mocks.listVehicles.mockResolvedValue({ count: 1, results: [vehicle(1, '1234KLM')] })
    // Lectura de otro mes → pendiente.
    mocks.fetchVehicleSummary.mockResolvedValue(summary(1, 31000, '2020-01-02'))

    renderPage()
    expect(await screen.findByText('Mis vehículos')).toBeInTheDocument()
    expect(await screen.findByText('1234KLM')).toBeInTheDocument()
    expect(await screen.findByText('31.000 km')).toBeInTheDocument()
    expect(screen.getByText('lectura pendiente')).toBeInTheDocument()
    // La tarjeta enlaza a la ficha de campo (M2).
    expect(screen.getByRole('link', { name: /1234KLM/ })).toHaveAttribute('href', '/vehiculos/1')
  })

  it('el buscador filtra en cliente y el título cambia para el supervisor', async () => {
    mocks.roles = ['driver', 'supervisor']
    mocks.listVehicles.mockResolvedValue({
      count: 2,
      results: [vehicle(1, '1234KLM'), vehicle(2, '5678BCD', 'Ford', 'Transit')],
    })
    mocks.fetchVehicleSummary.mockImplementation((id: number) =>
      Promise.resolve(summary(id, 1000, new Date().toISOString().slice(0, 10))),
    )

    renderPage()
    expect(await screen.findByText('Mi grupo')).toBeInTheDocument()
    expect(await screen.findByText('5678BCD')).toBeInTheDocument()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar vehículo' }), 'transit')
    expect(screen.queryByText('1234KLM')).not.toBeInTheDocument()
    expect(screen.getByText('5678BCD')).toBeInTheDocument()
  })
})
