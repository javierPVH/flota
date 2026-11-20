/**
 * Buscador de la Ayuda: sin mayúsculas ni acentos y por palabras sueltas
 * (tienen que estar TODAS en la misma frase, contando el título del
 * capítulo). Busca en títulos, resúmenes, pasos, tablas, notas y dudas.
 */
import type { Block, ChapterCopy, TutorialCopy } from '../translations/tutorial.ts'
import { CHAPTER_IDS, type ChapterId } from './chapters.ts'
import { plainText } from './RichText.tsx'

export interface SearchHit {
  chapter: ChapterId
  /** Pestaña del recorrido (desde 1), si el resultado está en él. */
  step?: number
  /** Id del elemento del capítulo donde está (una sección o una duda). */
  anchor?: string
  title: string
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

/** Frases de un bloque: pasos, filas de tabla y notas. */
function lines(block: Block): string[] {
  return [
    ...(block.steps ?? []),
    ...(block.defs ?? []).map((d) => `${d.term}: ${d.text}`),
    ...(block.note ? [block.note] : []),
    ...(block.warn ? [block.warn] : []),
  ]
}

/** Ids de las secciones y las dudas de un capítulo (los pinta `ChapterView`). */
export const sectionAnchor = (i: number) => `tut-s-${i}`
export const introAnchor = (i: number) => `tut-i-${i}`
export const faqAnchor = (i: number) => `tut-faq-${i}`

/** Resultados en el orden del índice; como mucho uno por frase. */
export function searchTutorial(
  copy: TutorialCopy,
  query: string,
  ids: readonly ChapterId[] = CHAPTER_IDS,
  limit = 30,
): SearchHit[] {
  const wanted = words(query)
  if (!wanted.length) return []
  const hits: SearchHit[] = []
  const titles = Object.fromEntries(CHAPTER_IDS.map((id) => [id, copy.chapters[id].title]))
  const matches = (...texts: string[]) => {
    const haystack = normalize(plainText(texts.join(' '), titles))
    return wanted.every((w) => haystack.includes(w))
  }
  const blocks = (id: ChapterId, ch: ChapterCopy, list: ChapterCopy['sections'], anchor: (i: number) => string) =>
    list?.forEach((s, i) => {
      for (const line of lines(s)) {
        if (matches(ch.title, s.title, line)) {
          hits.push({ chapter: id, anchor: anchor(i), title: `${ch.title} · ${s.title}`, text: plainText(line, titles) })
        }
      }
    })
  for (const id of ids) {
    const ch = copy.chapters[id]
    if (matches(ch.title, ch.lead)) hits.push({ chapter: id, title: ch.title, text: plainText(ch.lead, titles) })
    for (const q of ch.quick ?? []) {
      const w = ch.walk?.[q.step - 1]
      if (w && matches(q.label)) hits.push({ chapter: id, step: q.step, title: `${ch.title} · ${q.label}`, text: plainText(w.title, titles) })
    }
    blocks(id, ch, ch.intro, introAnchor)
    ch.walk?.forEach((w, i) => {
      for (const line of lines(w)) {
        if (matches(ch.title, w.title, line)) {
          hits.push({ chapter: id, step: i + 1, title: `${ch.title} · ${w.title}`, text: plainText(line, titles) })
        }
      }
    })
    blocks(id, ch, ch.sections, sectionAnchor)
    ch.faq?.forEach((f, i) => {
      if (matches(ch.title, f.q, f.a)) hits.push({ chapter: id, anchor: faqAnchor(i), title: f.q, text: plainText(f.a, titles) })
    })
  }
  return hits.slice(0, limit)
}

/** Dirección de un resultado: el capítulo, su paso y, si lo hay, el sitio exacto. */
export function hitPath(hit: Pick<SearchHit, 'chapter' | 'step' | 'anchor'>): string {
  return `/ayuda/${hit.chapter}${hit.step && hit.step > 1 ? `?paso=${hit.step}` : ''}${hit.anchor ? `#${hit.anchor}` : ''}`
}
