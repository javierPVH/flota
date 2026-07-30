import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import { LoginPage } from './LoginPage.tsx'

const mocks = vi.hoisted(() => ({
  fetchAuthConfig: vi.fn(),
  listDevUsers: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  fetchAuthConfig: mocks.fetchAuthConfig,
  listDevUsers: mocks.listDevUsers,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ setUser: vi.fn() }),
}))

describe('LoginPage (selector de desarrollo)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('con dev_login_enabled muestra el selector de usuarios de prueba', async () => {
    mocks.fetchAuthConfig.mockResolvedValue({
      password_enabled: true,
      registration_enabled: false,
      google_enabled: false,
      google_client_id: '',
      dev_login_enabled: true,
    })
    mocks.listDevUsers.mockResolvedValue([
      { username: 'admin', name: 'Alicia Admin', roles: ['admin'] },
    ])

    render(
      <MemoryRouter>
        <LanguageProvider>
          <LoginPage />
        </LanguageProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Entrar sin contraseña')).toBeInTheDocument()
    expect(screen.getByText(/Alicia Admin/)).toBeInTheDocument()
  })

  it('sin dev_login_enabled no hay selector', async () => {
    mocks.fetchAuthConfig.mockResolvedValue({
      password_enabled: true,
      registration_enabled: false,
      google_enabled: false,
      google_client_id: '',
      dev_login_enabled: false,
    })

    render(
      <MemoryRouter>
        <LanguageProvider>
          <LoginPage />
        </LanguageProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument()
    expect(screen.queryByText('Entrar sin contraseña')).not.toBeInTheDocument()
    expect(mocks.listDevUsers).not.toHaveBeenCalled()
  })
})
