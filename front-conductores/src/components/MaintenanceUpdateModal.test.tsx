import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { todayIso } from '../format.ts'
import { LanguageProvider } from '../i18n.tsx'
import type { Role, Vehicle } from '../types.ts'
import { MaintenanceUpdateModal } from './MaintenanceUpdateModal.tsx'

const mocks = vi.hoisted(() => ({
  listMaintenancePlans: vi.fn(),
  listIncidents: vi.fn(),
  resolveIncident: vi.fn(),
  roles: ['driver', 'supervisor'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listMaintenancePlans: mocks.listMaintenancePlans,
  listIncidents: mocks.listIncidents,
  resolveIncident: mocks.resolveIncident,
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

/** Incidencia base (avería abierta) con variaciones por caso. */
function incident(extra: Record<string, unknown> = {}) {
  return {
    id: 21,
    vehicle: 3,
    type: 'breakdown',
    type_display: 'Avería',
    date: '2026-08-25',
    description: 'Testigo de batería encendido.',
    mileage: null,
    workshop_postal_code: '',
    details: {},
    status: 'open',
    status_display: 'Abierta',
    cost: null,
    ...extra,
  }
}

function renderModal(onSaved = vi.fn()) {
  render(
    <LanguageProvider>
      <MaintenanceUpdateModal vehicle={VEHICLE} onClose={vi.fn()} onSaved={onSaved} />
    </LanguageProvider>,
  )
  return onSaved
}

describe('MaintenanceUpdateModal: planes + averías', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.roles = ['driver', 'supervisor']
    mocks.listMaintenancePlans.mockResolvedValue({ count: 0, results: [] })
    // Solo lo relacionado con averías debe salir: la de mantenimiento y la
    // cerrada quedan fuera de la sección (mismo filtro que el tablero).
    mocks.listIncidents.mockResolvedValue({
      count: 3,
      results: [
        incident(),
        incident({
          id: 22,
          type: 'maintenance',
          type_display: 'Mantenimiento',
          description: 'Cambio de aceite.',
        }),
        incident({
          id: 23,
          description: 'Embrague duro.',
          status: 'closed',
          status_display: 'Cerrada',
        }),
        incident({
          id: 24,
          type: 'tires',
          type_display: 'Cambio de neumático',
          description: '',
          details: {
            report_version: 1,
            change_reason: 'wear',
            wheel_scope: 'all',
            front_measure: '205/55 R16',
            rear_measure: '205/55 R16',
          },
        }),
      ],
    })
    mocks.resolveIncident.mockResolvedValue({ id: 21, status: 'closed' })
  })

  it('el supervisor ve las averías (solo averías) y las SOLUCIONA con su fecha', async () => {
    const onSaved = renderModal()

    expect(await screen.findByText('Averías')).toBeInTheDocument()
    expect(await screen.findByText('Testigo de batería encendido.')).toBeInTheDocument()
    expect(screen.getAllByText(/25\/8\/2026 · Abierta/)[0]).toBeInTheDocument()
    // El neumático no depende del comentario: motivo · ruedas · medida.
    expect(screen.getByText('Desgaste · Las 4 ruedas · 205/55 R16')).toBeInTheDocument()
    expect(screen.queryByText('Cambio de aceite.')).not.toBeInTheDocument()
    expect(screen.queryByText('Embrague duro.')).not.toBeInTheDocument()

    // Solucionar → submodal con la fecha (hoy por defecto) y el paro calculado.
    // El primero es la avería de la batería (la del neumático va después).
    await userEvent.click(screen.getAllByRole('button', { name: 'Solucionar' })[0])
    expect(await screen.findByRole('dialog', { name: 'Solución · Avería' })).toBeInTheDocument()
    await userEvent.type(
      screen.getByLabelText('Observaciones'),
      'Cambiado el motor de arranque.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar incidencia' }))

    await waitFor(() =>
      expect(mocks.resolveIncident).toHaveBeenCalledWith(21, {
        resolution_date: todayIso(),
        observations: 'Cambiado el motor de arranque.',
      }),
    )
    // La avería sale de la lista, hay aviso y la página puede refrescar.
    expect(await screen.findByText('Incidencia cerrada.')).toBeInTheDocument()
    expect(screen.queryByText('Testigo de batería encendido.')).not.toBeInTheDocument()
    expect(onSaved).toHaveBeenCalled()
  })

  it('el conductor las VE pero sin botón: cerrar incidencias es de gestión', async () => {
    mocks.roles = ['driver']
    renderModal()
    expect(await screen.findByText('Testigo de batería encendido.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Solucionar' })).not.toBeInTheDocument()
  })

  it('sin averías abiertas, la sección lo dice', async () => {
    mocks.listIncidents.mockResolvedValue({
      count: 1,
      results: [incident({ status: 'closed', status_display: 'Cerrada' })],
    })
    renderModal()
    expect(await screen.findByText('Sin averías abiertas.')).toBeInTheDocument()
  })
})
