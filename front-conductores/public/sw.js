/* Service worker de la app de campo (M7, endurecido en BG5).
 *
 * Estrategia mínima y segura:
 * - Assets fingerprinted de Vite (/assets/*): cache-first — su nombre cambia
 *   con cada build, así que la caché nunca sirve código viejo.
 * - Navegaciones: network-first con fallback al shell cacheado (la SPA arranca
 *   sin red y la cola offline hace el resto).
 * - /api y /media: SIEMPRE red, sin caché — datos de negocio (y sesión) no se
 *   sirven rancios; las escrituras sin red las gestiona la cola de la app.
 *
 * BG5 — actualizaciones sin ChunkLoadError:
 * - La caché se versiona POR BUILD (__BUILD_ID__ lo estampa vite.config.ts):
 *   los assets del build anterior no se purgan hasta que el SW nuevo activa.
 * - SIN skipWaiting incondicional: el SW nuevo espera. La app detecta la
 *   versión nueva y ofrece "recargar"; al aceptar, envía SKIP_WAITING y
 *   recarga en `controllerchange` — nunca hay una pestaña vieja pidiendo
 *   chunks ya borrados.
 * - `pushsubscriptionchange`: si el navegador rota la suscripción, se
 *   re-suscribe y re-registra en el back (antes los avisos morían en silencio).
 */
const CACHE = 'flota-campo-__BUILD_ID__'
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png']

self.addEventListener('install', (event) => {
  // Sin skipWaiting: queda "waiting" hasta que la app lo acepte (o se cierren
  // las pestañas). Así la pestaña abierta sigue con SU build completo.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Ahora sí: el SW nuevo controla, la app va a recargar con el HTML nuevo —
  // purgar las generaciones anteriores es seguro (y evita crecer sin techo).
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// M8 — Notificaciones push (payload JSON {title, body, url} del back).
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Flota', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/alertas' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/alertas'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        if (new URL(win.url).origin === self.location.origin) {
          win.navigate(url)
          return win.focus()
        }
      }
      return clients.openWindow(url)
    }),
  )
})

// BG5 — el navegador puede rotar la suscripción push: re-suscribir con la
// misma clave y re-registrar en el back (cookies de sesión incluidas).
self.addEventListener('pushsubscriptionchange', (event) => {
  const oldKey =
    event.oldSubscription && event.oldSubscription.options
      ? event.oldSubscription.options.applicationServerKey
      : null
  if (!oldKey) return
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: oldKey })
      .then((subscription) =>
        fetch('/api/v1/push/subscriptions/', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription.toJSON()),
        }),
      )
      .catch(() => {}),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return

  // Assets con hash: cache-first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
            return response
          }),
      ),
    )
    return
  }

  // Navegación SPA: red primero; sin red, el shell cacheado. `?? Response`:
  // sin shell cacheado, respondWith(undefined) LANZARÍA (BG5).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('/', copy))
          return response
        })
        .catch(async () => {
          const shell = await caches.match('/')
          return shell ?? new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
        }),
    )
  }
})
