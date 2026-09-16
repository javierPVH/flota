// R5-45: devolución guiada (GAP-7) — estimación en vivo, una sola llamada y el
// resumen de lo hecho, que es lo que la gestión archiva.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VehicleReturnModal } from './VehicleReturnModal.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'

const mocks = vi.hoisted(() => ({ returnVehicle: vi.fn() }))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  returnVehicle: mocks.returnVehicle,
}))

const VEHICLE = {
  id: 21,
  plate: '1234KLM',
  km_start: 10000,
  unlimited_km: false,
} as unknown as Vehicle

const CONTRACT: VehicleSummary['contract'] = {
  id: 3,
  month_fee: '400.00',
  contract_km: 40000,
  contract_time: 36,
  penalty_per_km: '0.10',
  start_date: '2024-01-01',
  planned_end_date: '2027-01-01',
  drive_url: '',
}

function renderModal(props: Partial<Parameters<typeof VehicleReturnModal>[0]> = {}) {
  const onClose = vi.fn()
  const onReturned = vi.fn()
  render(
    <LanguageProvider>
      <VehicleReturnModal
        open
        vehicle={VEHICLE}
        contract={CONTRACT}
        onClose={onClose}
        onReturned={onReturned}
        {...props}
      />
    </LanguageProvider>,
  )
  return { onClose, onReturned }
}

describe('VehicleReturnModal (devolución guiada, GAP-7)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.returnVehicle.mockReset()
  })

  it('estima en vivo el exceso y la penalización con lo que la ficha ya sabe', async () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: 'Devolver 1234KLM' })).toBeInTheDocument()
    const km = screen.getByLabelText('Km de devolución')
    // 10.000 iniciales + 40.000 contratados = 50.000: por debajo, dentro.
    await userEvent.type(km, '45000')
    expect(screen.getByText('Dentro de los km contratados.')).toBeInTheDocument()
    // 52.000 → 2.000 km de exceso × 0,10 € = 200 €.
    await userEvent.clear(km)
    await userEvent.type(km, '52000')
    // `toLocaleString()` sin locale: el separador de miles depende del entorno.
    expect(screen.getByText(/Exceso estimado: 2[.,]?000 km/)).toBeInTheDocument()
    expect(screen.getByText(/~200\.00 € de penalización/)).toBeInTheDocument()
  })

  it('sin contrato con km, o con km ilimitados, no estima nada', async () => {
    renderModal({ vehicle: { ...VEHICLE, unlimited_km: true } as Vehicle })
    await userEvent.type(screen.getByLabelText('Km de devolución'), '99000')
    expect(screen.queryByText(/Exceso estimado|Dentro de los km/)).toBeNull()
  })

  it('devuelve en UNA llamada y enseña el resumen; cerrarlo recarga la ficha', async () => {
    mocks.returnVehicle.mockResolvedValue({
      km_end: 52000,
      assignments_finished: 1,
      links_closed: 0,
      alerts_resolved: 2,
      contract_closed: 3,
      contract_km: 40000,
      overage_km: 2000,
      penalty_per_km: '0.10',
      penalty_estimate: '200.00',
    })
    const { onClose, onReturned } = renderModal()
    await userEvent.type(screen.getByLabelText('Km de devolución'), '52000')
    await userEvent.type(screen.getByLabelText('Motivo'), '  Fin de renting ')
    await userEvent.click(screen.getByRole('button', { name: 'Devolver vehículo' }))

    await waitFor(() => expect(mocks.returnVehicle).toHaveBeenCalledTimes(1))
    expect(mocks.returnVehicle).toHaveBeenCalledWith(21, {
      km_end: 52000,
      end_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      reason: 'Fin de renting', // recortado
    })
    expect(await screen.findByText('Vehículo devuelto')).toBeInTheDocument()
    expect(screen.getByText(/^52[.,]?000 km$/)).toBeInTheDocument()
    expect(screen.getByText(/^2[.,]?000 km$/)).toBeInTheDocument()
    expect(screen.getByText('200.00 €')).toBeInTheDocument()
    // Contrato cerrado → «Sí»; 2 alertas resueltas.
    expect(screen.getByText('Sí')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    // Dos «Cerrar»: la X del modal y el botón del resumen; los dos recargan.
    const cerrar = screen.getAllByRole('button', { name: 'Cerrar' })
    await userEvent.click(cerrar[cerrar.length - 1])
    expect(onReturned).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('un fallo del back se lee en el modal y no se da por devuelto', async () => {
    mocks.returnVehicle.mockRejectedValue(new Error('El vehículo ya está de baja.'))
    const { onReturned } = renderModal()
    await userEvent.click(screen.getByRole('button', { name: 'Devolver vehículo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('El vehículo ya está de baja.')
    expect(screen.queryByText('Vehículo devuelto')).toBeNull()
    // Sin km escritos se manda `null`: el back decide con la última lectura.
    expect(mocks.returnVehicle).toHaveBeenCalledWith(21, expect.objectContaining({ km_end: null }))
    expect(onReturned).not.toHaveBeenCalled()
  })

  it('cancelar antes de devolver solo cierra', async () => {
    const { onClose, onReturned } = renderModal()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onReturned).not.toHaveBeenCalled()
  })
})
