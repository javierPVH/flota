import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SsoLoginPage } from './SsoLoginPage.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { AuthConfig } from '../types.ts'

const mocks = vi.hoisted(() => ({
  startSamlLogin: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  startSamlLogin: mocks.startSamlLogin,
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

const CONFIG: AuthConfig = {
  password_enabled: false,
  registration_enabled: false,
  google_enabled: false,
  google_client_id: '',
  dev_login_enabled: false,
  jira_request_url: 'https://jira.example.com/solicitar-coche',
  saml_enabled: true,
  saml_login_url: '/api/v1/auth/saml/login/',
}

function abrir(ruta = '/login', config: AuthConfig = CONFIG) {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <LanguageProvider>
        <SsoLoginPage config={config} />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('SsoLoginPage (entrada por SSO corporativo)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('el botón navega al inicio del SSO del back', async () => {
    abrir()
    await userEvent.click(screen.getByRole('button', { name: /cuenta corporativa/i }))
    expect(mocks.startSamlLogin).toHaveBeenCalledWith('/api/v1/auth/saml/login/', '/')
  })

  it('sin SSO anunciado no hay botón, hay aviso', () => {
    abrir('/login', { ...CONFIG, saml_enabled: false, saml_login_url: '' })
    expect(screen.queryByRole('button', { name: /cuenta corporativa/i })).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/no está disponible/i)
  })

  it('con ?saml=no_user abre el modal que manda a Jira y no da acceso', async () => {
    abrir('/login?saml=no_user')
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/no está dado de alta/i)
    const enlace = screen.getByRole('link', { name: /jira/i })
    expect(enlace).toHaveAttribute('href', CONFIG.jira_request_url)
    expect(enlace).toHaveAttribute('target', '_blank')

    await userEvent.click(screen.getByRole('button', { name: /entendido/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.navigate).toHaveBeenCalledWith('/login', { replace: true })
  })

  it('sin URL de Jira el modal lo dice en vez de pintar un enlace roto', async () => {
    abrir('/login?saml=no_user', { ...CONFIG, jira_request_url: '' })
    await screen.findByRole('dialog')
    expect(screen.queryByRole('link', { name: /jira/i })).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/no está configurada/i)
  })

  it('un usuario de baja recibe su propio aviso, sin enlace a Jira', async () => {
    abrir('/login?saml=inactive')
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/dado de baja/i)
    expect(screen.queryByRole('link', { name: /jira/i })).toBeNull()
  })
})
