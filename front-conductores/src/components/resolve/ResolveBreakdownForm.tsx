import { useState, type FormEvent } from 'react'
import { Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { newClientRef } from '../../offline/queue.ts'
import { useResolveCopy } from '../../translations/resolve.ts'
import { ResolutionCommonFields } from './ResolutionCommonFields.tsx'
import { sendResolution } from './sendResolution.ts'
import { useResolutionCommon } from './useResolutionCommon.ts'
import type { ResolveFormProps } from './types.ts'

/**
 * Cierre de una **avería**, una **petición general** o un **mantenimiento
 * puntual**: solo lo común (qué se hizo, cuándo, con cuántos km y cuánto
 * costó). No tiene campos propios porque no hay nada más que preguntar —y
 * preguntarlo por preguntar alarga un formulario que se rellena de pie—.
 *
 * La **petición general** sí cambia el reparto: puede no ir del coche
 * (documentación, tarjetas, dudas), así que se cierra con **fecha y
 * observaciones** y lo del taller —km, coste, CP y factura— solo aparece si se
 * marca que **hubo taller**. Pedirlo siempre invitaba a cerrar con un cero
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
      {esGeneral ? (
        <>
          <ResolutionCommonFields
            common={common}
            show={{ km: false, cost: false, postalCode: false, proof: false }}
            minDate={incident.date}
          />
          {/* El aviso va FUERA de la etiqueta: dentro, el nombre accesible de
              la casilla sería la pregunta más la explicación entera. */}
          <label className="resolve-workshop">
            <input
              type="checkbox"
              checked={taller}
              onChange={(event) => cambiarTaller(event.target.checked)}
            />
            {t.general.workshop}
          </label>
          <p className="update-hint">{t.general.workshopHint}</p>
          {taller && <ResolutionCommonFields common={common} show={{ date: false, observations: false }} />}
        </>
      ) : (
        <ResolutionCommonFields common={common} minDate={incident.date} />
      )}
      {error && <div role="alert" className="form-error">{error}</div>}
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
        <Button type="submit" disabled={saving || !common.values.date}>
          {saving ? t.common.submitting : t.common.submit}
        </Button>
      </div>
    </form>
  )
}
