// El portón de la app de campo por ROLES: quién entra, quién ve el 403 con
// «Salir» y quién va a «Solicita tu vehículo». El caso que lo motivó es HSE:
// el back le deja LEER toda la flota, así que su GET /vehicles/ viene lleno y
// no sirve para decidir — hay que mirar los roles ANTES de preguntar.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Role } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listVehiclesCached: vi.fn(),
  logout: vi.fn(),
  // El `user` tiene que ser ESTABLE entre renders (el portón lo lleva en las
  // deps de su comprobación): un objeto nuevo por render la repetiría.
  auth: { user: { id: 1, username: 'hse', roles: [] as Role[] }, logout: vi.fn() },
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listVehiclesCached: mocks.listVehiclesCached,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => mocks.auth,
}))

import { AccessGate } from './AccessGate.tsx'
import { LanguageProvider } from '../i18n.tsx'

/** Un 403 del back (no es fallo de red): el usuario sin rol de campo. */
function forbidden(): Error & { status: number } {
  return Object.assign(new Error('403'), { status: 403 })
}

function renderGate() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <AccessGate>
                <p>dentro de la app</p>
              </AccessGate>
            }
          />
          <Route path="/solicitar" element={<p>pantalla solicitar</p>} />
          <Route path="/sin-flota" element={<p>pantalla sin flota</p>} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  )
}

/** Fija quién está dentro, con un objeto nuevo POR TEST y estable durante él. */
function entra(...roles: Role[]) {
  mocks.auth = { user: { id: 1, username: 'hse', roles }, logout: mocks.logout }
}

describe('AccessGate: el portón por roles (hse incluido)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.lang = 'es'
    entra()
    mocks.listVehiclesCached.mockResolvedValue({ count: 3, results: [] })
  })

  it.each([[['hse']], [['admin']], [['admin', 'hse']]] as Role[][][])(
    'con %j (sin rol de campo) → «Sin acceso» con cerrar sesión, y sin pedir la flota',
    async (roles) => {
      entra(...roles)
      renderGate()

      expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument()
      expect(screen.getByText(/es de gestión o HSE/)).toBeInTheDocument()
      expect(screen.queryByText('dentro de la app')).not.toBeInTheDocument()
      // Se decide por los roles: no hay ni un GET /vehicles/ que, para HSE,
      // vendría lleno y abriría la puerta.
      expect(mocks.listVehiclesCached).not.toHaveBeenCalled()

      // No es un login en bucle ni una pantalla vacía: hay salida.
      await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
      expect(mocks.logout).toHaveBeenCalledTimes(1)
    },
  )

  it.each([[['driver', 'hse']], [['supervisor', 'hse']]] as Role[][][])(
    'con %j entra: actúa como conductor/supervisor aunque además lea la flota',
    async (roles) => {
      entra(...roles)
      renderGate()
      expect(await screen.findByText('dentro de la app')).toBeInTheDocument()
      expect(mocks.listVehiclesCached).toHaveBeenCalledTimes(1)
    },
  )

  it('sin NINGÚN rol (recién creado por Google): el 403 del back → solicitar vehículo', async () => {
    entra()
    mocks.listVehiclesCached.mockRejectedValue(forbidden())
    renderGate()
    expect(await screen.findByText('pantalla solicitar')).toBeInTheDocument()
    await waitFor(() => expect(mocks.listVehiclesCached).toHaveBeenCalledTimes(1))
  })

  it('el conductor sin coche va a solicitar; el supervisor sin grupo, a «sin flota»', async () => {
    entra('driver')
    mocks.listVehiclesCached.mockResolvedValue({ count: 0, results: [] })
    const { unmount } = renderGate()
    expect(await screen.findByText('pantalla solicitar')).toBeInTheDocument()
    unmount()

    entra('supervisor')
    renderGate()
    expect(await screen.findByText('pantalla sin flota')).toBeInTheDocument()
  })
})
