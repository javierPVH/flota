import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DownloadsTab } from './DownloadsTab.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  listVehicles: vi.fn(),
  listUsers: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehicles: mocks.listVehicles,
  listUsers: mocks.listUsers,
}))

const page = <T,>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
})

function renderTab() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <DownloadsTab />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('DownloadsTab (documentos consolidados)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listVehicles.mockResolvedValue(
      page([
        {
          id: 1,
          plate: '1234ABC',
          brand: 'Seat',
          model: 'León',
          state: 'active',
          state_display: 'Activo',
          is_substitute: false,
        },
      ]),
    )
    mocks.listUsers.mockResolvedValue(
      page([
        {
          id: 2,
          username: 'carlos',
          name: 'Carlos Ruiz',
          email: 'carlos@example.com',
          phone: '',
          dni: null,
          roles: ['driver'],
          license_type: 'B',
          fuel_card: false,
          date_joined: '2026-01-01T10:00:00Z',
          is_active: true,
        },
      ]),
    )
  })

  it('permite elegir un único dominio y cambia sus filtros', async () => {
    const user = userEvent.setup()
    renderTab()

    expect(screen.getByRole('tab', { name: /Vehículos/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(await screen.findByText('Marca')).toBeInTheDocument()
    expect(screen.queryByText('Rol')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Usuarios/ }))

    expect(screen.getByRole('tab', { name: /Usuarios/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('Rol')).toBeInTheDocument()
    expect(screen.queryByText('Marca')).not.toBeInTheDocument()
  })

  it('explica que vehículos se descarga como un único Excel multihoja', async () => {
    renderTab()

    expect(await screen.findByText('Ficha completa')).toBeInTheDocument()
    expect(screen.getByText('Contratos')).toBeInTheDocument()
    expect(screen.getByText('Asignaciones')).toBeInTheDocument()
    expect(screen.getByText('Incidencias')).toBeInTheDocument()
    expect(screen.getByText('Solicitudes')).toBeInTheDocument()
    expect(screen.getByText('Imputaciones')).toBeInTheDocument()
  })
})
