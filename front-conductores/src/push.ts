/**
 * M8 — Suscripción Web Push del dispositivo.
 *
 * Flujo: config del back (¿habilitado? clave VAPID pública) → permiso de
 * notificaciones (requiere gesto del usuario, p. ej. el toggle de Alertas) →
 * `pushManager.subscribe` → se registra la suscripción en el back. En iOS
 * solo funciona con la PWA instalada (añadida a la pantalla de inicio).
 */

import { deletePushSubscription, fetchPushConfig, savePushSubscription } from './api.ts'

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** Clave VAPID base64url → bytes para `applicationServerKey`. */
function toApplicationServerKey(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

export type PushState = 'unsupported' | 'disabled' | 'off' | 'on' | 'blocked' | 'unknown'

/** Estado actual del push en ESTE dispositivo (para pintar el toggle). */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  try {
    const config = await fetchPushConfig()
    if (!config.enabled) return 'disabled'
    if (Notification.permission === 'denied') return 'blocked'
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    return subscription ? 'on' : 'off'
  } catch {
    // BG7: un fallo de red NO es "deshabilitado" (eso ocultaba el panel):
    // estado indeterminado con reintento en la UI.
    return 'unknown'
  }
}

/** Por qué no se pudo activar. El texto lo pone quien lo pinta: este módulo no
 * tiene diccionario, y un mensaje escrito aquí salía en castellano con la app
 * en inglés. */
export const PUSH_NOT_CONFIGURED = 'push:not_configured'
export const PUSH_DENIED = 'push:denied'

/** Activa los avisos en este dispositivo. Lanza Error con uno de los códigos
 * de arriba, o el del navegador si falla la suscripción. */
export async function enablePush(): Promise<void> {
  const config = await fetchPushConfig()
  if (!config.enabled || !config.public_key) {
    throw new Error(PUSH_NOT_CONFIGURED)
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(PUSH_DENIED)
  }
  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toApplicationServerKey(config.public_key) as BufferSource,
    }))
  await savePushSubscription(subscription.toJSON())
}

/** Baja local + en el back de la suscripción de ese registro, si la hay. */
async function unsubscribeFrom(registration: ServiceWorkerRegistration): Promise<void> {
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await deletePushSubscription(endpoint)
}

/** Desactiva los avisos en este dispositivo (baja local + en el back). */
export async function disablePush(): Promise<void> {
  await unsubscribeFrom(await navigator.serviceWorker.ready)
}

/**
 * FE-3: la misma baja, pero al CERRAR SESIÓN. La suscripción push es del
 * dispositivo, no de la sesión: sin esto sobrevivía al logout y el móvil seguía
 * recibiendo los avisos de quien se fue (y el back la seguía teniendo a su
 * nombre). Diferencias con `disablePush`:
 * - no espera a `serviceWorker.ready`, que sin SW registrado (dev, navegador
 *   sin soporte) no se resuelve nunca y dejaría el logout colgado: si no hay
 *   registro, no hay suscripción que dar de baja;
 * - se llama ANTES de cerrar la sesión, porque el `DELETE` al back va
 *   autenticado (cookies de sesión + CSRF).
 */
export async function disablePushOnLogout(): Promise<void> {
  if (!pushSupported()) return
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return
  await unsubscribeFrom(registration)
}
