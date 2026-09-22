import { Badge, Button, Modal } from '@flota/ui/ui'
import { useAppLang } from '@flota/ui/i18n'

import {
  fmtDate,
  fmtDateTime,
  fmtKm,
  incidentPriorityTone,
  incidentStatusTone,
} from '../format.ts'
import { useTireSummary } from '../incidentSummary.ts'
import { useIncidentsCopy } from '../translations/incidents.ts'
import { useResolveCopy } from '../translations/resolve.ts'
import type { Incident } from '../types.ts'
import { useDomainLabels } from '../domainLabels.ts'

/** Un dato: se omite ENTERO si no se recogió. Una etiqueta con un guion
 * delante no dice nada que no diga ya su ausencia, y son muchas. */
function dato(label: string, value: string) {
  return value ? (
    <div className="report-fact">
      <span className="report-fact-label">{label}</span>
      <span>{value}</span>
    </div>
  ) : null
}

/**
 * El parte de un accidente: dónde y cuándo ocurrió, el teléfono, el atestado y
 * las tablas de terceros y lesionados.
 *
 * No cabe en columnas —serían ocho que el resto de tipos dejaría vacías—, así
 * que se lee en dos sitios con la MISMA forma: desplegando la fila del
 * accidente en la bandeja y dentro de la ficha completa de la incidencia. Con
 * `sinPeticion` se callan el kilometraje y el CP del taller, que ahí ya están
 * arriba.
 */
