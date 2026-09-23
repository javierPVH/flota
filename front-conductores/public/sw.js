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
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/favicon.svg']

self.addEventListener('install', (event) => {
  // Sin skipWaiting: queda "waiting" hasta que la app lo acepte (o se cierren
  // las pestañas). Así la pestaña abierta sigue con SU build completo.
  // R5-62: `addAll` era todo-o-nada — un 404 del manifest tras un despliegue a
  // medias dejaba el SW nuevo sin instalar. Solo el shell ('/') es obligatorio.
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.add('/')
      await Promise.allSettled(SHELL.slice(1).map((url) => cache.add(url)))
    }),
  )
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
          // R5-62: `navigate` rechaza si la pestaña no está controlada por
          // este SW (primera carga); entonces se abre una nueva.
          return win
            .navigate(url)
            .then(() => win.focus())
            .catch(() => clients.openWindow(url))
        }
      }
      return clients.openWindow(url)
    }),
  )
})

// BG5 — el navegador puede rotar la suscripción push: re-suscribir con la
// misma clave y re-registrar en el back (cookies de sesión incluidas).
//
// R5-51: el back exige CSRF también aquí (sesión por cookie + DRF), así que el
// POST lleva `X-CSRFToken` leído de la cookie (`cookieStore`, disponible en los
// workers de Chromium, donde vive el push en Android). Si no hay forma de
// leerla, se pide a una pestaña abierta que re-suscriba por el transporte
// normal (`postMessage`), en vez de un 403 tragado en silencio.
async function csrfTokenFromCookie() {
  try {
    if (self.cookieStore && self.cookieStore.get) {
      const cookie = await self.cookieStore.get('csrftoken')
      return cookie ? cookie.value : null
    }
  } catch {
    /* sin cookieStore: se delega en la pestaña */
  }
  return null
}

async function askClientsToResubscribe() {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of all) client.postMessage({ type: 'PUSH_RESUBSCRIBE' })
}

self.addEventListener('pushsubscriptionchange', (event) => {
  const oldKey =
    event.oldSubscription && event.oldSubscription.options
      ? event.oldSubscription.options.applicationServerKey
      : null
  event.waitUntil(
    (async () => {
      // Firefox puede no traer `oldSubscription`: sin clave no se puede
      // re-suscribir desde aquí; que lo haga una pestaña.
      if (!oldKey) return askClientsToResubscribe()
      const token = await csrfTokenFromCookie()
      if (!token) return askClientsToResubscribe()
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: oldKey,
      })
      const response = await fetch('/api/v1/push/subscriptions/', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token },
        body: JSON.stringify(subscription.toJSON()),
      })
      if (!response.ok) await askClientsToResubscribe()
    })().catch(() => askClientsToResubscribe().catch(() => {})),
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
            // R5-52: solo se guarda lo que llegó bien. Un 404 en carrera con un
            // despliegue quedaba clavado en caché para todo el build.
            if (response.ok && response.type === 'basic') {
              const copy = response.clone()
              caches.open(CACHE).then((cache) => cache.put(request, copy))
            }
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
          // R5-52: un 502/503 de nginx durante un despliegue NO es el shell;
          // guardarlo dejaba «Bad Gateway» como pantalla offline hasta el
          // siguiente build.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put('/', copy))
          }
          return response
        })
        .catch(async () => {
          const shell = await caches.match('/')
          return shell ?? new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
        }),
    )
  }
})
