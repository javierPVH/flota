import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MaintenanceDoneModal } from './MaintenanceDoneModal.tsx'
import { todayIso } from '../format.ts'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  maintenancePlanDone: vi.fn(),
  listWorkshops: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  maintenancePlanDone: mocks.maintenancePlanDone,
  listWorkshops: mocks.listWorkshops,
}))

const VEHICLE = { id: 21, plate: '1234KLM', brand: 'Seat', model: 'Leon', state: 'active' } as unknown as Vehicle

describe('MaintenanceDoneModal (registrar servicio desde el desglose)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.maintenancePlanDone.mockReset()
    mocks.listWorkshops.mockResolvedValue([])
  })

  it('registra el servicio con fecha, km, coste y nota', async () => {
    mocks.maintenancePlanDone.mockResolvedValue({ incident: 12, vehicle_reactivated: false })
    const onSaved = vi.fn()
    render(
      <LanguageProvider>
        <MaintenanceDoneModal
          open
          vehicle={VEHICLE}
          planId={4}
          planName="Revisión general"
          onClose={vi.fn()}
          onSaved={onSaved}
        />
      </LanguageProvider>,
    )

    // El plan que se reancla queda a la vista; la fecha llega puesta a hoy.
    expect(await screen.findByRole('dialog', { name: 'Registrar servicio · 1234KLM' })).toBeInTheDocument()
    expect(screen.getByText('Revisión general')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Km al realizarlo' }), '45000')
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Coste (€)' }), '120.5')
    await userEvent.type(screen.getByRole('textbox', { name: 'Observaciones' }), 'Aceite y filtros')
    // Coche Activo: no se ofrece «devolver a Activo».
    expect(screen.queryByRole('checkbox')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Registrar servicio' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    // Sin taller elegido ni casilla: el payload lleva SOLO lo rellenado.
    expect(mocks.maintenancePlanDone).toHaveBeenCalledWith(4, {
      date: todayIso(),
      km: 45000,
      cost: '120.5',
      note: 'Aceite y filtros',
    })
    expect(onSaved.mock.calls[0][0]).toMatch(/Mantenimiento registrado/)
  })
})
