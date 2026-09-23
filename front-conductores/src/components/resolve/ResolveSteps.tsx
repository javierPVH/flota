/**
 * El cierre de una incidencia, **por pasos**: la misma tira de `flow-steps`, el
 * mismo pane que entra deslizándose y el mismo pie de «Atrás / Continuar» que
 * el parte guiado, «Mis datos» y subir un documento.
 *
 * De una sola columna se rellenaban a ciegas: fecha, días parado, kilometraje,
 * coste, CP, observaciones y la factura en una pantalla de móvil que había que
 * recorrer entera —muchas veces de pie en el taller— para saber si quedaba
 * algo. Partido, cada paso cabe sin desplazar y el botón de guardar solo
 * aparece cuando no queda nada por preguntar.
 *
 * Los pasos son cuatro y cada flujo usa los suyos: **cuándo** (la fecha, lo
 * único obligatorio), **detalles** (lo propio del tipo: las ruedas montadas, el
 * expediente del siniestro), **taller** (kilometraje, coste y CP) y **cierre**
 * (observaciones y factura). Una avería no tiene «detalles» que preguntar y una
 * petición general se salta el taller si no lo hubo: los pasos los arma cada
 * formulario, esto solo los recorre.
 */
import { useState } from 'react'
import { Button } from '@flota/ui/ui'

import { useResolveCopy } from '../../translations/resolve.ts'

export type ResolveStep = 'when' | 'what' | 'workshop' | 'close'

export interface ResolveStepsState {
  /** El paso que se está rellenando. */
  step: ResolveStep
  steps: ResolveStep[]
  current: number
  /** Los vecinos, o `undefined` en los extremos: el pie los lee para decidir
   * si toca «Cancelar» o «Atrás», «Continuar» o guardar. */
  previous?: ResolveStep
  next?: ResolveStep
  /** Se ha vuelto atrás: el pane entra por la izquierda. */
  cameBack: boolean
  goTo: (step: ResolveStep) => void
}

export function useResolveSteps(steps: ResolveStep[]): ResolveStepsState {
  const [step, setStep] = useState<ResolveStep>(steps[0])
  const [cameBack, setCameBack] = useState(false)
  // El paso activo puede desaparecer bajo los pies (desmarcar «hubo taller» en
  // una petición general se lleva el suyo): entonces manda el primero.
  const current = Math.max(0, steps.indexOf(step))
  return {
    step: steps[current],
    steps,
    current,
    previous: steps[current - 1],
    next: steps[current + 1],
    cameBack,
    goTo: (to) => {
      setCameBack(steps.indexOf(to) < current)
      setStep(to)
    },
  }
}

/** La tira de pasos: dónde se está y cuánto queda. Decorativa —no se pulsa—,
 * como en el resto de los carruseles de la app. */
export function ResolveStepBar({ steps }: { steps: ResolveStepsState }) {
  const labels = useResolveCopy().common.steps
  if (steps.steps.length < 2) return null
  return (
    <div className="flow-steps" aria-hidden>
      {steps.steps.map((key, index) => (
        <span
          key={key}
          className={`flow-step${
            index === steps.current ? ' is-current' : index < steps.current ? ' is-done' : ''
          }`}
        >
          {labels[key]}
        </span>
      ))}
    </div>
  )
}

/**
 * El pie: salir a la izquierda, avanzar a la derecha, y en el último paso
 * —solo ahí— el botón que cierra la incidencia. El mismo reparto que el
 * asistente de gestión: el botón de guardar no aparece bajo el dedo a mitad
 * del formulario.
 */
export function ResolveActions({
  steps,
  onCancel,
  canContinue = true,
  canSave,
  saving,
}: {
  steps: ResolveStepsState
  onCancel: () => void
  /** ¿Se puede pasar del paso que se está rellenando? */
  canContinue?: boolean
  canSave: boolean
  saving: boolean
}) {
  const c = useResolveCopy().common
  const { previous, next } = steps
  return (
    <div className="form-actions form-actions-steps">
      {previous === undefined ? (
        <Button type="button" variant="secondary" onClick={onCancel}>{c.cancel}</Button>
      ) : (
        <Button type="button" variant="secondary" onClick={() => steps.goTo(previous)}>
          {c.back}
        </Button>
      )}
      {next === undefined ? (
        <Button type="submit" disabled={saving || !canSave}>
          {saving ? c.submitting : c.submit}
        </Button>
      ) : (
        <Button type="button" onClick={() => steps.goTo(next)} disabled={!canContinue}>
          {c.next}
        </Button>
      )}
    </div>
  )
}
