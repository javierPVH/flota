// IndexedDB no existe en jsdom: fake-indexeddb lo aporta ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createIncident: vi.fn(),
  createKmReading: vi.fn(),
  registerItv: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  createIncident: mocks.createIncident,
  createKmReading: mocks.createKmReading,
  registerItv: mocks.registerItv,
  uploadDocument: mocks.uploadDocument,
}))

import { ApiError } from '@flota/ui/http'

import {
  enqueue,
  enqueueIncidentWithFiles,
  flush,
  isNetworkError,
  isTransientError,
  queueSize,
  queuedItems,
} from './queue.ts'

const KM = { kind: 'km' as const, payload: { vehicle: 1, km_reading: 32000, reading_date: '2026-07-22' } }

async function drain() {
  // Vacía la cola entre tests (la BD fake persiste dentro del proceso).
  mocks.createIncident.mockResolvedValue({ id: 1, vehicle: 1 })
  mocks.createKmReading.mockResolvedValue({})
  mocks.registerItv.mockResolvedValue({})
  mocks.uploadDocument.mockResolvedValue({})
  await flush()
  vi.clearAllMocks()
}

describe('cola offline (M7)', () => {
  beforeEach(drain)

  it('isNetworkError distingue red (TypeError) de errores del servidor', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true) // Chrome
    expect(
      isNetworkError(new TypeError('NetworkError when attempting to fetch resource.')),
    ).toBe(true) // Firefox
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true) // Safari
    expect(isNetworkError(new Error('km_reading: no puede retroceder'))).toBe(false)
    expect(isNetworkError({ detail: '400' })).toBe(false)
    // Un TypeError de PROGRAMACIÓN no es "sin red": no debe encolarse.
    expect(
      isNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')")),
    ).toBe(false)
  })

  it('encola y reenvía en orden al hacer flush', async () => {
    mocks.createKmReading.mockResolvedValue({})
    mocks.registerItv.mockResolvedValue({})
    await enqueue(KM)
    await enqueue({
      kind: 'itv',
      payload: { vehicle: 1, event_date: '2026-07-22', itv: { result: 'done', next_due: null } },
    })
    expect(await queueSize()).toBe(2)

    const result = await flush()
    expect(result.sent).toBe(2)
    expect(result.remaining).toBe(0)
    expect(mocks.createKmReading).toHaveBeenCalledWith(KM.payload)
    expect(mocks.registerItv).toHaveBeenCalledTimes(1)
  })

  it('si sigue sin red, corta y CONSERVA los pendientes', async () => {
    mocks.createKmReading.mockRejectedValue(new TypeError('Failed to fetch'))
    await enqueue(KM)
    await enqueue(KM)

    const result = await flush()
    expect(result.sent).toBe(0)
    expect(result.remaining).toBe(2) // nada perdido; se reintentará
    expect(mocks.createKmReading).toHaveBeenCalledTimes(1) // paró en el primero
  })

  it('un rechazo del servidor descarta el elemento sin bloquear al resto', async () => {
    mocks.createKmReading
      .mockRejectedValueOnce(new Error('km_reading: El odómetro no puede retroceder'))
      .mockResolvedValueOnce({})
    await enqueue(KM)
    await enqueue(KM)

    const result = await flush()
    expect(result.sent).toBe(1)
    expect(result.rejected).toEqual(['km_reading: El odómetro no puede retroceder'])
    expect(result.remaining).toBe(0)
  })

  it('los documentos conservan binario y nombre', async () => {
    mocks.uploadDocument.mockResolvedValue({})
    const blob = new Blob(['foto'], { type: 'image/png' })
    await enqueue({
      kind: 'document',
      payload: { vehicle: 1, type: 'damage_photos' },
      file: blob,
      fileName: 'dano.png',
      fileType: 'image/png',
    })
    const [stored] = await queuedItems()
    expect(stored.item.kind).toBe('document')

    await flush()
    const [payload, file] = mocks.uploadDocument.mock.calls[0]
    expect(payload).toEqual({ vehicle: 1, type: 'damage_photos' })
    expect(file.name).toBe('dano.png')
    expect(file.type).toBe('image/png')
  })

  // --- R3-27: parte de incidencia encolado con sus adjuntos -----------------

  it('R3-27: al crearse el parte encolado, sus adjuntos adoptan el id real', async () => {
    mocks.createIncident.mockResolvedValue({ id: 77, vehicle: 4 })
    mocks.uploadDocument.mockResolvedValue({})
    const file = new File(['foto'], 'golpe.png', { type: 'image/png' })
    const ok = await enqueueIncidentWithFiles(
      { vehicle: 4, type: 'accident', description: 'golpe', client_ref: 'ref-parte-1' },
      [{ file, type: 'accident_report' }],
    )
    expect(ok).toBe(true)

    const result = await flush()
    expect(result.sent).toBe(2)
    // El parte viaja con su clave de idempotencia (R3-34)…
    expect(mocks.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({ vehicle: 4, client_ref: 'ref-parte-1' }),
    )
    // …y el adjunto, que se encoló SIN id, sube enlazado al id recién creado.
    const [payload, sent] = mocks.uploadDocument.mock.calls[0]
    expect(payload.incident).toBe(77)
    expect(sent.name).toBe('golpe.png')
  })

  it('R3-27: si el servidor rechaza el parte, el adjunto sube suelto (solo vehículo)', async () => {
    mocks.createIncident.mockRejectedValue(new ApiError('Vehículo no válido.', 400))
    mocks.uploadDocument.mockResolvedValue({})
    const file = new File(['foto'], 'golpe.png', { type: 'image/png' })
    await enqueueIncidentWithFiles(
      { vehicle: 4, type: 'accident', client_ref: 'ref-parte-2' },
      [{ file, type: 'accident_report' }],
    )

    const result = await flush()
    expect(result.sent).toBe(1) // solo el adjunto
    expect(result.rejected).toEqual(['Vehículo no válido.']) // el parte, con su motivo
    const [payload] = mocks.uploadDocument.mock.calls[0]
    expect(payload.incident).toBeNull() // mejor suelto que perdido
  })

  // --- BG3: clasificación por status --------------------------------------

  it('isTransientError: 401/408/429/5xx se conservan; 400 se descarta', () => {
    expect(isTransientError(new ApiError('sesión caducada', 401))).toBe(true)
    expect(isTransientError(new ApiError('timeout', 408))).toBe(true)
    expect(isTransientError(new ApiError('throttle', 429))).toBe(true)
    expect(isTransientError(new ApiError('bad gateway', 502))).toBe(true)
    expect(isTransientError(new ApiError('validación', 400))).toBe(false)
    expect(isTransientError(new Error('cualquiera'))).toBe(false)
  })

  // --- C8: la sesión caducada llega como 403 con código, no como 401 --------

  it('403 not_authenticated es transitorio; 403 de permiso es definitivo', () => {
    const expirada = new ApiError('Sesión caducada.', 403, 'not_authenticated')
    const sinPermiso = new ApiError('El vehículo está fuera de tu ámbito.', 403)
    expect(isTransientError(expirada)).toBe(true)
    expect(isTransientError(sinPermiso)).toBe(false)
  })

  it('la sesión caducada (403 con código) CONSERVA el km encolado', async () => {
    mocks.createKmReading.mockRejectedValue(
      new ApiError('Sesión caducada.', 403, 'not_authenticated'),
    )
    await enqueue(KM)
    await flush()
    expect(await queueSize()).toBe(1)
  })

  it('un 403 de ámbito descarta el elemento (no se reintentará nunca)', async () => {
    mocks.createKmReading.mockRejectedValue(new ApiError('Fuera de tu ámbito.', 403))
    await enqueue(KM)
    await flush()
    expect(await queueSize()).toBe(0)
  })

  it('un 502 transitorio CONSERVA el elemento (antes se destruía)', async () => {
    mocks.createKmReading.mockRejectedValue(new ApiError('Bad gateway', 502))
    await enqueue(KM)

    const result = await flush()
    expect(result.sent).toBe(0)
    expect(result.rejected).toEqual([])
    expect(result.remaining).toBe(1)
    const [stored] = await queuedItems()
    expect(stored.attempts).toBe(1)
  })

  it('tras 8 reintentos transitorios el elemento se descarta con aviso', async () => {
    mocks.createKmReading.mockRejectedValue(new ApiError('Server error', 500))
    await enqueue(KM)
    let last = { rejected: [] as string[] }
    for (let i = 0; i < 8; i += 1) last = await flush()
    expect(last.rejected).toHaveLength(1)
    expect(last.rejected[0]).toContain('8 reintentos')
    expect(await queueSize()).toBe(0)
  })

  it('un 400 de validación (ventana de km) se descarta con el mensaje del back', async () => {
    mocks.createKmReading.mockRejectedValue(
      new ApiError('El registro de km se abre del día 23 al último día del mes.', 400),
    )
    await enqueue(KM)
    const result = await flush()
    expect(result.rejected[0]).toContain('se abre del día 23')
    expect(result.remaining).toBe(0)
  })

  it('AbortError cuenta como fallo de red: conservar', async () => {
    expect(isNetworkError(new DOMException('The operation was aborted.', 'AbortError'))).toBe(true)
  })
})
