/**
 * Ayuda (`/ayuda`, `/ayuda/:capitulo`): el tutorial de la app de gestión.
 *
 * Portada sin capítulo (tareas frecuentes y por dónde empezar); con capítulo,
 * ese capítulo (uno cada vez, para que solo se pidan sus capturas). La pestaña
 * de un recorrido va en `?paso=N`, así un enlace lleva al paso exacto. El
 * buscador recorre la copia de todos los capítulos y sus resultados llevan
 * al sitio exacto (`#ancla` de la sección o de la duda). Se llega también desde el
 * botón «?» de la cabecera, que abre el capítulo de la pantalla en la que estás.
 *
 * Plan: tutoriales/administradores/PLAN_VISTA_TUTORIAL.md
 */
import { useEffect, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, CircleHelp, CirclePlay, History } from 'lucide-react'
import { PageHeader, TextInputField } from '@flota/ui/ui'
import { useAppLang } from '@flota/ui/i18n'

import { useTutorialCopy, type TutorialCopy } from '../translations/tutorial.ts'
import { ChapterView } from '../tutorial/ChapterView.tsx'
import { CHAPTERS, GROUP_IDS, chapterById, isChapterId, type ChapterId } from '../tutorial/chapters.ts'
import { markSeen, readLast, readSeen } from '../tutorial/progress.ts'
import { ChapterTitles, RichText } from '../tutorial/RichText.tsx'
import { hitPath, searchTutorial } from '../tutorial/search.ts'
import { TutorialIndex } from '../tutorial/TutorialIndex.tsx'
import '../tutorial/tutorial.css'

export function TutorialPage() {
  const copy = useTutorialCopy()
  const lang = useAppLang()
  const location = useLocation()
  const { capitulo } = useParams()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const id = isChapterId(capitulo) ? capitulo : undefined
  const step = Math.max(1, Number(params.get('paso')) || 1)

  // El último abierto antes de este (para «Seguir donde lo dejaste»): se lee
  // una vez, antes de que el capítulo de ahora lo pise.
  const [last] = useState(readLast)

  // Al cambiar de capítulo queda como leído (✓ en el índice) y se sube arriba;
  // con `#ancla` (un resultado del buscador) se va a esa sección o a esa duda,
  // que además se abre.
  useEffect(() => {
    if (!id) return
    markSeen(id)
    const target = location.hash ? document.getElementById(location.hash.slice(1)) : null
    if (target instanceof HTMLDetailsElement) target.open = true
    ;(target ?? document.querySelector('.tut-page'))?.scrollIntoView?.({ block: target ? 'center' : 'start' })
  }, [id, location.hash])

  function setStep(next: number) {
    // Conserva el `state` (el «← Volver» a la pantalla de origen).
    setParams(next > 1 ? { paso: String(next) } : {}, { replace: true, state: location.state })
  }

  const titles = Object.fromEntries(CHAPTERS.map((c) => [c.id, copy.chapters[c.id].title]))

  return (
    <ChapterTitles.Provider value={titles}>
    <div className="tut-page">
      <PageHeader title={copy.ui.title} subtitle={copy.ui.subtitle} />
      <div className="tut-layout">
        <aside className="tut-aside">
          <TextInputField
            type="search"
            label={copy.ui.search}
            placeholder={copy.ui.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) setQuery('')
            }}
          />
          <TutorialIndex copy={copy} active={id} />
        </aside>
        <div className="tut-main">
          {query.trim() ? (
            <SearchResults copy={copy} query={query} onPick={() => setQuery('')} />
          ) : id ? (
            <ChapterView key={id} id={id} copy={copy} lang={lang} step={step} onStep={setStep} />
          ) : (
            <Cover copy={copy} last={last} />
          )}
        </div>
      </div>
    </div>
    </ChapterTitles.Provider>
  )
}

function SearchResults({ copy, query, onPick }: { copy: TutorialCopy; query: string; onPick: () => void }) {
  const hits = searchTutorial(copy, query)
  return (
    <section className="tut-chapter tut-results" aria-live="polite">
      <h2 className="tut-sub-h">{hits.length ? copy.ui.results(hits.length) : copy.ui.noResults(query.trim())}</h2>
      <ul>
        {hits.map((h, i) => {
          const Icon = chapterById(h.chapter).icon
          return (
            <li key={`${h.chapter}-${i}`}>
              <Link to={hitPath(h)} onClick={onPick}>
                <Icon size={20} aria-hidden="true" />
                <strong>{h.title}</strong>
                <span>
                  <RichText text={h.text} />
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Portada: la «hero» del tutorial de conductores (para qué es y por dónde
 * empezar) y, debajo, un bloque por grupo con sus capítulos y sus tareas. */
function Cover({ copy, last }: { copy: TutorialCopy; last?: ChapterId }) {
  const seen = readSeen()
  return (
    <>
      <section className="tut-hero">
        <p className="tut-eyebrow">{copy.ui.subtitle}</p>
        <h2>{copy.ui.coverTitle}</h2>
        <p>{copy.ui.coverText}</p>
        <div className="tut-cover-actions">
          <Link to="/ayuda/entrar" className="tut-start">
            {copy.ui.start} <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link to="/ayuda/video" className="tut-resume">
            <CirclePlay size={16} aria-hidden="true" />
            <span>{copy.ui.watchVideo}</span>
          </Link>
          {last && (
            <Link to={`/ayuda/${last}`} className="tut-resume">
              <History size={16} aria-hidden="true" />
              <span>
                <small>{copy.ui.resume}</small> {copy.chapters[last].title}
              </span>
            </Link>
          )}
        </div>
        <p className="tut-callout">
          <CircleHelp size={18} aria-hidden="true" />
          <span>
            <RichText text={copy.ui.headerHint} />
          </span>
        </p>
        <p className="tut-hint">
          {copy.ui.chaptersCount(CHAPTERS.length)}
          {seen.size > 0 && ` · ${copy.ui.progress(seen.size, CHAPTERS.length)}`}
        </p>
      </section>

      {/* Un bloque por grupo del índice; en cada capítulo, sus tareas (la guía
          rápida), cada una directa a su paso del recorrido. */}
      <section className="tut-chapter" aria-labelledby="tut-tasks">
        <h3 className="tut-sub-h tut-sub-h--first" id="tut-tasks">
          {copy.ui.tasksTitle}
        </h3>
        {GROUP_IDS.map((group) => (
          <section className="tut-cover-group" key={group} aria-labelledby={`tut-g-${group}`}>
            <h4 className="tut-index-title" id={`tut-g-${group}`}>
              {copy.groups[group]}
            </h4>
            <div className="tut-cover-grid">
              {CHAPTERS.filter((c) => c.group === group).map((c) => {
                const Icon = c.icon
                const text = copy.chapters[c.id]
                return (
                  <div className="tut-tile" key={c.id}>
                    <Link to={`/ayuda/${c.id}`} className="tut-cover-chapter">
                      <Icon size={18} aria-hidden="true" />
                      <strong>{text.title}</strong>
                      {seen.has(c.id) && <Check size={14} className="tut-index-seen" aria-label={copy.ui.read} />}
                    </Link>
                    {text.quick?.length ? (
                      <ul>
                        {text.quick.map((q) => (
                          <li key={q.label}>
                            <Link to={`/ayuda/${c.id}${q.step > 1 ? `?paso=${q.step}` : ''}`}>{q.label}</Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        <RichText text={text.lead} />
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </section>
    </>
  )
}
