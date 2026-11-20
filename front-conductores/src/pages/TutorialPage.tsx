/**
 * Ayuda (`/ayuda`, `/ayuda/:capitulo`): el tutorial de la app de campo, dentro
 * de la app. Ruta PÚBLICA con su propio shell ligero (sin barra de abajo): se
 * abre también desde el login y sin sesión.
 *
 * La maqueta copia la del «Manual de Flota» (tutoriales/conductores): portada
 * con la marca y el buscador «¿Qué necesitas hacer?» con las tareas en chips;
 * en los capítulos, un índice fijo arriba, antetítulo naranja, pasos
 * numerados y el móvil al lado del texto.
 *
 * Sin capítulo, la portada; con capítulo, ese capítulo (uno cada vez, para que
 * solo se pidan sus capturas). El paso de un recorrido va en `?paso=N`. Con
 * sesión o sin ella, lo de supervisores solo sale a quien supervisa (ni por
 * enlace: lleva a la portada).
 *
 * Plan: docs/PLAN_TUTORIAL_APP_CONDUCTORES.md
 */
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Car, Check, CirclePlay, History, Search, X } from 'lucide-react'
import { LanguageToggleButton } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import type { LayoutContext } from '../components/Layout.tsx'
import { useLang } from '../i18n.tsx'
import { useTutorialCopy, type TutorialCopy } from '../translations/tutorial.ts'
import { ChapterIsland } from '../tutorial/ChapterIsland.tsx'
import { ChapterView } from '../tutorial/ChapterView.tsx'
import {
  CHAPTERS,
  GROUP_IDS,
  chapterById,
  isChapterId,
  isForViewer,
  type Chapter,
  type ChapterId,
  type Viewer,
} from '../tutorial/chapters.ts'
import { markSeen, readLast, readSeen } from '../tutorial/progress.ts'
import { ChapterTitles, chapterHref, RichText } from '../tutorial/RichText.tsx'
import { hitPath, normalize, searchTutorial } from '../tutorial/search.ts'
import logoUrl from '../assets/img/gransolar-logo.png'
import '../tutorial/tutorial.css'

export function TutorialPage() {
  const copy = useTutorialCopy()
  const { language, setLanguage } = useLang()
  const lang = language === 'en' ? 'en' : 'es'
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { capitulo } = useParams()
  // Dentro del shell de la app (con sesión) la cabecera y la barra de abajo
  // son las de siempre: aquí no se pinta la propia.
  const embedded = useOutletContext<LayoutContext | undefined>() != null
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const step = Math.max(1, Number(params.get('paso')) || 1)
  // De dónde se vino (el «?» de la cabecera o el login): «Volver» regresa allí.
  const [from] = useState(() => (location.state as { from?: string } | null)?.from)
  const [last] = useState(readLast)

  const viewer: Viewer | null = user
    ? { driver: user.roles.includes('driver'), supervisor: user.roles.includes('supervisor') }
    : null
  const visible = CHAPTERS.filter((c) => isForViewer(c, viewer)).map((c) => c.id)
  // Lo de supervisores no se abre ni por enlace a quien no supervisa: a la portada.
  const asked = isChapterId(capitulo) ? capitulo : undefined
  const id = asked && visible.includes(asked) ? asked : undefined
  const resume = last && visible.includes(last) ? last : undefined

  useEffect(() => {
    if (asked && !id) navigate('/ayuda', { replace: true })
  }, [asked, id, navigate])

  useEffect(() => {
    if (!id) return
    markSeen(id)
    const target = location.hash ? document.getElementById(location.hash.slice(1)) : null
    if (target instanceof HTMLDetailsElement) target.open = true
    // Con ancla (un resultado del buscador), a ese sitio; sin ella, arriba del
    // todo (con el buscador a la vista, no tapado por la cabecera fija).
    if (target) target.scrollIntoView?.({ block: 'center' })
    else window.scrollTo?.(0, 0)
  }, [id, location.hash])

  function setStep(next: number) {
    setParams(next > 1 ? { paso: String(next) } : {}, { replace: true, state: location.state })
  }

  function goBack() {
    if (id && !from) navigate('/ayuda')
    else navigate(from ?? (user ? '/' : '/login'))
  }

  const titles = Object.fromEntries(CHAPTERS.map((c) => [c.id, copy.chapters[c.id].title]))

  return (
    <ChapterTitles.Provider value={titles}>
      <div className={`tut-shell${embedded ? ' is-embedded' : ''}`}>
        {/* Cabecera e índice, pegados arriba juntos. */}
        <div className="tut-bar">
        {!embedded && (
        <header className="app-header tut-header">
          <button type="button" className="hdr-iconbtn" onClick={goBack} aria-label={id && !from ? copy.ui.backToHelp : copy.ui.backToApp}>
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <div className="hdr-brand">
            <img className="hdr-logo" src={logoUrl} alt="Gransolar" />
            <span className="hdr-sep" aria-hidden="true" />
            <strong className="hdr-title">{copy.ui.title}</strong>
          </div>
          <div className="hdr-tools">
            <LanguageToggleButton activeLanguage={language} onChange={setLanguage} />
          </div>
        </header>
        )}

        {id && <ChapterIsland copy={copy} current={id} visible={visible} />}
        </div>

        <main className="tut-page">
          {id ? (
            // El buscador de un capítulo vive en el desplegable de la isla.
            <ChapterView
              key={id}
              id={id}
              copy={copy}
              lang={lang}
              step={step}
              onStep={setStep}
              visible={visible}
              supervisor={!!viewer?.supervisor}
            />
          ) : (
            <Cover copy={copy} last={resume} visible={visible} query={query} onQuery={setQuery} />
          )}

          <footer className="tut-footer">{copy.ui.footer}</footer>
        </main>
      </div>
    </ChapterTitles.Provider>
  )
}

