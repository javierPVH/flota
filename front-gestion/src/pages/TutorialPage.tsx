/**
 * Ayuda (`/ayuda`, `/ayuda/:capitulo`): el tutorial de la app de gestión.
 *
 * Portada sin capítulo; con capítulo, ese capítulo (uno cada vez, para que
 * solo se pidan sus capturas). La pestaña de un recorrido va en `?paso=N`,
 * así un enlace lleva al paso exacto. El buscador recorre la copia de todos
 * los capítulos.
 *
 * Plan: tutoriales/administradores/PLAN_VISTA_TUTORIAL.md
 */
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { PageHeader, TextInputField } from '@flota/ui/ui'
import { useAppLang } from '@flota/ui/i18n'

import { useTutorialCopy, type TutorialCopy } from '../translations/tutorial.ts'
import { ChapterView } from '../tutorial/ChapterView.tsx'
import { CHAPTERS, GROUP_IDS, isChapterId } from '../tutorial/chapters.ts'
import { searchTutorial } from '../tutorial/search.ts'
import { TutorialIndex } from '../tutorial/TutorialIndex.tsx'
import '../tutorial/tutorial.css'

export function TutorialPage() {
  const copy = useTutorialCopy()
  const lang = useAppLang()
  const { capitulo } = useParams()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const id = isChapterId(capitulo) ? capitulo : undefined
  const step = Math.max(1, Number(params.get('paso')) || 1)

  function setStep(next: number) {
    setParams(next > 1 ? { paso: String(next) } : {}, { replace: true })
  }

  return (
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
          />
          <TutorialIndex copy={copy} active={id} />
        </aside>
        <div className="tut-main">
          {query.trim() ? (
            <SearchResults copy={copy} query={query} onPick={() => setQuery('')} />
          ) : id ? (
            <ChapterView key={id} id={id} copy={copy} lang={lang} step={step} onStep={setStep} />
          ) : (
            <Cover copy={copy} />
          )}
        </div>
      </div>
    </div>
  )
}

function SearchResults({ copy, query, onPick }: { copy: TutorialCopy; query: string; onPick: () => void }) {
  const hits = searchTutorial(copy, query)
  return (
    <section className="tut-results" aria-live="polite">
      <p className="tut-walk-count">{hits.length ? copy.ui.results(hits.length) : copy.ui.noResults(query.trim())}</p>
      <ul>
        {hits.map((h, i) => (
          <li key={`${h.chapter}-${i}`}>
            <Link to={`/ayuda/${h.chapter}${h.step && h.step > 1 ? `?paso=${h.step}` : ''}`} onClick={onPick}>
              <strong>{h.title}</strong>
              <span>{h.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Cover({ copy }: { copy: TutorialCopy }) {
  return (
    <section className="tut-cover">
      <h2>{copy.ui.coverTitle}</h2>
      <p className="tut-lead">{copy.ui.coverText}</p>
      <div className="tut-cover-grid">
        {GROUP_IDS.map((group) => {
          const chapters = CHAPTERS.filter((c) => c.group === group)
          const first = chapters[0]
          const Icon = first.icon
          return (
            <Link key={group} to={`/ayuda/${first.id}`} className="tut-cover-card">
              <Icon size={20} aria-hidden="true" />
              <strong>{copy.groups[group]}</strong>
              <span>{chapters.map((c) => copy.chapters[c.id].title).join(' · ')}</span>
              {group === 'start' && <em className="tut-cover-start">{copy.ui.startHere}</em>}
            </Link>
          )
        })}
      </div>
      <p className="tut-walk-count">{copy.ui.chaptersCount(CHAPTERS.length)}</p>
    </section>
  )
}
