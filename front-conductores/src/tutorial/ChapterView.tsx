import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ArrowRight, ChevronDown, Info } from 'lucide-react'

import type { Block, ChapterCopy, TutorialCopy, TutorialSection } from '../translations/tutorial.ts'
import { CHAPTERS, chapterById, neighbours, type ChapterId } from './chapters.ts'
import { IntroVideo } from './IntroVideo.tsx'
import { chapterHref, RichText } from './RichText.tsx'
import { faqAnchor, introAnchor, sectionAnchor } from './search.ts'
import { Gallery } from './Shot.tsx'
import type { ShotLang } from './shots.ts'
import { Walk } from './Walk.tsx'

interface ChapterViewProps {
  id: ChapterId
  copy: TutorialCopy
  lang: ShotLang
  /** Paso del recorrido (`?paso=N`), desde 1. */
  step: number
  onStep: (step: number) => void
  /** Capítulos que se ven (para el anterior / siguiente). */
  visible: ChapterId[]
  /** Quien mira supervisa: ve las secciones «de supervisor» (en pestañas). */
  supervisor: boolean
}

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

/** Nota del manual: fondo de color, icono y texto (azul = info, ámbar = aviso). */
function Note({ kind, text }: { kind: 'info' | 'warn'; text: string }) {
  const Icon = kind === 'warn' ? AlertTriangle : Info
  return (
    <p className={`tut-note is-${kind}`}>
      <Icon size={16} aria-hidden="true" />
      <span>
        <RichText text={text} />
      </span>
    </p>
  )
}

