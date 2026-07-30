/**
 * BG5 — registro del service worker + detección de versión nueva.
 *
 * El SW nuevo se queda en `waiting` (no hay skipWaiting incondicional): aquí
 * se detecta y la UI ofrece "recargar". Al aceptar, se envía SKIP_WAITING y se
 * recarga en `controllerchange` — así nunca queda una pestaña del build viejo
 * pidiendo chunks ya purgados (el ChunkLoadError de cada deploy).
 */

let waitingWorker: ServiceWorker | null = null
const listeners = new Set<(hasUpdate: boolean) => void>()

function notify() {
  listeners.forEach((fn) => fn(waitingWorker !== null))
}

/** Suscripción para el aviso de la UI. Devuelve el des-suscriptor. */
export function onUpdateAvailable(listener: (hasUpdate: boolean) => void): () => void {
  listeners.add(listener)
  listener(waitingWorker !== null)
  return () => listeners.delete(listener)
}

/** Acepta la versión nueva: activa el SW en espera y recarga al tomar control. */
export function applyUpdate(): void {
  if (!waitingWorker) return
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => window.location.reload(),
    { once: true },
  )
  waitingWorker.postMessage({ type: 'SKIP_WAITING' })
}

function watch(registration: ServiceWorkerRegistration) {
  // Ya había uno esperando (p. ej. deploy mientras la pestaña estaba abierta).
  if (registration.waiting && navigator.serviceWorker.controller) {
    waitingWorker = registration.waiting
    notify()
  }
  registration.addEventListener('updatefound', () => {
    const incoming = registration.installing
    if (!incoming) return
    incoming.addEventListener('statechange', () => {
      // 'installed' con controller = actualización (sin controller = 1ª instalación).
      if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
        waitingWorker = incoming
        notify()
      }
    })
  })
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(watch)
      .catch(() => {})
  })
}
