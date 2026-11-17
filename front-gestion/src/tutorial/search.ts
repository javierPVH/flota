/**
 * Buscador de la Ayuda: sin mayúsculas ni acentos y por palabras sueltas
 * (tienen que estar TODAS en el mismo paso). Busca en títulos, resúmenes,
 * pasos y dudas de todos los capítulos: la copia es texto y ya está cargada.
 */
import type { TutorialCopy } from '../translations/tutorial.ts'
import { CHAPTER_IDS, type ChapterId } from './chapters.ts'
import { plainText } from './RichText.tsx'

export interface SearchHit {
  chapter: ChapterId
  /** Pestaña del recorrido (desde 1), si el resultado está en él. */
  step?: number
  /** Id del elemento del capítulo donde está (una sección o una duda): el
   * enlace lleva hasta él, y si es una duda la abre. */
  anchor?: string
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
  // Los enlaces [[id]] se buscan (y se enseñan) por el título de su capítulo.
  const titles = Object.fromEntries(CHAPTER_IDS.map((id) => [id, copy.chapters[id].title]))
  const matches = (...texts: string[]) => {
    const haystack = normalize(plainText(texts.join(' '), titles))
    return wanted.every((w) => haystack.includes(w))
  }
  for (const id of CHAPTER_IDS) {
    const ch = copy.chapters[id]
    if (matches(ch.title, ch.lead)) hits.push({ chapter: id, title: ch.title, text: plainText(ch.lead, titles) })
    // «¿Qué quieres hacer?»: se busca por la tarea, y lleva a su paso.
    for (const q of ch.quick ?? []) {
      const w = ch.walk?.[q.step - 1]
      if (w && matches(q.label)) hits.push({ chapter: id, step: q.step, title: `${ch.title} · ${q.label}`, text: plainText(w.steps[0] ?? w.title, titles) })
    }
    ch.sections?.forEach((s, i) => {
      for (const step of [...s.steps, ...(s.note ? [s.note] : [])]) {
        if (matches(ch.title, s.title, step)) {
          hits.push({ chapter: id, anchor: sectionAnchor(i), title: `${ch.title} · ${s.title}`, text: plainText(step, titles) })
        }
      }
    })
    ch.walk?.forEach((w, i) => {
      for (const step of w.steps) {
        if (matches(ch.title, w.title, step)) {
          hits.push({ chapter: id, step: i + 1, title: `${ch.title} · ${w.title}`, text: plainText(step, titles) })
        }
      }
    })
    ch.faq?.forEach((f, i) => {
      if (matches(ch.title, f.q, f.a)) hits.push({ chapter: id, anchor: faqAnchor(i), title: f.q, text: plainText(f.a, titles) })
    })
  }
  return hits.slice(0, limit)
}

/** Ids de las secciones y las dudas de un capítulo (los pinta `ChapterView`). */
export const sectionAnchor = (i: number) => `tut-s-${i}`
export const faqAnchor = (i: number) => `tut-faq-${i}`

/** Dirección de un resultado: el capítulo, su paso y, si lo hay, el sitio exacto. */
export function hitPath(hit: Pick<SearchHit, 'chapter' | 'step' | 'anchor'>): string {
  return `/ayuda/${hit.chapter}${hit.step && hit.step > 1 ? `?paso=${hit.step}` : ''}${hit.anchor ? `#${hit.anchor}` : ''}`
}
