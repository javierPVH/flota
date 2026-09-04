// IndexedDB no existe en jsdom: fake-indexeddb ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { todayIso } from '../format.ts'
import { LanguageProvider } from '../i18n.tsx'
import { queuedItems } from '../offline/queue.ts'
import type { Vehicle, VehicleSummary } from '../types.ts'
import { RegisterFuelModal } from './RegisterFuelModal.tsx'

const mocks = vi.hoisted(() => ({ addFuelEntry: vi.fn() }))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  addFuelEntry: mocks.addFuelEntry,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'carlos', roles: ['driver'] } }),
}))

const VEHICLE = { id: 3, plate: '7890NPQ' } as Vehicle

function renderModal(summary: Partial<VehicleSummary> | null = null) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(
    <LanguageProvider>
      <RegisterFuelModal
        vehicle={VEHICLE}
        summary={summary ? ({ vehicle: 3, ...summary } as VehicleSummary) : null}
        onClose={onClose}
        onSaved={onSaved}
      />
    </LanguageProvider>,
  )
  return { onSaved, onClose }
}

describe('RegisterFuelModal (gasto de combustible de campo)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.addFuelEntry.mockResolvedValue({ id: 5, period: '2026-09-01', liters: '55.50' })
  })

  it('enseña lo que ya lleva el mes y suma el repostaje', async () => {
    const { onSaved, onClose } = renderModal({
      fuel_month_liters: '120.00',
      fuel_month_amount: '168.40',
    })

    // La pista de arriba es el mes en curso (la serie de consumo es mensual).
    expect(screen.getByText(/Este mes ya llevas/)).toBeInTheDocument()
    expect(screen.getByText('120,00 l')).toBeInTheDocument()
    expect(screen.getByText(/168,40 €/)).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/Litros repostados/), '45,5')
    await userEvent.type(screen.getByLabelText(/Importe/), '62,30')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar gasto' }))

    // La coma del teclado móvil viaja como punto decimal. El payload lleva
    // además el mes de CAPTURA (R3-37) y la clave de idempotencia (R3-34).
    await waitFor(() =>
      expect(mocks.addFuelEntry).toHaveBeenCalledWith({
        vehicle: 3,
        liters: '45.5',
        amount: '62.30',
        period: `${todayIso().slice(0, 7)}-01`,
        client_ref: expect.any(String),
      }),
    )
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('sin gasto del mes lo dice, y el importe es opcional', async () => {
    renderModal({ fuel_month_liters: null, fuel_month_amount: null })

    expect(screen.getByText('Sin gasto registrado este mes.')).toBeInTheDocument()
    // Solo los litros son obligatorios: hay tickets que no se guardan.
    expect(screen.getByRole('button', { name: 'Guardar gasto' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/Litros repostados/), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar gasto' }))
    await waitFor(() =>
      expect(mocks.addFuelEntry).toHaveBeenCalledWith({
        vehicle: 3,
        liters: '30',
        amount: null,
        period: `${todayIso().slice(0, 7)}-01`,
        client_ref: expect.any(String),
      }),
    )
  })

  it('sin red, el repostaje queda en la cola offline', async () => {
    const { onSaved, onClose } = renderModal(null)
    // Fallo de RED (fetch rechaza con TypeError), no error HTTP.
    mocks.addFuelEntry.mockRejectedValue(new TypeError('Failed to fetch'))

    await userEvent.type(screen.getByLabelText(/Litros repostados/), '20')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar gasto' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // R3-37/R3-34: lo encolado conserva el mes de captura y la MISMA
    // referencia del intento directo — el reenvío no cambia el mes ni resuma.
    const attempted = mocks.addFuelEntry.mock.calls[0][0]
    const stored = (await queuedItems()).find(
      (row) => row.item.kind === 'fuel' && row.item.payload.liters === '20',
    )
    expect(stored).toBeDefined()
    expect(stored!.item.payload).toEqual(attempted)
    expect(attempted.period).toBe(`${todayIso().slice(0, 7)}-01`)
  })

  it('un rechazo del servidor se muestra y no cierra', async () => {
    const { onClose } = renderModal(null)
    mocks.addFuelEntry.mockRejectedValue(new Error('liters: No puede ser negativo.'))

    await userEvent.type(screen.getByLabelText(/Litros repostados/), '20')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar gasto' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No puede ser negativo.')
    expect(onClose).not.toHaveBeenCalled()
  })
})
