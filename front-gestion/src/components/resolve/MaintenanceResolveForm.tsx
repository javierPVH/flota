import { useEffect, useState, type FormEvent } from 'react'
import { Button, SelectField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  listMaintenancePlans,
  maintenancePlanDone,
  resolveAlert,
  resolveIncident,
  type MaintenancePlan,
} from '../../api.ts'
import { todayIso } from '../../format.ts'
import { useAlertsPageCopy } from '../../translations/alertsPage.ts'
import { useResolveCopy } from '../../translations/resolve.ts'
import type { Alert, Incident, VehicleState } from '../../types.ts'
import { uploadProof } from './proof.ts'
import { ResolutionCommonFields } from './ResolutionCommonFields.tsx'
import { useResolutionCommon } from './useResolutionCommon.ts'
import { useDomainLabels } from '../../domainLabels.ts'

/** De dónde viene el gesto: la alerta «Mantenimiento programado», la incidencia
 * de mantenimiento PUNTUAL (que no lleva plan) o el plan directamente (botón
 * «Registrar servicio» del desglose del Panel). */
export type MaintenanceSource =
  | { kind: 'alert'; alert: Alert }
  | { kind: 'incident'; incident: Incident }
  | { kind: 'plan'; vehicle: number; planId: number; planName: string }

interface Props {
  source: MaintenanceSource
  /** Estado actual del vehículo: decide si se ofrece «devolver a Activo». */
  vehicleState?: VehicleState
  /** Con el coche parado, la casilla vive en el despachador (una por modal). */
  returnToActive?: boolean
  /** Última lectura del coche: la que carga el botón de «Km». */
  vehicleKm?: number | null
  onClose: () => void
  /** Registrado: texto para el aviso verde del padre (que recarga sus datos). */
  onDone: (notice: string) => void
}

/** Centinela «sin plan»: valor de salida del selector y único valor posible en
 * el mantenimiento puntual. `required` evita la fila «-- Ignorar --» del DS,
 * pero exige un value no vacío. */
const NO_PLAN = 'none'

function vehicleOf(source: MaintenanceSource): number | null {
  if (source.kind === 'alert') return source.alert.vehicle
  if (source.kind === 'incident') return source.incident.vehicle
  return source.vehicle
}

/** Plan que la fuente ya señala: el de la `dedup_key` de la alerta
 * (`maintenance:{plan}:…`) o el del propio plan. Una incidencia de
 * mantenimiento puntual no señala ninguno: no hay ciclo que reanclar. */
function hintedPlan(source: MaintenanceSource): number | null {
  if (source.kind === 'alert') {
    const match = /^maintenance:(\d+):/.exec(source.alert.dedup_key ?? '')
    return match ? Number(match[1]) : null
  }
  if (source.kind === 'incident') return null
  return source.planId
}

/**
 * Registrar un mantenimiento realizado (GAP-8), desde cualquiera de sus tres
 * puertas, en UNA llamada al back: alerta o plan → `done` del plan (reancla,
 * deja la incidencia de registro, cierra las alertas DE ESE PLAN, emite el
 * evento); incidencia PUNTUAL → `resolve` a secas, sin plan — un mantenimiento
 * puntual no tiene ciclo que reanclar, y el que va contra un plan se sigue por
 * el plan («Mantenimiento programado» del modal de estado) y se cierra por
 * cualquiera de las otras dos puertas. Una alerta sin planes se resuelve solo
 * con la nota, como cualquier otra. El padre pone el `Modal` y el título.
 */