function SearchBox({ copy, query, onQuery }: { copy: TutorialCopy; query: string; onQuery: (q: string) => void }) {
  return (
    <label className="tut-search">
      <Search size={18} aria-hidden="true" />
      <span className="sr-only">{copy.ui.search}</span>
      <input
        type="search"
        aria-label={copy.ui.search}
        placeholder={copy.ui.searchPlaceholder}
        value={query}
        autoComplete="off"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) onQuery('')
        }}
      />
      {query && (
        <button type="button" onClick={() => onQuery('')} aria-label={copy.ui.clearSearch}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </label>
  )
}

function SearchResults(props: { copy: TutorialCopy; query: string; ids: ChapterId[]; onPick: () => void }) {
  const { copy, query, ids, onPick } = props
  const hits = searchTutorial(copy, query, ids)
  return (
    <section className="tut-results" aria-live="polite">
      <h2 className="tut-sub-h">{hits.length ? copy.ui.results(hits.length) : copy.ui.noResults(query.trim())}</h2>
      <ul>
        {hits.map((h, i) => {
          const Icon = chapterById(h.chapter).icon
          return (
            <li key={`${h.chapter}-${i}`}>
              <Link to={hitPath(h)} onClick={onPick}>
                <Icon size={18} aria-hidden="true" />
                <span>
                  <strong>{h.title}</strong>
                  <span>
                    <RichText text={h.text} />
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

interface Task {
  chapter: Chapter
  label: string
  step: number
}

/** Portada, como la cabecera del manual: marca, para qué es, el buscador con
 * las tareas frecuentes en chips (se filtran al escribir), el vídeo o seguir
 * donde se dejó, y el índice por grupos. */
function Cover(props: { copy: TutorialCopy; last?: ChapterId; visible: ChapterId[]; query: string; onQuery: (q: string) => void }) {
  const { copy, last, visible, query, onQuery } = props
  const seen = readSeen()
  const chapters = CHAPTERS.filter((c) => visible.includes(c.id))
  const tasks: Task[] = chapters.flatMap((c) =>
    (copy.chapters[c.id].quick ?? []).slice(0, 2).map((q) => ({ chapter: c, label: q.label, step: q.step })),
  )
  const read = chapters.filter((c) => seen.has(c.id)).length
  const q = normalize(query.trim())
  const shown = q ? tasks.filter((t) => normalize(`${t.label} ${copy.chapters[t.chapter.id].title}`).includes(q)) : tasks

  return (
    <>
      <header className="tut-top">
        <div className="tut-brand">
          <span className="tut-logo" aria-hidden="true">
            <Car size={24} />
          </span>
          <div>
            <small>{copy.ui.coverEyebrow}</small>
            <h1>{copy.ui.coverTitle}</h1>
          </div>
        </div>
        <p className="tut-lead">{copy.ui.coverText}</p>

        <div className="tut-finder">
          <span className="tut-finder-label" aria-hidden="true">
            {copy.ui.finderLabel}
          </span>
          <SearchBox copy={copy} query={query} onQuery={onQuery} />
          {shown.length > 0 && (
            <ul className="tut-chips" aria-label={copy.ui.tasksTitle}>
              {shown.map((task) => {
                const Icon = task.chapter.icon
                return (
                  <li key={`${task.chapter.id}-${task.step}`}>
                    <Link to={chapterHref(task.chapter.id, task.step)} className="tut-chip">
                      <Icon size={16} aria-hidden="true" />
                      <span>{task.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </header>

      {q ? (
        <SearchResults copy={copy} query={query} ids={visible} onPick={() => onQuery('')} />
      ) : (
        <>
          <div className="tut-cover-actions">
            <Link to="/ayuda/video" className="tut-start">
              <CirclePlay size={18} aria-hidden="true" /> {copy.ui.watchVideo}
            </Link>
            {last ? (
              <Link to={chapterHref(last)} className="tut-resume">
                <History size={18} aria-hidden="true" />
                <span>
                  <small>{copy.ui.resume}</small> {copy.chapters[last].title}
                </span>
              </Link>
            ) : (
              <Link to="/ayuda/entrar" className="tut-resume">
                <ArrowRight size={18} aria-hidden="true" />
                <span>{copy.ui.start}</span>
              </Link>
            )}
          </div>
          {read > 0 && <p className="tut-hint">{copy.ui.progress(read, chapters.length)}</p>}

          <nav className="tut-index" aria-label={copy.ui.indexLabel}>
            {GROUP_IDS.map((group) => {
              const list = chapters.filter((c) => c.group === group)
              if (!list.length) return null
              return (
                <section key={group} aria-labelledby={`tut-g-${group}`}>
                  <h2 className="tut-eyebrow" id={`tut-g-${group}`}>
                    {copy.groups[group]}
                  </h2>
                  <ul>
                    {list.map((c) => {
                      const Icon = c.icon
                      return (
                        <li key={c.id}>
                          <Link to={chapterHref(c.id)} className="tut-index-link">
                            <Icon size={18} aria-hidden="true" />
                            <span>{copy.chapters[c.id].title}</span>
                            {seen.has(c.id) && <Check size={16} className="tut-index-seen" aria-label={copy.ui.read} />}
                            <ArrowRight size={16} className="tut-index-go" aria-hidden="true" />
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </nav>
        </>
      )}
    </>
  )
}
