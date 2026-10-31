/**
 * Aviso de «han cambiado las solicitudes», de la bandeja a la cabecera.
 *
 * El globo de la llave cuenta lo que espera decisión y lo pedía UNA vez, al
 * montar la cabecera: al decidir algo en `/solicitudes` seguía marcando el
 * número viejo hasta recargar. La página avisa al decidir y la cabecera vuelve
 * a contar. Es un evento del `window` y no un contexto porque la cabecera y la
 * página no comparten ningún padre que no sea la app entera.
 */
const EVENTO = 'flota:solicitudes-cambian'

export function notifyRequestsChanged(): void {
  window.dispatchEvent(new Event(EVENTO))
}

/** Suscribe y devuelve cómo soltarlo (para el `useEffect`). */
export function onRequestsChanged(callback: () => void): () => void {
  window.addEventListener(EVENTO, callback)
  return () => window.removeEventListener(EVENTO, callback)
}
