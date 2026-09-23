import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ScheduleItvMaintenanceModal } from './ScheduleItvMaintenanceModal.tsx'
import { ConfirmProvider } from './ConfirmDialog.tsx'
import { fmtDate, todayIso } from '../format.ts'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listMaintenancePlans: vi.fn(),
  listMaintenancePrograms: vi.fn(),
  createMaintenancePlan: vi.fn(),
  updateMaintenancePlan: vi.fn(),
  createMaintenanceProgram: vi.fn(),
  listKmReadingsAll: vi.fn(),
  listVehicleEvents: vi.fn(),
  scheduleItv: vi.fn(),
  unscheduleItv: vi.fn(),
  deleteMaintenancePlan: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listMaintenancePlans: mocks.listMaintenancePlans,
  listMaintenancePrograms: mocks.listMaintenancePrograms,
  createMaintenancePlan: mocks.createMaintenancePlan,
  updateMaintenancePlan: mocks.updateMaintenancePlan,
  createMaintenanceProgram: mocks.createMaintenanceProgram,
  listKmReadingsAll: mocks.listKmReadingsAll,
  listVehicleEvents: mocks.listVehicleEvents,
  scheduleItv: mocks.scheduleItv,
  unscheduleItv: mocks.unscheduleItv,
  deleteMaintenancePlan: mocks.deleteMaintenancePlan,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const SIN_CITA = {
  id: 7,
  plate: '4567JKL',
  brand: 'Nissan',
  model: 'Leaf',
  state: 'active',
  next_itv_date: null,
  next_itv_manual: false,
  itv_postal_code: '',
} as Vehicle

const CON_CITA = {
  ...SIN_CITA,
  next_itv_date: '2026-11-20',
  next_itv_manual: true,
  itv_postal_code: '28100',
} as Vehicle

/** El catálogo COMÚN: uno con los dos ciclos y otro solo por meses. */
const GENERAL = {
  id: 1,
  name: 'Revisión general',
  every_km: 30000,
  every_months: 12,
  cycle_label: '30000 km / 12 meses',
  notes: '',
  created_at: '',
  updated_at: '',
}
const ANUAL = {
  ...GENERAL,
  id: 2,
  name: 'Revisión anual',
  every_km: null,
  cycle_label: '12 meses',
}

const PLAN = {
  id: 4,
  vehicle: 7,
  vehicle_plate: '4567JKL',
  program: 1,
  program_name: 'Revisión general',
  name: 'Revisión general',
  every_km: 30000,
  every_months: 12,
  last_done_date: '2026-01-10',
  last_done_km: 20000,
  workshop_postal_code: '28001',
  notes: '',
  created_at: '',
  updated_at: '',
}

const EVENTO = (id: number, fecha: string, notas: string) => ({
  id,
  vehicle: 7,
  event_type: 'maintenance',
  event_type_display: 'Mantenimiento',
  event_date: fecha,
  notes: notas,
  details: null,
})

function renderModal(vehicle: Vehicle) {
  const onSaved = vi.fn()
  render(
    <LanguageProvider>
      <ConfirmProvider>
        <ScheduleItvMaintenanceModal vehicle={vehicle} onClose={vi.fn()} onSaved={onSaved} />
      </ConfirmProvider>
    </LanguageProvider>,
  )
  return { onSaved }
}

const irAMantenimiento = () =>
  userEvent.click(screen.getByRole('tab', { name: /Programar mantenimiento/ }))

