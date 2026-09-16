// R5-63: detección de versión nueva del service worker (BG5).
//
// El módulo guarda estado (`waitingWorker`) a nivel de módulo, así que cada
// caso lo importa de cero con `vi.resetModules()`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (event?: unknown) => void

/** Un emisor mínimo con la forma de `addEventListener`. */
function emitter() {
  const listeners = new Map<string, Listener[]>()
  return {
    addEventListener: vi.fn((type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn])
    }),
    emit(type: string, event?: unknown) {
      for (const fn of listeners.get(type) ?? []) fn(event)
    },
  }
}

function fakeWorker(state: string) {
  return { ...emitter(), state, postMessage: vi.fn() }
}

type Worker = ReturnType<typeof fakeWorker>

function fakeRegistration(overrides: { waiting?: Worker | null; installing?: Worker | null } = {}) {
  return {
    ...emitter(),
    waiting: null as Worker | null,
    installing: null as Worker | null,
    ...overrides,
  }
}

async function loadModule() {
  vi.resetModules()
  return import('./sw-update.ts')
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('sw-update (BG5: versión nueva en espera)', () => {
  let container: ReturnType<typeof emitter> & { register: ReturnType<typeof vi.fn>; controller: unknown }

  beforeEach(() => {
    container = { ...emitter(), register: vi.fn(), controller: null }
    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true })
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })

  it('sin service worker en el navegador no registra nada ni rompe', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
    const { registerServiceWorker } = await loadModule()
    expect(() => registerServiceWorker()).not.toThrow()
    window.dispatchEvent(new Event('load'))
    await flush()
    expect(container.register).not.toHaveBeenCalled()
  })

  it('registra /sw.js al cargar y avisa cuando el SW nuevo queda instalado con otro controlando', async () => {
    const registration = fakeRegistration()
    container.register.mockResolvedValue(registration)
    container.controller = {} // ya hay un SW controlando: lo que llegue es una actualización
    const { registerServiceWorker, onUpdateAvailable } = await loadModule()
    const listener = vi.fn()
    onUpdateAvailable(listener)
    expect(listener).toHaveBeenLastCalledWith(false) // estado inicial, al suscribirse

    registerServiceWorker()
    window.dispatchEvent(new Event('load'))
    await flush()
    expect(container.register).toHaveBeenCalledWith('/sw.js')

    const incoming = fakeWorker('installing')
    registration.installing = incoming
    registration.emit('updatefound')
    incoming.emit('statechange') // sigue 'installing': nada
    expect(listener).toHaveBeenCalledTimes(1)
    incoming.state = 'installed'
    incoming.emit('statechange')
    expect(listener).toHaveBeenLastCalledWith(true)
  })

  it('la PRIMERA instalación (sin controller) no es una actualización', async () => {
    const registration = fakeRegistration()
    container.register.mockResolvedValue(registration)
    container.controller = null
    const { registerServiceWorker, onUpdateAvailable } = await loadModule()
    const listener = vi.fn()
    onUpdateAvailable(listener)
    registerServiceWorker()
    window.dispatchEvent(new Event('load'))
    await flush()
    const incoming = fakeWorker('installed')
    registration.installing = incoming
    registration.emit('updatefound')
    incoming.emit('statechange')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith(false)
  })

  it('si ya había uno esperando al registrar (deploy con la pestaña abierta), avisa al momento', async () => {
    const waiting = fakeWorker('installed')
    container.register.mockResolvedValue(fakeRegistration({ waiting }))
    container.controller = {}
    const { registerServiceWorker, onUpdateAvailable } = await loadModule()
    const listener = vi.fn()
    registerServiceWorker()
    window.dispatchEvent(new Event('load'))
    await flush()
    onUpdateAvailable(listener)
    expect(listener).toHaveBeenLastCalledWith(true)
  })

  it('applyUpdate manda SKIP_WAITING al que espera y recarga al cambiar de controlador', async () => {
    const waiting = fakeWorker('installed')
    container.register.mockResolvedValue(fakeRegistration({ waiting }))
    container.controller = {}
    const { registerServiceWorker, applyUpdate } = await loadModule()
    applyUpdate() // sin nada en espera no hace nada
    expect(container.addEventListener).not.toHaveBeenCalled()

    registerServiceWorker()
    window.dispatchEvent(new Event('load'))
    await flush()
    applyUpdate()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    // La recarga se engancha a `controllerchange` (una vez): así nunca queda la
    // pestaña vieja pidiendo chunks ya purgados.
    expect(container.addEventListener).toHaveBeenCalledWith(
      'controllerchange',
      expect.any(Function),
      { once: true },
    )
  })

  it('el des-suscriptor deja de avisar', async () => {
    const { onUpdateAvailable } = await loadModule()
    const listener = vi.fn()
    const off = onUpdateAvailable(listener)
    off()
    // Sin forma de forzar `notify` desde fuera, basta comprobar que no se
    // llama más que la vez inicial aunque llegue un registro después.
    container.register.mockResolvedValue(fakeRegistration({ waiting: fakeWorker('installed') }))
    container.controller = {}
    const { registerServiceWorker } = await import('./sw-update.ts')
    registerServiceWorker()
    window.dispatchEvent(new Event('load'))
    await flush()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
