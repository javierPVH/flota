import { useState, type FormEvent } from 'react'
import { Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { resolveIncident } from '../../api.ts'
import { todayIso } from '../../format.ts'
import { useResolveCopy } from '../../translations/resolve.ts'
import type { Incident, VehicleState } from '../../types.ts'
import { uploadProof } from './proof.ts'
import { ResolutionCommonFields } from './ResolutionCommonFields.tsx'
import { useResolutionCommon } from './useResolutionCommon.ts'

interface Props {
  incident: Incident
  /** Estado actual del vehículo: decide si se ofrece «devolver a Activo». */
  vehicleState?: VehicleState
  /** Con el coche parado, la casilla vive en el despachador (una por modal). */
  returnToActive?: boolean
  /** Última lectura del coche: la que carga el botón de «Km». */
  vehicleKm?: number | null
  onClose: () => void
  /** Cerrada: texto para el aviso verde del padre (que recarga sus datos). */
  onDone: (notice: string) => void
}

/**
 * Resolver una AVERÍA (o una petición general): fecha, taller, km, coste,
 * observaciones, factura y vuelta a Activo. Contenido del modal (el dispatcher
 * pone el `Modal` y el título). También es el cierre genérico de reparación
 * que usan neumáticos y accidente mientras no tienen su modal propio.
 *
 * La **petición general** se rellena en otro orden y con menos campos: puede no
 * ir del coche (documentación, tarjetas, dudas), así que se cierra con **fecha
 * y observaciones** y solo si se marca que **hubo taller** se piden los km, el
 * coste, el CP y la factura. Preguntarlos siempre invitaba a rellenar con ceros
 * una petición que nunca pisó un taller.
 */
export function ResolveBreakdownModal({
  incident,
  vehicleState,
  returnToActive,
  vehicleKm,
  onClose,
  onDone,
}: Props) {
  const t = useResolveCopy()
  const esGeneral = incident.type === 'general'
  const common = useResolutionCommon({
    flow: 'breakdown',
    vehicleState,
    returnToActive,
    vehicleKm,
    postalCode: incident.workshop_postal_code,
  })
  const [workshop, setWorkshop] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /** Desmarcar «hubo taller» **borra** lo que se hubiera escrito: si no, un
   * coste tecleado y luego escondido viajaría igual. */
  function toggleWorkshop(checked: boolean) {
    setWorkshop(checked)
    if (!checked) {
      common.set({
        km: '',
        cost: '',
        proof: null,
        postalCode: incident.workshop_postal_code ?? '',
      })
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!common.values.date) return
    setSaving(true)
    setError('')
    try {
      const result = await resolveIncident(incident.id, common.payload())
      // El justificante va después y nunca tumba la resolución ya hecha.
      const failed = await uploadProof(
        { vehicle: incident.vehicle, incident: incident.id, type: 'workshop_invoice' },
        common.values.proof,
      )
      let notice = result.vehicle_reactivated
        ? t.notices.incidentResolvedActive
        : t.notices.incidentResolved
      if (failed) notice = `${notice} ${t.common.proofFailed(failed)}`
      onDone(notice)
    } catch (err) {
      setError(asErrorMessage(err, t.common.genericError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="ops-modal" onSubmit={submit}>
      <p className="muted ops-note">{esGeneral ? t.general.intro : t.breakdown.intro}</p>
      {esGeneral ? (
        <>
          {/* Fecha y observaciones: con eso se cierra una petición que no fue
              al taller, que son la mayoría. */}
          <ResolutionCommonFields
            common={common}
            show={{ km: false, cost: false, postalCode: false, proof: false, returnToActive: false }}
            minDate={incident.date}
            maxDate={todayIso()}
            idPrefix={`resolve-general-${incident.id}`}
          />
          <label className="baja-toggle">
            <input
              type="checkbox"
              checked={workshop}
              onChange={(e) => toggleWorkshop(e.target.checked)}
            />
            {t.general.workshop}
            <span className="muted"> · {t.general.workshopHint}</span>
          </label>
          {workshop && (
            <ResolutionCommonFields
              common={common}
              show={{ date: false, observations: false }}
              proofType="workshop_invoice"
              idPrefix={`resolve-general-shop-${incident.id}`}
            />
          )}
        </>
      ) : (
        <ResolutionCommonFields
          common={common}
          minDate={incident.date}
          maxDate={todayIso()}
          proofType="workshop_invoice"
          idPrefix={`resolve-breakdown-${incident.id}`}
        />
      )}
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
      <div className="ops-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t.common.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={saving || !common.values.date}>
          {saving ? t.common.saving : t.breakdown.confirm}
        </Button>
      </div>
    </form>
  )
}
