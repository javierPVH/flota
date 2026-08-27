import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GroupPage } from './GroupPage.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Role, VehicleSummary } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  listKmReadings: vi.fn(),
  fetchVehicleSummaries: vi.fn(),
  roles: ['driver', 'supervisor'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  listKmReadings: mocks.listKmReadings,
  fetchVehicleSummaries: mocks.fetchVehicleSummaries,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'sara', roles: mocks.roles } }),
}))

function vehicle(id: number, plate: string) {
  return {
    id,
    plate,
    brand: 'Mercedes',
    model: 'Sprinter',
    state: 'active',
    state_display: 'Activo',
    is_substitute: false,
    next_itv_date: null,
    supervisor_name: '',
  }
}

/** Summary con contrato y proyección; el nivel y las cifras se inyectan. */
function summary(
  id: number,
  level: 'within' | 'watch' | 'over',
  extra: Partial<NonNullable<VehicleSummary['projection']>> = {},
): VehicleSummary {
  return {
    vehicle: id,
    plate: `${id}`,
    state: 'active',
    next_itv_date: null,
    unlimited_km: false,
    is_substitute: false,
    blocked_by_link: null,
    substituting_for: null,
    km_current: 52000,
    km_reading_date: null,
    km_driven: 52000,
    driver: { id: 40 + id, name: `Conductor ${id}` },
    contract: {
      id,
      month_fee: null,
      contract_km: 60000,
      contract_time: null,
      penalty_per_km: '0.15',
      start_date: '2026-01-01',
      planned_end_date: '2026-12-31',
    },
    projection: {
      km_remaining: 8000,
      monthly_avg: 6500,
      contracted_rate: 5000,
      projected_end: 78000,
      pct_of_limit: 86.7,
      level,
      overage_km: 0,
      estimated_penalty: null,
      ...extra,
    },
  } as VehicleSummary
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/grupo']}>
      <LanguageProvider>
        <GroupPage />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('GroupPage (proyección de km del grupo)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.roles = ['driver', 'supervisor']
    // 1111AAA dentro, 2222BBB en exceso, 3333CCC sin contrato (sin proyección).
    mocks.listVehicles.mockResolvedValue({
      count: 3,
      results: [vehicle(1, '1111AAA'), vehicle(2, '2222BBB'), vehicle(3, '3333CCC')],
    })
    mocks.fetchVehicleSummaries.mockResolvedValue([
      summary(1, 'within', { pct_of_limit: 16.7 }),
      summary(2, 'over', { overage_km: 18000, estimated_penalty: '2700.00' }),
    ])
    mocks.listKmReadings.mockResolvedValue({ count: 0, results: [] })
  })

  it('ordena por urgencia, con el % en grande y el exceso destacado', async () => {
    renderPage()
    expect(await screen.findByText('Proyección de km')).toBeInTheDocument()

    // El exceso primero, lo que no proyecta al final.
    const plates = [...document.querySelectorAll('.km-card .plate')].map((el) => el.textContent)
    expect(plates).toEqual(['2222BBB', '1111AAA', '3333CCC'])

    // El % consumido en grande (86.7 → 87) y el exceso como aviso rojo.
    expect(screen.getByText('87%')).toHaveClass('km-pct')
    expect(screen.getByText(/Exceso estimado: 18\.000 km · ~2700\.00 €/)).toBeInTheDocument()
    // Cabecera con el recuento de gestión.
    expect(screen.getByText('En riesgo')).toBeInTheDocument()
  })

  it('la barra lleva la marca temporal del contrato y la lectura de consumo', async () => {
    renderPage()
    await screen.findByText('1111AAA')

    // "52.000 km de 60.000 km contratados" + "Contrato al NN%" (marca visible).
    expect(screen.getAllByText(/de 60\.000 km contratados/).length).toBe(2)
    expect(screen.getAllByText(/Contrato al \d+%/).length).toBe(2)
    expect(document.querySelectorAll('.km-progress-mark').length).toBe(2)
    // El coche sin contrato lo dice y no pinta barra.
    expect(screen.getByText('Sin contrato de km: no hay proyección.')).toBeInTheDocument()
  })

  it('"Ver evolución" es un icono en la cabecera y no queda reparto de uso', async () => {
    renderPage()
    await screen.findByText('1111AAA')

    // El reparto de uso ya no vive aquí (se gestiona desde el front de gestión).
    expect(screen.queryByText('Reparto de uso')).not.toBeInTheDocument()

    // Botón de solo icono, con nombre accesible y estado de despliegue.
    const [btn] = screen.getAllByRole('button', { name: 'Ver evolución' })
    expect(btn.textContent).toBe('')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(btn)
    expect(screen.getByRole('button', { name: 'Ocultar evolución' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('filtra por nivel con pestañas y sus recuentos', async () => {
    renderPage()
    await screen.findByText('1111AAA')

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Todos 3',
      'Riesgo exceso 1',
      'Dentro 1',
      'Sin proyección 1',
    ])

    await userEvent.click(screen.getByRole('tab', { name: /Dentro/ }))
    expect(screen.getByText('1111AAA')).toBeInTheDocument()
    expect(screen.queryByText('2222BBB')).not.toBeInTheDocument()
    expect(screen.queryByText('3333CCC')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /Todos/ }))
    expect(screen.getByText('2222BBB')).toBeInTheDocument()
  })

  it('sin rol supervisor no existe: redirige fuera', async () => {
    mocks.roles = ['driver']
    renderPage()
    expect(screen.queryByText('Proyección de km')).not.toBeInTheDocument()
    expect(mocks.listVehicles).not.toHaveBeenCalled()
  })
})
