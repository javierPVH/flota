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

const CAMPO = /Consumo medio real en ese momento/

describe('RegisterFuelModal (consumo medio de campo)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.addFuelEntry.mockResolvedValue({ id: 5, reading_date: '2026-09-14', avg_consumption: '6.80' })
  })

  it('enseña la nota y la última anotación, y guarda consumo medio con su día', async () => {
    const { onSaved, onClose } = renderModal({
      fuel_avg_consumption: '7.10',
      fuel_avg_date: '2026-09-02',
    })

    // La nota dice qué se anota (el del último trayecto) y qué no (el histórico).
    expect(
      screen.getByText(/anota el consumo medio que marca el ordenador de a bordo/),
    ).toBeInTheDocument()
    expect(screen.getByText(/NO anotes el "consumo histórico"/)).toBeInTheDocument()
    // La pista de arriba es la última anotación, con su día.
    expect(screen.getByText(/Última anotación/)).toHaveTextContent(/7,10/)
    // Ni litros, ni importe, ni origen.
    expect(screen.queryByLabelText(/Litros/)).toBeNull()
    expect(screen.queryByLabelText(/Importe/)).toBeNull()
    expect(screen.queryByLabelText(/Origen/)).toBeNull()

    await userEvent.type(screen.getByLabelText(CAMPO), '6,8')
    const fecha = screen.getByLabelText(/Fecha/) as HTMLInputElement
    expect(fecha.type).toBe('date')
    expect(fecha.value).toBe(todayIso())
    await userEvent.click(screen.getByRole('button', { name: 'Guardar consumo' }))

    // La coma del teclado móvil viaja como punto decimal. El payload lleva
    // además el día de CAPTURA (R3-37) y la clave de idempotencia (R3-34).
    await waitFor(() =>
      expect(mocks.addFuelEntry).toHaveBeenCalledWith({
        vehicle: 3,
        avg_consumption: '6.8',
        reading_date: todayIso(),
        client_ref: expect.any(String),
      }),
    )
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('sin anotaciones lo dice, y sin cifra no deja guardar', async () => {
    renderModal({ fuel_avg_consumption: null, fuel_avg_date: null })

    expect(screen.getByText('Sin anotaciones de consumo todavía.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar consumo' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText(CAMPO), '5.9')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar consumo' }))
    await waitFor(() =>
      expect(mocks.addFuelEntry).toHaveBeenCalledWith({
        vehicle: 3,
        avg_consumption: '5.9',
        reading_date: todayIso(),
        client_ref: expect.any(String),
      }),
    )
  })

  it('sin red, la anotación queda en la cola offline con su día', async () => {
    const { onSaved, onClose } = renderModal(null)
    // Fallo de RED (fetch rechaza con TypeError), no error HTTP.
    mocks.addFuelEntry.mockRejectedValue(new TypeError('Failed to fetch'))

    await userEvent.type(screen.getByLabelText(CAMPO), '6.2')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar consumo' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // R3-37/R3-34: lo encolado conserva el día de captura y la MISMA
    // referencia del intento directo.
    const attempted = mocks.addFuelEntry.mock.calls[0][0]
    const stored = (await queuedItems()).find(
      (row) => row.item.kind === 'fuel' && row.item.payload.avg_consumption === '6.2',
    )
    expect(stored).toBeDefined()
    expect(stored!.item.payload).toEqual(attempted)
    expect(attempted.reading_date).toBe(todayIso())
  })

  it('un rechazo del servidor se muestra y no cierra', async () => {
    const { onClose } = renderModal(null)
    mocks.addFuelEntry.mockRejectedValue(new Error('avg_consumption: No puede ser negativo.'))

    await userEvent.type(screen.getByLabelText(CAMPO), '6.2')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar consumo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No puede ser negativo.')
    expect(onClose).not.toHaveBeenCalled()
  })
})
