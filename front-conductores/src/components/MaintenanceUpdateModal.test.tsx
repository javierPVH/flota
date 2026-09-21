import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { todayIso } from '../format.ts'
import { LanguageProvider } from '../i18n.tsx'
import type { Role, Vehicle, VehicleSummary } from '../types.ts'
import { MaintenanceUpdateModal } from './MaintenanceUpdateModal.tsx'

const mocks = vi.hoisted(() => ({
  listMaintenancePlans: vi.fn(),
  listIncidents: vi.fn(),
  markMaintenanceDone: vi.fn(),
  roles: ['driver', 'supervisor'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listMaintenancePlans: mocks.listMaintenancePlans,
  listIncidents: mocks.listIncidents,
  markMaintenanceDone: mocks.markMaintenanceDone,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'sara', roles: mocks.roles } }),
}))

const VEHICLE = {
  id: 3,
  plate: '7890NPQ',
  brand: 'Tesla',
  model: 'Model 3',
  state: 'active',
  state_display: 'Activo',
} as Vehicle

const PLAN = {
  id: 9,
  vehicle: 3,
  name: 'Revisión anual',
  every_km: 30000,
  every_months: 12,
  last_done_date: '2025-09-01',
  last_done_km: 12000,
  alerts_resolved: 0,
}

/** Fecha ISO a N días de hoy, compuesta con las partes LOCALES (`toISOString`
 * pasa a UTC y en España devolvía el día anterior — doctrina E2/E6). */
function inDays(days: number): string {
  const date = new Date(`${todayIso()}T00:00:00`)
  date.setDate(date.getDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function renderModal(onSaved = vi.fn(), summary: Partial<VehicleSummary> | null = null) {
  render(
    <LanguageProvider>
      <MaintenanceUpdateModal
        vehicle={VEHICLE}
        summary={summary ? ({ vehicle: 3, ...summary } as VehicleSummary) : null}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    </LanguageProvider>,
  )
  return onSaved
}

describe('MaintenanceUpdateModal: SOLO el mantenimiento programado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.roles = ['driver', 'supervisor']
    mocks.listMaintenancePlans.mockResolvedValue({ count: 1, results: [PLAN] })
    mocks.listIncidents.mockResolvedValue({ count: 0, results: [] })
    mocks.markMaintenanceDone.mockResolvedValue({
      ...PLAN,
      last_done_date: todayIso(),
      alerts_resolved: 1,
    })
  })

  it('enseña el plan con su ciclo y lo marca realizado en la fecha elegida', async () => {
    const onSaved = renderModal()

    expect(await screen.findByText('Revisión anual')).toBeInTheDocument()
    expect(screen.getByText(/cada 30\.000 km \/ 12 meses/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Marcar como realizado' }))
    const dialog = await screen.findByRole('dialog', {
      name: '¿Cuándo se hizo? · Revisión anual',
    })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Marcar como realizado' }))

    // Reancla el ciclo a la fecha y cierra los avisos que hubiera abiertos.
    await waitFor(() =>
      expect(mocks.markMaintenanceDone).toHaveBeenCalledWith(9, { date: todayIso() }),
    )
    expect(await screen.findByText(/«Revisión anual» reanclado a hoy\. 1 alerta resuelta\./))
      .toBeInTheDocument()
    expect(onSaved).toHaveBeenCalled()
  })

  it('lo primero de cada plan es CUÁNDO toca, con su semáforo', async () => {
    // La fecha la calcula el back (`next_maintenance_date` del resumen): aquí
    // solo se pinta, con el mismo semáforo que los demás vencimientos.
    renderModal(vi.fn(), { next_maintenance_date: inDays(13) })

    const due = await screen.findByText(/Próxima: .+ · en 13 días/)
    expect(due).toHaveClass('itv-soon')
  })

  it('no es el cajón de las averías: ni las pide ni las pinta, y dice dónde están', async () => {
    renderModal()
    await screen.findByText('Revisión anual')

    // La lista de averías vive en la tarjeta «Incidencias» (tablero y ficha): aquí
    // ni se consulta —era la misma petición dos veces— ni se enseña.
    expect(mocks.listIncidents).not.toHaveBeenCalled()
    expect(screen.queryByText('Incidencias')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Solucionar' })).not.toBeInTheDocument()
    expect(screen.getByText(/Las incidencias se comunican y se solucionan/)).toBeInTheDocument()
  })

  it('sin plan programado lo dice (los crea administración)', async () => {
    mocks.listMaintenancePlans.mockResolvedValue({ count: 0, results: [] })
    renderModal()
    expect(
      await screen.findByText('Este vehículo no tiene planes de mantenimiento (los crea administración).'),
    ).toBeInTheDocument()
  })
})
