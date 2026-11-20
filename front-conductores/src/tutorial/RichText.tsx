import { createContext, Fragment, useContext } from 'react'
import { Link } from 'react-router-dom'

import { isChapterId, type ChapterId } from './chapters.ts'

/**
 * Marcas que entiende la copia de la Ayuda:
 *   «Guardar lectura» / “Save reading” → un rótulo de la app, pintado como botón.
 *   [[km]] / [[accidente#3]]          → enlace a otro capítulo (y a su paso).
 *   **Obligatorio**                    → negrita.
 */
export const MARKS = /«([^»]+)»|“([^”]+)”|\[\[([a-z-]+)(?:#(\d+))?\]\]|\*\*([^*]+)\*\*/g
export const LINK_MARK = /\[\[([a-z-]+)(?:#(\d+))?\]\]/g

/** Títulos de los capítulos en el idioma activo (para el texto de los enlaces). */
export const ChapterTitles = createContext<Partial<Record<ChapterId, string>>>({})

type Part = string | { label: string } | { bold: string } | { chapter: ChapterId; step?: number }

export function chapterHref(chapter: ChapterId, step?: number): string {
  return `/ayuda/${chapter}${step && step > 1 ? `?paso=${step}` : ''}`
}

/** Texto de la Ayuda con sus rótulos pintados como botones y sus enlaces. */
export function RichText({ text }: { text: string }) {
  const titles = useContext(ChapterTitles)
  const parts: Part[] = []
  let last = 0
  for (const m of text.matchAll(MARKS)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[3] && isChapterId(m[3])) {
      parts.push({ chapter: m[3], step: m[4] ? Number(m[4]) : undefined })
    } else if (m[3]) {
      parts.push(m[0]) // id desconocido: se deja tal cual (la prueba lo caza)
    } else if (m[5]) {
      parts.push({ bold: m[5] })
    } else {
      parts.push({ label: m[1] ?? m[2] })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === 'string') return <Fragment key={i}>{p}</Fragment>
        if ('label' in p)
          return (
            <span key={i} className="tut-ui">
              {p.label}
            </span>
          )
        if ('bold' in p) return <strong key={i}>{p.bold}</strong>
        return (
          <Link key={i} className="tut-xref" to={chapterHref(p.chapter, p.step)}>
            {titles[p.chapter] ?? p.chapter}
          </Link>
        )
      })}
    </>
  )
}

/** El mismo texto, plano: sin marcas y con el título de cada capítulo enlazado. */
export function plainText(text: string, titles: Partial<Record<ChapterId, string>>): string {
  return text
    .replace(LINK_MARK, (_, id: string) => (isChapterId(id) ? (titles[id] ?? id) : id))
    .replace(/\*\*([^*]+)\*\*/g, '$1')
}
