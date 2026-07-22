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
  | { kind: 'document'; payload: DocumentUploadInput; file: Blob; fileName: string }

export interface StoredItem {
  id: number
  createdAt: string
  item: QueuedItem
}

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

/** ¿Fallo de RED (sin conexión / servidor inalcanzable)? fetch → TypeError. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError
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

async function send(item: QueuedItem): Promise<void> {
  if (item.kind === 'km') {
    await createKmReading(item.payload)
  } else if (item.kind === 'itv') {
    await registerItv(item.payload)
  } else {
    const file = new File([item.file], item.fileName || 'documento', {
      type: item.file.type || 'application/octet-stream',
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
        // El servidor respondió con error: descartar y avisar (reenviarlo
        // repetiría el mismo rechazo para siempre).
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
