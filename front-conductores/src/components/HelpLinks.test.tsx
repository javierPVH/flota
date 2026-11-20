import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import { markSeen } from '../tutorial/progress.ts'
import { HelpWelcome, LoginHelpLink, ProfileHelpLink } from './HelpLinks.tsx'

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname + JSON.stringify(loc.state ?? null)}</p>
}

function renderIn(node: React.ReactNode) {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="*" element={node} />
        </Routes>
        <Where />
      </MemoryRouter>
    </LanguageProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

describe('accesos a la Ayuda', () => {
  it('el login lleva a «Entrar» y la ayuda sabe volver al login', async () => {
    renderIn(<LoginHelpLink />)
    await userEvent.click(screen.getByRole('link', { name: /Ver la ayuda/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/ayuda/entrar{"from":"/login"}')
  })

  it('el perfil lleva a la portada de la ayuda', () => {
    renderIn(<ProfileHelpLink />)
    expect(screen.getByRole('link', { name: /Ayuda y tutorial/ })).toHaveAttribute('href', '/ayuda')
  })

  it('la bienvenida sale la primera vez y «Ahora no» la guarda para este usuario', async () => {
    const first = renderIn(<HelpWelcome userId={7} />)
    expect(screen.getByRole('region', { name: '¿Primera vez en la app?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ahora no' }))
    expect(screen.queryByRole('region', { name: '¿Primera vez en la app?' })).toBeNull()
    first.unmount()
    renderIn(<HelpWelcome userId={7} />)
    expect(screen.queryByRole('region', { name: '¿Primera vez en la app?' })).toBeNull()
    // Otro usuario en el mismo móvil sí la ve.
    renderIn(<HelpWelcome userId={8} />)
    expect(screen.getByRole('region', { name: '¿Primera vez en la app?' })).toBeInTheDocument()
  })

  it('ver el vídeo desde la bienvenida también la cierra', async () => {
    renderIn(<HelpWelcome userId={7} />)
    await userEvent.click(screen.getByRole('link', { name: /Ver el vídeo/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/ayuda/video')
    expect(localStorage.getItem('flota.campo.ayuda.bienvenida.7')).toBe('1')
  })

  it('no sale a quien ya ha abierto algún capítulo', () => {
    markSeen('km')
    renderIn(<HelpWelcome userId={7} />)
    expect(screen.queryByRole('region', { name: '¿Primera vez en la app?' })).toBeNull()
  })
})
