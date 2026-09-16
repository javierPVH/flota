import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResolveTiresModal } from './ResolveTiresModal.tsx'
import { prefillPositions, prefillSize } from './tires.ts'
import { LanguageProvider } from '../../i18n.tsx'
import type { Incident } from '../../types.ts'

const mocks = vi.hoisted(() => ({
  resolveIncident: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.ts')>()),
  resolveIncident: mocks.resolveIncident,
  uploadDocument: mocks.uploadDocument,
}))

const incident = (details: Record<string, unknown>) =>
  ({
    id: 4,
    vehicle: 21,
    type: 'tires',
    type_display: 'Avería de neumáticos',
    date: '2026-08-20',
    description: 'Desgaste delantero',
    mileage: null,
    workshop_postal_code: '',
    details,
    status: 'open',
    status_display: 'Abierta',
    cost: null,
  }) as unknown as Incident

function renderModal(details: Record<string, unknown>) {
  const onDone = vi.fn()
  render(
    <LanguageProvider>
      <ResolveTiresModal incident={incident(details)} onClose={vi.fn()} onDone={onDone} />
    </LanguageProvider>,
  )
  return onDone
}

describe('ResolveTiresModal (neumáticos montados)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.resolveIncident.mockReset()
    mocks.uploadDocument.mockReset()
    mocks.resolveIncident.mockResolvedValue({ id: 4, status: 'closed', vehicle_reactivated: false })
  })

  it('desgaste delantero: prellena medida y las dos posiciones, y manda el bloque `tires`', async () => {
    const onDone = renderModal({
      report_version: 1,
      change_reason: 'wear',
      wheel_scope: 'front',
      front_measure: '205/55 R16',
    })
    expect(screen.getByLabelText('Medida')).toHaveValue('205/55 R16')
    expect(screen.getByRole('checkbox', { name: 'Delantera izquierda' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Delantera derecha' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Trasera izquierda' })).not.toBeChecked()
    expect(screen.getByLabelText('Cantidad')).toHaveValue(2)
    // Sin casilla de vuelta a Activo: cambiar ruedas no saca el coche del servicio.
    expect(screen.queryByRole('checkbox', { name: /Devolver el vehículo a Activo/ })).toBeNull()

    await userEvent.type(screen.getByLabelText('Marca'), 'Michelin')
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.resolveIncident).toHaveBeenCalledWith(4, {
      resolution_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      tires: {
        size: '205/55 R16',
        brand: 'Michelin',
        quantity: 2,
        positions: ['front_left', 'front_right'],
      },
    })
    expect(onDone.mock.calls[0][0]).toBe('Petición resuelta y cerrada.')
  })

  it('pinchazo: una rueda; marcar otra sube la cantidad y quitarlas todas la libera', async () => {
    renderModal({ change_reason: 'puncture', wheel: 'rear_left', tire_measure: '195/65 R15' })
    await screen.findByLabelText('Medida')
    expect(screen.getByLabelText('Medida')).toHaveValue('195/65 R15')
    const rearLeft = screen.getByRole('checkbox', { name: 'Trasera izquierda' })
    const rearRight = screen.getByRole('checkbox', { name: 'Trasera derecha' })
    expect(rearLeft).toBeChecked()
    expect(screen.getByLabelText('Cantidad')).toHaveValue(1)
    await userEvent.click(rearRight)
    expect(screen.getByLabelText('Cantidad')).toHaveValue(2)
    await userEvent.click(rearLeft)
    await userEvent.click(rearRight)
    expect(screen.getByLabelText('Cantidad')).toHaveValue(null)
  })

  it('sin parte guiado ni datos, el cierre lleva solo la fecha', async () => {
    const onDone = renderModal({})
    await screen.findByLabelText('Medida')
    await userEvent.click(screen.getByRole('button', { name: 'Resolver y cerrar' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mocks.resolveIncident).toHaveBeenCalledWith(4, {
      resolution_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })
})

describe('prefill desde el parte', () => {
  it('traduce alcance y rueda a posiciones, y elige la medida disponible', () => {
    expect(prefillPositions({ wheel_scope: 'all' })).toHaveLength(4)
    expect(prefillPositions({ wheel_scope: 'rear' })).toEqual(['rear_left', 'rear_right'])
    expect(prefillPositions({ wheel: 'front_right' })).toEqual(['front_right'])
    expect(prefillPositions({ wheel: 'spare' })).toEqual([])
    expect(prefillSize({ rear_measure: ' 225/45 R17 ' })).toBe('225/45 R17')
    expect(prefillSize({})).toBe('')
  })
})
