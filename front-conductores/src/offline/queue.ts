/**
 * M7 — Cola offline para las escrituras críticas de campo (HU-3.1/4.1/5.1):
 * registro de km, gasto de combustible, subida de documentos (con su binario),
 * registro de ITV y parte de incidencia con sus adjuntos (R3-27). La
 * gasolinera es justo donde no hay cobertura.
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
 * - FE-2: cada elemento lleva el `userId` de quien lo encoló; `flush` descarta
 *   lo ajeno y el cierre de sesión vacía la cola (`clearQueue`).
 */

import { ApiError } from '@flota/ui/http'

import { addFuelEntry, createIncident, createKmReading, registerItv, uploadDocument } from '../api.ts'
import type { DocumentUploadInput, FuelEntryInput, IncidentInput } from '../api.ts'

export type QueuedItem =
  | {
      kind: 'km'
      payload: { vehicle: number; km_reading: number; reading_date: string; client_ref?: string }
    }
  | { kind: 'fuel'; payload: FuelEntryInput }
  | {
      kind: 'itv'
      payload: {
        vehicle: number
        event_date: string
        itv: { result: string; next_due: string | null }
        client_ref?: string
      }
    }
  | {
      /** R3-27: parte de incidencia capturado sin cobertura. Su `client_ref`
       * hace doble papel: idempotencia en el back (R3-34) y referencia para
       * que los adjuntos encolados con él (`incidentRef`) se enlacen al id
       * real cuando el parte por fin se cree. */
      kind: 'incident'
      payload: IncidentInput & { client_ref: string }
    }
  | {
      kind: 'document'
      payload: DocumentUploadInput
      file: Blob
      fileName: string
      /** MIME explícito: el structured clone de IndexedDB no siempre conserva
       * el `type` del Blob (p. ej. implementaciones antiguas / polyfills). */
      fileType: string
      /** R3-27: `client_ref` del parte encolado del que depende este adjunto;
       * al crearse el parte se sustituye por el `payload.incident` real. */
      incidentRef?: string
      /** Lo mismo para el informe de una ITV capturada sin cobertura: el
       * informe cuelga del REGISTRO, cuyo id no existe hasta que la cola lo
       * crea (`payload.event`). */
      eventRef?: string
    }

export interface StoredItem {
  id: number
  createdAt: string
  item: QueuedItem
  /** BG3: reintentos consumidos por errores transitorios (429/5xx/408/401). */
  attempts?: number
  /** FE-2: de quién es el dato. La cola sobrevive al cierre de sesión (es
   * IndexedDB del dispositivo), así que lo encolado por una persona NO puede
   * reenviarse con la sesión de la siguiente: `flush` descarta lo que no sea
   * del usuario vigente. Ausente (elementos anteriores a esta marca) cuenta
   * como ajeno. */
  userId?: number | null
}

// FE-2: usuario vigente al que pertenece lo que se encola. Lo fija la app al
// arrancar/entrar (`setQueueOwner`) y lo vacía al salir. Sin dueño no se
// reenvía nada: no hay sesión con la que hacerlo.
let owner: number | null = null

