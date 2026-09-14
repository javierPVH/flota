import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VehicleDriverModal } from './VehicleDriverModal.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listDrivers: vi.fn(),
  listSupervisors: vi.fn(),
  listAssignments: vi.fn(),
  setVehicleDriver: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listDrivers: mocks.listDrivers,
  listSupervisors: mocks.listSupervisors,
  listAssignments: mocks.listAssignments,
  setVehicleDriver: mocks.setVehicleDriver,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

// Vehículo CON conductor y CON supervisor (datos de ejemplo, como el seed).
const VEHICLE = {
  id: 21,
  plate: '2026JHF',
  brand: 'Seat',
  model: 'Ibiza',
  driver_id: 7,
  driver_name: 'Víctor Cabrera',
  supervisor: 5,
  supervisor_name: 'Sara Supervisora',
  updated_at: '2026-08-01T00:00:00Z',
} as unknown as Vehicle

function renderModal(vehicle: Vehicle = VEHICLE) {
  const onDone = vi.fn()
  const onClose = vi.fn()
  render(
    <LanguageProvider>
      <VehicleDriverModal vehicle={vehicle} onClose={onClose} onDone={onDone} />
    </LanguageProvider>,
  )
  return { onDone, onClose }
}

describe('VehicleDriverModal (conductor y supervisor)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listDrivers.mockResolvedValue([
      { id: 7, name: 'Víctor Cabrera' },
      { id: 8, name: 'Lucía Conductora' },
    ])
    mocks.listSupervisors.mockResolvedValue([{ id: 5, name: 'Sara Supervisora' }])
    mocks.listAssignments.mockResolvedValue(page([]))
    mocks.setVehicleDriver.mockReset()
    mocks.setVehicleDriver.mockResolvedValue({})
  })

  /** El selector solo PONE a alguien: vaciar el puesto es la papelera. */
  it('el selector de conductor no ofrece quitarlo', async () => {
    const { onDone } = renderModal()
    const driver = await screen.findByRole('combobox', { name: 'Nuevo conductor' })
    // El vigente sale marcado, y no hay opción de vaciar.
    expect(await screen.findByRole('option', { name: /Víctor Cabrera \(actual\)/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Quitar el conductor/ })).toBeNull()

    // Cambiar de conductor sí, con su fecha de inicio.
    await userEvent.selectOptions(driver, '8')
    expect(screen.getByLabelText('Fecha de inicio')).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(mocks.setVehicleDriver).toHaveBeenCalledWith(
      21,
      expect.objectContaining({ driver: 8, expected_updated_at: '2026-08-01T00:00:00Z' }),
    )
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  /** «Vigente» es sin fecha de fin O con un fin PROGRAMADO que aún no ha
   * llegado: de ahí sale el conductor que la papelera propone quitar. */
  it('la asignación con fin PROGRAMADO también cuenta como vigente', async () => {
    mocks.listAssignments.mockResolvedValue(
      page([{ id: 3, vehicle: 21, driver: 7, driver_name: 'Víctor Cabrera', status: 'accepted', end_date: '2099-01-01' }]),
    )
    renderModal()
    // Se pide solo lo aceptado (menos riesgo de que la vigente quede en otra página).
    await waitFor(() =>
      expect(mocks.listAssignments).toHaveBeenCalledWith({ vehicle: 21, status: 'accepted' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Quitar conductor o supervisor' }))
    expect(
      await screen.findByRole('radio', { name: 'Conductor · Víctor Cabrera' }),
    ).toBeInTheDocument()
  })

  it('deja VACIAR el supervisor', async () => {
    renderModal()
    const supervisor = await screen.findByRole('combobox', { name: 'Supervisor' })
    expect(supervisor).toHaveValue('5')
    await userEvent.selectOptions(
      supervisor,
      screen.getByRole('option', { name: '— Sin supervisor —' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(mocks.setVehicleDriver).toHaveBeenCalledWith(21, {
      supervisor: null,
      expected_updated_at: '2026-08-01T00:00:00Z',
    })
  })

  /** La papelera de la barra: quitar a quien está puesto es una operación
   * aparte —con su aviso— y no se cuela entre los cambios del formulario. */
  it('la papelera avisa y deja elegir a quién se quita', async () => {
    const { onDone } = renderModal()
    await userEvent.click(screen.getByRole('button', { name: 'Quitar conductor o supervisor' }))

    // Sale el aviso, con el conductor propuesto (es el que hay) y ambos a mano.
    const aviso = await screen.findByRole('dialog', { name: 'Quitar conductor o supervisor' })
    expect(aviso).toHaveTextContent(/El vehículo se queda sin esa persona/)
    expect(screen.getByRole('radio', { name: 'Conductor · Víctor Cabrera' })).toBeChecked()

    // Se puede quitar al otro sin tocar al conductor.
    await userEvent.click(screen.getByRole('radio', { name: 'Supervisor · Sara Supervisora' }))
    await userEvent.click(screen.getByRole('button', { name: 'Quitar' }))
    await waitFor(() =>
      expect(mocks.setVehicleDriver).toHaveBeenCalledWith(21, {
        supervisor: null,
        expected_updated_at: '2026-08-01T00:00:00Z',
      }),
    )
    expect(onDone).toHaveBeenCalled()
  })

  it('sin conductor ni supervisor, la papelera no se puede pulsar', async () => {
    renderModal({
      ...VEHICLE,
      driver_id: null,
      driver_name: '',
      supervisor: null,
      supervisor_name: '',
    } as unknown as Vehicle)
    expect(screen.getByRole('button', { name: 'Quitar conductor o supervisor' })).toBeDisabled()
  })

  it('un coche sin conductor no ofrece quitarlo', async () => {
    renderModal({ ...VEHICLE, driver_id: null, driver_name: '' } as unknown as Vehicle)
    await userEvent.click(screen.getByRole('button', { name: 'Quitar conductor o supervisor' }))
    // Solo se ofrece a quien está puesto: aquí, el supervisor.
    expect(await screen.findByRole('radio', { name: /Supervisor/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Conductor/ })).toBeNull()
  })
})
