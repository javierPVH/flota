import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResolveAccidentModal } from './ResolveAccidentModal.tsx'
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
  type: 'accident',
  type_display: 'Accidente',
  date: '2026-08-20',
  description: 'Alcance en rotonda',
  mileage: null,
  workshop_postal_code: '',
  details: {},
  accident_report: null,
  status: 'open',
  status_display: 'Abierta',
  cost: null,
} as unknown as Incident

function renderModal(vehicleState: VehicleState) {
  const onDone = vi.fn()
  const onRetire = vi.fn()
  render(
    <LanguageProvider>
      <ResolveAccidentModal
        incident={INCIDENT}
        vehicleState={vehicleState}
        onClose={vi.fn()}
        onDone={onDone}
        onRetire={onRetire}
      />
    </LanguageProvider>,
  )
  return { onDone, onRetire }
}

describe('ResolveAccidentModal (reparación + datos del siniestro)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.resolveIncident.mockReset()
    mocks.uploadDocument.mockReset()
    mocks.resolveIncident.mockResolvedValue({ id: 4, status: 'closed', vehicle_reactivated: true })
  })

  it('coche accidentado: Activo marcado, expediente y franquicia con su importe', async () => {
    const { onDone, onRetire } = renderModal('accidente')
    await screen.findByLabelText('Nº de expediente')
    expect(screen.getByRole('checkbox', { name: /Devolver el vehículo a Activo/ })).toBeChecked()
    await userEvent.type(screen.getByLabelText('Nº de expediente'), 'EXP-2026-17')
    // El importe solo aparece cuando asume la franquicia.
    expect(screen.queryByLabelText('Importe de la franquicia (€)')).toBeNull()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Quién asume el coste' }), 'deductible')
    await userEvent.type(screen.getByLabelText('Importe de la franquicia (€)'), '300')
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.resolveIncident).toHaveBeenCalledWith(4, {
      resolution_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      return_to_active: true,
      accident: { claim_ref: 'EXP-2026-17', liability: 'deductible', deductible_amount: '300' },
    })
    expect(onDone.mock.calls[0][0]).toMatch(/vuelve a estar Activo/)
    expect(onRetire).not.toHaveBeenCalled()
  })

  it('siniestro total: sin vuelta a Activo, «Resolver y dar de baja» y encadena la baja', async () => {
    mocks.resolveIncident.mockResolvedValue({ id: 4, status: 'closed', vehicle_reactivated: false })
    const { onDone, onRetire } = renderModal('accidente')
    await screen.findByLabelText('Nº de expediente')
    await userEvent.click(screen.getByRole('checkbox', { name: /Siniestro total/ }))
    expect(screen.queryByRole('checkbox', { name: /Devolver el vehículo a Activo/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y dar de baja' }))

    await waitFor(() => expect(onRetire).toHaveBeenCalled())
    expect(mocks.resolveIncident).toHaveBeenCalledWith(4, {
      resolution_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      accident: { total_loss: true },
    })
    // Primero se avisa del cierre; después se abre la baja.
    expect(onDone).toHaveBeenCalled()
    expect(onDone.mock.invocationCallOrder[0]).toBeLessThan(onRetire.mock.invocationCallOrder[0])
  })

  it('coche ya Activo y tercero responsable: sin casilla, sin importe, bloque mínimo', async () => {
    const { onDone } = renderModal('active')
    await screen.findByLabelText('Nº de expediente')
    expect(screen.queryByRole('checkbox', { name: /Devolver el vehículo a Activo/ })).toBeNull()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Quién asume el coste' }), 'third_party')
    expect(screen.queryByLabelText('Importe de la franquicia (€)')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.resolveIncident).toHaveBeenCalledWith(4, {
      resolution_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      accident: { liability: 'third_party' },
    })
  })
})
