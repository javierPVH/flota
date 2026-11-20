/**
 * Capítulos de la Ayuda que esta persona ya ha abierto (✓ en el índice) y el
 * último («Seguir donde lo dejaste»). Comodidad local del dispositivo: si el
 * almacenamiento falla o está vacío, el índice sale sin marcas y todo sigue.
 */
import { isChapterId, type ChapterId } from './chapters.ts'

const KEY = 'flota.campo.ayuda.leidos'
const LAST_KEY = 'flota.campo.ayuda.ultimo'

export function readSeen(): Set<ChapterId> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((x): x is ChapterId => isChapterId(String(x))) : [])
  } catch {
    return new Set()
  }
}

export function readLast(): ChapterId | undefined {
  try {
    const raw = localStorage.getItem(LAST_KEY)
    return isChapterId(raw) ? raw : undefined
  } catch {
    return undefined
  }
}

export function markSeen(id: ChapterId) {
  try {
    localStorage.setItem(LAST_KEY, id)
    const seen = readSeen()
    if (seen.has(id)) return
    seen.add(id)
    localStorage.setItem(KEY, JSON.stringify([...seen]))
  } catch {
    // Sin almacenamiento: no se recuerda, y ya está.
  }
}
