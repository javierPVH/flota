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

/** Desactiva los avisos en este dispositivo (baja local + en el back). */
export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await deletePushSubscription(endpoint)
}
