import { useState, type FormEvent } from 'react'
import { asErrorMessage } from '@flota/ui/http'

import { newClientRef } from '../../offline/queue.ts'
import { useResolveCopy } from '../../translations/resolve.ts'
import { ResolutionCommonFields } from './ResolutionCommonFields.tsx'
import { ResolveActions, ResolveStepBar, useResolveSteps } from './ResolveSteps.tsx'
import { sendResolution } from './sendResolution.ts'
import { useResolutionCommon } from './useResolutionCommon.ts'
import type { ResolveFormProps } from './types.ts'

/**
 * Cierre de una **avería**, una **petición general** o un **mantenimiento
 * puntual**: solo lo común (qué se hizo, cuándo, con cuántos km y cuánto
 * costó). No tiene campos propios porque no hay nada más que preguntar —y
 * preguntarlo por preguntar alarga un formulario que se rellena de pie—, así
 * que sus pasos son **cuándo → taller → cierre**.
 *
 * La **petición general** sí cambia el reparto: puede no ir del coche
 * (documentación, tarjetas, dudas), así que se cierra con **fecha y
 * observaciones** y lo del taller —km, coste, CP y factura— es un **paso más
 * que solo existe** si se marca que hubo taller. Pedirlo siempre invitaba a
 * cerrar con un cero peticiones que nunca pisaron uno.
 *
 * El mantenimiento **programado** no pasa por aquí: es una alerta y se cierra
 * marcando el plan como realizado, que es lo que reancla el ciclo.
 */
export function ResolveBreakdownForm({
  incident,
  vehicleKm,
  onClose,
  onResolved,
}: ResolveFormProps) {
  const t = useResolveCopy()
  const esMantenimiento = incident.type === 'maintenance'
  const esGeneral = incident.type === 'general'
  const common = useResolutionCommon({
    incidentDate: incident.date,
    postalCode: incident.workshop_postal_code,
    vehicleKm,
  })
  const [taller, setTaller] = useState(false)
  const [proofRef] = useState(newClientRef)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // En la petición general el taller va al FINAL y solo si lo hubo: marcar la
  // casilla añade el paso, desmarcarla se lo lleva.
  const pasos = useResolveSteps(
    esGeneral
      ? taller
        ? ['when', 'close', 'workshop']
        : ['when', 'close']
      : ['when', 'workshop', 'close'],
  )

  /** Desmarcar «hubo taller» **borra** lo que se hubiera escrito: si no, un
   * coste tecleado y luego escondido viajaría igual. */
  function cambiarTaller(marcado: boolean) {
    setTaller(marcado)
    if (!marcado) {
      common.set({ km: '', cost: '', proof: null, postalCode: incident.workshop_postal_code })
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Intro antes del último paso AVANZA: no cierra la incidencia a medias.
    if (pasos.next !== undefined) {
      pasos.goTo(pasos.next)
      return
    }
    if (!common.values.date) return
    setSaving(true)
    setError('')
    try {
      const aviso = await sendResolution({
        incident,
        payload: common.payload(),
        proof: common.values.proof,
        proofRef,
        copy: t.common,
      })
      onResolved(aviso)
    } catch (caught) {
      setError(asErrorMessage(caught, t.common.error))
      setSaving(false)
    }
  }

  const intro = esGeneral ? t.general.intro : esMantenimiento ? t.maintenance.intro : t.breakdown.intro

  return (
    <form className="update-action-form" onSubmit={submit}>
      <p className="update-hint">{intro}</p>
      <ResolveStepBar steps={pasos} />
      <div key={pasos.step} className={`step-pane${pasos.cameBack ? ' from-left' : ''}`}>
        {pasos.step === 'when' && (
          <ResolutionCommonFields
            common={common}
            minDate={incident.date}
            show={{ km: false, cost: false, postalCode: false, observations: false, proof: false }}
          />
        )}
        {pasos.step === 'workshop' && (
          // En la general la factura viene aquí: es del taller que se acaba de
          // reconocer, no del cierre.
          <ResolutionCommonFields
            common={common}
            show={{ date: false, observations: false, proof: esGeneral }}
          />
        )}
        {pasos.step === 'close' && (
          <>
            <ResolutionCommonFields
              common={common}
              show={{ date: false, km: false, cost: false, postalCode: false, proof: !esGeneral }}
            />
            {/* El aviso va FUERA de la etiqueta: dentro, el nombre accesible de
                la casilla sería la pregunta más la explicación entera. */}
            {esGeneral && (
              <>
                <label className="resolve-workshop">
                  <input
                    type="checkbox"
                    checked={taller}
                    onChange={(event) => cambiarTaller(event.target.checked)}
                  />
                  {t.general.workshop}
                </label>
                <p className="update-hint">{t.general.workshopHint}</p>
              </>
            )}
          </>
        )}
      </div>
      {error && <div role="alert" className="form-error">{error}</div>}
      <ResolveActions
        steps={pasos}
        onCancel={onClose}
        canContinue={pasos.step !== 'when' || Boolean(common.values.date)}
        canSave={Boolean(common.values.date)}
        saving={saving}
      />
    </form>
  )
}
