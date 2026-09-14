import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MaintenanceResolveForm } from './MaintenanceResolveForm.tsx'
import { LanguageProvider } from '../../i18n.tsx'
import type { Alert, Incident } from '../../types.ts'

const mocks = vi.hoisted(() => ({
  listMaintenancePlans: vi.fn(),
  maintenancePlanDone: vi.fn(),
  resolveIncident: vi.fn(),
  resolveAlert: vi.fn(),
  listWorkshops: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.ts')>()),
  listMaintenancePlans: mocks.listMaintenancePlans,
  maintenancePlanDone: mocks.maintenancePlanDone,
  resolveIncident: mocks.resolveIncident,
  resolveAlert: mocks.resolveAlert,
  listWorkshops: mocks.listWorkshops,
  uploadDocument: mocks.uploadDocument,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const PLANS = [
  { id: 4, vehicle: 21, name: 'Revisión general', every_km: 30000, every_months: 12 },
  { id: 5, vehicle: 21, name: 'Cambio de correa', every_km: null, every_months: 60 },
]

const ALERT = {
  id: 9,
  type: 'maintenance_due',
  type_display: 'Mantenimiento programado',
  level: 'warning',
  level_display: 'Aviso',
  status: 'open',
  vehicle: 21,
  vehicle_plate: '1234KLM',
  message: 'Cambio de correa vence en 3 días',
  due_date: null,
  dedup_key: 'maintenance:5:2026-09-12',
} as unknown as Alert

const INCIDENT = {
  id: 14,
  vehicle: 21,
  type: 'maintenance',
  type_display: 'Mantenimiento puntual',
  date: '2026-09-01',
  description: 'Ruido en la correa',
  details: { maintenance_plan: 4 },
  status: 'open',
  status_display: 'Abierta',
  cost: null,
} as unknown as Incident

type Props = Parameters<typeof MaintenanceResolveForm>[0]

function renderForm(props: Omit<Props, 'onClose' | 'onDone'>) {
  const onDone = vi.fn()
  render(
    <LanguageProvider>
      <MaintenanceResolveForm {...props} onClose={vi.fn()} onDone={onDone} />
    </LanguageProvider>,
  )
  return onDone
}

describe('MaintenanceResolveForm (una llamada, tres puertas)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.maintenancePlanDone.mockReset()
    mocks.resolveIncident.mockReset()
    mocks.resolveAlert.mockReset()
    mocks.uploadDocument.mockReset()
    mocks.listWorkshops.mockResolvedValue([{ id: 3, name: 'Taller Centro', kind: 'workshop' }])
    mocks.listMaintenancePlans.mockResolvedValue(page(PLANS))
    mocks.maintenancePlanDone.mockResolvedValue({ incident: 30, vehicle_reactivated: true })
    mocks.resolveIncident.mockResolvedValue({ ...INCIDENT, status: 'closed', vehicle_reactivated: false })
    mocks.resolveAlert.mockResolvedValue({})
  })

  it('alerta: preselecciona el plan de su clave y llama a `done` con taller, coste, nota y Activo', async () => {
    const onDone = renderForm({ source: { kind: 'alert', alert: ALERT }, vehicleState: 'maintenance' })
    // El mensaje del aviso, delante de los ojos.
    expect(screen.getByText('Cambio de correa vence en 3 días')).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'Plan de mantenimiento' })).toHaveValue('5')
    await userEvent.type(screen.getByLabelText('Coste (€)'), '210')
    await userEvent.type(screen.getByLabelText('Observaciones'), 'Correa y tensor')
    expect(screen.getByRole('checkbox', { name: /Devolver el vehículo a Activo/ })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Registrar mantenimiento y resolver' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.maintenancePlanDone).toHaveBeenCalledWith(5, {
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      cost: '210',
      note: 'Correa y tensor',
      return_to_active: true,
    })
    expect(mocks.resolveAlert).not.toHaveBeenCalled()
    expect(onDone.mock.calls[0][0]).toMatch(/vuelve a estar Activo/)
  })

  it('alerta sin planes: solo la nota, y resuelve la alerta como cualquier otra', async () => {
    mocks.listMaintenancePlans.mockResolvedValue(page([]))
    const onDone = renderForm({ source: { kind: 'alert', alert: ALERT } })
    expect(await screen.findByText(/no tiene planes de mantenimiento/)).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    await userEvent.type(screen.getByLabelText('Observaciones'), 'Cita pedida')
    await userEvent.click(screen.getByRole('button', { name: 'Resolver alerta' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.resolveAlert).toHaveBeenCalledWith(9, 'Cita pedida')
    expect(mocks.maintenancePlanDone).not.toHaveBeenCalled()
  })

  /** Un mantenimiento PUNTUAL no lleva plan: no hay ciclo que reanclar, así que
   * su cierre no pregunta por ninguno (ni carga el catálogo de planes). */
  it('incidencia puntual: no pregunta el plan y liga la factura al cerrar', async () => {
    mocks.uploadDocument.mockResolvedValue({})
    const onDone = renderForm({ source: { kind: 'incident', incident: INCIDENT }, vehicleState: 'active' })
    expect(await screen.findByLabelText('Fecha del servicio')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Plan de mantenimiento' })).toBeNull()
    expect(screen.getByText(/no hay plan que reanclar/)).toBeInTheDocument()
    const file = new File(['pdf'], 'factura.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText(/Adjuntar la factura del taller/), file)
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    // Sin plan ni casilla (coche Activo): solo la fecha.
    expect(mocks.resolveIncident).toHaveBeenCalledWith(14, {
      resolution_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
    expect(mocks.uploadDocument).toHaveBeenCalledWith(
      { vehicle: 21, incident: 14, type: 'workshop_invoice' },
      file,
    )
    expect(mocks.maintenancePlanDone).not.toHaveBeenCalled()
  })

  it('incidencia puntual: `resolve` va sin `maintenance_plan` (una sola llamada)', async () => {
    const onDone = renderForm({ source: { kind: 'incident', incident: INCIDENT } })
    await userEvent.type(await screen.findByLabelText('Km al realizarlo'), '61000')
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.resolveIncident).toHaveBeenCalledWith(14, {
      resolution_date: expect.any(String),
      km: 61000,
    })
    expect(onDone.mock.calls[0][0]).toBe('Petición resuelta y cerrada.')
  })
})
