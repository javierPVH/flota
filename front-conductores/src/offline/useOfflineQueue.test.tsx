// R5-63: el hook del indicador de la cola offline (M7).
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  flush: vi.fn(),
  onQueueChange: vi.fn(),
  queueSize: vi.fn(),
}))

vi.mock('./queue.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./queue.ts')>()),
  flush: mocks.flush,
  onQueueChange: mocks.onQueueChange,
  queueSize: mocks.queueSize,
}))

import { useOfflineQueue } from './useOfflineQueue.ts'

const NADA = { sent: 0, rejected: [], remaining: 0 }

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

describe('useOfflineQueue (M7: indicador y reenvío)', () => {
  let unsubscribe: ReturnType<typeof vi.fn>
  let queueListener: (() => void) | null

  beforeEach(() => {
    unsubscribe = vi.fn()
    queueListener = null
    mocks.onQueueChange.mockReset().mockImplementation((fn: () => void) => {
      queueListener = fn
      return unsubscribe
    })
    mocks.queueSize.mockReset().mockResolvedValue(2)
    mocks.flush.mockReset().mockResolvedValue(NADA)
    setOnline(true)
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'onLine')
  })

  it('al montar con red lee el tamaño, se suscribe a la cola y vacía lo que quedara', async () => {
    const onFlushed = vi.fn()
    const { result } = renderHook(() => useOfflineQueue(onFlushed))
    await waitFor(() => expect(result.current.pending).toBe(2))
    expect(mocks.onQueueChange).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(1))
    // Nada enviado ni rechazado: no hay nada que contar a la UI.
    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(onFlushed).not.toHaveBeenCalled()
  })

  it('sin red al montar no intenta reenviar; al volver la conexión, sí', async () => {
    setOnline(false)
    const onFlushed = vi.fn()
    mocks.flush.mockResolvedValue({ sent: 2, rejected: [], remaining: 0 })
    renderHook(() => useOfflineQueue(onFlushed))
    await waitFor(() => expect(mocks.queueSize).toHaveBeenCalled())
    expect(mocks.flush).not.toHaveBeenCalled()

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(mocks.flush).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onFlushed).toHaveBeenCalledWith({ sent: 2, rejected: [], remaining: 0 }))
  })

  it('un rechazo del back también se cuenta (la UI enseña qué no entró)', async () => {
    const onFlushed = vi.fn()
    const rechazo = { sent: 0, rejected: ['km_reading: no puede retroceder'], remaining: 0 }
    mocks.flush.mockResolvedValue(rechazo)
    renderHook(() => useOfflineQueue(onFlushed))
    await waitFor(() => expect(onFlushed).toHaveBeenCalledWith(rechazo))
  })

  it('flushNow marca «enviando» mientras dura y refresca el tamaño al terminar', async () => {
    let resolveFlush: (value: typeof NADA) => void = () => {}
    mocks.flush.mockImplementation(
      () =>
        new Promise<typeof NADA>((resolve) => {
          resolveFlush = resolve
        }),
    )
    const { result } = renderHook(() => useOfflineQueue())
    // El del arranque sigue en vuelo: lo soltamos antes de probar el manual.
    await act(async () => resolveFlush(NADA))
    await waitFor(() => expect(result.current.sending).toBe(false))

    mocks.queueSize.mockResolvedValue(0)
    let manual: Promise<void> = Promise.resolve()
    act(() => {
      manual = result.current.flushNow()
    })
    await waitFor(() => expect(result.current.sending).toBe(true))
    await act(async () => {
      resolveFlush(NADA)
      await manual
    })
    expect(result.current.sending).toBe(false)
    await waitFor(() => expect(result.current.pending).toBe(0))
  })

  it('un cambio en la cola refresca el contador, y al desmontar se des-suscribe', async () => {
    const { result, unmount } = renderHook(() => useOfflineQueue())
    await waitFor(() => expect(result.current.pending).toBe(2))
    mocks.queueSize.mockResolvedValue(5)
    act(() => queueListener?.())
    await waitFor(() => expect(result.current.pending).toBe(5))

    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    // El `online` ya no llega al hook desmontado.
    const llamadas = mocks.flush.mock.calls.length
    window.dispatchEvent(new Event('online'))
    expect(mocks.flush).toHaveBeenCalledTimes(llamadas)
  })

  it('si IndexedDB falla al contar, el indicador enseña 0 en vez de romper', async () => {
    mocks.queueSize.mockRejectedValue(new Error('IDB cerrada'))
    const { result } = renderHook(() => useOfflineQueue())
    await waitFor(() => expect(mocks.queueSize).toHaveBeenCalled())
    await waitFor(() => expect(result.current.pending).toBe(0))
  })
})
