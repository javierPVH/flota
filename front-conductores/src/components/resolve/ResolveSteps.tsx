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
 * Los pasos son seis y cada flujo usa los suyos: **cuándo** (la fecha, lo
 * único obligatorio), **detalles** (lo propio del tipo: las ruedas montadas, el
 * expediente del siniestro), **taller** (kilometraje, coste y CP), **notas**,
 * **factura** y **cierre**. Una avería no tiene «detalles» que preguntar y una
 * petición general se salta el taller —y con él la factura— si no lo hubo: los
 * pasos los arma cada formulario, esto solo los recorre.
 *
 * El **cierre** no pregunta nada: es el **repaso** de lo rellenado
 * (`ResolveSummary`) y el botón que cierra. Cada cosa en su paso, y la
 * última pantalla se lee de arriba abajo antes de aceptar.
 */
import { useState } from 'react'
import { Button } from '@flota/ui/ui'

import { useResolveCopy } from '../../translations/resolve.ts'

export type ResolveStep = 'when' | 'what' | 'workshop' | 'notes' | 'proof' | 'close'

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
 *
 * **Ninguno de los dos envía el formulario**, y eso es a propósito: los dos
 * son `type="button"` y cerrar la incidencia es el `onSave` de este pie, como
 * en el resto de carruseles de la app («Mis datos», el parte de accidente,
 * subir documento). Con un `type="submit"` en la rama de guardar, pulsar
 * «Continuar» en el penúltimo paso cerraba la incidencia sola: React reusa
 * ESE mismo botón para pintar el otro y le cambia el `type` a `submit` antes
 * de que el navegador ejecute la acción por defecto del clic, así que entrar
 * en el repaso lo guardaba todo sin que nadie lo aceptara.
 */
export function ResolveActions({
  steps,
  onCancel,
  onSave,
  canContinue = true,
  canSave,
  saving,
}: {
  steps: ResolveStepsState
  onCancel: () => void
  /** Cerrar la incidencia: se pulsa, no se envía. */
  onSave: () => void
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
        <Button type="button" onClick={onSave} disabled={saving || !canSave}>
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
