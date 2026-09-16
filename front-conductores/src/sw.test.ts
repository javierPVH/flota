// @vitest-environment node
//
// R5-63: el service worker (`public/sw.js`) no es un módulo —habla con `self`,
// `caches` y `clients`— así que se evalúa aquí dentro de un `self` falso que
// recoge sus manejadores y se disparan eventos a mano. Lo que se prueba son
// las DECISIONES (qué se cachea, qué no, a quién se avisa), no la API del SW.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOURCE = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8')
const ORIGIN = 'https://campo.test'

type Handler = (event: Record<string, unknown>) => unknown

class FakeResponse {
  constructor(
    public body: string,
    public init: { status?: number; type?: string } = {},
  ) {}
  get status() {
    return this.init.status ?? 200
  }
  get ok() {
    return this.status >= 200 && this.status < 300
  }
  get type() {
    return this.init.type ?? 'basic'
  }
  clone() {
    return new FakeResponse(this.body, this.init)
  }
}

function fakeCache(entries: Record<string, FakeResponse> = {}) {
  return {
    entries,
    add: vi.fn(async (url: string) => {
      entries[url] = new FakeResponse(url)
    }),
    put: vi.fn(async (request: { url: string } | string, response: FakeResponse) => {
      entries[typeof request === 'string' ? request : request.url] = response
    }),
    match: vi.fn(async (request: { url: string } | string) => {
      const key = typeof request === 'string' ? request : request.url
      return entries[key] ?? entries[new URL(key, ORIGIN).pathname]
    }),
  }
}

/** Evalúa el SW con un entorno falso y devuelve lo que hace falta para dispararlo. */
function bootServiceWorker(options: { cookie?: string | null; withCookieStore?: boolean } = {}) {
  const handlers = new Map<string, Handler>()
  const cache = fakeCache()
  const cacheNames = ['flota-campo-viejo', 'flota-campo-__BUILD_ID__']
  const caches = {
    open: vi.fn(async () => cache),
    match: vi.fn((request: unknown) => cache.match(request as string)),
    keys: vi.fn(async () => cacheNames),
    delete: vi.fn(async () => true),
  }
  const client = { postMessage: vi.fn(), url: `${ORIGIN}/alertas`, navigate: vi.fn(), focus: vi.fn() }
  const clients = {
    matchAll: vi.fn(async () => [client]),
    claim: vi.fn(async () => undefined),
    openWindow: vi.fn(async () => undefined),
  }
  const registration = {
    showNotification: vi.fn(async () => undefined),
    pushManager: {
      subscribe: vi.fn(async () => ({ toJSON: () => ({ endpoint: 'https://push.test/nueva' }) })),
    },
  }
  const fetch = vi.fn()
  const self: Record<string, unknown> = {
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    location: { origin: ORIGIN },
    registration,
    clients,
    skipWaiting: vi.fn(),
  }
  if (options.withCookieStore !== false) {
    self.cookieStore = {
      get: vi.fn(async () => (options.cookie ? { value: options.cookie } : null)),
    }
  }
  new Function('self', 'caches', 'clients', 'fetch', 'Response', SOURCE)(
    self,
    caches,
    clients,
    fetch,
    FakeResponse,
  )

  /** Dispara un evento y devuelve lo que el SW le pasó a `waitUntil`/`respondWith`. */
  async function fire(type: string, event: Record<string, unknown> = {}) {
    let waited: unknown
    let responded: unknown
    const handler = handlers.get(type)
    if (!handler) throw new Error(`sin manejador para ${type}`)
    handler({
      ...event,
      waitUntil: (p: unknown) => {
        waited = p
      },
      respondWith: (p: unknown) => {
        responded = p
      },
    })
    return { waited: await waited, responded: await responded, respondió: responded !== undefined }
  }

  return { fire, cache, caches, cacheNames, clients, client, registration, fetch, self }
}

const asset = (path: string, mode = 'no-cors') => ({
  method: 'GET',
  url: `${ORIGIN}${path}`,
  mode,
})

