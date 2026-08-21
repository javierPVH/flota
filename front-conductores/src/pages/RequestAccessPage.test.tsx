import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RequestAccessPage } from './RequestAccessPage.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  fetchAuthConfig: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  fetchAuthConfig: mocks.fetchAuthConfig,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({
    user: { id: 1, username: 'nuevo', first_name: 'Nuevo', roles: [] },
    logout: mocks.logout,
  }),
}))

const CONFIG = {
  password_enabled: true,
  registration_enabled: false,
  google_enabled: false,
  google_client_id: '',
  dev_login_enabled: true,
  jira_request_url: 'https://jira.example/crear-solicitud',
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <RequestAccessPage />
      </LanguageProvider>
    </MemoryRouter>,
  )
}

describe('RequestAccessPage', () => {
  beforeEach(() => {
    mocks.fetchAuthConfig.mockReset()
  })

  it('enlaza a Jira en una pestaña nueva con la URL que publica el back', async () => {
    mocks.fetchAuthConfig.mockResolvedValue(CONFIG)
    renderPage()

    const link = await screen.findByRole('link', { name: /jira/i })
    expect(link).toHaveAttribute('href', CONFIG.jira_request_url)
    expect(link).toHaveAttribute('target', '_blank')
    // Sale de la aplicación: la página de destino no debe poder tocar esta.
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('no pinta formulario: Jira no se gestiona desde la aplicación', async () => {
    mocks.fetchAuthConfig.mockResolvedValue(CONFIG)
    renderPage()

    await screen.findByRole('link', { name: /jira/i })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    // Y explica que la activación la hace la administración a mano.
    expect(screen.getByText(/administración activará tu acceso/i)).toBeInTheDocument()
  })

  it('sin URL configurada avisa en vez de dejar un enlace roto', async () => {
    mocks.fetchAuthConfig.mockResolvedValue({ ...CONFIG, jira_request_url: '' })
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/no está configurada/i)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('si el config no carga, cae al aviso y no rompe el portón', async () => {
    mocks.fetchAuthConfig.mockRejectedValue(new Error('boom'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/no está configurada/i)
    // El botón de reintentar la entrada sigue disponible.
    expect(screen.getByRole('button', { name: /volver a comprobar/i })).toBeInTheDocument()
  })
})
