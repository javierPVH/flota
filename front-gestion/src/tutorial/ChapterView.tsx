import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ChevronDown, Download, ExternalLink, Info } from 'lucide-react'
import { Button } from '@flota/ui/ui'

import type { TutorialCopy } from '../translations/tutorial.ts'
import { CHAPTERS, chapterById, neighbours, type ChapterId } from './chapters.ts'
import { IntroVideo } from './IntroVideo.tsx'
import { faqAnchor, sectionAnchor } from './search.ts'
import { Shot } from './Shot.tsx'
import type { ShotLang } from './shots.ts'
import { RichText } from './RichText.tsx'
import { Walk } from './Walk.tsx'

interface ChapterViewProps {
  id: ChapterId
  copy: TutorialCopy
  lang: ShotLang
  /** Pestaña del recorrido (`?paso=N`), desde 1. */
  step: number
  onStep: (step: number) => void
}

/** Una duda: caja plegable con la flecha a la derecha (como en el tutorial
 * de conductores). */
function Faq({ id, q, a }: { id?: string; q: string; a: string }) {
  return (
    <details className="tut-faq" id={id}>
      <summary>
        {q}
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div>
        <RichText text={a} />
      </div>
    </details>
  )
}

/** Un capítulo, en UNA tarjeta (la misma forma que el tutorial de conductores):
 * cabecera, «Abrir esta pantalla», guía rápida, recorrido, secciones, dudas y
 * el paso al capítulo anterior / siguiente. */
export function ChapterView({ id, copy, lang, step, onStep }: ChapterViewProps) {
  const navigate = useNavigate()
  // Venir del botón «?» de la cabecera: se puede volver a la pantalla.
  const from = (useLocation().state as { from?: string } | null)?.from
  const chapter = chapterById(id)
  const text = copy.chapters[id]
  const ui = copy.ui
  const Icon = chapter.icon
  const { prev, next } = neighbours(id)
  const empty = !chapter.video && !text.sections?.length && !text.walk?.length && !text.faq?.length
  // En «Preguntas frecuentes» se juntan también las dudas de cada capítulo.
  const otherFaqs =
    id === 'preguntas' ? CHAPTERS.filter((c) => c.id !== id && copy.chapters[c.id].faq?.length) : []

  function pickQuick(target: number) {
    onStep(target)
    // La guía puede quedar lejos del recorrido en pantallas estrechas.
    document.getElementById(`tut-${id}-panel`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }

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
    <>
      {from && (
        <Link to={from} className="tut-back">
          <ArrowLeft size={14} aria-hidden="true" /> {ui.backToScreen}
        </Link>
      )}
      <article className="tut-chapter" aria-labelledby="tut-chapter-title">
        <header className="tut-ch-head">
          <span className="tut-ch-icon" aria-hidden="true">
            <Icon size={24} />
          </span>
          <div className="tut-ch-titles">
            <p className="tut-eyebrow">{copy.groups[chapter.group]}</p>
            <h2 id="tut-chapter-title">{text.title}</h2>
            <p className="tut-ch-sub">
              <RichText text={text.lead} />
            </p>
          </div>
          <div className="tut-ch-side">
            {chapter.audience && (
              <span className={`tut-badge ${chapter.audience === 'superuser' ? 'is-danger' : 'is-info'}`}>
                {copy.audience[chapter.audience]}
              </span>
            )}
            {chapter.route && (
              <Button variant="primary" size="sm" onClick={() => navigate(chapter.route!)}>
                <ExternalLink size={14} aria-hidden="true" /> {ui.openScreen}
              </Button>
            )}
          </div>
        </header>

        {empty && (
          <p className="tut-callout">
            <Info size={18} aria-hidden="true" />
            <span>{ui.pending}</span>
          </p>
        )}

        {chapter.video && <IntroVideo copy={copy} lang={lang} />}

        {text.quick && text.walk && (
          <nav aria-label={ui.quickTitle}>
            <h3 className="tut-sub-h">{ui.quickTitle}</h3>
            <ul className="tut-quick">
              {text.quick.map((q) => (
                <li key={q.label}>
                  <button
                    type="button"
                    className={`tut-quick-item${q.step === step ? ' is-active' : ''}`}
                    onClick={() => pickQuick(q.step)}
                  >
                    <Icon size={20} aria-hidden="true" />
                    <b>{q.label}</b>
                    <span>
                      {q.step} · {text.walk![q.step - 1]?.tab}
                    </span>
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
            end={
              next && (
                <Link to={`/ayuda/${next}`} className="tut-walk-end">
                  <span>
                    <small>{ui.nextChapter}</small> {copy.chapters[next].title}
                  </span>
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              )
            }
          />
        )}

        {text.sections?.map((s, i) => (
          // Cada sección: su título, los pasos a la izquierda y la captura a
          // la derecha (se amplía al pulsarla).
          <section className="tut-section" key={s.title} aria-labelledby={sectionAnchor(i)}>
            <h3 className="tut-sub-h" id={sectionAnchor(i)}>
              {s.title}
            </h3>
            <div className={`tut-split${s.shot ? '' : ' tut-split--text'}`}>
              <div>
                <ol className="tut-steps">
                  {s.steps.map((line) => (
                    <li key={line}>
                      <RichText text={line} />
                    </li>
                  ))}
                </ol>
                {s.note && (
                  <p className="tut-callout">
                    <Info size={18} aria-hidden="true" />
                    <span>
                      <RichText text={s.note} />
                    </span>
                  </p>
                )}
              </div>
              {s.shot && shot(s.shot)}
            </div>
          </section>
        ))}

        {!!text.downloads?.length && (
          <section className="tut-section" aria-labelledby="tut-downloads">
            <h3 className="tut-sub-h" id="tut-downloads">
              {ui.downloadsTitle}
            </h3>
            <ul className="tut-downloads">
              {text.downloads.map((d) => (
                <li key={d.file}>
                  <a href={`${import.meta.env.BASE_URL}tutorial/ejemplos/${d.file}`} download={d.file}>
                    <Download size={20} aria-hidden="true" />
                    <b>{d.label}</b>
                    <span>{d.file}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!!text.faq?.length && (
          <section className="tut-section" aria-labelledby="tut-faq">
            <h3 className="tut-sub-h" id="tut-faq">
              {ui.faqTitle}
            </h3>
            {text.faq.map((f, i) => (
              <Faq key={f.q} id={faqAnchor(i)} q={f.q} a={f.a} />
            ))}
          </section>
        )}

        {otherFaqs.length > 0 && (
          <section className="tut-section" aria-labelledby="tut-faq-more">
            <h3 className="tut-sub-h" id="tut-faq-more">
              {ui.moreFaq}
            </h3>
            {otherFaqs.map((c) => (
              <div className="tut-faq-group" key={c.id}>
                <h4>
                  <Link to={`/ayuda/${c.id}`}>{copy.chapters[c.id].title}</Link>
                </h4>
                {copy.chapters[c.id].faq!.map((f) => (
                  <Faq key={f.q} q={f.q} a={f.a} />
                ))}
              </div>
            ))}
          </section>
        )}
      </article>

      <nav className="tut-pager" aria-label={ui.pagerLabel}>
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
    </>
  )
}
