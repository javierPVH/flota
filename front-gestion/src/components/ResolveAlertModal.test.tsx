import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResolveAlertModal } from './ResolveAlertModal.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Alert } from '../types.ts'

const mocks = vi.hoisted(() => ({
  fetchDriverCandidates: vi.fn(),
  setVehicleDriver: vi.fn(),
  resolveAlert: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  fetchDriverCandidates: mocks.fetchDriverCandidates,
  setVehicleDriver: mocks.setVehicleDriver,
  resolveAlert: mocks.resolveAlert,
}))

const ALERT = {
  id: 9,
  type: 'no_driver',
  type_display: 'Vehículo sin conductor',
  level: 'warning',
  level_display: 'Aviso',
  status: 'open',
  vehicle: 21,
  vehicle_plate: '1234KLM',
  message: 'Sin conductor asignado desde hace más de 7 día(s).',
  due_date: null,
  driver_name: '',
} as unknown as Alert

function renderModal(onDone = vi.fn()) {
  render(
    <LanguageProvider>
      <ResolveAlertModal alert={ALERT} onClose={vi.fn()} onDone={onDone} />
    </LanguageProvider>,
  )
  return onDone
}

describe('ResolveAlertModal — sin conductor', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.setVehicleDriver.mockReset()
    mocks.resolveAlert.mockReset()
    mocks.resolveAlert.mockResolvedValue({})
    mocks.setVehicleDriver.mockResolvedValue({})
    mocks.fetchDriverCandidates.mockResolvedValue({
      vehicle: { id: 21, plate: '1234KLM', monthly_avg: null, driver: null },
      candidates: [
        { id: 7, name: 'Ana', vehicles: [], monthly_avg: null },
        { id: 8, name: 'Luis', vehicles: [{ id: 30, plate: '9999ZZZ' }], monthly_avg: 1200 },
      ],
    })
  })

  it('sin elegir a nadie resuelve solo con la nota', async () => {
    const onDone = renderModal()
    const select = await screen.findByRole('combobox', { name: 'Asignar conductor' })
    expect(select).toHaveValue('none')
    expect(screen.getByRole('option', { name: 'Luis · 9999ZZZ' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Resolver alerta' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.setVehicleDriver).not.toHaveBeenCalled()
    expect(mocks.resolveAlert).toHaveBeenCalledWith(9, '')
  })

  it('con candidato asigna el conductor y resuelve con la nota automática', async () => {
    const onDone = renderModal()
    const select = await screen.findByRole('combobox', { name: 'Asignar conductor' })
    await userEvent.selectOptions(select, '7')
    await userEvent.click(screen.getByRole('button', { name: 'Asignar conductor y resolver' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.setVehicleDriver).toHaveBeenCalledWith(21, { driver: 7 })
    expect(mocks.resolveAlert).toHaveBeenCalledWith(9, 'Conductor asignado: Ana.')
  })
})
