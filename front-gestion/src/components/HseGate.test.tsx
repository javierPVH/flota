import { render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { HseOnlyRedirect, RequireHse } from './HseGate.tsx'
import type { FlotaUser } from '../types.ts'

const mockUseAuth = vi.hoisted(() => vi.fn())
vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: mockUseAuth,
}))

const entra = (roles: FlotaUser['roles']) =>
  mockUseAuth.mockReturnValue({ user: { id: 1, username: 'x', roles } as FlotaUser })

/** El mismo árbol que monta `App`: el redirector envuelve el shell y `/hse`
 * lleva su propio portón. Cada página es un texto para leer dónde se acaba. */
function pintar(ruta: string) {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route
          element={
            <HseOnlyRedirect>
              <Outlet />
            </HseOnlyRedirect>
          }
        >
          <Route path="/" element={<p>panel</p>} />
          <Route path="/vehiculos" element={<p>inventario</p>} />
          <Route
            path="/hse"
            element={
              <RequireHse>
                <p>vista hse</p>
              </RequireHse>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('HseGate: quién puede estar dónde', () => {
  it('un HSE puro acaba en /hse venga de donde venga', () => {
    entra(['hse'])
    pintar('/vehiculos')
    expect(screen.getByText('vista hse')).toBeInTheDocument()
    expect(screen.queryByText('inventario')).not.toBeInTheDocument()
  })

  it('un HSE puro tampoco ve el panel', () => {
    entra(['hse'])
    pintar('/')
    expect(screen.getByText('vista hse')).toBeInTheDocument()
  })

  it('un admin sin el rol no entra en /hse: vuelve al panel', () => {
    entra(['admin'])
    pintar('/hse')
    expect(screen.getByText('panel')).toBeInTheDocument()
    expect(screen.queryByText('vista hse')).not.toBeInTheDocument()
  })

  it('un admin sin el rol navega la gestión como siempre', () => {
    entra(['admin'])
    pintar('/vehiculos')
    expect(screen.getByText('inventario')).toBeInTheDocument()
  })

  it('admin+hse tiene las dos puertas abiertas', () => {
    entra(['admin', 'hse'])
    pintar('/hse')
    expect(screen.getByText('vista hse')).toBeInTheDocument()
  })

  it('admin+hse conserva la gestión entera', () => {
    entra(['admin', 'hse'])
    pintar('/vehiculos')
    expect(screen.getByText('inventario')).toBeInTheDocument()
  })
})