export function AccidentReportBlock({
  incident,
  sinPeticion = false,
}: {
  incident: Incident
  sinPeticion?: boolean
}) {
  const language = useAppLang()
  const rt = useIncidentsCopy().report
  const etiqueta = useDomainLabels()
  const r = incident.accident_report
  if (!r) return null
  const calle = [r.street, r.street_number].filter(Boolean).join(' ')
  const sitio = [calle, r.postal_code, r.locality, r.province].filter(Boolean).join(' · ')
  return (
    <div className="accident-report">
      <div className="report-block">
        <strong className="report-title">{rt.where}</strong>
        <div className="report-facts">
          {dato(rt.place, sitio)}
          {dato(rt.occurredAt, r.occurred_at ? fmtDateTime(r.occurred_at, language) : '')}
          {dato(rt.phone, r.phone)}
          {dato(rt.policeRef, r.police_report_ref)}
          {!sinPeticion &&
            dato(rt.mileage, incident.mileage != null ? fmtKm(incident.mileage, language) : '')}
          {!sinPeticion && dato(rt.workshopPostalCode, incident.workshop_postal_code)}
        </div>
      </div>

      <div className="report-block">
        <strong className="report-title">{rt.thirdParties(r.third_parties.length)}</strong>
        {r.third_parties.length === 0 ? (
          <p className="muted">{rt.noThirdParties}</p>
        ) : (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>{rt.tpPlate}</th>
                  <th>{rt.tpVehicle}</th>
                  <th>{rt.tpName}</th>
                  <th>{rt.tpPhone}</th>
                  <th>{rt.tpInsurer}</th>
                  <th>{rt.tpPolicy}</th>
                  <th>{rt.tpDamage}</th>
                </tr>
              </thead>
              <tbody>
                {r.third_parties.map((tp) => (
                  <tr key={tp.id}>
                    <td>{tp.plate || rt.empty}</td>
                    <td>{[tp.brand, tp.model].filter(Boolean).join(' ') || rt.empty}</td>
                    <td>{tp.name || rt.empty}</td>
                    <td>{tp.phone || rt.empty}</td>
                    <td>{tp.insurance_company || rt.empty}</td>
                    <td>{tp.policy_number || rt.empty}</td>
                    <td>{tp.damage_description || rt.empty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="report-block">
        <strong className="report-title">{rt.injured(r.injured.length)}</strong>
        {r.injured.length === 0 ? (
          <p className="muted">{rt.noInjured}</p>
        ) : (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th>{rt.injName}</th>
                  <th>{rt.injPhone}</th>
                  <th>{rt.injEmail}</th>
                  <th>{rt.injPlate}</th>
                  <th>{rt.injSeat}</th>
                </tr>
              </thead>
              <tbody>
                {r.injured.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name || rt.empty}</td>
                    <td>{p.phone || rt.empty}</td>
                    <td>{p.email || rt.empty}</td>
                    <td>{p.plate || rt.empty}</td>
                    <td>{etiqueta.seat(p) || rt.empty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/** Cadena de un valor suelto del JSON del parte (puede no venir o venir a medias). */
const texto = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const objeto = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

/**
 * La incidencia ENTERA, de un vistazo: la petición, el parte con el que se
 * comunicó y la solución con la que se cerró.
 *
 * La bandeja enseña lo que se filtra y se ordena, y eso son columnas; el resto
 * —el parte guiado, las observaciones del cierre, quién lo cerró y cuándo, los
 * neumáticos que se montaron, el expediente del siniestro— vivía repartido
 * entre el JSON de `details` y el admin de Django. Es de solo lectura a
 * propósito: lo que se toca se toca donde se toca (editar, resolver), y esto
 * es para mirar.
 */
export function IncidentDetailModal({
  incident,
  plate,
  onClose,
}: {
  incident: Incident
  plate: string
  onClose: () => void
}) {
  const language = useAppLang()
  const t = useIncidentsCopy()
  const etiqueta = useDomainLabels()
  const d = t.detail
  const rc = useResolveCopy()
  const resumenNeumaticos = useTireSummary()

  const resolucion = objeto(incident.details?.resolution)
  const neumaticos = objeto(resolucion.tires)
  const siniestro = objeto(resolucion.accident)
  const cerrada = Boolean(incident.resolution_date || incident.resolved_at)

  const responsable: Record<string, string> = {
    own: rc.accident.liabilityOwn,
    third_party: rc.accident.liabilityThirdParty,
    deductible: rc.accident.liabilityDeductible,
  }
  const posiciones = Array.isArray(neumaticos.positions)
    ? (neumaticos.positions as string[])
        .map((p) => rc.tires.position[p as keyof typeof rc.tires.position] ?? p)
        .join(' · ')
    : ''
  const parado = typeof resolucion.downtime_days === 'number' ? resolucion.downtime_days : null

  return (
    <Modal
      open
      xl
      title={d.title(plate)}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {d.close}
        </Button>
      }
    >
      <div className="incident-detail">
        <div className="detail-chips">
          <Badge tone={incidentStatusTone(incident.status)}>{etiqueta.incidentStatus(incident)}</Badge>
          <Badge tone={incidentPriorityTone(incident.priority)}>{etiqueta.incidentPriority(incident)}</Badge>
        </div>

        <div className="report-block">
          <strong className="report-title">{d.request}</strong>
          <div className="report-facts">
            {dato(t.columns.vehicle, plate)}
            {dato(t.columns.type, etiqueta.incidentType(incident))}
            {dato(t.columns.date, incident.date ? fmtDate(incident.date, language) : '')}
            {dato(
              t.report.mileage,
              incident.mileage != null ? fmtKm(incident.mileage, language) : '',
            )}
            {dato(t.report.workshopPostalCode, incident.workshop_postal_code)}
            {dato(d.workshop, incident.workshop_name)}
            {dato(t.columns.cost, incident.cost ? `${incident.cost} €` : '')}
          </div>
          {incident.description && <p className="detail-text">{incident.description}</p>}
        </div>

        {/* El parte guiado, cada uno con su forma. */}
        {resumenNeumaticos(incident) && (
          <div className="report-block">
            <strong className="report-title">{d.tires}</strong>
            <p>{resumenNeumaticos(incident)}</p>
          </div>
        )}
        <AccidentReportBlock incident={incident} sinPeticion />

        <div className="report-block">
          <strong className="report-title">{d.resolution}</strong>
          {!cerrada ? (
            <p className="muted">{d.notResolved}</p>
          ) : (
            <>
              <div className="report-facts">
                {dato(
                  rc.common.date,
                  incident.resolution_date ? fmtDate(incident.resolution_date, language) : '',
                )}
                {dato(d.downtimeLabel, parado === null ? '' : d.downtime(parado))}
                {dato(d.workshop, incident.workshop_name)}
                {dato(
                  rc.common.km,
                  incident.resolution_km != null ? fmtKm(incident.resolution_km, language) : '',
                )}
                {dato(rc.common.cost, incident.cost ? `${incident.cost} €` : '')}
                {dato(d.resolvedBy, incident.resolved_by_name)}
                {dato(
                  d.resolvedAt,
                  incident.resolved_at ? fmtDateTime(incident.resolved_at, language) : '',
                )}
                {/* Neumáticos MONTADOS (el parte registra los que se quitaron). */}
                {dato(rc.tires.size, texto(neumaticos.size))}
                {dato(rc.tires.brand, texto(neumaticos.brand))}
                {dato(
                  rc.tires.quantity,
                  typeof neumaticos.quantity === 'number' ? String(neumaticos.quantity) : '',
                )}
                {dato(rc.tires.positions, posiciones)}
                {/* Datos del siniestro. */}
                {dato(rc.accident.claimRef, texto(siniestro.claim_ref))}
                {dato(rc.accident.liability, responsable[texto(siniestro.liability)] ?? '')}
                {dato(
                  rc.accident.deductibleAmount,
                  siniestro.deductible_amount ? `${siniestro.deductible_amount} €` : '',
                )}
                {dato(rc.accident.totalLoss, siniestro.total_loss ? d.yes : '')}
              </div>
              {texto(resolucion.observations) && (
                <p className="detail-text">{texto(resolucion.observations)}</p>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
