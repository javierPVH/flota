import type { ReactNode } from 'react'
import { Badge, Button, Modal } from '@flota/ui/ui'
import { useAppLang } from '@flota/ui/i18n'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Clock,
  Euro,
  FileBadge,
  Gauge,
  HeartPulse,
  MapPin,
  Phone,
  Siren,
  Users,
  Wrench,
} from 'lucide-react'

import {
  fmtDate,
  fmtDateTime,
  fmtKm,
  incidentPriorityTone,
  incidentStatusTone,
  incidentTypeTone,
} from '../format.ts'
import { useTireSummary } from '../incidentSummary.ts'
import { useIncidentsCopy } from '../translations/incidents.ts'
import { useResolveCopy } from '../translations/resolve.ts'
import type { Incident } from '../types.ts'
import { useDomainLabels } from '../domainLabels.ts'

/** Un dato: se omite ENTERO si no se recogió. Una etiqueta con un guion
 * delante no dice nada que no diga ya su ausencia, y son muchas. El icono es
 * opcional: lo llevan los que se buscan de un vistazo (el lugar, la hora, el
 * teléfono), no todos, o dejaría de señalar nada. */
function dato(label: string, value: string, icon?: ReactNode) {
  return value ? (
    <div className="report-fact">
      <span className="report-fact-label">{label}</span>
      <span className="report-fact-value">
        {icon && <span className="report-fact-icon">{icon}</span>}
        {value}
      </span>
    </div>
  ) : null
}

/** Un bloque del parte o de la ficha: cabecera con icono y título, y debajo
 * lo suyo. Es la misma caja en la fila desplegada, en el modal y en los
 * formularios de resolver que se parten en bloques («Resolver accidente»). */
