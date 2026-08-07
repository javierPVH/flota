import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DashboardPage } from './DashboardPage.tsx'
import { ConfirmProvider } from '../components/ConfirmDialog.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  fetchFleetSummary: vi.fn(),
  listAlerts: vi.fn(),
  listVehicles: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  fetchFleetSummary: mocks.fetchFleetSummary,
  listAlerts: mocks.listAlerts,
  listVehicles: mocks.listVehicles,
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
  next_itv_date: null,
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
          type_display: 'ITV próxima / vencida',
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
  })

  it('pinta KPIs, fila del listado y el detalle de la alerta en su modal', async () => {
    renderHome()
    expect(await screen.findByText('Vista general')).toBeInTheDocument()
    expect(await screen.findByText('3 activos · 1 en taller')).toBeInTheDocument()
    // El listado muestra la matrícula (una vez) y el conductor.
    expect(await screen.findByText('Carlos Ruiz')).toBeInTheDocument()
    expect(screen.getByText('1234KLM')).toBeInTheDocument()
    // La tira abre el modal de alertas, donde sale el mensaje y la matrícula.
    await userEvent.click(
      screen.getByRole('button', { name: /Alertas que requieren atención/i }),
    )
    expect(await screen.findByText('ITV vencida hace 6 días')).toBeInTheDocument()
    expect(screen.getAllByText('1234KLM').length).toBeGreaterThanOrEqual(2)
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
    expect(mocks.listVehicles).toHaveBeenLastCalledWith(
      expect.objectContaining({ assigned: false }),
    )
  })
})
