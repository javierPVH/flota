// R5-50: la referencia de idempotencia es UNA por captura, no por pulsación.
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'
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

describe('RegisterFuelModal · client_ref estable (R5-50)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
  })

  it('un 502 y el reintento manual mandan la MISMA referencia', async () => {
    // Un error HTTP (no de red) pinta el aviso; el conductor vuelve a pulsar.
    mocks.addFuelEntry
      .mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
      .mockResolvedValueOnce({ id: 5, reading_date: '2026-09-14', avg_consumption: '6.80' })
    const onSaved = vi.fn()
    render(
      <LanguageProvider>
        <RegisterFuelModal vehicle={VEHICLE} summary={null} onClose={vi.fn()} onSaved={onSaved} />
      </LanguageProvider>,
    )
    await userEvent.type(screen.getByLabelText(/Consumo medio real en ese momento/), '6,8')
    const save = screen.getByRole('button', { name: 'Guardar consumo' })
    await userEvent.click(save)
    await screen.findByRole('alert')
    await userEvent.click(save)
    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    expect(mocks.addFuelEntry).toHaveBeenCalledTimes(2)
    const [first] = mocks.addFuelEntry.mock.calls[0]
    const [second] = mocks.addFuelEntry.mock.calls[1]
    expect(first.client_ref).toBeTruthy()
    expect(second.client_ref).toBe(first.client_ref)
  })
})
