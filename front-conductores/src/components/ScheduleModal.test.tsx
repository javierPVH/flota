import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { todayIso } from '../format.ts'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'
import { ScheduleItvModal, ScheduleMaintenanceModal } from './ScheduleModal.tsx'

const mocks = vi.hoisted(() => ({
  scheduleItv: vi.fn(),
  listMaintenancePrograms: vi.fn(),
  listMaintenancePlans: vi.fn(),
  createMaintenancePlan: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  scheduleItv: mocks.scheduleItv,
  listMaintenancePrograms: mocks.listMaintenancePrograms,
  listMaintenancePlans: mocks.listMaintenancePlans,
  createMaintenancePlan: mocks.createMaintenancePlan,
}))

const VEHICLE = {
  id: 3,
  plate: '7890NPQ',
  brand: 'Tesla',
  model: 'Model 3',
  state: 'active',
  state_display: 'Activo',
  next_itv_date: null,
} as unknown as Vehicle

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

/** El catálogo común: uno con los dos ciclos, uno solo por km y uno solo por meses. */
const GENERAL = {
  id: 1,
  name: 'Revisión general',
  every_km: 30000,
  every_months: 12,
  cycle_label: '30000 km / 12 meses',
  notes: 'Aceite y filtros',
}
const SOLO_KM = { id: 2, name: 'Neumáticos', every_km: 40000, every_months: null, cycle_label: '40000 km', notes: '' }
const SOLO_MESES = { id: 3, name: 'Correa', every_km: null, every_months: 60, cycle_label: '60 meses', notes: '' }

function renderItv(vehicle: Vehicle = VEHICLE) {
  const onSaved = vi.fn()
  render(
    <LanguageProvider>
      <ScheduleItvModal vehicle={vehicle} onClose={vi.fn()} onSaved={onSaved} />
    </LanguageProvider>,
  )
  return onSaved
}

function renderMaintenance(summary: Partial<VehicleSummary> | null = { km_current: 4679 }) {
  const onSaved = vi.fn()
  render(
    <LanguageProvider>
      <ScheduleMaintenanceModal
        vehicle={VEHICLE}
        summary={summary ? ({ vehicle: 3, ...summary } as VehicleSummary) : null}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    </LanguageProvider>,
  )
  return onSaved
}

beforeEach(() => {
  vi.clearAllMocks()
  document.documentElement.lang = 'es'
  mocks.scheduleItv.mockResolvedValue({ ...VEHICLE, next_itv_date: '2027-03-01' })
  mocks.listMaintenancePrograms.mockResolvedValue(page([GENERAL, SOLO_KM, SOLO_MESES]))
  mocks.listMaintenancePlans.mockResolvedValue(page([]))
  mocks.createMaintenancePlan.mockResolvedValue({ id: 9 })
})