/** FE-2: fija (o borra, con `null`) el usuario al que pertenece la cola. */
export function setQueueOwner(userId: number | null): void {
  owner = userId
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

// R5-57: UNA conexión compartida en vez de abrir y cerrar una por operación
// (un flush de 20 elementos abría ~60). Se suelta si el navegador la cierra o
// si otra pestaña pide subir de versión (`versionchange`), para no bloquear
// una migración futura del esquema.
let sharedDb: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (!sharedDb) {
    sharedDb = openDb().then((conn) => {
      conn.onclose = () => {
        sharedDb = null
      }
      conn.onversionchange = () => {
        conn.close()
        sharedDb = null
      }
      return conn
    })
    sharedDb.catch(() => {
      sharedDb = null
    })
  }
  return sharedDb
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (conn) =>
      new Promise<T>((resolve, reject) => {
        const transaction = conn.transaction(STORE, mode)
        const request = run(transaction.objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        transaction.onabort = () => reject(transaction.error ?? request.error)
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
    store.add({
      createdAt: new Date().toISOString(),
      item,
      // FE-2: marcado con su dueño, que es lo que permite descartarlo si lo
      // reenvía otra sesión.
      userId: owner,
    } as Omit<StoredItem, 'id'>),
  )
  notify()
}

/** FE-2: vacía la cola entera. Se llama al cerrar sesión: lo que quedara sin
 * enviar (km, repostajes, partes, adjuntos) es de quien se va, y no puede
 * salir con la sesión de quien entre después. */
export async function clearQueue(): Promise<void> {
  await tx('readwrite', (store) => store.clear())
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

/** R3-34: referencia de idempotencia extremo a extremo. Se genera UNA vez al
 * capturar el dato y viaja igual en el intento directo y en el reenvío de la
 * cola: si el POST llegó pero la respuesta se perdió por el camino, el back
 * reconoce la referencia y devuelve la respuesta original sin repetir el
 * efecto (sin doblar los litros del mes, sin duplicar la lectura). */
export function newClientRef(): string {
  try {
    return crypto.randomUUID()
  } catch {
    // Sin `randomUUID` (contexto no seguro): basta con que no se repita.
    return `ref-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/** R3-27: encola un parte de incidencia con sus adjuntos, en orden FIFO (el
 * parte primero). Devuelve `false` si ni siquiera el parte cupo en IndexedDB
 * (BG4: la UI debe avisar de que NO quedó nada guardado); un adjunto que no
 * quepa se pierde en silencio — el parte, que es lo crítico, ya está a salvo. */
export async function enqueueIncidentWithFiles(
  payload: IncidentInput & { client_ref: string },
  files: Array<{ file: File; type: string; notes?: string }>,
): Promise<boolean> {
  if (!(await safeEnqueue({ kind: 'incident', payload }))) return false
  for (const upload of files) {
    await safeEnqueue({
      kind: 'document',
      // Sin `incident`: el id no existe aún — `incidentRef` lo resolverá el
      // flush cuando el parte se cree.
      payload: {
        vehicle: payload.vehicle,
        type: upload.type,
        client_ref: newClientRef(),
        // La nota dice de qué son (los papeles del coche de sustitución): sin
        // ella, al reenviarse quedarían como un «Otro» más de la incidencia.
        ...(upload.notes ? { notes: upload.notes } : {}),
      },
      file: upload.file,
      fileName: upload.file.name,
      fileType: upload.file.type,
      incidentRef: payload.client_ref,
    })
  }
  return true
}

/** ITV capturada sin cobertura, con su informe: se encolan los dos y el
 * informe queda esperando (`eventRef`) al id del registro que creará el flush.
 * Devuelve `false` si ni siquiera la ITV pudo guardarse (sin IndexedDB). */
export async function enqueueItvWithReport(
  payload: Extract<QueuedItem, { kind: 'itv' }>['payload'] & { client_ref: string },
  report: File | null,
): Promise<boolean> {
  if (!(await safeEnqueue({ kind: 'itv', payload }))) return false
  if (report) {
    await safeEnqueue({
      kind: 'document',
      // Sin `event`: el registro no existe aún.
      payload: {
        vehicle: payload.vehicle,
        type: 'itv_report',
        client_ref: newClientRef(),
      },
      file: report,
      fileName: report.name,
      fileType: report.type,
      eventRef: payload.client_ref,
    })
  }
  return true
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

/** Reenvía un elemento. Para un parte de incidencia y para una ITV devuelve el
 * id creado (sus adjuntos encolados lo esperan); el resto no devuelve nada. */
async function send(item: QueuedItem): Promise<number | undefined> {
  if (item.kind === 'km') {
    await createKmReading(item.payload)
  } else if (item.kind === 'fuel') {
    await addFuelEntry(item.payload)
  } else if (item.kind === 'itv') {
    const event = await registerItv(item.payload)
    return event.id
  } else if (item.kind === 'incident') {
    const incident = await createIncident(item.payload)
    return incident.id
  } else {
    const payload = { ...item.payload }
    if (item.incidentRef) {
      // R3-27: el parte del que dependía nunca llegó a crearse (el servidor lo
      // rechazó y se descartó). El adjunto sube ligado solo al vehículo —
      // mejor suelto que perdido.
      payload.incident = null
    }
    if (item.eventRef) {
      // Ídem con la ITV que nunca llegó a registrarse.
      payload.event = null
    }
    const file = new File([item.file], item.fileName || 'documento', {
      type: item.fileType || item.file.type || 'application/octet-stream',
    })
    await uploadDocument(payload, file)
  }
  return undefined
}

/** R3-27: al crearse por fin lo que esperaban (el parte de una incidencia, el
 * registro de una ITV), sus adjuntos pendientes pasan a apuntar al id real —
 * en el array en memoria (este mismo flush los envía) y en IndexedDB (por si
 * el flush se corta antes de llegar a ellos). */
async function adopt(
  items: StoredItem[],
  link: 'incident' | 'event',
  ref: string,
  id: number,
): Promise<void> {
  const refField = link === 'incident' ? 'incidentRef' : 'eventRef'
  for (const stored of items) {
    const item = stored.item
    if (item.kind !== 'document' || item[refField] !== ref) continue
    item.payload = { ...item.payload, [link]: id }
    delete item[refField]
    try {
      await tx('readwrite', (store) => store.put({ ...stored }))
    } catch {
      // Best-effort: en memoria ya está enlazado para este flush; si además
      // falla persistir y la app muere antes de enviarlo, subirá sin enlace.
    }
  }
}

export interface FlushResult {
  sent: number
  /** Rechazados por el servidor (descartados): mensajes para avisar. */
  rejected: string[]
  /** Quedan pendientes por seguir sin red. */
  remaining: number
  /** FE-2: descartados sin enviar por ser de OTRO usuario (o sin dueño). */
  discarded?: number
}

let flushing = false

/** Reenvía la cola en orden. Segura ante llamadas concurrentes. */
export async function flush(): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, rejected: [], remaining: 0, discarded: 0 }
  // R5-59: la segunda llamada solapada no debe decir «no queda nada».
  if (flushing) return { ...result, remaining: await queueSize().catch(() => 0) }
  // FE-2: sin usuario vigente no hay sesión con la que reenviar; se conserva
  // todo hasta que alguien entre (y entonces se decide de quién es cada cosa).
  if (owner === null) return { ...result, remaining: await queueSize().catch(() => 0) }
  flushing = true
  try {
    const items = await queuedItems()
    for (const stored of items) {
      // FE-2: lo que no es del usuario vigente se BORRA sin enviarlo — cubre
      // la sesión caducada seguida de la entrada de otra persona en el mismo
      // móvil, donde el cierre manual (que vacía la cola) no ha ocurrido.
      if (stored.userId !== owner) {
        await remove(stored.id)
        result.discarded = (result.discarded ?? 0) + 1
        continue
      }
      try {
        const createdId = await send(stored.item)
        if (stored.item.kind === 'incident' && createdId !== undefined) {
          await adopt(items, 'incident', stored.item.payload.client_ref, createdId)
        }
        // La ITV siempre se encola con `client_ref` (idempotencia R3-34); es
        // esa misma referencia la que espera su informe.
        if (stored.item.kind === 'itv' && createdId !== undefined && stored.item.payload.client_ref) {
          await adopt(items, 'event', stored.item.payload.client_ref, createdId)
        }
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
