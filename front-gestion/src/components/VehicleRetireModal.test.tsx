import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VehicleRetireModal } from './VehicleRetireModal.tsx'
import { todayIso } from '../format.ts'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  fetchVehicle: vi.fn(),
  updateVehicleFields: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  fetchVehicle: mocks.fetchVehicle,
  updateVehicleFields: mocks.updateVehicleFields,
}))

const VEHICLE = {
  id: 21,
  plate: '1234KLM',
  brand: 'Seat',
  model: 'Leon',
  state: 'accidente',
  driver_name: 'Carlos Ruiz',
  updated_at: '2026-09-01T08:00:00Z',
} as unknown as Vehicle

function renderModal(activeLink = false) {
  const onDone = vi.fn()
  render(
    <LanguageProvider>
      <VehicleRetireModal
        open
        vehicle={VEHICLE}
        activeLink={activeLink}
        onClose={vi.fn()}
        onDone={onDone}
      />
    </LanguageProvider>,
  )
  return onDone
}

describe('VehicleRetireModal (dar de baja)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.fetchVehicle.mockReset()
    mocks.updateVehicleFields.mockReset()
    // La ficha cambió desde que se cargó: el `updated_at` fresco es otro.
    mocks.fetchVehicle.mockResolvedValue({ ...VEHICLE, updated_at: '2026-09-09T10:00:00Z' })
    mocks.updateVehicleFields.mockResolvedValue({ ...VEHICLE, state: 'retired' })
  })

  it('avisa del conductor y del vínculo, y da de baja con el updated_at FRESCO', async () => {
    const onDone = renderModal(true)
    expect(await screen.findByRole('dialog', { name: 'Dar de baja 1234KLM' })).toBeInTheDocument()
    expect(screen.getByText(/Tiene conductor asignado/)).toBeInTheDocument()
    expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument()
    expect(screen.getByText(/vínculo de sustitución/)).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Motivo *'), 'Siniestro total')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar baja' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.fetchVehicle).toHaveBeenCalledWith(21)
    expect(mocks.updateVehicleFields).toHaveBeenCalledWith(21, {
      state: 'retired',
      change_reason: 'Siniestro total',
      change_date: todayIso(),
      expected_updated_at: '2026-09-09T10:00:00Z',
    })
  })

  it('sin vínculo no avisa de él, y un fallo del back se enseña sin cerrar', async () => {
    mocks.updateVehicleFields.mockRejectedValue(new Error('409'))
    const onDone = renderModal(false)
    await screen.findByRole('dialog', { name: 'Dar de baja 1234KLM' })
    expect(screen.queryByText(/vínculo de sustitución/)).toBeNull()
    await userEvent.type(screen.getByLabelText('Motivo *'), 'Fin de contrato')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar baja' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })
})