export function ReportBlock({
  icon,
  title,
  aside,
  children,
}: {
  icon: ReactNode
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="report-block">
      <header className="report-block-head">
        <span className="report-block-icon">{icon}</span>
        <strong className="report-title">{title}</strong>
        {aside && <span className="report-block-aside">{aside}</span>}
      </header>
      <div className="report-block-body">{children}</div>
    </section>
  )
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
      <ReportBlock icon={<MapPin size={15} aria-hidden />} title={rt.where}>
        <div className="report-facts">
          {dato(rt.place, sitio, <MapPin size={14} aria-hidden />)}
          {dato(
            rt.occurredAt,
            r.occurred_at ? fmtDateTime(r.occurred_at, language) : '',
            <Clock size={14} aria-hidden />,
          )}
          {dato(rt.phone, r.phone, <Phone size={14} aria-hidden />)}
          {dato(rt.policeRef, r.police_report_ref, <FileBadge size={14} aria-hidden />)}
          {!sinPeticion &&
            dato(rt.mileage, incident.mileage != null ? fmtKm(incident.mileage, language) : '')}
          {!sinPeticion && dato(rt.workshopPostalCode, incident.workshop_postal_code)}
        </div>
      </ReportBlock>

      {/* Terceros y lesionados: el recuento va en el título, que es lo que se
          lee plegado; sin ninguno, una línea y no una tabla vacía. */}
      <ReportBlock
        icon={<Users size={15} aria-hidden />}
        title={rt.thirdParties(r.third_parties.length)}
      >
        {r.third_parties.length === 0 ? (
          <p className="muted report-none">{rt.noThirdParties}</p>
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
                    <td>{tp.plate ? <strong>{tp.plate}</strong> : rt.empty}</td>
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
      </ReportBlock>

      <ReportBlock icon={<HeartPulse size={15} aria-hidden />} title={rt.injured(r.injured.length)}>
        {r.injured.length === 0 ? (
          <p className="muted report-none">{rt.noInjured}</p>
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
                    <td>{p.name ? <strong>{p.name}</strong> : rt.empty}</td>
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
      </ReportBlock>
    </div>
  )
}

/** Cadena de un valor suelto del JSON del parte (puede no venir o venir a medias). */
const texto = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const objeto = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

/** El icono con el que la app nombra cada tipo de incidencia. */
function iconoDelTipo(type: Incident['type']) {
  switch (type) {
    case 'accident':
      return <Siren size={22} aria-hidden />
    case 'maintenance':
    case 'tires':
      return <Wrench size={22} aria-hidden />
    default:
      return <AlertTriangle size={22} aria-hidden />
  }
}

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
 *
 * Se lee de arriba abajo: una **cabecera** con el tipo (su icono, en el color
 * de su gravedad), la matrícula y las chapas de estado y prioridad, y a la
 * derecha las tres cifras que se buscan primero —fecha, kilometraje y coste—;
 * debajo, tres bloques con la misma caja: la petición (lo que se contó y
 * desde dónde se busca taller), el parte (neumáticos o accidente) y la
 * solución, que abierta es un hueco que lo dice y no un bloque en gris.
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
  const tipo = etiqueta.incidentType(incident) || incident.type_display

  // Las tres cifras de la cabecera: lo que se busca antes de leer nada.
  const cifras = [
    {
      key: 'date',
      icon: <CalendarDays size={15} aria-hidden />,
      label: t.columns.date,
      value: incident.date ? fmtDate(incident.date, language) : '—',
    },
    {
      key: 'km',
      icon: <Gauge size={15} aria-hidden />,
      label: t.report.mileage,
      value: incident.mileage != null ? fmtKm(incident.mileage, language) : '—',
    },
    {
      key: 'cost',
      icon: <Euro size={15} aria-hidden />,
      label: t.columns.cost,
      value: incident.cost ? `${incident.cost} €` : '—',
    },
  ]

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
        <header className={`detail-hero tone-${incidentTypeTone(incident.type)}`}>
          <span className="detail-hero-icon">{iconoDelTipo(incident.type)}</span>
          <div className="detail-hero-main">
            <span className="detail-hero-type">{tipo}</span>
            <span className="detail-hero-plate">{plate}</span>
            <div className="detail-chips">
              <Badge tone={incidentStatusTone(incident.status)}>
                {etiqueta.incidentStatus(incident)}
              </Badge>
              <Badge tone={incidentPriorityTone(incident.priority)}>
                {etiqueta.incidentPriority(incident)}
              </Badge>
            </div>
          </div>
          <dl className="detail-stats">
            {cifras.map((c) => (
              <div key={c.key} className="detail-stat">
                <dt>
                  {c.icon} {c.label}
                </dt>
                <dd>{c.value}</dd>
              </div>
            ))}
          </dl>
        </header>

        <ReportBlock icon={<ClipboardList size={15} aria-hidden />} title={d.request}>
          {incident.description ? (
            <p className="detail-text detail-quote">{incident.description}</p>
          ) : (
            <p className="muted report-none">{d.noDescription}</p>
          )}
          <div className="report-facts">
            {dato(t.report.workshopPostalCode, incident.workshop_postal_code)}
            {dato(d.workshop, incident.workshop_name)}
          </div>
        </ReportBlock>

        {/* El parte guiado, cada uno con su forma. */}
        {resumenNeumaticos(incident) && (
          <ReportBlock icon={<Wrench size={15} aria-hidden />} title={d.tires}>
            <p className="detail-text">{resumenNeumaticos(incident)}</p>
          </ReportBlock>
        )}
        <AccidentReportBlock incident={incident} sinPeticion />

        <ReportBlock
          icon={
            cerrada ? <CheckCircle2 size={15} aria-hidden /> : <CircleDot size={15} aria-hidden />
          }
          title={d.resolution}
          aside={
            cerrada && incident.resolution_date ? (
              <Badge tone="success">{fmtDate(incident.resolution_date, language)}</Badge>
            ) : undefined
          }
        >
          {!cerrada ? (
            <div className="detail-empty">
              <CircleDot size={18} aria-hidden />
              <span>{d.notResolved}</span>
            </div>
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
                <p className="detail-text detail-quote">{texto(resolucion.observations)}</p>
              )}
            </>
          )}
        </ReportBlock>
      </div>
    </Modal>
  )
}
