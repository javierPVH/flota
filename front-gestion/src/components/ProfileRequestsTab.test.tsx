import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProfileRequestsTab } from './ProfileRequestsTab.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { ProfileChangeRequestRow } from '../api.ts'

const mocks = vi.hoisted(() => ({
  listProfileChangeRequests: vi.fn(),
  resolveProfileChangeRequest: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listProfileChangeRequests: mocks.listProfileChangeRequests,
  resolveProfileChangeRequest: mocks.resolveProfileChangeRequest,
}))

const PETICION: ProfileChangeRequestRow = {
  id: 4,
  user: 9,
  user_name: 'Carlos Ruiz',
  user_username: 'carlos',
  requested_by: 9,
  requested_by_name: 'Carlos Ruiz',
  changes: { phone: '600 111 222' },
  changes_display: [
    { field: 'phone', label: 'Teléfono', current: '600 000 000', proposed: '600 111 222' },
  ],
  note: 'El DNI también está mal.',
  status: 'pending',
  status_display: 'Pendiente',
  resolved_by_name: '',
  resolved_at: null,
  resolution_note: '',
  created_at: '2026-09-18T10:00:00Z',
}

function pintar() {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <ProfileRequestsTab />
      </LanguageProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

describe('Bandeja de peticiones de corrección de ficha', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listProfileChangeRequests.mockResolvedValue({
      count: 1,
      results: [PETICION],
      next: null,
    })
    mocks.resolveProfileChangeRequest.mockResolvedValue({ ...PETICION, status: 'done' })
  })

  it('la fila dice de quién es la ficha y el antes y el después de cada campo', async () => {
    pintar()
    expect(await screen.findByText('Carlos Ruiz')).toBeInTheDocument()
    // Con el antes y el después no hace falta abrir nada para decidir.
    expect(screen.getByText('600 000 000')).toBeInTheDocument()
    expect(screen.getByText(/600 111 222/)).toBeInTheDocument()
  })

  it('aplicarla la manda como «done» y avisa de que la ficha cambió', async () => {
    const user = pintar()
    await user.click(await screen.findByRole('button', { name: 'Gestionar…' }))
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    await waitFor(() =>
      expect(mocks.resolveProfileChangeRequest).toHaveBeenCalledWith(4, 'done', ''),
    )
    expect(await screen.findByText('Ficha de Carlos Ruiz actualizada.')).toBeInTheDocument()
  })

  it('rechazarla viaja con su motivo', async () => {
    const user = pintar()
    await user.click(await screen.findByRole('button', { name: 'Gestionar…' }))
    await user.selectOptions(
      screen.getByLabelText('Qué se hace con la petición'),
      'reject',
    )
    await user.type(screen.getByLabelText('Observaciones (opcional)'), 'El móvil es el de empresa.')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    await waitFor(() =>
      expect(mocks.resolveProfileChangeRequest).toHaveBeenCalledWith(
        4,
        'reject',
        'El móvil es el de empresa.',
      ),
    )
  })
})
