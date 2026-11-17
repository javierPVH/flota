/**
 * Capítulos de la Ayuda que esta persona ya ha abierto (✓ en el índice).
 * Comodidad local del navegador: si el almacenamiento falla o está vacío, el
 * índice sale sin marcas y todo sigue funcionando.
 */
import type { TutorialCopy } from '../translations/tutorial.ts'
import { chapterById, isChapterId, type ChapterId } from './chapters.ts'

const KEY = 'flota.ayuda.leidos'
const LAST_KEY = 'flota.ayuda.ultimo'

export function readSeen(): Set<ChapterId> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((x): x is ChapterId => isChapterId(String(x))) : [])
  } catch {
    return new Set()
  }
}

/** El último capítulo abierto («Seguir donde lo dejaste» en la portada). */
export function readLast(): ChapterId | undefined {
  try {
    const raw = localStorage.getItem(LAST_KEY) ?? undefined
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

/** Un capítulo está listo cuando tiene algo más que su resumen. */
export function isReady(copy: TutorialCopy, id: ChapterId): boolean {
  const c = copy.chapters[id]
  return !!(c.sections?.length || c.walk?.length || c.faq?.length || chapterById(id).video)
}
