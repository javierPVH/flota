import { useEffect, useRef, type KeyboardEvent, type ReactNode, type TouchEvent } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'

import type { TutorialWalkStep } from '../translations/tutorial.ts'
import { RichText } from './RichText.tsx'

interface WalkProps {
  id: string
  label: string
  steps: TutorialWalkStep[]
  /** Paso activo, desde 1 (el `?paso=N`). */
  active: number
  onChange: (step: number) => void
  stepOf: (i: number, n: number) => string
  backLabel: string
  nextLabel: string
  /** El texto del paso (sin capturas). */
  renderText: (step: TutorialWalkStep) => ReactNode
  /** Las capturas del paso, en su marco de móvil (o nada). */
  renderPhone: (step: TutorialWalkStep) => ReactNode
  /** Lo que sale en vez de «Continuar» en el último paso (el capítulo siguiente). */
  end?: ReactNode
}

/** Distancia mínima (px) de un deslizamiento horizontal para cambiar de paso. */
const SWIPE = 60

/** «Paso 3 · «Implicados»» → «Implicados»: el paso ya lo dice la pestaña. */
const bare = (title: string) => title.replace(/^(Paso|Step) \d+ · /, '')

interface Group {
  label: string
  /** Pasos del grupo (índices desde 1). */
  steps: number[]
}

/** Las pestañas: los pasos seguidos con el mismo prefijo («Subir · Tipo»,
 * «Subir · Notas»…) van juntos en una («Subir»), con sus subpasos dentro. */
function groupSteps(steps: TutorialWalkStep[]): Group[] {
  const groups: Group[] = []
  steps.forEach((s, i) => {
    const label = s.tab.split(' · ')[0]
    const last = groups[groups.length - 1]
    if (last && last.label === label && s.tab.includes(' · ')) last.steps.push(i + 1)
    else groups.push({ label, steps: [i + 1] })
  })
  return groups
}

/**
 * Recorrido por pestañas: una tira de pestañas numeradas arriba (las hechas,
 * con ✓) y, debajo, una tarjeta con el paso: el texto y, al lado (o debajo en
 * un móvil), el móvil con su captura. Abajo, «‹ Atrás · Paso N de M ·
 * Continuar ›». En el móvil se cambia de paso deslizando la tarjeta; con
 * teclado, las flechas (patrón WAI-ARIA de pestañas).
 */
export function Walk(props: WalkProps) {
  const { id, label, steps, active, onChange, stepOf, backLabel, nextLabel, renderText, renderPhone, end } = props
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const strip = useRef<HTMLDivElement>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const n = steps.length
  const index = Math.min(Math.max(active, 1), n)
  const current = steps[index - 1]
  const groups = groupSteps(steps)
  const g = groups.findIndex((gr) => gr.steps.includes(index))
  const group = groups[g]

  // La pestaña activa, a la vista en la tira (solo se desplaza la tira).
  useEffect(() => {
    const tab = tabs.current[g]
    const box = strip.current
    if (!tab || !box) return
    const left = tab.offsetLeft - (box.clientWidth - tab.offsetWidth) / 2
    box.scrollTo?.({ left: Math.max(0, left), behavior: 'smooth' })
  }, [g])

  function go(step: number) {
    onChange(Math.min(Math.max(step, 1), n))
  }

  function goGroup(to: number, focus = false) {
    const target = Math.min(Math.max(to, 0), groups.length - 1)
    go(groups[target].steps[0])
    if (focus) tabs.current[target]?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = { ArrowRight: g + 1, ArrowLeft: g - 1, Home: 0, End: groups.length - 1 }
    const to = moves[event.key]
    if (to === undefined) return
    event.preventDefault()
    goGroup(to, true)
  }

  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0]
    touch.current = t ? { x: t.clientX, y: t.clientY } : null
  }

  function onTouchEnd(e: TouchEvent) {
    const start = touch.current
    const t = e.changedTouches[0]
    touch.current = null
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    // Solo un gesto claramente horizontal: el vertical es desplazar la página.
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return
    go(dx < 0 ? index + 1 : index - 1)
  }

  const phone = renderPhone(current)

  return (
    <section className="tut-walk" aria-label={label}>
      <div ref={strip} className="tut-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {groups.map((gr, i) => {
          const selected = i === g
          const done = i < g
          return (
            <button
              key={gr.label}
              ref={(el) => {
                tabs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${gr.steps[0]}`}
              aria-controls={`${id}-panel`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className={done ? 'is-done' : undefined}
              onClick={() => go(gr.steps[0])}
            >
              <span className="tut-tab-num" aria-hidden="true">
                {done ? <Check size={12} strokeWidth={3} /> : i + 1}
              </span>
              {gr.label}
            </button>
          )
        })}
      </div>

      <div
        className={`tut-tabpanel${phone ? ' has-phone' : ''}`}
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${group.steps[0]}`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="tut-tabpanel-text">
          {group.steps.length > 1 && (
            <ol className="tut-substeps">
              {group.steps.map((s, i) => (
                <li key={s}>
                  <button
                    type="button"
                    aria-pressed={s === index}
                    className={s < index ? 'is-done' : undefined}
                    onClick={() => go(s)}
                  >
                    <span aria-hidden="true">{i + 1}</span>
                    {steps[s - 1].tab.split(' · ').slice(1).join(' · ')}
                  </button>
                </li>
              ))}
            </ol>
          )}
          <h3 className="tut-panel-h">
            <RichText text={bare(current.title)} />
          </h3>
          {renderText(current)}
        </div>
        {phone && <div className="tut-tabpanel-phone">{phone}</div>}
        <div className="tut-walk-nav">
          <button type="button" disabled={index === 1} onClick={() => go(index - 1)} aria-label={backLabel}>
            <ChevronLeft size={18} aria-hidden="true" />
            <span>{backLabel}</span>
          </button>
          <span
            className="tut-walk-mid"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={n}
            aria-valuenow={index}
            aria-valuetext={stepOf(index, n)}
          >
            {stepOf(index, n)}
          </span>
          {index === n && end ? (
            end
          ) : (
            <button type="button" className="is-primary" disabled={index === n} onClick={() => go(index + 1)}>
              <span>{nextLabel}</span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
