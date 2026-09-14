import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VehiclePeopleModal } from './VehiclePeopleModal.tsx'
import { ConfirmProvider } from './ConfirmDialog.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listAssignments: vi.fn(),
  listSupervisorPeriods: vi.fn(),
  listDrivers: vi.fn(),
  listSupervisors: vi.fn(),
  createAssignment: vi.fn(),
  createSupervisorPeriod: vi.fn(),
  updateAssignment: vi.fn(),
  updateSupervisorPeriod: vi.fn(),
  deleteAssignment: vi.fn(),
  deleteSupervisorPeriod: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listAssignments: mocks.listAssignments,
  listSupervisorPeriods: mocks.listSupervisorPeriods,
  listDrivers: mocks.listDrivers,
  listSupervisors: mocks.listSupervisors,
  createAssignment: mocks.createAssignment,
  createSupervisorPeriod: mocks.createSupervisorPeriod,
  updateAssignment: mocks.updateAssignment,
  updateSupervisorPeriod: mocks.updateSupervisorPeriod,
  deleteAssignment: mocks.deleteAssignment,
  deleteSupervisorPeriod: mocks.deleteSupervisorPeriod,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const VEHICLE = { id: 21, plate: '2026JHF', state: 'active' } as unknown as Vehicle

// Datos de ejemplo: un conductor cerrado y otro en curso; una supervisora.
const ASIGNACIONES = [
  {
    id: 1,
    vehicle: 21,
    driver: 7,
    driver_name: 'Víctor Cabrera',
    start_date: '2026-01-01',
    end_date: null,
    status: 'accepted',
  },
  {
    id: 2,
    vehicle: 21,
    driver: 8,
    driver_name: 'Lucía Conductora',
    start_date: '2025-06-01',
    end_date: '2026-01-01',
    status: 'finished',
  },
  // Una propuesta: NO es un periodo, así que no debe salir.
  {
    id: 3,
    vehicle: 21,
    driver: 8,
    driver_name: 'Lucía Conductora',
    start_date: '2026-12-01',
    end_date: '2026-12-31',
    status: 'proposed',
  },
]

const PERIODOS = [
  {
    id: 11,
    vehicle: 21,
    supervisor: 5,
    supervisor_name: 'Sara Supervisora',
    start_date: '2025-03-01',
    end_date: null,
  },
]

function renderModal() {
  const onDone = vi.fn()
  render(
    <LanguageProvider>
      <ConfirmProvider>
        <VehiclePeopleModal vehicle={VEHICLE} onClose={vi.fn()} onDone={onDone} />
      </ConfirmProvider>
    </LanguageProvider>,
  )
  return { onDone }
}

describe('VehiclePeopleModal (periodos de conductores y supervisores)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listAssignments.mockResolvedValue(page(ASIGNACIONES))
    mocks.listSupervisorPeriods.mockResolvedValue(page(PERIODOS))
    mocks.listDrivers.mockResolvedValue([
      { id: 7, name: 'Víctor Cabrera' },
      { id: 8, name: 'Lucía Conductora' },
    ])
    mocks.listSupervisors.mockResolvedValue([
      { id: 5, name: 'Sara Supervisora' },
      { id: 6, name: 'Marta Supervisora' },
    ])
    mocks.createAssignment.mockReset()
    mocks.createAssignment.mockResolvedValue({})
    mocks.createSupervisorPeriod.mockReset()
    mocks.createSupervisorPeriod.mockResolvedValue({})
  })

  it('lista los periodos reales del coche, sin las propuestas', async () => {
    renderModal()
    // Sale en la tabla y, por ser el de hoy, también en la barra de arriba.
    expect((await screen.findAllByText('Víctor Cabrera')).length).toBeGreaterThan(0)
    // La propuesta (mismo nombre, otras fechas) no añade una tercera fila.
    const cuerpo = document.querySelector('.people-table tbody') as HTMLElement
    expect(within(cuerpo).getAllByRole('row')).toHaveLength(2)
    // Y queda dicho que la papelera no borra el histórico (N7).
    expect(screen.getByText(/no borra el histórico/)).toBeInTheDocument()
  })

  /** La condición que pidió el usuario: si esas fechas ya están ocupadas, hay
   * que decir por quién — y no dejar guardar. */
  it('avisa de quién ocupa el rango y no deja añadir encima', async () => {
    renderModal()
    await screen.findAllByText('Víctor Cabrera')

    await userEvent.click(screen.getByRole('button', { name: 'Añadir conductor por periodo' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Conductor' }), '8')
    const inicio = screen.getByLabelText('Inicio del periodo nuevo')
    await userEvent.clear(inicio)
    await userEvent.type(inicio, '2026-03-01')

    expect(await screen.findByText(/Esas fechas ya las cubre Víctor Cabrera/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Añadir periodo' })).toBeDisabled()
    expect(mocks.createAssignment).not.toHaveBeenCalled()
  })

  it('un hueco libre sí se puede añadir', async () => {
    const { onDone } = renderModal()
    await screen.findAllByText('Víctor Cabrera')

    await userEvent.click(screen.getByRole('button', { name: 'Añadir conductor por periodo' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Conductor' }), '8')
    const inicio = screen.getByLabelText('Inicio del periodo nuevo')
    await userEvent.clear(inicio)
    await userEvent.type(inicio, '2024-01-01')
    const fin = screen.getByLabelText('Fin del periodo nuevo')
    await userEvent.type(fin, '2025-06-01')

    expect(screen.getByText('Nadie ocupa esas fechas.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Añadir periodo' }))

    await waitFor(() =>
      expect(mocks.createAssignment).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicle: 21,
          driver: 8,
          start_date: '2024-01-01',
          end_date: '2025-06-01',
          status: 'accepted',
        }),
      ),
    )
    expect(onDone).toHaveBeenCalled()
  })

  it('la pestaña de supervisores trabaja sobre sus periodos', async () => {
    renderModal()
    await screen.findAllByText('Víctor Cabrera')
    await userEvent.click(screen.getByRole('tab', { name: 'Supervisores' }))

    // En su fila y, por estar en curso, también en la barra de arriba.
    expect(screen.getAllByText('Sara Supervisora').length).toBeGreaterThan(0)
    // Sara está en curso desde 2025-03-01: cualquier fecha posterior choca.
    await userEvent.click(screen.getByRole('button', { name: 'Añadir supervisor por periodo' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Supervisor' }), '6')
    const inicio = screen.getByLabelText('Inicio del periodo nuevo')
    await userEvent.clear(inicio)
    await userEvent.type(inicio, '2026-05-01')
    expect(await screen.findByText(/Esas fechas ya las cubre Sara Supervisora/)).toBeInTheDocument()

    // …y un tramo anterior, que termina justo cuando ella empieza, no choca.
    await userEvent.clear(inicio)
    await userEvent.type(inicio, '2024-01-01')
    await userEvent.type(screen.getByLabelText('Fin del periodo nuevo'), '2025-03-01')
    await userEvent.click(screen.getByRole('button', { name: 'Añadir periodo' }))
    await waitFor(() =>
      expect(mocks.createSupervisorPeriod).toHaveBeenCalledWith({
        vehicle: 21,
        supervisor: 6,
        start_date: '2024-01-01',
        end_date: '2025-03-01',
      }),
    )
  })
})