describe('ScheduleItvModal: quien supervisa cita la ITV', () => {
  it('sin cita lo dice, y la fecha no puede ser anterior a hoy', () => {
    renderItv()
    expect(screen.getByText('Este coche no tiene ninguna ITV citada.')).toBeInTheDocument()
    expect(screen.getByLabelText('Fecha de la ITV')).toHaveAttribute('min', todayIso())
  })

  it('con cita avisa de que guardar la CORRIGE: la cita es una', () => {
    renderItv({ ...VEHICLE, next_itv_date: '2026-09-30' } as Vehicle)
    expect(screen.getByText(/Ahora está citada el 30\/9\/2026/)).toBeInTheDocument()
  })

  it('un CP a medias no se envía', async () => {
    renderItv()
    fireEvent.change(screen.getByLabelText('Fecha de la ITV'), { target: { value: '2027-03-01' } })
    await userEvent.type(screen.getByLabelText('CP preferente'), '281')
    await userEvent.click(screen.getByRole('button', { name: 'Programar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Indica un código postal de 5 cifras.')
    expect(mocks.scheduleItv).not.toHaveBeenCalled()
  })

  it('cita, lo dice y no se cierra sola', async () => {
    const onSaved = renderItv()
    fireEvent.change(screen.getByLabelText('Fecha de la ITV'), { target: { value: '2027-03-01' } })
    await userEvent.click(screen.getByRole('button', { name: 'Programar' }))
    await waitFor(() =>
      expect(mocks.scheduleItv).toHaveBeenCalledWith(3, { date: '2027-03-01', postal_code: '' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(/ITV citada el 1\/3\/2027/)
    expect(onSaved).toHaveBeenCalledWith(expect.stringMatching(/ITV citada/))
    // El formulario se ha ido: queda el acuse con su «Cerrar» (la X del modal
    // se llama igual, por eso se mira dentro del acuse).
    expect(screen.queryByLabelText('Fecha de la ITV')).toBeNull()
    const acuse = document.querySelector('.km-saved') as HTMLElement
    expect(within(acuse).getByRole('button', { name: 'Cerrar' })).toBeInTheDocument()
  })
})

describe('ScheduleMaintenanceModal: un programa del catálogo y desde dónde cuenta', () => {
  it('con un plan ya activo no ofrece el formulario: dice cuál es', async () => {
    mocks.listMaintenancePlans.mockResolvedValue(
      page([{ id: 5, vehicle: 3, name: 'Revisión general', every_km: 30000, every_months: 12, last_done_date: '2026-01-15', last_done_km: 1000 }]),
    )
    renderMaintenance()
    expect(await screen.findByText('Este coche ya tiene un mantenimiento programado:')).toBeInTheDocument()
    expect(screen.getByText(/15\/1\/2026/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Qué mantenimiento')).toBeNull()
  })

  it('con el catálogo vacío remite a administración', async () => {
    mocks.listMaintenancePrograms.mockResolvedValue(page([]))
    renderMaintenance()
    expect(await screen.findByText(/No hay ningún programa en el catálogo/)).toBeInTheDocument()
  })

  it('cada ancla se pregunta solo si su ciclo existe, y el km nace con el odómetro', async () => {
    renderMaintenance()
    const programa = await screen.findByLabelText('Qué mantenimiento')

    await userEvent.selectOptions(programa, '2') // solo por km
    expect(screen.queryByLabelText('Contando desde (fecha)')).toBeNull()
    expect(screen.getByLabelText('Contando desde (km)')).toHaveValue('4679')

    await userEvent.selectOptions(programa, '3') // solo por meses
    expect(screen.getByLabelText('Contando desde (fecha)')).toHaveValue(todayIso())
    expect(screen.queryByLabelText('Contando desde (km)')).toBeNull()
  })

  it('un programa solo por meses manda la fecha y NINGÚN km', async () => {
    renderMaintenance()
    await userEvent.selectOptions(await screen.findByLabelText('Qué mantenimiento'), '3')
    await userEvent.click(screen.getByRole('button', { name: 'Programar' }))
    await waitFor(() =>
      expect(mocks.createMaintenancePlan).toHaveBeenCalledWith(
        expect.objectContaining({
          program: 3,
          every_km: null,
          every_months: 60,
          last_done_date: todayIso(),
          last_done_km: null,
        }),
      ),
    )
  })

  it('un programa por km sin kilometraje no se envía: contar desde 0 abriría un aviso', async () => {
    // Sin resumen no hay odómetro que precargar: el campo nace vacío.
    renderMaintenance(null)
    await userEvent.selectOptions(await screen.findByLabelText('Qué mantenimiento'), '1')
    expect(screen.getByLabelText('Contando desde (km)')).toHaveValue('')
    expect(screen.queryByRole('button', { name: /Cargar los del coche/ })).toBeNull()

    fireEvent.submit(screen.getByRole('button', { name: 'Programar' }).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Indica desde qué kilometraje cuenta el ciclo.',
    )
    expect(mocks.createMaintenancePlan).not.toHaveBeenCalled()
  })

  it('programa copiando el ciclo del catálogo, con su nota y el CP', async () => {
    const onSaved = renderMaintenance()
    await userEvent.selectOptions(await screen.findByLabelText('Qué mantenimiento'), '1')
    await userEvent.type(screen.getByLabelText('CP preferente'), '28100')
    await userEvent.click(screen.getByRole('button', { name: 'Programar' }))

    await waitFor(() =>
      expect(mocks.createMaintenancePlan).toHaveBeenCalledWith({
        vehicle: 3,
        program: 1,
        name: 'Revisión general',
        every_km: 30000,
        every_months: 12,
        last_done_date: todayIso(),
        last_done_km: 4679,
        workshop_postal_code: '28100',
        notes: 'Aceite y filtros',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Mantenimiento programado.')
    expect(onSaved).toHaveBeenCalled()
  })

  it('un CP a medias tampoco se envía aquí', async () => {
    renderMaintenance()
    await userEvent.selectOptions(await screen.findByLabelText('Qué mantenimiento'), '1')
    await userEvent.type(screen.getByLabelText('CP preferente'), '28')
    await userEvent.click(screen.getByRole('button', { name: 'Programar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Indica un código postal de 5 cifras.')
    expect(mocks.createMaintenancePlan).not.toHaveBeenCalled()
  })
})
