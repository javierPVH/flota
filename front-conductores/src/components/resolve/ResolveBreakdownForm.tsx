import { useState, type FormEvent } from 'react'
import { asErrorMessage } from '@flota/ui/http'

import { newClientRef } from '../../offline/queue.ts'
import { useResolveCopy } from '../../translations/resolve.ts'
import { ResolutionCommonFields } from './ResolutionCommonFields.tsx'
import { ResolveActions, ResolveStepBar, useResolveSteps } from './ResolveSteps.tsx'
import { ResolveSummary } from './ResolveSummary.tsx'
import { sendResolution } from './sendResolution.ts'
import { useResolutionCommon } from './useResolutionCommon.ts'
import type { ResolveFormProps } from './types.ts'

/**
 * Cierre de una **avería**, una **petición general** o un **mantenimiento
 * puntual**: solo lo común (qué se hizo, cuándo, con cuántos km y cuánto
 * costó). No tiene campos propios porque no hay nada más que preguntar —y
 * preguntarlo por preguntar alarga un formulario que se rellena de pie—, así
 * que sus pasos son **cuándo → taller → notas → factura → cierre**, y el
 * cierre no pregunta nada: es el repaso de todo lo anterior.
 *
 * La **petición general** sí cambia el reparto: puede no ir del coche
 * (documentación, tarjetas, dudas), así que se cierra con **fecha y
 * observaciones** y lo del taller —km, coste y CP, más la factura— son **dos
 * pasos que solo existen** si se marca que hubo taller, casilla que vive en
 * el paso de las notas. Pedirlo siempre invitaba a cerrar con un cero
 * peticiones que nunca pisaron uno.
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

  // En la petición general el taller va DESPUÉS de las notas y solo si lo hubo:
  // marcar la casilla añade sus dos pasos, desmarcarla se los lleva.
  const pasos = useResolveSteps(
    esGeneral
      ? taller
        ? ['when', 'notes', 'workshop', 'proof', 'close']
        : ['when', 'notes', 'close']
      : ['when', 'workshop', 'notes', 'proof', 'close'],
  )
  // Sin taller no hay km, coste, CP ni factura que repasar: no se preguntaron.
  const huboTaller = !esGeneral || taller

  /** Desmarcar «hubo taller» **borra** lo que se hubiera escrito: si no, un
   * coste tecleado y luego escondido viajaría igual. */
  function cambiarTaller(marcado: boolean) {
    setTaller(marcado)
    if (!marcado) {
      common.set({ km: '', cost: '', proof: null, postalCode: incident.workshop_postal_code })
    }
  }

  /** Intro **nunca** cierra la incidencia: como mucho pasa al paso siguiente.
   * Cerrarla es pulsar su botón, después de leer el repaso. */
  function avanzar(event: FormEvent) {
    event.preventDefault()
    if (pasos.next !== undefined) pasos.goTo(pasos.next)
  }

  async function guardar() {
    if (!common.values.date || saving) return
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
    <form className="update-action-form" onSubmit={avanzar}>
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
          <ResolutionCommonFields
            common={common}
            show={{ date: false, observations: false, proof: false }}
          />
        )}
        {pasos.step === 'notes' && (
          <>
            <ResolutionCommonFields
              common={common}
              show={{ date: false, km: false, cost: false, postalCode: false, proof: false }}
            />
            {/* En la general, aquí se dice si hubo taller: es lo que añade sus
                dos pasos, así que tiene que preguntarse ANTES que ellos. El
                aviso va FUERA de la etiqueta: dentro, el nombre accesible de la
                casilla sería la pregunta más la explicación entera. */}
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
        {pasos.step === 'proof' && (
          <ResolutionCommonFields
            common={common}
            show={{
              date: false,
              km: false,
              cost: false,
              postalCode: false,
              observations: false,
            }}
          />
        )}
        {pasos.step === 'close' && (
          <ResolveSummary
            common={common}
            show={{
              km: huboTaller,
              cost: huboTaller,
              postalCode: huboTaller,
              proof: huboTaller,
            }}
          />
        )}
      </div>
      {error && <div role="alert" className="form-error">{error}</div>}
      <ResolveActions
        steps={pasos}
        onCancel={onClose}
        onSave={() => void guardar()}
        canContinue={pasos.step !== 'when' || Boolean(common.values.date)}
        canSave={Boolean(common.values.date)}
        saving={saving}
      />
    </form>
  )
}