export function MaintenanceResolveForm({
  source,
  vehicleState,
  returnToActive,
  vehicleKm,
  onClose,
  onDone,
}: Props) {
  const t = useResolveCopy()
  const m = t.maintenance
  const alertsCopy = useAlertsPageCopy()
  const etiqueta = useDomainLabels()
  const vehicleId = vehicleOf(source)
  const common = useResolutionCommon({
    flow: 'maintenance',
    vehicleState,
    returnToActive,
    vehicleKm,
    // El CP solo se pinta cuando hay petición detrás: una alerta no tiene
    // ubicación preferente que completar.
    postalCode: source.kind === 'incident' ? source.incident.workshop_postal_code : undefined,
  })

  // Planes del vehículo: solo los pide la ALERTA (hay que decir cuál se ha
  // hecho). El plan directo ya viene elegido y el puntual no lleva plan.
  const [plans, setPlans] = useState<MaintenancePlan[] | null>(
    source.kind === 'alert' ? null : [],
  )
  const [planId, setPlanId] = useState(source.kind === 'plan' ? String(source.planId) : NO_PLAN)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Primitivas para el efecto: el padre puede recrear `source` en cada render.
  const kind = source.kind
  const hinted = hintedPlan(source)
  useEffect(() => {
    if (kind !== 'alert' || vehicleId == null) return
    let alive = true
    listMaintenancePlans({ vehicle: vehicleId })
      .then((page) => {
        if (!alive) return
        setPlans(page.results)
        const match = page.results.find((p) => p.id === hinted)
        // La alerta siempre apunta a un plan: el suyo o, si no lo dice, el primero.
        if (match) setPlanId(String(match.id))
        else if (page.results[0]) setPlanId(String(page.results[0].id))
      })
      .catch(() => {
        // Sin planes que enseñar: la alerta degrada al resolver con nota.
        if (alive) setPlans([])
      })
    return () => {
      alive = false
    }
  }, [kind, vehicleId, hinted])

  const plan = plans?.find((p) => String(p.id) === planId) ?? null
  const usesPlan = planId !== NO_PLAN
  // Alerta sin plan: solo la nota tiene destino (`resolve` de la alerta).
  const noteOnly = source.kind === 'alert' && !usesPlan

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!common.values.date) return
    setSaving(true)
    setError('')
    try {
      const p = common.payload()
      let notice: string
      let record: number | null = null
      if (source.kind === 'incident') {
        // Puntual: fecha, km, coste, observaciones y factura. Sin plan.
        const res = await resolveIncident(source.incident.id, p)
        record = source.incident.id
        notice = res.vehicle_reactivated
          ? t.notices.incidentResolvedActive
          : t.notices.incidentResolved
      } else if (source.kind === 'alert' && !usesPlan) {
        await resolveAlert(source.alert.id, p.observations ?? '')
        notice = alertsCopy.closedNotice(source.alert.vehicle_plate || etiqueta.alertType(source.alert))
      } else {
        const res = await maintenancePlanDone(Number(planId), {
          date: p.resolution_date,
          ...(p.km !== undefined ? { km: p.km } : {}),
          ...(p.cost !== undefined ? { cost: p.cost } : {}),
          ...(p.observations !== undefined ? { note: p.observations } : {}),
          ...(p.return_to_active ? { return_to_active: true } : {}),
        })
        record = res.incident ?? null
        notice = res.vehicle_reactivated ? m.savedNoticeActive : m.savedNotice
      }
      // La factura va después, ligada al registro, y nunca tumba lo ya hecho.
      if (vehicleId != null) {
        const failed = await uploadProof(
          { vehicle: vehicleId, incident: record, type: 'workshop_invoice' },
          common.values.proof,
        )
        if (failed) notice = `${notice} ${t.common.proofFailed(failed)}`
      }
      onDone(notice)
    } catch (err) {
      setError(asErrorMessage(err, t.common.genericError))
    } finally {
      setSaving(false)
    }
  }

  const confirmLabel =
    source.kind === 'plan'
      ? m.confirmPlan
      : source.kind === 'incident'
        ? m.confirmIncident
        : usesPlan
          ? m.confirmAlert
          : alertsCopy.resolveModal.confirm

  return (
    <form className="ops-modal" onSubmit={submit}>
      {source.kind === 'alert' && source.alert.message && (
        <p className="muted ops-note">{source.alert.message}</p>
      )}

      {source.kind === 'plan' ? (
        <p className="muted ops-note">
          {m.planFixed}: <strong>{source.planName || '—'}</strong>
        </p>
      ) : source.kind === 'incident' ? null : plans === null ? (
        <p className="muted ops-note" role="status">
          {m.loadingPlans}
        </p>
      ) : plans.length === 0 ? (
        <p className="muted ops-note">{m.noPlans}</p>
      ) : (
        <SelectField
          label={m.planLabel}
          aria-label={m.planLabel}
          required
          options={plans.map((p) => ({ value: String(p.id), label: p.name }))}
          value={planId}
          onValueChange={setPlanId}
        />
      )}
      {/* El puntual no reancla nada: su nota lo dice para no prometer de más. */}
      {source.kind === 'incident' ? (
        <p className="muted ops-note">{m.hintOnce}</p>
      ) : (
        !noteOnly && <p className="muted ops-note">{m.hint}</p>
      )}

      <ResolutionCommonFields
        common={common}
        show={
          noteOnly
            ? { date: false, km: false, cost: false, proof: false, returnToActive: false }
            : {}
        }
        labels={{ date: m.dateLabel, km: m.kmLabel }}
        placeholders={{ km: plan?.every_km ? m.kmPlaceholder : undefined }}
        minDate={source.kind === 'incident' ? source.incident.date : undefined}
        maxDate={todayIso()}
        proofType="workshop_invoice"
        idPrefix={`resolve-maintenance-${vehicleId ?? 'none'}`}
      />

      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
      <div className="ops-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t.common.cancel}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={saving || plans === null || !common.values.date}
        >
          {saving ? t.common.saving : confirmLabel}
        </Button>
      </div>
    </form>
  )
}