/** «Incidencia › Disponibilidad › Documentos»: un recorrido de pestañas. */
const isFlow = (text: string) => text.includes(' › ') && !/[«“*[]/.test(text)

/** El texto de un bloque: aviso, pasos numerados, tabla «campo → qué poner» y
 * nota. Las capturas van aparte (`BlockPhone`): en pantalla ancha, al lado. */
function BlockText({ block }: { block: Block }) {
  return (
    <>
      {block.warn && <Note kind="warn" text={block.warn} />}
      {!!block.steps?.length && (
        <ol className={`tut-steps${block.steps.length === 1 ? ' is-single' : ''}`}>
          {block.steps.map((line) => (
            <li key={line}>
              <RichText text={line} />
            </li>
          ))}
        </ol>
      )}
      {!!block.defs?.length && block.defs.every((d) => isFlow(d.text)) && (
        <div className="tut-flows">
          {block.defs.map((d) => (
            <div key={d.term} className="tut-flow">
              <strong>{d.term}</strong>
              <ol>
                {d.text.split(' › ').map((part, k) => (
                  <li key={part}>
                    <span className="tut-flow-n" aria-hidden="true">
                      {k + 1}
                    </span>
                    {part}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      {!!block.defs?.length && !block.defs.every((d) => isFlow(d.text)) && (
        <div className="tut-tablebox">
          <table className="tut-ref">
            <tbody>
              {block.defs.map((d) => (
                <tr key={d.term}>
                  <th scope="row">{d.term}</th>
                  <td>
                    <RichText text={d.text} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {block.note && <Note kind="info" text={block.note} />}
    </>
  )
}

/** Las capturas de un bloque, en el marco de móvil (o nada si no tiene). */
function BlockPhone({ block, text, copy, lang }: { block: Block; text: ChapterCopy; copy: TutorialCopy; lang: ShotLang }) {
  if (!block.shots?.length) return null
  return (
    <Gallery
      shots={block.shots}
      labels={block.shotLabels}
      alts={text.shots ?? {}}
      lang={lang}
      pendingLabel={copy.ui.shotPending}
      zoomLabel={copy.ui.zoom}
    />
  )
}

/** Secciones con la maqueta del manual: texto a la izquierda y el móvil a la
 * derecha (en un móvil, el móvil debajo del texto). */
function Section(props: { s: TutorialSection; id: string; text: ChapterCopy; copy: TutorialCopy; lang: ShotLang; bare?: boolean }) {
  const { s, id, text, copy, lang, bare } = props
  const phone = !!s.shots?.length
  return (
    <section className={`tut-sec${phone ? ' has-phone' : ''}${bare ? ' is-bare' : ''}`} aria-labelledby={id}>
      <div className="tut-sec-text">
        <h3 className="tut-sub-h" id={id}>
          {s.title}
        </h3>
        <BlockText block={s} />
      </div>
      {phone && (
        <div className="tut-phone-col">
          <BlockPhone block={s} text={text} copy={copy} lang={lang} />
        </div>
      )}
    </section>
  )
}

/** Las secciones con público (conductor / supervisor) en pestañas. */
function AudienceTabs(props: { items: Array<{ s: TutorialSection; i: number }>; anchor: (i: number) => string; text: ChapterCopy; copy: TutorialCopy; lang: ShotLang }) {
  const { items, anchor, text, copy, lang } = props
  const [on, setOn] = useState(0)
  const current = items[Math.min(on, items.length - 1)]
  return (
    <div className="tut-sec tut-audience">
      <div className="tut-tabs" role="tablist" aria-label={text.title}>
        {items.map(({ s }, k) => (
          <button
            key={s.title}
            type="button"
            role="tab"
            id={`tut-aud-${k}`}
            aria-controls="tut-aud-panel"
            aria-selected={k === on}
            tabIndex={k === on ? 0 : -1}
            onClick={() => setOn(k)}
          >
            {s.tab ?? s.title}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="tut-aud-panel" aria-labelledby={`tut-aud-${on}`}>
        <Section s={current.s} id={anchor(current.i)} text={text} copy={copy} lang={lang} bare />
      </div>
    </div>
  )
}

/** Secciones con la maqueta del manual: texto a la izquierda y el móvil a la
 * derecha (en un móvil, el móvil debajo del texto). Las que tienen público:
 * a quien supervisa, en pestañas; a los demás, solo la del conductor. */
function Sections(props: { list?: TutorialSection[]; anchor: (i: number) => string; text: ChapterCopy; copy: TutorialCopy; lang: ShotLang; supervisor: boolean }) {
  const { list, anchor, text, copy, lang, supervisor } = props
  if (!list) return null
  const out: ReactNode[] = []
  let tabbed: Array<{ s: TutorialSection; i: number }> = []
  const flush = () => {
    if (tabbed.length) out.push(<AudienceTabs key={`aud-${tabbed[0].i}`} items={tabbed} anchor={anchor} text={text} copy={copy} lang={lang} />)
    tabbed = []
  }
  list.forEach((s, i) => {
    if (s.audience && supervisor) {
      tabbed.push({ s, i })
      return
    }
    flush()
    if (s.audience === 'supervisor') return
    out.push(<Section key={s.title} s={s} id={anchor(i)} text={text} copy={copy} lang={lang} />)
  })
  flush()
  return <>{out}</>
}

/** Un capítulo: antetítulo y título, avisos previos, guía rápida, recorrido,
 * secciones, dudas y el paso al capítulo anterior / siguiente. */
export function ChapterView({ id, copy, lang, step, onStep, visible, supervisor }: ChapterViewProps) {
  const chapter = chapterById(id)
  const text = copy.chapters[id]
  const ui = copy.ui
  const { prev, next } = neighbours(id, visible)
  const otherFaqs =
    id === 'preguntas' ? CHAPTERS.filter((c) => c.id !== id && visible.includes(c.id) && copy.chapters[c.id].faq?.length) : []

  function pickQuick(target: number) {
    onStep(target)
    document.getElementById(`tut-${id}-panel`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }

  return (
    <>
      <article className="tut-chapter" aria-labelledby="tut-chapter-title">
        <header className="tut-ch-head">
          <p className="tut-eyebrow">
            {copy.groups[chapter.group]}
            {chapter.audience === 'supervisor' && <span className="tut-badge">{copy.audience.supervisor}</span>}
          </p>
          <h2 id="tut-chapter-title">{text.title}</h2>
          <p className="tut-lead">
            <RichText text={text.lead} />
          </p>
        </header>

        {chapter.video && <IntroVideo copy={copy} lang={lang} />}

        <Sections list={text.intro} anchor={introAnchor} text={text} copy={copy} lang={lang} supervisor={supervisor} />

        {text.quick && text.walk && (
          <nav aria-label={ui.quickTitle} className="tut-quick-box">
            <h3 className="tut-sub-h">{ui.quickTitle}</h3>
            <ul className="tut-quick">
              {text.quick.map((q) => (
                <li key={q.label}>
                  <button
                    type="button"
                    className={`tut-quick-item${q.step === step ? ' is-active' : ''}`}
                    onClick={() => pickQuick(q.step)}
                  >
                    <strong>{q.label}</strong>
                    {/* A qué pestaña lleva (fuera del nombre accesible: es una pista). */}
                    <small aria-hidden="true">
                      <ArrowRight size={12} /> {text.walk?.[q.step - 1]?.tab.split(' · ')[0]}
                    </small>
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
            backLabel={ui.prev}
            nextLabel={ui.next}
            renderText={(s) => <BlockText block={s} />}
            renderPhone={(s) => <BlockPhone block={s} text={text} copy={copy} lang={lang} />}
            end={
              next && (
                <Link to={chapterHref(next)} className="tut-walk-end">
                  <span>{copy.chapters[next].title}</span>
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              )
            }
          />
        )}

        <Sections list={text.sections} anchor={sectionAnchor} text={text} copy={copy} lang={lang} supervisor={supervisor} />

        {!!text.faq?.length && (
          <section className="tut-faqs" aria-labelledby="tut-faq">
            <h3 className="tut-sub-h" id="tut-faq">
              {ui.faqTitle}
            </h3>
            {text.faq.map((f, i) => (
              <Faq key={f.q} id={faqAnchor(i)} q={f.q} a={f.a} />
            ))}
          </section>
        )}

        {otherFaqs.length > 0 && (
          <section className="tut-faqs" aria-labelledby="tut-faq-more">
            <h3 className="tut-sub-h" id="tut-faq-more">
              {ui.moreFaq}
            </h3>
            {otherFaqs.map((c) => (
              <div className="tut-faq-group" key={c.id}>
                <h4>
                  <Link to={chapterHref(c.id)}>{copy.chapters[c.id].title}</Link>
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
          <Link to={chapterHref(prev)} className="tut-pager-link">
            <ArrowLeft size={16} aria-hidden="true" />
            <span>
              <small>{ui.prevChapter}</small> {copy.chapters[prev].title}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link to={chapterHref(next)} className="tut-pager-link tut-pager-next">
            <span>
              <small>{ui.nextChapter}</small> {copy.chapters[next].title}
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        )}
      </nav>
    </>
  )
}
