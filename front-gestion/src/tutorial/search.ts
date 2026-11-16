/**
 * Buscador de la Ayuda: sin mayúsculas ni acentos y por palabras sueltas
 * (tienen que estar TODAS en el mismo paso). Busca en títulos, resúmenes,
 * pasos y dudas de todos los capítulos: la copia es texto y ya está cargada.
 */
import type { TutorialCopy } from '../translations/tutorial.ts'
import { CHAPTER_IDS, type ChapterId } from './chapters.ts'

export interface SearchHit {
  chapter: ChapterId
  /** Pestaña del recorrido (desde 1), si el resultado está en él. */
  step?: number
  /** Título de lo encontrado (capítulo, sección, pestaña o pregunta). */
  title: string
  /** Frase donde está. */
  text: string
}

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function words(query: string): string[] {
  return normalize(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** Resultados en el orden del índice; como mucho uno por frase. */
export function searchTutorial(copy: TutorialCopy, query: string, limit = 30): SearchHit[] {
  const wanted = words(query)
  if (!wanted.length) return []
  const hits: SearchHit[] = []
  const matches = (...texts: string[]) => {
    const haystack = normalize(texts.join(' '))
    return wanted.every((w) => haystack.includes(w))
  }
  for (const id of CHAPTER_IDS) {
    const ch = copy.chapters[id]
    if (matches(ch.title, ch.lead)) hits.push({ chapter: id, title: ch.title, text: ch.lead })
    for (const s of ch.sections ?? []) {
      for (const step of [...s.steps, ...(s.note ? [s.note] : [])]) {
        if (matches(ch.title, s.title, step)) hits.push({ chapter: id, title: `${ch.title} · ${s.title}`, text: step })
      }
    }
    ch.walk?.forEach((w, i) => {
      for (const step of w.steps) {
        if (matches(ch.title, w.title, step)) {
          hits.push({ chapter: id, step: i + 1, title: `${ch.title} · ${w.title}`, text: step })
        }
      }
    })
    for (const f of ch.faq ?? []) {
      if (matches(ch.title, f.q, f.a)) hits.push({ chapter: id, title: f.q, text: f.a })
    }
  }
  return hits.slice(0, limit)
}
