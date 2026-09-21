import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GoogleLoginPage } from './GoogleLoginPage.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  fetchAuthConfig: vi.fn(),
  googleLogin: vi.fn(),
  navigate: vi.fn(),
  setUser: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  fetchAuthConfig: mocks.fetchAuthConfig,
  googleLogin: mocks.googleLogin,
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ setUser: mocks.setUser }),
}))

const CONFIG = {
  password_enabled: false,
  registration_enabled: false,
  google_enabled: true,
  google_client_id: 'cliente-123.apps.googleusercontent.com',
  dev_login_enabled: false,
  jira_request_url: '',
  saml_enabled: false,
  saml_login_url: '',
}

/** Doble de la librería de Google: guarda el callback para poder dispararlo. */
function fingirGoogle() {
  const estado: { callback?: (r: { credential?: string }) => void; pintado: number } = {
    pintado: 0,
  }
  window.google = {
    accounts: {
      id: {
        initialize: ({ callback }) => {
          estado.callback = callback
        },
        renderButton: () => {
          estado.pintado += 1
        },
      },
    },
  }
  return estado
}

function abrir() {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <GoogleLoginPage />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('GoogleLoginPage (entrada solo con Google)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchAuthConfig.mockResolvedValue(CONFIG)
    mocks.googleLogin.mockResolvedValue({ id: 1, username: 'sara', roles: ['driver'] })
  })

  afterEach(() => {
    delete window.google
  })

  it('pinta el botón de Google y entra con el token que devuelve', async () => {
    const google = fingirGoogle()
    abrir()
    await waitFor(() => expect(google.pintado).toBe(1))

    google.callback?.({ credential: 'id-token-de-google' })

    await waitFor(() => expect(mocks.googleLogin).toHaveBeenCalledWith('id-token-de-google'))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true }))
  })

  it('sin Google configurado lo dice en vez de dejar un hueco', async () => {
    fingirGoogle()
    mocks.fetchAuthConfig.mockResolvedValue({ ...CONFIG, google_enabled: false })
    abrir()
    expect(await screen.findByRole('alert')).toHaveTextContent(/no está configurado/i)
  })
})
