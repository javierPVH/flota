import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResolveDispatcher } from './ResolveDispatcher.tsx'
import { alertTarget, incidentTarget } from './resolveFlow.ts'
import { LanguageProvider } from '../../i18n.tsx'
import type { Alert, Incident, Vehicle } from '../../types.ts'

const mocks = vi.hoisted(() => ({
  fetchDriverCandidates: vi.fn(),
  listMaintenancePlans: vi.fn(),
  resolveIncident: vi.fn(),
  fetchVehicle: vi.fn(),
  updateVehicleFields: vi.fn(),
  listVehicleLinks: vi.fn(),
  releaseSubstitute: vi.fn(),
}))

vi.mock('../../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.ts')>()),
  fetchDriverCandidates: mocks.fetchDriverCandidates,
  listMaintenancePlans: mocks.listMaintenancePlans,
  resolveIncident: mocks.resolveIncident,
  fetchVehicle: mocks.fetchVehicle,
  updateVehicleFields: mocks.updateVehicleFields,
  listVehicleLinks: mocks.listVehicleLinks,
  releaseSubstitute: mocks.releaseSubstitute,
}))

const VEHICLE = { id: 21, plate: '1234KLM', brand: 'Seat', model: 'Leon', state: 'broken' } as unknown as Vehicle
const incident = (type: string, type_display: string, details: Record<string, unknown> = {}) =>
  ({
    id: 4,
    vehicle: 21,
    type,
    type_display,
    date: '2026-08-20',
    description: '',
    details,
    status: 'open',
    status_display: 'Abierta',
    cost: null,
  }) as unknown as Incident
const alert = (type: string, type_display: string, extra: Record<string, unknown> = {}) =>
  ({
    id: 9,
    type,
    type_display,
    level: 'warning',
    level_display: 'Aviso',
    status: 'open',
    vehicle: 21,
    vehicle_plate: '1234KLM',
    message: 'msg',
    due_date: null,
    ...extra,
  }) as unknown as Alert

const PLANS = {
  count: 2,
  next: null,
  previous: null,
  results: [
    { id: 4, vehicle: 21, name: 'Revisión general', every_km: 30000, every_months: 12 },
    { id: 5, vehicle: 21, name: 'Cambio de correa', every_km: null, every_months: 60 },
  ],
}

function renderWith(
  target: Parameters<typeof ResolveDispatcher>[0]['target'],
  vehicle: Vehicle = VEHICLE,
) {
  const onDone = vi.fn()
  render(
    <LanguageProvider>
      <ResolveDispatcher target={target} vehicles={[vehicle]} onClose={vi.fn()} onDone={onDone} />
    </LanguageProvider>,
  )
  return onDone
}

const SIN_VINCULOS = { count: 0, next: null, previous: null, results: [] }
const CON_SUSTITUTO = {
  count: 1,
  next: null,
  previous: null,
  results: [{ id: 3, main_vehicle: 21, substitute_vehicle: 8, substitute_vehicle_plate: '2222BBB', end_date: null }],
}

