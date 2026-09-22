// FE-1 / FE-2: qué deja la sesión en el dispositivo y qué se lleva al cerrarla.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureCsrf: vi.fn(),
  fetchMe: vi.fn(),
  logout: vi.fn(),
  clearQueue: vi.fn(),
  setQueueOwner: vi.fn(),
}))

vi.mock('./api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.ts')>()),
  ensureCsrf: mocks.ensureCsrf,
  fetchMe: mocks.fetchMe,
  logout: mocks.logout,
}))

vi.mock('./offline/queue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./offline/queue.ts')>()),
  clearQueue: mocks.clearQueue,
  setQueueOwner: mocks.setQueueOwner,
}))

import { bootstrap, onLogout } from './auth.ts'
import type { FlotaUser } from './types.ts'

const LAST_ME_KEY = 'flota:last-me'

const ME: FlotaUser = {
  id: 7,
  username: 'ana',
  email: 'ana@example.com',
  first_name: 'Ana',
  last_name: 'Pérez',
  roles: ['driver'],
  fuel_card: true,
  dni: '00000000T',
  phone: '600000000',
  license_type: 'B',
  is_staff: false,
  is_superuser: false,
}

describe('auth: caché del último /me (FE-1) y cierre de sesión (FE-2)', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.ensureCsrf.mockReset().mockResolvedValue(undefined)
    mocks.fetchMe.mockReset()
    mocks.logout.mockReset().mockResolvedValue(undefined)
    mocks.clearQueue.mockReset().mockResolvedValue(undefined)
    mocks.setQueueOwner.mockReset()
  })

  it('FE-1: en el dispositivo se guarda SOLO lo que decide el acceso, nada personal', async () => {
    mocks.fetchMe.mockResolvedValue(ME)
    expect(await bootstrap()).toEqual(ME)

    const cached = JSON.parse(localStorage.getItem(LAST_ME_KEY) ?? '{}')
    expect(cached).toEqual({
      id: 7,
      username: 'ana',
      roles: ['driver'],
      is_staff: false,
      is_superuser: false,
    })
    for (const campo of ['dni', 'phone', 'email', 'first_name', 'last_name']) {
      expect(cached).not.toHaveProperty(campo)
    }
    // FE-2: la cola sabe de quién es lo que se encole.
    expect(mocks.setQueueOwner).toHaveBeenCalledWith(7)
  })

  it('FE-1: sin red se arranca con lo cacheado y lo personal llega vacío', async () => {
    localStorage.setItem(
      LAST_ME_KEY,
      JSON.stringify({ id: 7, username: 'ana', roles: ['driver'], is_staff: false, is_superuser: false }),
    )
    mocks.fetchMe.mockRejectedValue(new TypeError('Failed to fetch'))

    const me = await bootstrap()
    expect(me).toMatchObject({ id: 7, username: 'ana', roles: ['driver'] })
    expect(me?.dni).toBeNull()
    expect(me?.phone).toBe('')
    expect(me?.email).toBe('')
    expect(mocks.setQueueOwner).toHaveBeenCalledWith(7)
  })

  it('un 401 real (no red) olvida la caché y devuelve anónimo', async () => {
    localStorage.setItem(LAST_ME_KEY, JSON.stringify({ id: 7, username: 'ana', roles: ['driver'] }))
    mocks.fetchMe.mockRejectedValue(new Error('401'))
    expect(await bootstrap()).toBeNull()
    expect(localStorage.getItem(LAST_ME_KEY)).toBeNull()
  })

  it('FE-1/FE-2: el cierre MANUAL olvida el /me, vacía la cola y quita el dueño', () => {
    localStorage.setItem(LAST_ME_KEY, '{"id":7}')
    onLogout('manual')
    expect(localStorage.getItem(LAST_ME_KEY)).toBeNull()
    expect(mocks.clearQueue).toHaveBeenCalledTimes(1)
    expect(mocks.setQueueOwner).toHaveBeenCalledWith(null)
    expect(mocks.logout).toHaveBeenCalledTimes(1)
  })

  it('FE-1: al CADUCAR también se olvida el /me; la cola se conserva (la limpia el dueño en el flush)', () => {
    localStorage.setItem(LAST_ME_KEY, '{"id":7}')
    onLogout('expired')
    expect(localStorage.getItem(LAST_ME_KEY)).toBeNull()
    expect(mocks.clearQueue).not.toHaveBeenCalled()
    expect(mocks.setQueueOwner).toHaveBeenCalledWith(null)
  })
})
