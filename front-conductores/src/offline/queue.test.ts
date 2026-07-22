// IndexedDB no existe en jsdom: fake-indexeddb lo aporta ANTES de importar la cola.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createKmReading: vi.fn(),
  registerItv: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  createKmReading: mocks.createKmReading,
  registerItv: mocks.registerItv,
  uploadDocument: mocks.uploadDocument,
}))

import { enqueue, flush, isNetworkError, queueSize, queuedItems } from './queue.ts'

const KM = { kind: 'km' as const, payload: { vehicle: 1, km_reading: 32000, reading_date: '2026-07-22' } }

async function drain() {
  // Vacía la cola entre tests (la BD fake persiste dentro del proceso).
  mocks.createKmReading.mockResolvedValue({})
  mocks.registerItv.mockResolvedValue({})
  mocks.uploadDocument.mockResolvedValue({})
  await flush()
  vi.clearAllMocks()
}

describe('cola offline (M7)', () => {
  beforeEach(drain)

  it('isNetworkError distingue red (TypeError) de errores del servidor', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new Error('km_reading: no puede retroceder'))).toBe(false)
    expect(isNetworkError({ detail: '400' })).toBe(false)
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
})
