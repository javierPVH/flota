import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '@flota/ui/ui'

import type { TutorialWalkStep } from '../translations/tutorial.ts'

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
}

/** Recorrido por pestañas: un paso de la tarea en cada una, con Atrás /
 * Continuar y las flechas del teclado (patrón WAI-ARIA de pestañas). */
export function Walk({ id, label, steps, active, onChange, stepOf, backLabel, nextLabel, renderShot }: WalkProps) {
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
      <div className="veh-tabs tut-walk-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {steps.map((s, i) => (
          <button
            key={s.tab}
            ref={(el) => {
              tabs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${i + 1}`}
            aria-controls={`${id}-panel`}
            aria-selected={index === i + 1}
            tabIndex={index === i + 1 ? 0 : -1}
            className={`veh-tab${index === i + 1 ? ' is-active' : ''}`}
            onClick={() => go(i + 1)}
          >
            <span className="tut-walk-num" aria-hidden="true">
              {i + 1}
            </span>{' '}
            {s.tab}
          </button>
        ))}
      </div>
      <div className="tut-walk-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${index}`}>
        <p className="tut-walk-count">{stepOf(index, n)}</p>
        <h3>{current.title}</h3>
        <ol className="tut-steps">
          {current.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {current.shot && renderShot(current.shot)}
        <div className="tut-walk-nav">
          <Button variant="outline" size="sm" disabled={index === 1} onClick={() => go(index - 1)}>
            {backLabel}
          </Button>
          <Button variant="primary" size="sm" disabled={index === n} onClick={() => go(index + 1)}>
            {nextLabel}
          </Button>
        </div>
      </div>
    </section>
  )
}
