import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AdminGate } from './AdminGate.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { FlotaUser } from '../types.ts'

const makeUser = (roles: FlotaUser['roles']): FlotaUser =>
  ({ id: 1, username: 'sara', roles }) as FlotaUser

const mockUseAuth = vi.hoisted(() => vi.fn())
vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: mockUseAuth,
}))

describe('AdminGate (403 de gestión)', () => {
  it('un no-admin ve la pantalla Sin acceso con logout, no la app', () => {
    mockUseAuth.mockReturnValue({ user: makeUser(['supervisor', 'driver']), logout: vi.fn() })
    render(
      <LanguageProvider>
        <AdminGate>
          <p>contenido privado</p>
        </AdminGate>
      </LanguageProvider>,
    )
    expect(screen.getByText('Sin acceso')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument()
    expect(screen.queryByText('contenido privado')).not.toBeInTheDocument()
  })

  it('un admin ve la app', () => {
    mockUseAuth.mockReturnValue({ user: makeUser(['admin']), logout: vi.fn() })
    render(
      <LanguageProvider>
        <AdminGate>
          <p>contenido privado</p>
        </AdminGate>
      </LanguageProvider>,
    )
    expect(screen.getByText('contenido privado')).toBeInTheDocument()
  })
})
