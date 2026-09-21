import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppHeader } from './AppHeader.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { FlotaUser } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listAlerts: vi.fn(),
  listIncidents: vi.fn(),
  listVehicleRequests: vi.fn(),
  listDocumentDeletionRequests: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listAlerts: mocks.listAlerts,
  listIncidents: mocks.listIncidents,
  listVehicleRequests: mocks.listVehicleRequests,
  listDocumentDeletionRequests: mocks.listDocumentDeletionRequests,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({
    user: { id: 1, username: 'admin', roles: ['admin'] } as FlotaUser,
    logout: vi.fn(),
  }),
}))

function pintar() {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <AppHeader />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('AppHeader: las solicitudes sin decidir', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listAlerts.mockResolvedValue({ count: 0, results: [] })
    mocks.listIncidents.mockResolvedValue({ count: 0, results: [] })
    mocks.listVehicleRequests.mockResolvedValue({ count: 3, results: [] })
    mocks.listDocumentDeletionRequests.mockResolvedValue({ count: 2, results: [] })
  })

  it('suma las dos bandejas y lleva a la de coches, ya filtrada', async () => {
    pintar()

    // Solo cuenta lo que espera decisión, en las dos bandejas: conceder el
    // coche o borrar el documento es lo que el aviso pide hacer.
    await waitFor(() =>
      expect(mocks.listVehicleRequests).toHaveBeenCalledWith({ status: 'pending' }),
    )
    expect(mocks.listDocumentDeletionRequests).toHaveBeenCalledWith({ status: 'pending' })
    const aviso = await screen.findByRole('link', { name: '5 solicitudes sin decidir' })
    expect(aviso).toHaveTextContent('5')
    expect(aviso).toHaveAttribute('href', '/solicitudes?status=pending')
  })

  it('si lo único pendiente son documentos, abre esa pestaña', async () => {
    mocks.listVehicleRequests.mockResolvedValue({ count: 0, results: [] })
    pintar()

    const aviso = await screen.findByRole('link', { name: '2 solicitudes sin decidir' })
    expect(aviso).toHaveAttribute('href', '/solicitudes?tab=documentos')
  })

  it('sin ninguna pendiente no ocupa sitio en la cabecera', async () => {
    mocks.listVehicleRequests.mockResolvedValue({ count: 0, results: [] })
    mocks.listDocumentDeletionRequests.mockResolvedValue({ count: 0, results: [] })
    pintar()

    await waitFor(() => expect(mocks.listVehicleRequests).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: /solicitudes sin decidir/ })).not.toBeInTheDocument()
  })
})
