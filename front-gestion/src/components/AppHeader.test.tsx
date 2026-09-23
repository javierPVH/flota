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

// Quién está dentro lo decide cada caso: la cabecera cambia con los roles.
const session = vi.hoisted(() => ({
  user: { id: 1, username: 'admin', roles: ['admin'] } as FlotaUser,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({
    user: session.user,
    logout: vi.fn(),
  }),
}))

const conRoles = (roles: FlotaUser['roles']) => {
  session.user = { id: 1, username: 'admin', roles } as FlotaUser
}

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
    conRoles(['admin'])
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

describe('AppHeader: el rol HSE', () => {
  const HSE_LINK = 'Vista HSE de la flota (solo lectura)'

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listAlerts.mockResolvedValue({ count: 0, results: [] })
    mocks.listIncidents.mockResolvedValue({ count: 0, results: [] })
    mocks.listVehicleRequests.mockResolvedValue({ count: 3, results: [] })
    mocks.listDocumentDeletionRequests.mockResolvedValue({ count: 0, results: [] })
  })

  it('admin+hse: el botón «HSE» va a /hse y a la IZQUIERDA del aviso de solicitudes', async () => {
    conRoles(['admin', 'hse'])
    pintar()

    const hse = screen.getByRole('link', { name: HSE_LINK })
    expect(hse).toHaveAttribute('href', '/hse')
    expect(hse).toHaveTextContent('HSE')
    const aviso = await screen.findByRole('link', { name: '3 solicitudes sin decidir' })
    // DOCUMENT_POSITION_FOLLOWING (4): el aviso viene DESPUÉS del botón HSE.
    expect(hse.compareDocumentPosition(aviso) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Y conserva la gestión entera: campana y menú.
    expect(screen.getByRole('button', { name: 'Notificaciones' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Menú' })).toBeInTheDocument()
  })

  it('un admin sin el rol no ve el botón', async () => {
    conRoles(['admin'])
    pintar()

    await screen.findByRole('link', { name: '3 solicitudes sin decidir' })
    expect(screen.queryByRole('link', { name: HSE_LINK })).not.toBeInTheDocument()
  })

  it('HSE puro: marca «HSE», idioma y salir; ni menú, ni campana, ni solicitudes', async () => {
    conRoles(['hse'])
    pintar()

    expect(screen.getByText('Flota · HSE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Menú' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Notificaciones' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    // Tampoco pide lo que el back le negaría (solicitudes, recuentos de la campana).
    await waitFor(() => expect(mocks.listVehicleRequests).not.toHaveBeenCalled())
    expect(mocks.listAlerts).not.toHaveBeenCalled()
  })
})
