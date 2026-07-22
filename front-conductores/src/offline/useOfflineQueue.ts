import { useCallback, useEffect, useState } from 'react'

import { flush, onQueueChange, queueSize, type FlushResult } from './queue.ts'

/**
 * Estado de la cola offline para el indicador del shell (M7): tamaño en vivo,
 * reenvío automático al volver la conexión (evento `online` + al montar) y
 * reenvío manual desde el indicador.
 */
export function useOfflineQueue(onFlushed?: (result: FlushResult) => void) {
  const [pending, setPending] = useState(0)
  const [sending, setSending] = useState(false)

  const refresh = useCallback(() => {
    queueSize().then(setPending, () => setPending(0))
  }, [])

  const flushNow = useCallback(async () => {
    setSending(true)
    try {
      const result = await flush()
      if (result.sent > 0 || result.rejected.length > 0) onFlushed?.(result)
    } finally {
      setSending(false)
      refresh()
    }
  }, [onFlushed, refresh])

  useEffect(() => {
    refresh()
    const unsubscribe = onQueueChange(refresh)
    const onOnline = () => void flushNow()
    window.addEventListener('online', onOnline)
    // Al arrancar con red, vacía lo que quedara de la sesión anterior.
    if (navigator.onLine) void flushNow()
    return () => {
      unsubscribe()
      window.removeEventListener('online', onOnline)
    }
  }, [refresh, flushNow])

  return { pending, sending, flushNow }
}
