import { useState, type FormEvent } from 'react'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { registerItv } from '../../api.ts'
import { todayIso } from '../../format.ts'
import { useAlertsPageCopy } from '../../translations/alertsPage.ts'
import { useResolveCopy } from '../../translations/resolve.ts'
import type { Vehicle } from '../../types.ts'
import { uploadProof } from './proof.ts'
import { ResolutionCommonFields } from './ResolutionCommonFields.tsx'
import { useResolutionCommon } from './useResolutionCommon.ts'

interface Props {
  vehicles: readonly Vehicle[]
  /** Vehículo preseleccionado (desde una alerta, una incidencia o una fila). */
  initialVehicleId?: number | null
  /** Incidencia «En ITV» que se está resolviendo: el informe se liga a ella. */
  incidentId?: number | null
  /** Con el coche parado, la casilla vive en el despachador (una por modal). */
  returnToActive?: boolean
  onClose: () => void
  /** ITV registrada: texto para el aviso verde del padre, que cierra y recarga. */
  onSaved: (notice: string) => void
}

/**
 * Formulario de «Registrar ITV» (HU-5.1), sin `Modal`: lo montan el
 * `RegisterItvModal` de los desgloses y el dispatcher de resolver (alerta de
 * ITV e incidencia «En ITV»). Además del resultado y la próxima fecha, recoge
 * los km, el informe y —si la ITV es favorable y el coche está «En ITV»— la
 * vuelta a Activo; la estación no se pide aquí (se decide en la gestión de la
 * petición, con su CP). El back cierra las alertas con actor, cierra la
 * incidencia «En ITV» y refresca la fecha.
 */
export function RegisterItvForm({
  vehicles,
  initialVehicleId = null,
  incidentId = null,
  returnToActive,
  onClose,
  onSaved,
}: Props) {
  const t = useAlertsPageCopy()
  const r = useResolveCopy()

  const [vehicle, setVehicle] = useState(initialVehicleId ? String(initialVehicleId) : '')
  const [result, setResult] = useState('done')
  const [nextDue, setNextDue] = useState('')
  const [date, setDate] = useState(todayIso())
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // El formulario arranca limpio cada vez: el `Modal` desmonta el contenido al
  // cerrarse y el wrapper lo remonta (`key`) si cambia el preseleccionado.

  // La casilla «devolver a Activo» sigue al vehículo ELEGIDO (aquí se puede
  // cambiar), y solo tiene sentido con una ITV favorable.
  const selected = vehicles.find((v) => String(v.id) === vehicle)
  const common = useResolutionCommon({
    flow: 'itv',
    vehicleState: selected?.state,
    returnToActive,
  })
  const favourable = result === 'done'

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!vehicle) {
      setError(t.itvModal.chooseVehicleError)
      return
    }
    setSaving(true)
    setError('')
    try {
      const extra = common.payload()
      const saved = await registerItv({
        vehicle: Number(vehicle),
        event_date: date,
        notes: notes || undefined,
        // A13/C5: la próxima fecha solo acompaña a una ITV FAVORABLE. Con
        // resultado "no pasada" no hay próxima ITV que apuntar (y el back la
        // rechaza), y el aviso sigue abierto a propósito.
        itv: {
          result,
          next_due: favourable ? nextDue : null,
          ...(cost ? { cost } : {}),
          ...(extra.km !== undefined ? { km: extra.km } : {}),
        },
        ...(favourable && extra.return_to_active ? { return_to_active: true } : {}),
      })
      // El informe va después y nunca tumba el registro ya hecho. Se liga a la
      // incidencia «En ITV» que se resolvía (o a la que el back cerró).
      const failed = await uploadProof(
        {
          vehicle: Number(vehicle),
          incident: incidentId ?? saved.incident_closed ?? null,
          type: 'itv_report',
        },
        common.values.proof,
      )
      let notice = t.itvModal.savedNotice
      if (saved.vehicle_reactivated) notice = `${notice} ${r.itv.savedActive}`
      if (failed) notice = `${notice} ${r.common.proofFailed(failed)}`
      onSaved(notice)
    } catch (err) {
      setError(asErrorMessage(err, t.itvModal.saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <SelectField
        label={t.itvModal.vehicle}
        aria-label={t.itvModal.vehicle}
        options={[
          { value: '', label: t.itvModal.choose },
          ...vehicles.map((v) => ({
            value: String(v.id),
            label: `${v.plate} · ${v.brand} ${v.model}`,
          })),
        ]}
        value={vehicle}
        onValueChange={setVehicle}
      />
      <SelectField
        label={t.itvModal.result}
        aria-label={t.itvModal.result}
        options={[
          { value: 'done', label: t.itvModal.resultPass },
          { value: 'not done', label: t.itvModal.resultFail },
        ]}
        value={result}
        onValueChange={setResult}
      />
      <TextInputField
        label={t.itvModal.inspectionDate}
        aria-label={t.itvModal.inspectionDate}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
      />
      <TextInputField
        label={t.itvModal.nextDue}
        aria-label={t.itvModal.nextDue}
        type="date"
        value={favourable ? nextDue : ''}
        onChange={(e) => setNextDue(e.target.value)}
        // A13: obligatoria si la ITV se pasó; deshabilitada si no.
        required={favourable}
        disabled={!favourable}
      />
      <TextInputField
        label={t.itvModal.cost}
        aria-label={t.itvModal.cost}
        type="number"
        min={0}
        step="0.01"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
      />
      <TextInputField
        label={t.itvModal.notes}
        aria-label={t.itvModal.notes}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      {/* Km, informe y (favorable + «En ITV») vuelta a Activo. */}
      <ResolutionCommonFields
        common={common}
        show={{ date: false, cost: false, observations: false, returnToActive: favourable }}
        labels={{ km: r.itv.km }}
        proofType="itv_report"
        idPrefix={`register-itv-${vehicle || 'none'}`}
      />
      <p className="muted" style={{ margin: 0 }}>
        {t.itvModal.note1}
        <strong>{t.itvModal.noteStrong}</strong>
        {t.itvModal.note2}
      </p>
      {error && <div role="alert" className="form-error">{error}</div>}
      <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t.itvModal.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? t.itvModal.saving : t.itvModal.save}
        </Button>
      </div>
    </form>
  )
}
