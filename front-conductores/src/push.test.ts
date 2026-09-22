// R5-63: suscripción Web Push del dispositivo (M8).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchPushConfig: vi.fn(),
  savePushSubscription: vi.fn(),
  deletePushSubscription: vi.fn(),
}))

vi.mock('./api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.ts')>()),
  fetchPushConfig: mocks.fetchPushConfig,
  savePushSubscription: mocks.savePushSubscription,
  deletePushSubscription: mocks.deletePushSubscription,
}))

import {
  disablePush,
  enablePush,
  pushState,
  pushSupported,
  PUSH_DENIED,
  PUSH_NOT_CONFIGURED,
} from './push.ts'

// «AQID» en base64url son los bytes 1, 2, 3 (sin relleno: hay que añadirlo).
const PUBLIC_KEY = 'AQID'

function fakeSubscription(endpoint = 'https://push.test/abc') {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'k', auth: 'a' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  }
}

/** Deja el navegador «con push»: SW listo, PushManager y Notification. */
function withPushSupport(subscription: ReturnType<typeof fakeSubscription> | null) {
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(subscription),
    subscribe: vi.fn().mockResolvedValue(fakeSubscription('https://push.test/nueva')),
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  })
  Object.defineProperty(window, 'PushManager', { value: function PushManager() {}, configurable: true })
  Object.defineProperty(window, 'Notification', {
    value: { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') },
    configurable: true,
    writable: true,
  })
  return pushManager
}

describe('push (M8: estado, alta y baja en este dispositivo)', () => {
  beforeEach(() => {
    mocks.fetchPushConfig.mockReset()
    mocks.savePushSubscription.mockReset().mockResolvedValue(undefined)
    mocks.deletePushSubscription.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
    Reflect.deleteProperty(window, 'PushManager')
    Reflect.deleteProperty(window, 'Notification')
  })

  it('sin PushManager en el navegador: unsupported, sin tocar la red', async () => {
    expect(pushSupported()).toBe(false)
    expect(await pushState()).toBe('unsupported')
    expect(mocks.fetchPushConfig).not.toHaveBeenCalled()
  })

  it('el back sin push configurado → disabled; el permiso denegado → blocked', async () => {
    withPushSupport(null)
    mocks.fetchPushConfig.mockResolvedValue({ enabled: false, public_key: '' })
    expect(await pushState()).toBe('disabled')

    mocks.fetchPushConfig.mockResolvedValue({ enabled: true, public_key: PUBLIC_KEY })
    ;(window.Notification as unknown as { permission: string }).permission = 'denied'
    expect(await pushState()).toBe('blocked')
  })

  it('con suscripción → on; sin ella → off', async () => {
    mocks.fetchPushConfig.mockResolvedValue({ enabled: true, public_key: PUBLIC_KEY })
    withPushSupport(fakeSubscription())
    expect(await pushState()).toBe('on')
    withPushSupport(null)
    expect(await pushState()).toBe('off')
  })

  it('BG7: un fallo de red NO es «deshabilitado», es unknown (la UI reintenta)', async () => {
    withPushSupport(null)
    mocks.fetchPushConfig.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await pushState()).toBe('unknown')
  })

  it('enablePush: sin permiso lanza su CÓDIGO (el texto lo pone la pantalla) y no se suscribe', async () => {
    const pushManager = withPushSupport(null)
    mocks.fetchPushConfig.mockResolvedValue({ enabled: true, public_key: PUBLIC_KEY })
    ;(window.Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue('denied')
    await expect(enablePush()).rejects.toThrow(PUSH_DENIED)
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(mocks.savePushSubscription).not.toHaveBeenCalled()
  })

  it('enablePush: sin clave en el servidor lanza antes de pedir permiso', async () => {
    withPushSupport(null)
    mocks.fetchPushConfig.mockResolvedValue({ enabled: true, public_key: '' })
    await expect(enablePush()).rejects.toThrow(PUSH_NOT_CONFIGURED)
    expect(window.Notification.requestPermission).not.toHaveBeenCalled()
  })

  it('enablePush: se suscribe con la clave VAPID decodificada (base64url → bytes) y la registra en el back', async () => {
    const pushManager = withPushSupport(null)
    mocks.fetchPushConfig.mockResolvedValue({ enabled: true, public_key: PUBLIC_KEY })
    await enablePush()
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1)
    const options = pushManager.subscribe.mock.calls[0][0] as {
      userVisibleOnly: boolean
      applicationServerKey: Uint8Array
    }
    expect(options.userVisibleOnly).toBe(true)
    expect(Array.from(options.applicationServerKey)).toEqual([1, 2, 3])
    expect(mocks.savePushSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.test/nueva' }),
    )
  })

  it('enablePush: si ya había suscripción la reutiliza (no se suscribe dos veces)', async () => {
    const pushManager = withPushSupport(fakeSubscription('https://push.test/ya'))
    mocks.fetchPushConfig.mockResolvedValue({ enabled: true, public_key: PUBLIC_KEY })
    await enablePush()
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(mocks.savePushSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.test/ya' }),
    )
  })

  it('disablePush: baja local y en el back por endpoint; sin suscripción no llama a nada', async () => {
    const subscription = fakeSubscription('https://push.test/fuera')
    withPushSupport(subscription)
    await disablePush()
    expect(subscription.unsubscribe).toHaveBeenCalled()
    expect(mocks.deletePushSubscription).toHaveBeenCalledWith('https://push.test/fuera')

    withPushSupport(null)
    mocks.deletePushSubscription.mockClear()
    await disablePush()
    expect(mocks.deletePushSubscription).not.toHaveBeenCalled()
  })
})
