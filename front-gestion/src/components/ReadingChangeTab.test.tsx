import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReadingChangeTab } from './ReadingChangeTab.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { ReadingChangeRequestRow } from '../api.ts'

const mocks = vi.hoisted(() => ({
  listReadingChangeRequests: vi.fn(),
  resolveReadingChangeRequest: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listReadingChangeRequests: mocks.listReadingChangeRequests,
  resolveReadingChangeRequest: mocks.resolveReadingChangeRequest,
}))

const CORRECCION: ReadingChangeRequestRow = {
  id: 7,
  kind: 'km',
  kind_display: 'Lectura de km',
  vehicle: 21,
  vehicle_plate: '1234KLM',
  requested_by: 9,
  requested_by_name: 'Carlos Ruiz',
  changes: { km_reading: 41900 },
  changes_display: [
    { field: 'km_reading', label: 'Odómetro (km)', current: '49000', proposed: '41900' },
  ],
  note: 'Bailé dos cifras.',
  status: 'pending',
  status_display: 'Pendiente',
  resolved_by_name: '',
  resolved_at: null,
  resolution_note: '',
  created_at: '2026-11-18T10:00:00Z',
}

function pintar() {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <ReadingChangeTab />
      </LanguageProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

describe('Bandeja de correcciones de km y consumo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listReadingChangeRequests.mockResolvedValue({
      count: 1,
      results: [CORRECCION],
      next: null,
    })
    mocks.resolveReadingChangeRequest.mockResolvedValue({ ...CORRECCION, status: 'done' })
  })

  it('la fila dice de qué coche es, qué se corrige y el original frente a lo pedido', async () => {
    const user = pintar()
    expect(await screen.findByText('1234KLM')).toBeInTheDocument()
    expect(screen.getByText('Lectura de km')).toBeInTheDocument()
    expect(screen.getByText('49000')).toBeInTheDocument()
    expect(screen.getByText(/41900/)).toBeInTheDocument()
    expect(screen.getByText('Carlos Ruiz')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Gestionar…' }))
    expect(
      await screen.findByRole('dialog', { name: 'Corregir una anotación · 1234KLM' }),
    ).toBeInTheDocument()
  })

  it('aprobarla la manda como «done» y avisa', async () => {
    const user = pintar()
    await user.click(await screen.findByRole('button', { name: 'Gestionar…' }))
    await user.click(screen.getByRole('button', { name: 'Resolver' }))

    await waitFor(() =>
      expect(mocks.resolveReadingChangeRequest).toHaveBeenCalledWith(7, 'done', ''),
    )
    expect(await screen.findByText('Corrección de 1234KLM aprobada.')).toBeInTheDocument()
  })

  it('denegarla viaja con su motivo', async () => {
    const user = pintar()
    await user.click(await screen.findByRole('button', { name: 'Gestionar…' }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Qué se hace con la corrección' }),
      'reject',
    )
    await user.type(screen.getByLabelText('Observaciones (opcional)'), 'La cifra era buena.')
    await user.click(screen.getByRole('button', { name: 'Resolver' }))

    await waitFor(() =>
      expect(mocks.resolveReadingChangeRequest).toHaveBeenCalledWith(
        7,
        'reject',
        'La cifra era buena.',
      ),
    )
  })

  it('si el back no deja aprobarla, el motivo se lee en el modal y la fila sigue', async () => {
    mocks.resolveReadingChangeRequest.mockRejectedValue(new Error('El odómetro no puede retroceder'))
    const user = pintar()
    await user.click(await screen.findByRole('button', { name: 'Gestionar…' }))
    await user.click(screen.getByRole('button', { name: 'Resolver' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
