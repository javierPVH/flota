import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react'
import { Badge, Button } from '@flota/ui/ui'

import type { TutorialCopy } from '../translations/tutorial.ts'
import { chapterById, neighbours, type ChapterId } from './chapters.ts'
import { Shot } from './Shot.tsx'
import type { ShotLang } from './shots.ts'
import { Walk } from './Walk.tsx'

interface ChapterViewProps {
  id: ChapterId
  copy: TutorialCopy
  lang: ShotLang
  /** Pestaña del recorrido (`?paso=N`), desde 1. */
  step: number
  onStep: (step: number) => void
}

/** Un capítulo: cabecera, «Abrir esta pantalla», guía rápida, recorrido,
 * secciones, dudas y el paso al capítulo anterior / siguiente. */
export function ChapterView({ id, copy, lang, step, onStep }: ChapterViewProps) {
  const navigate = useNavigate()
  const chapter = chapterById(id)
  const text = copy.chapters[id]
  const ui = copy.ui
  const Icon = chapter.icon
  const { prev, next } = neighbours(id)
  const empty = !text.sections?.length && !text.walk?.length && !text.faq?.length

  const shot = (name: string) => (
    <Shot
      key={name}
      name={name}
      alt={text.shots?.[name] ?? name}
      lang={lang}
      pendingLabel={ui.shotPending}
      zoomLabel={ui.zoom}
    />
  )

  return (
    <article className="tut-chapter" aria-labelledby="tut-chapter-title">
      <header className="tut-chapter-head">
        <span className="tut-chapter-icon" aria-hidden="true">
          <Icon size={22} />
        </span>
        <div>
          <p className="tut-eyebrow">{copy.groups[chapter.group]}</p>
          <h2 id="tut-chapter-title">{text.title}</h2>
          <p className="tut-lead">{text.lead}</p>
          {chapter.audience && (
            <Badge tone={chapter.audience === 'superuser' ? 'danger' : 'info'} size="sm">
              {copy.audience[chapter.audience]}
            </Badge>
          )}
        </div>
        {chapter.route && (
          <Button variant="outline" size="sm" onClick={() => navigate(chapter.route!)}>
            <ExternalLink size={14} aria-hidden="true" /> {ui.openScreen}
          </Button>
        )}
      </header>

      {empty && <p className="tut-pending">{ui.pending}</p>}

      {text.quick && text.walk && (
        <nav className="tut-quick" aria-label={ui.quickTitle}>
          <h3>{ui.quickTitle}</h3>
          <ul>
            {text.quick.map((q) => (
              <li key={q.label}>
                <button
                  type="button"
                  className={`tut-quick-item${q.step === step ? ' is-active' : ''}`}
                  onClick={() => onStep(q.step)}
                >
                  {q.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {text.walk && (
        <Walk
          id={`tut-${id}`}
          label={ui.walkLabel}
          steps={text.walk}
          active={step}
          onChange={onStep}
          stepOf={ui.stepOf}
          backLabel={ui.back}
          nextLabel={ui.next}
          renderShot={shot}
        />
      )}

      {text.sections?.map((s, i) => (
        <section className="tut-section" key={s.title} aria-labelledby={`tut-s-${i}`}>
          <h3 id={`tut-s-${i}`}>{s.title}</h3>
          <ol className="tut-steps">
            {s.steps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          {s.note && <p className="tut-note">{s.note}</p>}
          {s.shot && shot(s.shot)}
        </section>
      ))}

      {!!text.faq?.length && (
        <section className="tut-section" aria-labelledby="tut-faq">
          <h3 id="tut-faq">{ui.faqTitle}</h3>
          {text.faq.map((f) => (
            <details className="tut-faq" key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </section>
      )}

      <nav className="tut-pager" aria-label={copy.ui.indexLabel}>
        {prev ? (
          <Link to={`/ayuda/${prev}`} className="tut-pager-link">
            <ArrowLeft size={14} aria-hidden="true" />
            <span>
              <small>{ui.prevChapter}</small> {copy.chapters[prev].title}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link to={`/ayuda/${next}`} className="tut-pager-link tut-pager-next">
            <span>
              <small>{ui.nextChapter}</small> {copy.chapters[next].title}
            </span>
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </nav>
    </article>
  )
}