describe('sw.js (caché por build, navegación offline, push)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('install: el shell «/» es obligatorio y el resto best-effort (R5-62)', async () => {
    const sw = bootServiceWorker()
    sw.cache.add.mockImplementation(async (url: string) => {
      if (url === '/manifest.webmanifest') throw new Error('404')
      sw.cache.entries[url] = new FakeResponse(url)
    })
    await expect(sw.fire('install')).resolves.toBeDefined()
    expect(sw.cache.add).toHaveBeenCalledWith('/')
    expect(sw.cache.add).toHaveBeenCalledWith('/icons/icon-192.png')

    sw.cache.add.mockImplementation(async (url: string) => {
      if (url === '/') throw new Error('sin shell')
    })
    await expect(sw.fire('install')).rejects.toThrow('sin shell')
  })

  it('activate: purga las generaciones anteriores y reclama los clientes', async () => {
    const sw = bootServiceWorker()
    await sw.fire('activate')
    expect(sw.caches.delete).toHaveBeenCalledWith('flota-campo-viejo')
    expect(sw.caches.delete).not.toHaveBeenCalledWith('flota-campo-__BUILD_ID__')
    expect(sw.clients.claim).toHaveBeenCalled()
  })

  it('message SKIP_WAITING activa el SW en espera (y otros mensajes no)', async () => {
    const sw = bootServiceWorker()
    await sw.fire('message', { data: { type: 'OTRO' } })
    expect(sw.self.skipWaiting).not.toHaveBeenCalled()
    await sw.fire('message', { data: { type: 'SKIP_WAITING' } })
    expect(sw.self.skipWaiting).toHaveBeenCalled()
  })

  it('fetch: no toca lo que no es GET, lo de otro origen ni /api y /media', async () => {
    const sw = bootServiceWorker()
    expect((await sw.fire('fetch', { request: { ...asset('/assets/a.js'), method: 'POST' } })).respondió).toBe(false)
    expect((await sw.fire('fetch', { request: { method: 'GET', url: 'https://otro.test/x.js' } })).respondió).toBe(false)
    expect((await sw.fire('fetch', { request: asset('/api/v1/vehicles/') })).respondió).toBe(false)
    expect((await sw.fire('fetch', { request: asset('/media/foto.jpg') })).respondió).toBe(false)
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it('assets: cache-first, y solo se guarda lo que llegó bien (R5-52)', async () => {
    const sw = bootServiceWorker()
    const bueno = new FakeResponse('js')
    sw.fetch.mockResolvedValueOnce(bueno)
    const primera = await sw.fire('fetch', { request: asset('/assets/app.js') })
    expect(primera.responded).toBe(bueno)
    await Promise.resolve() // `caches.open().then(put)` va en segundo plano
    expect(sw.cache.put).toHaveBeenCalledTimes(1)

    // La segunda vez sale de la caché sin red.
    const segunda = await sw.fire('fetch', { request: asset('/assets/app.js') })
    expect(segunda.responded).toBeInstanceOf(FakeResponse)
    expect(sw.fetch).toHaveBeenCalledTimes(1)

    // Un 404 en carrera con un despliegue se entrega pero NO se clava en caché.
    sw.fetch.mockResolvedValueOnce(new FakeResponse('no', { status: 404 }))
    await sw.fire('fetch', { request: asset('/assets/perdido.js') })
    await Promise.resolve()
    expect(sw.cache.put).toHaveBeenCalledTimes(1)
    // Ni una respuesta opaca (type distinto de basic).
    sw.fetch.mockResolvedValueOnce(new FakeResponse('opaca', { type: 'opaque' }))
    await sw.fire('fetch', { request: asset('/icons/x.png') })
    await Promise.resolve()
    expect(sw.cache.put).toHaveBeenCalledTimes(1)
  })

  it('navegación: red primero; un 502 no se guarda como shell; sin red, el shell o un 503', async () => {
    const sw = bootServiceWorker()
    const shell = new FakeResponse('<html>')
    sw.fetch.mockResolvedValueOnce(shell)
    const ok = await sw.fire('fetch', { request: asset('/alertas', 'navigate') })
    expect(ok.responded).toBe(shell)
    await Promise.resolve()
    expect(sw.cache.put).toHaveBeenCalledWith('/', expect.any(FakeResponse))

    sw.fetch.mockResolvedValueOnce(new FakeResponse('Bad Gateway', { status: 502 }))
    await sw.fire('fetch', { request: asset('/vehiculos', 'navigate') })
    await Promise.resolve()
    expect(sw.cache.put).toHaveBeenCalledTimes(1)

    // Sin red: el shell cacheado.
    sw.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const offline = await sw.fire('fetch', { request: asset('/km', 'navigate') })
    expect((offline.responded as FakeResponse).body).toBe('<html>')

    // Sin red y sin shell: un 503 legible, nunca `respondWith(undefined)` (BG5).
    delete sw.cache.entries['/']
    sw.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const sinShell = await sw.fire('fetch', { request: asset('/km', 'navigate') })
    expect((sinShell.responded as FakeResponse).status).toBe(503)
  })

  it('push: enseña la notificación con la URL del payload (o /alertas si no trae)', async () => {
    const sw = bootServiceWorker()
    await sw.fire('push', {
      data: { json: () => ({ title: '1234KLM · ITV', body: 'Vence el lunes', url: '/vehiculos/21' }) },
    })
    expect(sw.registration.showNotification).toHaveBeenCalledWith(
      '1234KLM · ITV',
      expect.objectContaining({ body: 'Vence el lunes', data: { url: '/vehiculos/21' } }),
    )
    await sw.fire('push', {
      data: {
        json: () => {
          throw new Error('no es JSON')
        },
        text: () => 'texto plano',
      },
    })
    expect(sw.registration.showNotification).toHaveBeenLastCalledWith(
      'Flota',
      expect.objectContaining({ body: 'texto plano', data: { url: '/alertas' } }),
    )
  })

  it('notificationclick: navega en una pestaña nuestra y, si no puede, abre otra (R5-62)', async () => {
    const sw = bootServiceWorker()
    const notification = { close: vi.fn(), data: { url: '/alertas' } }
    sw.client.navigate.mockResolvedValue(undefined)
    await sw.fire('notificationclick', { notification })
    expect(notification.close).toHaveBeenCalled()
    expect(sw.client.navigate).toHaveBeenCalledWith('/alertas')
    expect(sw.client.focus).toHaveBeenCalled()
    expect(sw.clients.openWindow).not.toHaveBeenCalled()

    sw.client.navigate.mockRejectedValue(new Error('no controlada'))
    await sw.fire('notificationclick', { notification })
    expect(sw.clients.openWindow).toHaveBeenCalledWith('/alertas')
  })

  it('pushsubscriptionchange: re-suscribe con la clave vieja y registra con CSRF (R5-51)', async () => {
    const sw = bootServiceWorker({ cookie: 'tok3n' })
    sw.fetch.mockResolvedValue(new FakeResponse('', { status: 201 }))
    await sw.fire('pushsubscriptionchange', {
      oldSubscription: { options: { applicationServerKey: 'clave' } },
    })
    expect(sw.registration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: 'clave',
    })
    expect(sw.fetch).toHaveBeenCalledWith(
      '/api/v1/push/subscriptions/',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({ 'X-CSRFToken': 'tok3n' }),
      }),
    )
    expect(sw.client.postMessage).not.toHaveBeenCalled()
  })

  it('pushsubscriptionchange: sin clave, sin cookie o con el back en 403, lo delega en la pestaña', async () => {
    // Firefox: sin `oldSubscription`.
    let sw = bootServiceWorker({ cookie: 'tok3n' })
    await sw.fire('pushsubscriptionchange', {})
    expect(sw.registration.pushManager.subscribe).not.toHaveBeenCalled()
    expect(sw.client.postMessage).toHaveBeenCalledWith({ type: 'PUSH_RESUBSCRIBE' })

    // Sin `cookieStore` (no hay forma de leer el CSRF desde el worker).
    sw = bootServiceWorker({ withCookieStore: false })
    await sw.fire('pushsubscriptionchange', {
      oldSubscription: { options: { applicationServerKey: 'clave' } },
    })
    expect(sw.fetch).not.toHaveBeenCalled()
    expect(sw.client.postMessage).toHaveBeenCalledWith({ type: 'PUSH_RESUBSCRIBE' })

    // El back rechaza el registro: que lo reintente la pestaña por su transporte.
    sw = bootServiceWorker({ cookie: 'tok3n' })
    sw.fetch.mockResolvedValue(new FakeResponse('', { status: 403 }))
    await sw.fire('pushsubscriptionchange', {
      oldSubscription: { options: { applicationServerKey: 'clave' } },
    })
    expect(sw.client.postMessage).toHaveBeenCalledWith({ type: 'PUSH_RESUBSCRIBE' })
  })
})
