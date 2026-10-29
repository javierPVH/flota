import { render, screen, waitFor, within } from '@testing-library/react'
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

  it('marcar multiusuario retira al conductor con aviso, exige supervisor y manda la marca', async () => {
    renderModal()
    const casilla = await screen.findByRole('checkbox', { name: /Multiusuario/ })
    await userEvent.click(casilla)
    // Sin conductor que cambiar, y se dice que el actual pasa al histórico al
    // guardar; el párrafo de «este coche es multiusuario» no, que aún no lo es.
    expect(screen.queryByRole('combobox', { name: 'Nuevo conductor' })).not.toBeInTheDocument()
    expect(screen.getByText(/Víctor Cabrera pasará al histórico/)).toBeInTheDocument()
    expect(screen.queryByText(/Este coche es multiusuario/)).not.toBeInTheDocument()
    // Y en la barra de arriba: el conductor tachado con su porqué.
    expect(screen.getByText('Víctor Cabrera').tagName).toBe('S')
    expect(screen.getByText(/pasa al histórico al guardar/)).toBeInTheDocument()
    // Sin supervisor no se guarda, y la barra marca el hueco.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Supervisor' }), '__none__')
    expect(screen.getByText(/obligatorio en un multiusuario/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    // Lo dice el campo (su aviso) y lo dice el formulario al intentar guardar.
    const avisos = await screen.findAllByRole('alert')
    expect(avisos.some((a) => /necesita supervisor/.test(a.textContent ?? ''))).toBe(true)
    expect(mocks.setVehicleDriver).not.toHaveBeenCalled()
    // Con él: la marca del hueco se va, y una sola llamada con la marca y la
    // retirada del conductor.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Supervisor' }), '5')
    expect(screen.queryByText(/obligatorio en un multiusuario/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mocks.setVehicleDriver).toHaveBeenCalledWith(21, {
        driver: null,
        is_multiuser: true,
        expected_updated_at: VEHICLE.updated_at,
      }),
    )
  })

  it('en un multiusuario, desmarcar vuelve a ofrecer el conductor y se guardan juntos', async () => {
    renderModal({ ...VEHICLE, is_multiuser: true, driver_id: null, driver_name: '' } as Vehicle)
    expect(screen.queryByRole('combobox', { name: 'Nuevo conductor' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('checkbox', { name: /Multiusuario/ }))
    const conductor = await screen.findByRole('combobox', { name: 'Nuevo conductor' })
    await waitFor(() => expect(within(conductor).getByRole('option', { name: /Lucía/ })).toBeInTheDocument())
    await userEvent.selectOptions(conductor, '8')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mocks.setVehicleDriver).toHaveBeenCalledWith(
        21,
        expect.objectContaining({ driver: 8, is_multiuser: false }),
      ),
    )
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
