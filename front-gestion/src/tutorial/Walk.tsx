import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'

import type { TutorialWalkStep } from '../translations/tutorial.ts'
import { RichText } from './RichText.tsx'

interface WalkProps {
  id: string
  label: string
  steps: TutorialWalkStep[]
  /** Pestaña activa, desde 1. */
  active: number
  onChange: (step: number) => void
  stepOf: (i: number, n: number) => string
  backLabel: string
  nextLabel: string
  renderShot: (name: string) => ReactNode
  /** Lo que sale en vez de «Continuar» en el último paso (el capítulo siguiente). */
  end?: ReactNode
}

/** Recorrido por pestañas, con la forma del tutorial de conductores: una caja
 * con las pestañas arriba («1 · Buscar»; las ya pasadas, en verde), el paso
 * dentro y un pie con «‹ Atrás», por dónde vas y «Continuar ›». Flechas del
 * teclado según el patrón WAI-ARIA de pestañas. */
export function Walk({ id, label, steps, active, onChange, stepOf, backLabel, nextLabel, renderShot, end }: WalkProps) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const n = steps.length
  const current = steps[active - 1] ?? steps[0]
  const index = steps.indexOf(current) + 1

  function go(step: number, focus = false) {
    const target = Math.min(Math.max(step, 1), n)
    onChange(target)
    if (focus) tabs.current[target - 1]?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 1,
      End: n,
    }
    const to = moves[event.key]
    if (to === undefined) return
    event.preventDefault()
    go(to, true)
  }

  return (
    <section className="tut-walk" aria-label={label}>
      <div className="tut-walk-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {steps.map((s, i) => {
          const selected = index === i + 1
          const done = i + 1 < index
          return (
            <button
              key={s.tab}
              ref={(el) => {
                tabs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${i + 1}`}
              aria-controls={`${id}-panel`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className={done ? 'is-done' : undefined}
              onClick={() => go(i + 1)}
            >
              {done ? <Check size={14} aria-hidden="true" /> : <span aria-hidden="true">{i + 1} ·</span>} {s.tab}
            </button>
          )
        })}
      </div>
      <div className="tut-walk-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${index}`}>
        <div className={`tut-split${current.shot ? '' : ' tut-split--text'}`}>
          <div>
            <h3 className="tut-panel-h">{current.title}</h3>
            <ol className="tut-steps">
              {current.steps.map((step) => (
                <li key={step}>
                  <RichText text={step} />
                </li>
              ))}
            </ol>
          </div>
          {current.shot && renderShot(current.shot)}
        </div>
      </div>
      <div className="tut-walk-nav">
        <button type="button" disabled={index === 1} onClick={() => go(index - 1)}>
          <ChevronLeft size={16} aria-hidden="true" />
          <span>
            {backLabel}
            {index > 1 && <span className="tut-walk-where">: {steps[index - 2].tab}</span>}
          </span>
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
            <span>
              {nextLabel}
              {index < n && <span className="tut-walk-where">: {steps[index].tab}</span>}
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  )
}
