import { createContext, Fragment, useContext } from 'react'
import { Link } from 'react-router-dom'

import { isChapterId, type ChapterId } from './chapters.ts'

/**
 * Marcas que entiende la copia de la Ayuda:
 *   «Exportar CSV» / “Export CSV”  → un rótulo de la app, pintado como botón.
 *   [[ficha]] / [[informes#2]]     → enlace a otro capítulo (y a su paso).
 */
export const MARKS = /«([^»]+)»|“([^”]+)”|\[\[([a-z-]+)(?:#(\d+))?\]\]/g
export const LINK_MARK = /\[\[([a-z-]+)(?:#(\d+))?\]\]/g

/** Títulos de los capítulos en el idioma activo (para el texto de los enlaces). */
export const ChapterTitles = createContext<Partial<Record<ChapterId, string>>>({})

type Part = string | { label: string } | { chapter: ChapterId; step?: number }

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
        return (
          <Link key={i} className="tut-xref" to={`/ayuda/${p.chapter}${p.step && p.step > 1 ? `?paso=${p.step}` : ''}`}>
            {titles[p.chapter] ?? p.chapter}
          </Link>
        )
      })}
    </>
  )
}

/** El mismo texto, plano: los enlaces se cambian por el título del capítulo. */
export function plainText(text: string, titles: Partial<Record<ChapterId, string>>): string {
  return text.replace(LINK_MARK, (_, id: string) => (isChapterId(id) ? (titles[id] ?? id) : id))
}
