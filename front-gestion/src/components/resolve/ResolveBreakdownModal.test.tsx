import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResolveBreakdownModal } from './ResolveBreakdownModal.tsx'
import { LanguageProvider } from '../../i18n.tsx'
import type { Incident, VehicleState } from '../../types.ts'

const mocks = vi.hoisted(() => ({
  resolveIncident: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.ts')>()),
  resolveIncident: mocks.resolveIncident,
  uploadDocument: mocks.uploadDocument,
}))

const INCIDENT = {
  id: 4,
  vehicle: 21,
  type: 'breakdown',
  type_display: 'Avería',
  date: '2026-08-20',
  description: 'No arranca en frío',
  mileage: null,
  workshop_postal_code: '',
  details: {},
  status: 'open',
  status_display: 'Abierta',
  cost: null,
} as unknown as Incident

function renderModal(
  vehicleState: VehicleState,
  onDone = vi.fn(),
  extra: { incident?: Incident; vehicleKm?: number | null } = {},
) {
  render(
    <LanguageProvider>
      <ResolveBreakdownModal
        incident={extra.incident ?? INCIDENT}
        vehicleState={vehicleState}
        vehicleKm={extra.vehicleKm ?? null}
        onClose={vi.fn()}
        onDone={onDone}
      />
    </LanguageProvider>,
  )
  return onDone
}

describe('ResolveBreakdownModal (resolver avería)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.resolveIncident.mockReset()
    mocks.uploadDocument.mockReset()
    mocks.resolveIncident.mockResolvedValue({
      ...INCIDENT,
      status: 'closed',
      vehicle_reactivated: true,
      alerts_resolved: 0,
    })
  })

  it('coche averiado: ofrece devolverlo a Activo (marcado) y manda coste y km', async () => {
    const onDone = renderModal('broken')
    // El cierre ya NO pregunta el taller (era la dinámica antigua: el taller se
    // decide en la gestión, con el CP de la ubicación preferente).
    expect(screen.queryByRole('combobox', { name: 'Taller' })).toBeNull()
    await userEvent.type(await screen.findByLabelText('Coste (€)'), '420.5')
    await userEvent.type(screen.getByLabelText('Km al recoger el vehículo'), '40120')
    const toggle = screen.getByRole('checkbox', { name: /Devolver el vehículo a Activo/ })
    expect(toggle).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.resolveIncident).toHaveBeenCalledWith(4, {
      resolution_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      cost: '420.5',
      km: 40120,
      return_to_active: true,
    })
    expect(onDone.mock.calls[0][0]).toMatch(/vuelve a estar Activo/)
    expect(mocks.uploadDocument).not.toHaveBeenCalled()
  })

  it('coche activo: sin casilla y sin `return_to_active` en el payload', async () => {
    const onDone = renderModal('active')
    await screen.findByLabelText('Coste (€)')
    expect(screen.queryByRole('checkbox')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.resolveIncident).toHaveBeenCalledWith(4, {
      resolution_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })

  it('la factura se sube DESPUÉS de resolver, ligada a la incidencia, y su fallo no rompe', async () => {
    mocks.uploadDocument.mockRejectedValue(new Error('drive caído'))
    const onDone = renderModal('active')
    await screen.findByLabelText('Coste (€)')
    const file = new File(['pdf'], 'factura.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText(/Adjuntar la factura del taller/), file)
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.uploadDocument).toHaveBeenCalledWith(
      { vehicle: 21, incident: 4, type: 'workshop_invoice' },
      file,
    )
    expect(onDone.mock.calls[0][0]).toMatch(/no se pudo subir «factura.pdf»/)
  })

  it('petición general: fecha y observaciones, y el taller solo si se marca', async () => {
    // Puede no ir del coche (documentación, tarjetas, dudas): pedir siempre km,
    // coste, CP y factura invitaba a cerrarla con ceros.
    const general = { ...INCIDENT, type: 'general', type_display: 'Petición general' } as Incident
    const onDone = renderModal('active', vi.fn(), { incident: general })
    await screen.findByLabelText('Observaciones')
    expect(screen.queryByLabelText('Coste (€)')).toBeNull()
    expect(screen.queryByLabelText('Km al recoger el vehículo')).toBeNull()

    await userEvent.click(screen.getByRole('checkbox', { name: /Requirió pasar por el taller/ }))
    await userEvent.type(await screen.findByLabelText('Coste (€)'), '30')
    // Desmarcarlo lo BORRA: si no, un coste escondido viajaría igual.
    await userEvent.click(screen.getByRole('checkbox', { name: /Requirió pasar por el taller/ }))
    expect(screen.queryByLabelText('Coste (€)')).toBeNull()

    await userEvent.type(screen.getByLabelText('Observaciones'), 'Tarjeta entregada')
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.resolveIncident).toHaveBeenCalledWith(4, {
      resolution_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      observations: 'Tarjeta entregada',
    })
  })

  it('«Km» se carga del propio coche: en el taller no ha rodado', async () => {
    const onDone = renderModal('active', vi.fn(), { vehicleKm: 40120 })
    await userEvent.click(await screen.findByRole('button', { name: /Cargar los del coche/ }))
    expect(screen.getByLabelText('Km al recoger el vehículo')).toHaveValue(40120)

    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.resolveIncident).toHaveBeenCalledWith(4, {
      resolution_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      km: 40120,
    })
  })

  it('sin última lectura conocida no se ofrece cargarla', async () => {
    renderModal('active')
    await screen.findByLabelText('Coste (€)')
    expect(screen.queryByRole('button', { name: /Cargar los del coche/ })).toBeNull()
  })

  it('el cierre no consulta el catálogo de talleres', async () => {
    const onDone = renderModal('active')
    await userEvent.click(await screen.findByRole('button', { name: 'Resolver y cerrar' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })
})
