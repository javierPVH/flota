/**
 * M7 — Cola offline para las escrituras críticas de campo (HU-3.1/4.1/5.1):
 * registro de km, subida de documentos (con su binario) y registro de ITV.
 *
 * Diseño:
 * - IndexedDB (los `File` de la cámara no caben en localStorage).
 * - Solo se encola ante un FALLO DE RED (fetch rechaza con TypeError). Un error
 *   HTTP significa que el servidor respondió (400/403/…): eso se muestra al
 *   usuario, no se reencola — reintentarlo daría el mismo error.
 * - `flush()` reenvía en orden (FIFO). Si un envío falla por red se corta (se
 *   reintentará al volver la conexión); si el servidor lo rechaza, el elemento
 *   se descarta y se notifica: los demás no se bloquean.
 * - Reintento automático: evento `online` + al arrancar la app.
 */

import { ApiError } from '@flota/ui/http'

import { createKmReading, registerItv, uploadDocument } from '../api.ts'
import type { DocumentUploadInput } from '../api.ts'

export type QueuedItem =
  | { kind: 'km'; payload: { vehicle: number; km_reading: number; reading_date: string } }
  | {
      kind: 'itv'
      payload: {
        vehicle: number
        event_date: string
        itv: { result: string; next_due: string | null }
      }
    }
  | {
      kind: 'document'
      payload: DocumentUploadInput
      file: Blob
      fileName: string
      /** MIME explícito: el structured clone de IndexedDB no siempre conserva
       * el `type` del Blob (p. ej. implementaciones antiguas / polyfills). */
      fileType: string
    }

export interface StoredItem {
  id: number
  createdAt: string
  item: QueuedItem
  /** BG3: reintentos consumidos por errores transitorios (429/5xx/408/401). */
  attempts?: number
}

/** BG3: tras N reintentos transitorios fallidos, el elemento se descarta con
 * aviso (cuarentena) para no bloquear la cola para siempre. */
const MAX_TRANSIENT_ATTEMPTS = 8

const DB_NAME = 'flota-campo'
const STORE = 'outbox'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const request = run(transaction.objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        transaction.oncomplete = () => db.close()
      }),
  )
}

/** ¿Fallo de RED (sin conexión / servidor inalcanzable)? fetch → TypeError.
 *
 * OJO (E3 de OPTIMIZACION_Y_ERRORES.md): un TypeError de PROGRAMACIÓN en el
 * camino del envío no debe pasar por "sin red" — se encolaría para siempre y
 * cada flush repetiría el error, bloqueando también al resto de la cola. Se
 * exige además el mensaje típico de red: Chrome «Failed to fetch», Firefox
 * «NetworkError when attempting…», Safari «Load failed». */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true
  return err instanceof TypeError && /fetch|network|load failed/i.test(err.message)
}

/** BG3: ¿error TRANSITORIO del servidor? Se conserva y se reintenta con tope.
 *
 * Sesión caducada (al reautenticarse el flush lo enviará), 408, 429 (throttle) y
 * 5xx (p. ej. 502 de nginx durante un deploy).
 *
 * C8: la sesión caducada NO llega como 401. Con auth por sesión, DRF degrada
 * `NotAuthenticated` a **403**, el mismo código que "no tienes permiso" o "fuera
 * de tu ámbito" — que sí son definitivos. Antes se comprobaba `status === 401`,
 * que con este backend nunca se cumple: el km o la foto encolados se
 * DESCARTABAN justo en el caso para el que se escribió esta función. Ahora se
 * decide por el `code` de la envoltura del backend. */
export function isTransientError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  if (err.status === 401 || err.code === 'not_authenticated') return true
  return err.status === 408 || err.status === 429 || err.status >= 500
}

const listeners = new Set<() => void>()
function notify() {
  listeners.forEach((fn) => fn())
}
/** Suscripción para el indicador de la UI. Devuelve el des-suscriptor. */
export function onQueueChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function enqueue(item: QueuedItem): Promise<void> {
  await tx('readwrite', (store) =>
    store.add({ createdAt: new Date().toISOString(), item } as Omit<StoredItem, 'id'>),
  )
  notify()
}

/** BG4: `enqueue` sin excepciones — IndexedDB puede fallar justo en el
 * escenario para el que existe la cola (Safari en privado, cuota llena con
 * una foto grande). Devuelve `false` si no se pudo guardar: la UI debe avisar
 * de que el dato NO quedó encolado. */
export async function safeEnqueue(item: QueuedItem): Promise<boolean> {
  try {
    await enqueue(item)
    return true
  } catch {
    return false
  }
}

/** BG4: pedir almacenamiento persistente al arrancar — reduce el riesgo de
 * que el navegador purgue IndexedDB (y la cola) bajo presión de disco. */
export function requestPersistentStorage(): void {
  try {
    void navigator.storage?.persist?.()
  } catch {
    // Best-effort: sin soporte no hay nada que hacer.
  }
}

export function queuedItems(): Promise<StoredItem[]> {
  return tx('readonly', (store) => store.getAll() as IDBRequest<StoredItem[]>)
}

export async function queueSize(): Promise<number> {
  return tx('readonly', (store) => store.count())
}

async function remove(id: number): Promise<void> {
  await tx('readwrite', (store) => store.delete(id))
  notify()
}

async function bumpAttempts(stored: StoredItem): Promise<number> {
  const attempts = (stored.attempts ?? 0) + 1
  await tx('readwrite', (store) => store.put({ ...stored, attempts }))
  return attempts
}

async function send(item: QueuedItem): Promise<void> {
  if (item.kind === 'km') {
    await createKmReading(item.payload)
  } else if (item.kind === 'itv') {
    await registerItv(item.payload)
  } else {
    const file = new File([item.file], item.fileName || 'documento', {
      type: item.fileType || item.file.type || 'application/octet-stream',
    })
    await uploadDocument(item.payload, file)
  }
}

export interface FlushResult {
  sent: number
  /** Rechazados por el servidor (descartados): mensajes para avisar. */
  rejected: string[]
  /** Quedan pendientes por seguir sin red. */
  remaining: number
}

let flushing = false

/** Reenvía la cola en orden. Segura ante llamadas concurrentes. */
export async function flush(): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, rejected: [], remaining: 0 }
  if (flushing) return result
  flushing = true
  try {
    const items = await queuedItems()
    for (const stored of items) {
      try {
        await send(stored.item)
        await remove(stored.id)
        result.sent += 1
      } catch (err) {
        if (isNetworkError(err)) break // seguimos sin red: parar y conservar
        if (isTransientError(err)) {
          // BG3: 401/408/429/5xx — el servidor está mal o la sesión caducó.
          // CONSERVAR y parar (reintento en el próximo flush), con tope de
          // intentos para que un fallo persistente no bloquee la cola.
          const attempts = await bumpAttempts(stored)
          if (attempts >= MAX_TRANSIENT_ATTEMPTS) {
            await remove(stored.id)
            result.rejected.push(
              `Descartado tras ${attempts} reintentos: ` +
                (err instanceof Error ? err.message : String(err)),
            )
            continue
          }
          break
        }
        // 4xx de validación (p. ej. "fuera de plazo" de la ventana de km, N8a):
        // descartar con el mensaje del servidor — reenviarlo repetiría el
        // mismo rechazo para siempre.
        await remove(stored.id)
        result.rejected.push(err instanceof Error ? err.message : String(err))
      }
    }
    result.remaining = await queueSize()
    return result
  } finally {
    flushing = false
  }
}