describe('ResolveDispatcher — un mismo gesto, el modal de cada tipo', () => {
  beforeEach(() => {
    // Sin esto, `mock.calls[0]` es la llamada de OTRO caso: los espías son
    // compartidos y aquí se mira con qué se llamó, no solo cuántas veces.
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.listMaintenancePlans.mockResolvedValue(PLANS)
    mocks.resolveIncident.mockResolvedValue({ id: 4, status: 'closed', vehicle_reactivated: false })
    mocks.fetchVehicle.mockResolvedValue({ ...VEHICLE, updated_at: 'fresh' })
    mocks.updateVehicleFields.mockResolvedValue({ ...VEHICLE, state: 'retired' })
    mocks.listVehicleLinks.mockResolvedValue(SIN_VINCULOS)
    mocks.releaseSubstitute.mockResolvedValue({
      link_closed: true,
      substitute_plate: '2222BBB',
      vehicle_reactivated: true,
      blocked_by: null,
    })
    mocks.fetchDriverCandidates.mockResolvedValue({
      vehicle: { id: 21, plate: '1234KLM', monthly_avg: null, driver: null },
      candidates: [{ id: 7, name: 'Ana', vehicles: [], monthly_avg: null }],
    })
  })

  // --- Vuelta al servicio: una casilla para los siete modales ---------------

  it('coche parado con sustituto: la casilla lo nombra y al resolver lo suelta', async () => {
    mocks.listVehicleLinks.mockResolvedValue(CON_SUSTITUTO)
    const onDone = renderWith(incidentTarget(incident('breakdown', 'Avería')))
    const casilla = await screen.findByRole('checkbox', {
      name: /dejar libre el de sustitución \(2222BBB\)/i,
    })
    // El coche está averiado y se cierra la avería: nace marcada.
    expect(casilla).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))
    await waitFor(() => expect(mocks.releaseSubstitute).toHaveBeenCalledWith(21))
    expect(onDone.mock.calls[0][0]).toMatch(/2222BBB queda libre/)
  })

  it('el coche ya activo no pregunta nada', async () => {
    const activo = { ...VEHICLE, state: 'active' } as Vehicle
    renderWith(incidentTarget(incident('breakdown', 'Avería')), activo)
    await screen.findByRole('dialog')
    expect(screen.queryByRole('checkbox', { name: /Devolver el coche a Activo/i })).toBeNull()
    // Y sin coche parado no se pregunta por sus vínculos.
    expect(mocks.listVehicleLinks).not.toHaveBeenCalled()
  })

  it('parado por otra causa: la casilla sale sin marcar y, marcada, lo reactiva', async () => {
    // Un «No activo» administrativo con una petición general: cerrarla no
    // devuelve el coche a la calle por sí sola, así que se decide aquí.
    const parado = { ...VEHICLE, state: 'non_active' } as Vehicle
    mocks.releaseSubstitute.mockResolvedValue({
      link_closed: false,
      substitute_plate: '',
      vehicle_reactivated: true,
      blocked_by: null,
    })
    renderWith(incidentTarget(incident('general', 'Petición general')), parado)
    const casilla = await screen.findByRole('checkbox', { name: /Devolver el coche a Activo/i })
    expect(casilla).not.toBeChecked()

    await userEvent.click(casilla)
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))
    await waitFor(() => expect(mocks.releaseSubstitute).toHaveBeenCalledWith(21))
    // El cierre de una petición general no toca el estado: lo hace la acción.
    expect(mocks.resolveIncident.mock.calls[0][1].return_to_active).toBeUndefined()
  })

  it('lo que bloquea la vuelta se cuenta, sin tumbar la resolución', async () => {
    mocks.listVehicleLinks.mockResolvedValue(CON_SUSTITUTO)
    mocks.releaseSubstitute.mockResolvedValue({
      link_closed: true,
      substitute_plate: '2222BBB',
      vehicle_reactivated: false,
      blocked_by: { id: 9, type_display: 'Mantenimiento' },
    })
    const onDone = renderWith(incidentTarget(incident('breakdown', 'Avería')))
    await screen.findByRole('checkbox', { name: /2222BBB/ })
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(onDone.mock.calls[0][0]).toMatch(/sigue abierta una petición de Mantenimiento/)
  })

  it('el CP de la petición viene puesto y se manda si se corrige', async () => {
    const conCp = incident('breakdown', 'Avería')
    ;(conCp as unknown as { workshop_postal_code: string }).workshop_postal_code = '28045'
    renderWith(incidentTarget(conCp))
    const cp = await screen.findByLabelText(/CP de la ubicación/)
    expect(cp).toHaveValue('28045')

    await userEvent.clear(cp)
    await userEvent.type(cp, '41001')
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))
    await waitFor(() => expect(mocks.resolveIncident).toHaveBeenCalled())
    expect(mocks.resolveIncident.mock.calls[0][1].workshop_postal_code).toBe('41001')
  })

  it('sin target no hay diálogo', () => {
    renderWith(null)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('una avería abre el cierre de reparación con su título', async () => {
    renderWith(incidentTarget(incident('breakdown', 'Avería')))
    expect(await screen.findByRole('dialog', { name: 'Resolver avería · 1234KLM' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolver y cerrar' })).toBeInTheDocument()
  })

  it('la alerta de ITV y la incidencia «En ITV» abren Registrar ITV, no una nota', async () => {
    renderWith(alertTarget(alert('itv_due', 'ITV próxima / vencida')))
    expect(await screen.findByRole('dialog', { name: 'Registrar ITV · 1234KLM' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Resultado' })).toBeInTheDocument()
    expect(screen.getByLabelText('Km en la inspección')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/taller avisado/)).toBeNull()
  })

  it('la incidencia inspection también va a Registrar ITV con el vehículo preseleccionado', async () => {
    renderWith(incidentTarget(incident('inspection', 'ITV')))
    await screen.findByRole('dialog', { name: 'Registrar ITV · 1234KLM' })
    expect(screen.getByRole('combobox', { name: 'Vehículo' })).toHaveValue('21')
  })

  it('la alerta de mantenimiento abre su formulario con el plan de su clave preseleccionado', async () => {
    renderWith(
      alertTarget(
        alert('maintenance_due', 'Mantenimiento programado', {
          dedup_key: 'maintenance:5:2026-09-01',
        }),
      ),
    )
    await screen.findByRole('dialog', { name: 'Registrar mantenimiento · 1234KLM' })
    // El plan de la alerta (5, no el primero de la lista) y sin nota suelta.
    expect(await screen.findByRole('combobox', { name: 'Plan de mantenimiento' })).toHaveValue('5')
    expect(screen.queryByRole('option', { name: /Sin plan/ })).toBeNull()
    expect(screen.queryByPlaceholderText(/taller avisado/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Registrar mantenimiento y resolver' })).toBeInTheDocument()
  })

  it('la incidencia de mantenimiento puntual se cierra SIN plan de mantenimiento', async () => {
    renderWith(incidentTarget(incident('maintenance', 'Mantenimiento puntual')))
    await screen.findByRole('dialog', { name: 'Resolver mantenimiento puntual · 1234KLM' })
    // Un mantenimiento puntual no tiene ciclo: no se pregunta por ningún plan.
    expect(await screen.findByLabelText('Fecha del servicio')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Plan de mantenimiento' })).toBeNull()
    expect(screen.getByText(/no hay plan que reanclar/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolver y cerrar' })).toBeInTheDocument()
  })

  it('la alerta de seguro abre «Renovar seguro» con la fecha propuesta un año después del vencimiento', async () => {
    renderWith(
      alertTarget(alert('insurance_due', 'Seguro próximo / vencido', { due_date: '2026-09-20' })),
    )
    await screen.findByRole('dialog', { name: 'Renovar seguro · 1234KLM' })
    expect(screen.getByLabelText('Nueva fecha de vencimiento')).toHaveValue('2027-09-20')
    expect(screen.getByRole('button', { name: 'Renovar seguro' })).toBeInTheDocument()
    // Sin `onEmailRenting` del padre no se ofrece el atajo del correo.
    expect(screen.queryByRole('button', { name: 'Mandar correo a la renting' })).toBeNull()
    expect(screen.queryByPlaceholderText(/taller avisado/)).toBeNull()
  })

  it('la incidencia de neumáticos abre su cierre con las posiciones del parte', async () => {
    renderWith(
      incidentTarget(
        incident('tires', 'Avería de neumáticos', { wheel_scope: 'front', front_measure: '205/55 R16' }),
      ),
    )
    await screen.findByRole('dialog', { name: 'Resolver avería de neumáticos · 1234KLM' })
    expect(screen.getByLabelText('Medida')).toHaveValue('205/55 R16')
    expect(screen.getByRole('checkbox', { name: 'Delantera izquierda' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Trasera izquierda' })).not.toBeChecked()
  })

  it('un accidente con siniestro total cierra la incidencia y encadena la baja del vehículo', async () => {
    const onDone = renderWith(incidentTarget(incident('accident', 'Accidente')))
    await screen.findByRole('dialog', { name: 'Resolver accidente · 1234KLM' })
    expect(screen.getByLabelText('Nº de expediente')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /Siniestro total/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y dar de baja' }))

    // Se avisa del cierre y se abre la baja con la matrícula del coche.
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Petición resuelta y cerrada.'))
    expect(await screen.findByRole('dialog', { name: 'Dar de baja 1234KLM' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Motivo *'), 'Siniestro total')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar baja' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Vehículo 1234KLM dado de baja.'))
    expect(mocks.updateVehicleFields).toHaveBeenCalledWith(
      21,
      expect.objectContaining({ state: 'retired', expected_updated_at: 'fresh' }),
    )
  })

  it('«sin conductor» abre el modal de alertas con la asignación de conductor', async () => {
    renderWith(alertTarget(alert('no_driver', 'Vehículo sin conductor')))
    await screen.findByRole('dialog', { name: 'Resolver alerta · 1234KLM' })
    expect(await screen.findByRole('combobox', { name: 'Asignar conductor' })).toBeInTheDocument()
  })
})
