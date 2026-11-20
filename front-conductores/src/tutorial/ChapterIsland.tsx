import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, Search, X } from 'lucide-react'

import type { TutorialCopy } from '../translations/tutorial.ts'
import { CHAPTERS, GROUP_IDS, chapterById, neighbours, type ChapterId } from './chapters.ts'
import { chapterHref } from './RichText.tsx'
import { normalize } from './search.ts'

interface ChapterIslandProps {
  copy: TutorialCopy
  current: ChapterId
  /** Capítulos que se ven (los de su rol, o todos con «Ver también…»). */
  visible: ChapterId[]
}

/**
 * La isla de arriba de un capítulo: «‹  Tutoriales: Conoce la pantalla ▾  ›».
 * Las flechas pasan al capítulo anterior / siguiente; el nombre abre un
 * desplegable con un buscador arriba. Sin escribir, todos los tutoriales por
 * grupos (y la portada); al escribir, solo los tutoriales cuyo TÍTULO encaja
 * (sin acentos ni mayúsculas, todas las palabras).
 */
export function ChapterIsland({ copy, current, visible }: ChapterIslandProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const ids = visible.includes(current) ? visible : [...visible, current]
  const { prev, next } = neighbours(current, ids)
  const ui = copy.ui

  function close() {
    setOpen(false)
    setQuery('')
  }

  // Se cierra al cambiar de capítulo, al tocar fuera y con Escape.
  useEffect(close, [current])
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const words = normalize(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const searching = words.length > 0
  const fits = (id: ChapterId) => {
    const name = normalize(copy.chapters[id].title)
    return words.every((w) => name.includes(w))
  }

  function item(id: ChapterId) {
    const c = chapterById(id)
    const Icon = c.icon
    const here = id === current
    return (
      <Link
        key={id}
        to={chapterHref(id)}
        className={`tut-island-item${here ? ' is-current' : ''}`}
        aria-current={here ? 'page' : undefined}
        onClick={close}
      >
        <Icon size={16} aria-hidden="true" />
        <span>{copy.chapters[id].title}</span>
        {here && <Check size={16} aria-hidden="true" />}
      </Link>
    )
  }

  const named = searching ? ids.filter(fits) : []

  return (
    <nav ref={box} className="tut-island-wrap" aria-label={ui.tocLabel}>
      <div className="tut-island">
        {prev ? (
          <Link to={chapterHref(prev)} className="tut-island-arrow" aria-label={`${ui.prevChapter}: ${copy.chapters[prev].title}`}>
            <ChevronLeft size={20} aria-hidden="true" />
          </Link>
        ) : (
          <span className="tut-island-arrow is-off" aria-hidden="true">
            <ChevronLeft size={20} />
          </span>
        )}
        <button
          type="button"
          className="tut-island-name"
          aria-expanded={open}
          aria-controls="tut-island-menu"
          onClick={() => (open ? close() : setOpen(true))}
        >
          <span className="tut-island-label">{ui.islandLabel}:</span>
          <strong>{copy.chapters[current].title}</strong>
          <ChevronDown size={16} aria-hidden="true" className="tut-island-caret" />
        </button>
        {next ? (
          <Link to={chapterHref(next)} className="tut-island-arrow" aria-label={`${ui.nextChapter}: ${copy.chapters[next].title}`}>
            <ChevronRight size={20} aria-hidden="true" />
          </Link>
        ) : (
          <span className="tut-island-arrow is-off" aria-hidden="true">
            <ChevronRight size={20} />
          </span>
        )}
      </div>

      {open && (
        <div className="tut-island-menu" id="tut-island-menu">
          <label className="tut-search tut-island-search">
            <Search size={18} aria-hidden="true" />
            <input
              ref={input}
              type="search"
              aria-label={ui.search}
              placeholder={ui.searchPlaceholder}
              value={query}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Escape vacía primero lo escrito; con nada escrito, cierra.
                if (e.key === 'Escape' && query) {
                  e.stopPropagation()
                  e.nativeEvent.stopImmediatePropagation()
                  setQuery('')
                }
              }}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label={ui.clearSearch}>
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </label>

          {!searching ? (
            <>
              <Link to="/ayuda" className="tut-island-item is-cover" onClick={close}>
                <LayoutGrid size={16} aria-hidden="true" />
                <span>{ui.allChapters}</span>
              </Link>
              {GROUP_IDS.map((group) => {
                const list = CHAPTERS.filter((c) => c.group === group && ids.includes(c.id))
                if (!list.length) return null
                return (
                  <div key={group} className="tut-island-group">
                    <p className="tut-island-group-h">{copy.groups[group]}</p>
                    {list.map((c) => item(c.id))}
                  </div>
                )
              })}
            </>
          ) : (
            <div aria-live="polite">
              {named.length > 0 && <div className="tut-island-group">{named.map(item)}</div>}
              {!named.length && <p className="tut-island-empty">{ui.noResults(query.trim())}</p>}
            </div>
          )}
        </div>
      )}
    </nav>
  )
}
