import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { createAuth } from './createAuth.tsx'

afterEach(() => {
  localStorage.clear()
})

type User = { name: string }

function Consumer({ useAuth }: { useAuth: ReturnType<typeof createAuth<User>>['useAuth'] }) {
  const { status, user, logout } = useAuth()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.name ?? '-'}</span>
      <button onClick={logout}>logout</button>
    </div>
  )
}

describe('createAuth', () => {
  it('bootstrap con usuario → autenticado', async () => {
    const { AuthProvider, useAuth } = createAuth<User>()
    render(
      <AuthProvider bootstrap={async () => ({ name: 'Ada' })}>
        <Consumer useAuth={useAuth} />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    expect(screen.getByTestId('user').textContent).toBe('Ada')
  })

  it('bootstrap sin usuario → anónimo', async () => {
    const { AuthProvider, useAuth } = createAuth<User>()
    render(
      <AuthProvider bootstrap={async () => null}>
        <Consumer useAuth={useAuth} />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
  })

  it('bootstrap que lanza → anónimo', async () => {
    const { AuthProvider, useAuth } = createAuth<User>()
    render(
      <AuthProvider bootstrap={async () => { throw new Error('boom') }}>
        <Consumer useAuth={useAuth} />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
  })

  it('logout llama a onLogout y pasa a anónimo', async () => {
    const onLogout = vi.fn()
    const { AuthProvider, useAuth } = createAuth<User>()
    render(
      <AuthProvider bootstrap={async () => ({ name: 'Ada' })} onLogout={onLogout}>
        <Consumer useAuth={useAuth} />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'))
    fireEvent.click(screen.getByText('logout'))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anonymous'))
    expect(onLogout).toHaveBeenCalledOnce()
  })

  it('RequireAuth deja pasar autenticado y redirige anónimo', async () => {
    const { AuthProvider, RequireAuth } = createAuth<User>()

    function App({ authed }: { authed: boolean }) {
      return (
        <AuthProvider bootstrap={async () => (authed ? { name: 'Ada' } : null)}>
          <MemoryRouter initialEntries={['/priv']}>
            <Routes>
              <Route path="/login" element={<div>LOGIN</div>} />
              <Route
                path="/priv"
                element={
                  <RequireAuth>
                    <div>PRIVADO</div>
                  </RequireAuth>
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      )
    }

    const { rerender } = render(<App authed />)
    await waitFor(() => expect(screen.getByText('PRIVADO')).toBeInTheDocument())

    localStorage.clear()
    rerender(<App authed={false} />)
    await waitFor(() => expect(screen.getByText('LOGIN')).toBeInTheDocument())
  })
})