describe('Programar ITV y mantenimiento', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listMaintenancePlans.mockResolvedValue(page([]))
    mocks.listMaintenancePrograms.mockResolvedValue(page([GENERAL, ANUAL]))
    mocks.listKmReadingsAll.mockResolvedValue(page([]))
    mocks.listVehicleEvents.mockResolvedValue(page([]))
    mocks.createMaintenancePlan.mockReset()
    mocks.updateMaintenancePlan.mockReset()
    mocks.createMaintenanceProgram.mockReset()
    mocks.scheduleItv.mockReset()
    mocks.unscheduleItv.mockReset().mockResolvedValue({
      ...SIN_CITA,
      next_itv_manual: true,
      previous_next_itv_date: '2026-11-20',
      alerts_resolved: 1,
    })
    mocks.deleteMaintenancePlan.mockReset().mockResolvedValue(undefined)
    mocks.scheduleItv.mockResolvedValue({
      ...CON_CITA,
      next_itv_date: '2027-03-01',
      previous_next_itv_date: null,
      changed: true,
      alerts_resolved: 0,
    })
  })

  it('sin ITV a la vista: deja programarla con su CP preferente', async () => {
    const { onSaved } = renderModal(SIN_CITA)
    // El modal abre en la pestaña de la ITV.
    expect(screen.getByRole('tab', { name: 'Programar ITV' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Nada que enseñar → el formulario sale ya abierto.
    expect(screen.getByText(/No hay ninguna ITV a la vista/)).toBeInTheDocument()
    // Las dos salidas van en la MISMA fila de botones: registrar (por si ya se
    // pasó) a la izquierda con su porqué y programar, la principal, a la derecha.
    const fila = screen.getByRole('button', { name: 'Programar ITV' }).closest('.form-actions')!
    expect(within(fila as HTMLElement).getByText('¿Ya se ha pasado?')).toBeInTheDocument()
    expect(within(fila as HTMLElement).getByRole('button', { name: 'Registrar ITV' })).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Fecha de la ITV'), '2027-03-01')
    await userEvent.type(screen.getByLabelText('CP preferente para la ITV'), '28100')
    await userEvent.click(screen.getByRole('button', { name: 'Programar ITV' }))

    expect(mocks.scheduleItv).toHaveBeenCalledWith(7, { date: '2027-03-01', postal_code: '28100' })
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    // Guardada: ya no ofrece programar, solo modificar la que hay.
    expect(await screen.findByRole('button', { name: 'Modificar la cita' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Programar ITV' })).not.toBeInTheDocument()
  })

  it('con ITV programada: la muestra, deja modificarla y registrarla', async () => {
    renderModal(CON_CITA)
    expect(screen.getByText('ITV programada')).toBeInTheDocument()
    expect(screen.getByText(/20 nov 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Cita puesta por la gestión/)).toBeInTheDocument()
    // No hay forma de crear una segunda: ni formulario ni botón de programar.
    expect(screen.queryByLabelText('Fecha de la ITV')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Programar ITV' })).not.toBeInTheDocument()
    // Resolver está aquí mismo: la ITV se registra sin salir del modal.
    expect(screen.getByRole('button', { name: 'Registrar ITV' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Modificar la cita' }))
    const fecha = screen.getByLabelText('Fecha de la ITV')
    expect(fecha).toHaveValue('2026-11-20')
    await userEvent.clear(fecha)
    await userEvent.type(fecha, '2027-03-01')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar la cita' }))
    expect(mocks.scheduleItv).toHaveBeenCalledWith(7, { date: '2027-03-01', postal_code: '28100' })
  })

  it('modificando la cita se puede eliminar: confirma, la quita y deja programar otra', async () => {
    const { onSaved } = renderModal(CON_CITA)
    // Sin estar modificando no se ofrece: es una acción de la edición.
    expect(screen.queryByRole('button', { name: 'Eliminar la cita' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Modificar la cita' }))
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar la cita' }))

    // El modal de programar también es un diálogo: el de confirmar va por su título.
    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar la cita de ITV' })
    expect(dialogo).toHaveTextContent(/20 nov 2026/)
    expect(mocks.unscheduleItv).not.toHaveBeenCalled()
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, eliminar la cita' }))

    await waitFor(() => expect(mocks.unscheduleItv).toHaveBeenCalledWith(7))
    expect(await screen.findByText(/Cita de ITV eliminada/)).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalled()
    // Sin cita: vuelve el aviso y el formulario en blanco para programar otra.
    expect(screen.getByText(/No hay ninguna ITV a la vista/)).toBeInTheDocument()
    expect(screen.getByLabelText('Fecha de la ITV')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Programar ITV' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Eliminar la cita' })).not.toBeInTheDocument()
  })

  it('modificando el mantenimiento se puede eliminar: lo retira y deja programar otro', async () => {
    mocks.listMaintenancePlans.mockResolvedValue(page([PLAN]))
    const { onSaved } = renderModal(SIN_CITA)
    await irAMantenimiento()
    await userEvent.click(await screen.findByRole('button', { name: 'Modificar el mantenimiento' }))
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar el mantenimiento' }))

    const dialogo = await screen.findByRole('dialog', {
      name: 'Eliminar el mantenimiento programado',
    })
    expect(dialogo).toHaveTextContent('Revisión general')
    await userEvent.click(
      within(dialogo).getByRole('button', { name: 'Sí, eliminar el mantenimiento' }),
    )
    await waitFor(() =>
      expect(mocks.deleteMaintenancePlan).toHaveBeenCalledWith(4, expect.stringMatching(/Programar ITV/)),
    )
    expect(await screen.findByText(/Mantenimiento programado eliminado/)).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalled()
    expect(screen.getByText(/No hay ningún mantenimiento programado/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Programar mantenimiento' })).toBeInTheDocument()
  })

  /** El «cada cuánto» sale del catálogo común, y el ciclo por meses se cuenta
   * desde el día en que se crea el registro. */
  it('sin mantenimiento: se programa con un programa del catálogo', async () => {
    mocks.listMaintenancePrograms.mockResolvedValue(page([ANUAL]))
    mocks.createMaintenancePlan.mockResolvedValue({ ...PLAN, id: 9 })
    const { onSaved } = renderModal(SIN_CITA)
    await irAMantenimiento()
    expect(await screen.findByText(/No hay ningún mantenimiento programado/)).toBeInTheDocument()

    // Un solo programa en el catálogo → va elegido.
    const select = screen.getByLabelText('Programa de mantenimiento')
    await waitFor(() => expect(select).toHaveValue('2'))
    expect(screen.getByText(/Solo hay un programa en el catálogo/)).toBeInTheDocument()

    // Se cuenta desde HOY, y el próximo se ve antes de guardar.
    const hoy = todayIso()
    expect(screen.getByLabelText('Se cuenta desde (fecha)')).toHaveValue(hoy)
    const proxima = `${Number(hoy.slice(0, 4)) + 1}${hoy.slice(4)}`
    expect(
      screen.getByText(`Próximo mantenimiento: ${fmtDate(proxima, 'es')}.`),
    ).toBeInTheDocument()
    // Sin ciclo por km, ese ancla ni se pide.
    expect(screen.queryByLabelText('Se cuenta desde (km)')).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('CP preferente'), '28001')
    // La misma fila que en la ITV: la pista de la revisión ya hecha a la
    // izquierda y «Programar», la principal, a la derecha.
    const fila = screen
      .getByRole('button', { name: 'Programar mantenimiento' })
      .closest('.form-actions')!
    expect(within(fila as HTMLElement).getByText(/Revisión ya hecha/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Programar mantenimiento' }))
    expect(mocks.createMaintenancePlan).toHaveBeenCalledWith({
      vehicle: 7,
      program: 2,
      name: 'Revisión anual',
      every_km: null,
      every_months: 12,
      last_done_date: hoy,
      last_done_km: null,
      workshop_postal_code: '28001',
      notes: '',
    })
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('con mantenimiento: enseña cuándo toca y deja modificarlo o resolverlo', async () => {
    mocks.listMaintenancePlans.mockResolvedValue(page([PLAN]))
    mocks.updateMaintenancePlan.mockResolvedValue(PLAN)
    renderModal(CON_CITA)
    await irAMantenimiento()

    expect(await screen.findByText('Mantenimiento programado')).toBeInTheDocument()
    // El próximo sale del ancla + el ciclo: 10 ene 2026 + 12 meses.
    expect(screen.getByText('10 ene 2027')).toBeInTheDocument()
    // Y el objetivo por km, del ancla de km + el ciclo (20.000 + 30.000).
    expect(screen.getByText(/50\.000 km/)).toBeInTheDocument()
    expect(screen.getByText(/Solo puede haber un mantenimiento programado/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ya se pasó la revisión' })).toBeInTheDocument()
    // Sin pulsar «Modificar» no hay formulario que pueda crear un segundo.
    expect(screen.queryByLabelText('Programa de mantenimiento')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Modificar el mantenimiento' }))
    await userEvent.clear(screen.getByLabelText('CP preferente'))
    await userEvent.type(screen.getByLabelText('CP preferente'), '41001')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el mantenimiento' }))
    expect(mocks.updateMaintenancePlan).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ program: 1, workshop_postal_code: '41001', last_done_km: 20000 }),
    )
    expect(mocks.createMaintenancePlan).not.toHaveBeenCalled()
  })

  it('el catálogo se amplía desde el propio modal', async () => {
    mocks.createMaintenanceProgram.mockResolvedValue({
      ...ANUAL,
      id: 5,
      name: 'Revisión de frenos',
      every_km: 20000,
      every_months: null,
      cycle_label: '20000 km',
    })
    renderModal(SIN_CITA)
    await irAMantenimiento()
    await userEvent.selectOptions(
      await screen.findByLabelText('Programa de mantenimiento'),
      screen.getByRole('option', { name: '+ Nuevo programa' }),
    )

    // Se gestiona en su propio modal, que avisa de cómo funcionan los ciclos.
    const dialogo = await screen.findByRole('dialog', { name: /Nuevo programa/ })
    expect(dialogo).toHaveTextContent(/vale para TODA la flota/)
    expect(dialogo).toHaveTextContent(/Los kilómetros mandan/)
    await userEvent.type(within(dialogo).getByLabelText('Nombre del programa'), 'Revisión de frenos')
    await userEvent.type(within(dialogo).getByLabelText('Cada (km)'), '20000')
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar el programa' }))

    expect(mocks.createMaintenanceProgram).toHaveBeenCalledWith({
      name: 'Revisión de frenos',
      every_km: 20000,
      every_months: null,
      notes: '',
    })
    // Vuelve elegido, y con él aparece su ancla por km.
    await waitFor(() =>
      expect(screen.getByLabelText('Programa de mantenimiento')).toHaveValue('5'),
    )
    expect(screen.getByLabelText('Se cuenta desde (km)')).toBeInTheDocument()
  })

  it('un programa sin ciclo no se guarda', async () => {
    renderModal(SIN_CITA)
    await irAMantenimiento()
    await userEvent.selectOptions(
      await screen.findByLabelText('Programa de mantenimiento'),
      screen.getByRole('option', { name: '+ Nuevo programa' }),
    )
    const dialogo = await screen.findByRole('dialog', { name: /Nuevo programa/ })
    await userEvent.type(within(dialogo).getByLabelText('Nombre del programa'), 'Sin ciclo')
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar el programa' }))
    expect(within(dialogo).getByRole('alert')).toHaveTextContent(/al menos un ciclo/)
    expect(mocks.createMaintenanceProgram).not.toHaveBeenCalled()
  })

  /** Abajo del todo, lo ya realizado: las cinco últimas de cada pestaña. */
  it('el histórico enseña las cinco últimas realizadas', async () => {
    mocks.listVehicleEvents.mockImplementation((_vehicle: number, tipo: string) =>
      Promise.resolve(
        page(
          tipo === 'maintenance'
            ? [
                EVENTO(1, '2026-08-01', 'Mantenimiento realizado: Revisión general. 45000 km.'),
                EVENTO(2, '2026-07-01', 'Mantenimiento realizado: Revisión general.'),
                EVENTO(3, '2026-06-01', 'Mantenimiento realizado: Cambio de aceite.'),
                EVENTO(4, '2026-05-01', 'Mantenimiento realizado: Revisión general.'),
                EVENTO(5, '2026-04-01', 'Mantenimiento realizado: Revisión general.'),
                EVENTO(6, '2026-03-01', 'La sexta, que ya no cabe.'),
              ]
            : [EVENTO(9, '2026-02-10', 'ITV favorable.')],
        ),
      ),
    )
    renderModal(CON_CITA)

    // Pestaña de la ITV: su propio histórico.
    const itv = await screen.findByText('ITV favorable.')
    expect(itv).toBeInTheDocument()

    await irAMantenimiento()
    const lista = await screen.findByText(/45000 km/)
    const filas = lista.closest('ul')!.querySelectorAll('li')
    expect(filas).toHaveLength(5)
    expect(screen.queryByText('La sexta, que ya no cabe.')).not.toBeInTheDocument()
  })
})
