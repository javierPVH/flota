// IndexedDB no existe en jsdom: fake-indexeddb lo aporta ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  fetchVehicle: vi.fn(),
  fetchVehicleSummary: vi.fn(),
  listDocuments: vi.fn(),
  listIncidents: vi.fn(),
  roles: ['driver', 'supervisor'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  fetchVehicle: mocks.fetchVehicle,
  fetchVehicleSummary: mocks.fetchVehicleSummary,
  listDocuments: mocks.listDocuments,
  listIncidents: mocks.listIncidents,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'sara', roles: mocks.roles } }),
}))

import { VehicleFieldPage } from './VehicleFieldPage.tsx'
import { LanguageProvider } from '../i18n.tsx'

const VEHICLE = {
  id: 1,
  plate: '1234KLM',
  brand: 'Mercedes',
  model: 'Sprinter',
  year: 2022,
  state: 'active',
  state_display: 'Activo',
  is_substitute: false,
  next_itv_date: '2026-09-30',
  supervisor_name: 'Sara S',
  business_use: '',
}

const SUMMARY = {
  vehicle: 1,
  plate: '1234KLM',
  state: 'active',
  next_itv_date: '2026-09-30',
  next_maintenance_date: '2026-09-15',
  unlimited_km: false,
  is_substitute: false,
  blocked_by_link: null,
  substituting_for: null,
  km_current: 4679,
  km_reading_date: '2026-07-26',
  km_driven: 31000,
  driver: { id: 5, name: 'Carlos C' },
  contract: {
    id: 1,
    month_fee: null,
    contract_km: 50000,
    contract_time: null,
    penalty_per_km: null,
    start_date: '2026-01-01',
    planned_end_date: '2026-12-31',
  },
  projection: {
    km_remaining: 19000,
    monthly_avg: 4000,
    contracted_rate: null,
    projected_end: 62000,
    pct_of_limit: 72.4,
    level: 'watch',
    overage_km: 0,
    estimated_penalty: null,
  },
}

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/vehiculos/1']}>
        <Routes>
          <Route path="/vehiculos/:id" element={<VehicleFieldPage />} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  )
}

describe('VehicleFieldPage (ficha de campo)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.roles = ['driver', 'supervisor']
    mocks.fetchVehicle.mockResolvedValue(VEHICLE)
    mocks.fetchVehicleSummary.mockResolvedValue(SUMMARY)
    mocks.listDocuments.mockResolvedValue({ count: 0, results: [] })
    mocks.listIncidents.mockResolvedValue({ count: 0, results: [] })
  })

  it('supervisor: mantenimiento, proyección y herramientas de gestión', async () => {
    renderPage()
    expect(await screen.findByText('1234KLM')).toBeInTheDocument()

    // GAP-8: tercera tarjeta con el próximo mantenimiento.
    expect(screen.getByText('Próx. mantenimiento')).toBeInTheDocument()
    expect(screen.getByText('15/9/2026')).toBeInTheDocument()

    // Proyección compacta contra el contrato, como en la vista del grupo.
    expect(screen.getByText('72%')).toHaveClass('km-pct')
    expect(screen.getByText('31.000 km de 50.000 km contratados')).toBeInTheDocument()

    // Sus herramientas de tarjeta, también aquí.
    expect(screen.getByRole('button', { name: 'Actualizar datos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar recordatorio' })).toBeInTheDocument()
  })

  it('conductor: sin proyección ni herramientas de gestión', async () => {
    mocks.roles = ['driver']
    renderPage()
    await screen.findByText('1234KLM')

    expect(screen.queryByText('72%')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Actualizar datos' })).not.toBeInTheDocument()
    // Sus accesos de siempre siguen siendo enlaces vivos.
    expect(screen.getByRole('link', { name: /Registrar km/ })).toBeInTheDocument()
  })

  it('principal bloqueado (N9): km, documento y avería apagados; la ITV sigue', async () => {
    mocks.fetchVehicleSummary.mockResolvedValue({
      ...SUMMARY,
      blocked_by_link: {
        substitute_id: 9,
        plate: '4567JKL',
        reason: 'Mantenimiento',
        since: '2026-08-01',
      },
    })
    renderPage()
    await screen.findByText('1234KLM')

    expect(screen.getByText('🔒 Bloqueado por sustitución')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Registrar km/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Subir documento/ })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.quick-action.is-disabled').length).toBe(3)
    // La ITV es del coche físico: sigue disponible aunque esté cubierto.
    expect(screen.getByRole('button', { name: 'Registrar ITV' })).toBeInTheDocument()
  })

  it('la ITV se registra aunque la tarjeta de documentos esté plegada (BG)', async () => {
    renderPage()
    await screen.findByText('1234KLM')

    await userEvent.click(screen.getByRole('button', { name: 'Plegar todo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Registrar ITV' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Registrar ITV · 1234KLM')).toBeInTheDocument()
  })
})
