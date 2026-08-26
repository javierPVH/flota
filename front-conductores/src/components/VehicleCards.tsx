import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ClipboardList, Gauge, Mail, Siren, TriangleAlert, Wrench } from 'lucide-react'
import { Badge } from '@flota/ui/ui'

import { fmtDate, fmtKm, itvClass, kmLevelTone, pendingThisMonth, vehicleStateTone } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { pairedWith } from '../substitution.ts'
import { AccidentModal } from './AccidentModal.tsx'
import { BreakdownModal } from './BreakdownModal.tsx'
import { IncidentModal } from './IncidentModal.tsx'
import { ReminderModal } from './ReminderModal.tsx'
import { VehicleUpdateModal } from './VehicleUpdateModal.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'

/**
 * Lista de tarjetas de vehículo con el emparejamiento de sustitución (N9):
 * el principal cuyo sustituto está en la lista no sale suelto — vive detrás
 * del reel de su sustituto. Compartida entre "Mi vehículo" y "Flota a cargo".
 *
 * `lookup` es el universo donde buscar al otro coche de una pareja (puede ser
 * más amplio que `vehicles`, p. ej. todo el ámbito cuando la lista está
 * recortada por pestaña o búsqueda).
 */
export function VehicleCardList({
  vehicles,
  lookup,
  summaries,
  isSupervisor,
  onRefresh,
}: {
  vehicles: Vehicle[]
  lookup: Vehicle[]
  summaries: Record<number, VehicleSummary>
  isSupervisor: boolean | undefined
  /** La página vuelve a cargar sus datos tras guardar algo desde un modal. */
  onRefresh?: () => void
}) {
  const { t } = useLang()
  // Recordatorio (correo/alerta) del supervisor: un modal para toda la lista,
  // FUERA de las tarjetas — cada una es un <Link> y no puede contenerlo.
  const [remindFor, setRemindFor] = useState<Vehicle | null>(null)
  const onRemind = isSupervisor ? setRemindFor : undefined
  // Actualización de campo (km / mantenimiento / partes), también del supervisor.
  const [updateFor, setUpdateFor] = useState<Vehicle | null>(null)
  const onUpdate = isSupervisor ? setUpdateFor : undefined
  // Lanzar una averia (fase 1 del ciclo): modal con el coche fijado, para todos.
  const [breakdownFor, setBreakdownFor] = useState<Vehicle | null>(null)
  // Nueva incidencia (neumáticos / general / mantenimiento): también en modal.
  const [incidentFor, setIncidentFor] = useState<Vehicle | null>(null)
  // El parte de accidente completo de Gestión, disponible solo al supervisor.
  const [accidentFor, setAccidentFor] = useState<Vehicle | null>(null)
  const onAccident = isSupervisor ? setAccidentFor : undefined
  // Principales cuyo sustituto está en ESTA lista: viven dentro del reel.
  const reelMainIds = new Set<number>()
  vehicles.forEach((v) => {
    const main = summaries[v.id]?.substituting_for
    if (main && lookup.some((x) => x.id === main.main_id)) reelMainIds.add(main.main_id)
  })
  const topLevel = vehicles.filter((v) => !reelMainIds.has(v.id))

  return (
    <div className="vehicle-cards">
      {topLevel.map((v) => {
        const summary = summaries[v.id]
        const pair = pairedWith(summary)
        if (pair?.side === 'substitute') {
          const original = lookup.find((x) => x.id === pair.id) ?? null
          if (original) {
            return (
              <SubstitutionReel
                key={v.id}
                substitute={v}
                original={original}
                pair={pair}
                summaries={summaries}
                isSupervisor={isSupervisor}
                onRemind={onRemind}
                onUpdate={onUpdate}
                onBreakdown={setBreakdownFor}
                onIncident={setIncidentFor}
                onAccident={onAccident}
              />
            )
          }
          // Sustituto cuyo principal no está a la vista (lo lleva otra
          // persona): la marca sí, el reel no — no hay carta que asomar.
          return (
            <div key={v.id} className="sub-group">
              <VehicleCard
                vehicle={v}
                summary={summary}
                isSupervisor={isSupervisor}
                cardClass="card-substitute"
                tag={<Badge tone="info">{t.home.substituteTag}</Badge>}
                note={t.home.covering(pair.plate, pair.reason)}
                onRemind={onRemind}
                onUpdate={onUpdate}
                onBreakdown={setBreakdownFor}
                onIncident={setIncidentFor}
                onAccident={onAccident}
              />
            </div>
          )
        }
        if (pair?.side === 'main') {
          // Principal bloqueado sin su sustituto en la lista: ancho completo
          // con sus marcas (candado y motivo los pinta la propia tarjeta).
          return (
            <div key={v.id} className="sub-group">
              <VehicleCard
                vehicle={v}
                summary={summary}
                isSupervisor={isSupervisor}
                onRemind={onRemind}
                onUpdate={onUpdate}
                onBreakdown={setBreakdownFor}
                onIncident={setIncidentFor}
                onAccident={onAccident}
              />
            </div>
          )
        }
        return (
          <VehicleCard
            key={v.id}
            vehicle={v}
            summary={summary}
            isSupervisor={isSupervisor}
            onRemind={onRemind}
            onUpdate={onUpdate}
            onBreakdown={setBreakdownFor}
            onIncident={setIncidentFor}
            onAccident={onAccident}
          />
        )
      })}
      {remindFor && (
        <ReminderModal
          vehicle={remindFor}
          summary={summaries[remindFor.id]}
          onClose={() => setRemindFor(null)}
        />
      )}
      {updateFor && (
        <VehicleUpdateModal
          vehicle={updateFor}
          summary={summaries[updateFor.id]}
          onClose={() => setUpdateFor(null)}
          onSaved={onRefresh}
        />
      )}
      {breakdownFor && (
        <BreakdownModal
          vehicle={breakdownFor}
          onClose={() => setBreakdownFor(null)}
          onSaved={onRefresh}
        />
      )}
      {incidentFor && (
        <IncidentModal
          vehicle={incidentFor}
          onClose={() => setIncidentFor(null)}
          onSaved={onRefresh}
        />
      )}
      {accidentFor && (
        <AccidentModal
          vehicle={accidentFor}
          onClose={() => setAccidentFor(null)}
          onSaved={onRefresh}
        />
      )}
    </div>
  )
}

/**
 * Reel de la pareja de sustitución (N9): una sola fila a todo el ancho donde
 * SOLO se ve el sustituto; el botón junto a su matrícula lo desliza a la
 * derecha y el principal asoma desde la izquierda (y su botón devuelve).
 *
 * Las dos tarjetas quedan montadas (la animación las necesita); la oculta va
 * con `aria-hidden` + `inert` para que ni el lector de pantalla ni el tabulador
 * caigan en un coche que no está en pantalla.
 */
function SubstitutionReel({
  substitute,
  original,
  pair,
  summaries,
  isSupervisor,
  onRemind,
  onUpdate,
  onBreakdown,
  onIncident,
  onAccident,
}: {
  substitute: Vehicle
  original: Vehicle
  pair: { plate: string; reason: string }
  summaries: Record<number, VehicleSummary>
  isSupervisor: boolean | undefined
  onRemind?: (vehicle: Vehicle) => void
  onUpdate?: (vehicle: Vehicle) => void
  onBreakdown?: (vehicle: Vehicle) => void
  onIncident?: (vehicle: Vehicle) => void
  onAccident?: (vehicle: Vehicle) => void
}) {
  const { t } = useLang()
  const [showOriginal, setShowOriginal] = useState(false)
  return (
    <div className="sub-group">
      <div className="sub-reel">
        <div className={`sub-track${showOriginal ? ' show-original' : ''}`}>
          {/* El original vive a la IZQUIERDA del sustituto: al deslizar, asoma de ahí. */}
          <div className="sub-slide" aria-hidden={!showOriginal} inert={!showOriginal}>
            <VehicleCard
              vehicle={original}
              summary={summaries[original.id]}
              isSupervisor={isSupervisor}
              reelButton={{
                label: t.home.backToSubstitute(substitute.plate),
                dir: 'right',
                onClick: () => setShowOriginal(false),
              }}
            />
          </div>
          <div className="sub-slide" aria-hidden={showOriginal} inert={showOriginal}>
            <VehicleCard
              vehicle={substitute}
              summary={summaries[substitute.id]}
              isSupervisor={isSupervisor}
              cardClass="card-substitute"
              tag={<Badge tone="info">{t.home.substituteTag}</Badge>}
              note={t.home.covering(pair.plate, pair.reason)}
              onRemind={onRemind}
              onUpdate={onUpdate}
              onBreakdown={onBreakdown}
              onIncident={onIncident}
              onAccident={onAccident}
              reelButton={{
                label: t.home.showOriginal(pair.plate),
                dir: 'left',
                onClick: () => setShowOriginal(true),
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Tarjeta de vehículo de la lista de campo.
 *
 * Vive aquí (y no en la página) porque el reel de sustitución la pinta dos
 * veces (sustituto y principal) y "Flota a cargo" reutiliza la lista entera.
 */
function VehicleCard({
  vehicle,
  summary,
  isSupervisor,
  cardClass = '',
  tag,
  note,
  reelButton,
  onRemind,
  onUpdate,
  onBreakdown,
  onIncident,
  onAccident,
}: {
  vehicle: Vehicle
  summary: VehicleSummary | undefined
  isSupervisor: boolean | undefined
  /** Clase extra de la tarjeta (p. ej. la marca de sustitución). */
  cardClass?: string
  /** Chapita extra de la cabecera. */
  tag?: ReactNode
  /** Nota bajo el modelo (a quién cubre). */
  note?: string
  /** Botón del reel, a la izquierda de la matrícula: desliza al otro coche. */
  reelButton?: { label: string; dir: 'left' | 'right'; onClick: () => void }
  /** Abre el modal de recordatorio (correo/alerta) — solo supervisor. */
  onRemind?: (vehicle: Vehicle) => void
  /** Abre el modal de actualización (km/mantenimiento/partes) — solo supervisor. */
  onUpdate?: (vehicle: Vehicle) => void
  /** Abre el modal de avería (fase 1 del ciclo), con este coche fijado. */
  onBreakdown?: (vehicle: Vehicle) => void
  /** Abre el modal de nueva incidencia (neumáticos/general/mantenimiento). */
  onIncident?: (vehicle: Vehicle) => void
  /** Abre el parte guiado de accidente — solo supervisor. */
  onAccident?: (vehicle: Vehicle) => void
}) {
  const { t, language } = useLang()
  const navigate = useNavigate()
  const kmPending = summary ? pendingThisMonth(summary) : false
  // N9: el principal con sustituto activo se ve BLOQUEADO (atenuado, candado y
  // motivo); el sustituto operativo queda ligado visualmente.
  const blocked = summary?.blocked_by_link ?? null

  return (
    <Link to={`/vehiculos/${vehicle.id}`} className="card-link">
      <div className={`card${blocked ? ' card-blocked' : ''}${cardClass ? ` ${cardClass}` : ''}`}>
        <div className="vehicle-card">
          <div className="vehicle-card-head">
            {reelButton && (
              // A la izquierda de la matrícula. Es un <button> y no un <a>
              // porque la tarjeta entera ya es un enlace (anidar dos no es HTML
              // válido) y el clic hay que detenerlo para no abrir esta ficha.
              <button
                type="button"
                className="sub-jump"
                title={reelButton.label}
                aria-label={reelButton.label}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  reelButton.onClick()
                }}
              >
                {reelButton.dir === 'left' ? (
                  <ChevronLeft size={18} aria-hidden />
                ) : (
                  <ChevronRight size={18} aria-hidden />
                )}
              </button>
            )}
            <span className="plate">{vehicle.plate}</span>
            <Badge tone={vehicleStateTone(vehicle.state)}>{vehicle.state_display || '—'}</Badge>
            {tag}
            {blocked && <Badge tone="warning">🔒 {t.home.blocked}</Badge>}
            {/* La marca de "algo abierto": averías/incidencias sin cerrar. */}
            {(summary?.open_incidents ?? 0) > 0 && (
              <span title={t.home.openIncidents(summary?.open_incidents ?? 0)}>
                <Badge tone="warning" size="sm">
                  🔧 {summary?.open_incidents}
                </Badge>
              </span>
            )}
            <ChevronRight size={18} aria-hidden className="card-chevron" />
          </div>
          <p className="vehicle-model">
            {vehicle.brand} {vehicle.model}
          </p>
          {note && <p className="sub-note">{note}</p>}
          {blocked && (
            <p className="blocked-note">{t.home.blockedNote(blocked.reason, blocked.plate)}</p>
          )}
          <dl className="vehicle-meta">
            <dt>{t.home.km}</dt>
            <dd>
              {summary ? fmtKm(summary.km_current, language) : '…'}
              {kmPending && (
                // Atajo (mejora 🔴): la chapita lleva directo a registrar la
                // lectura de ESTE vehículo (sin pasar por la ficha).
                <button
                  type="button"
                  className="pending-link"
                  title={t.home.quickRegister}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    navigate(`/registrar?vehiculo=${vehicle.id}`)
                  }}
                >
                  <Badge tone="warning" size="sm">
                    <Gauge size={12} aria-hidden />{' '}
                    {summary?.km_reading_date
                      ? t.home.pendingSince(fmtDate(summary.km_reading_date, language))
                      : t.home.pendingReading}
                  </Badge>
                </button>
              )}
            </dd>
            {vehicle.next_itv_date && (
              <>
                <dt>{t.home.nextItv}</dt>
                <dd className={itvClass(vehicle.next_itv_date)}>
                  {fmtDate(vehicle.next_itv_date, language)}
                </dd>
              </>
            )}
            {/* GAP-8: próximo mantenimiento (si hay plan anclado), con el mismo
                semáforo de cercanía que la ITV. */}
            {summary?.next_maintenance_date && (
              <>
                <dt>{t.home.nextMaintenance}</dt>
                <dd className={itvClass(summary.next_maintenance_date)}>
                  {fmtDate(summary.next_maintenance_date, language)}
                </dd>
              </>
            )}
            {isSupervisor && summary?.driver && (
              <>
                <dt>{t.home.driver}</dt>
                <dd>{summary.driver.name}</dd>
              </>
            )}
            {/* Datos de gestión (solo supervisor): cuándo se leyó el cuenta-km
                por última vez y cómo va la proyección contra el contrato. */}
            {isSupervisor && summary && (
              <>
                <dt>{t.home.lastReading}</dt>
                <dd className={summary.km_reading_date ? '' : 'meta-muted'}>
                  {summary.km_reading_date
                    ? fmtDate(summary.km_reading_date, language)
                    : t.home.noReading}
                </dd>
              </>
            )}
            {isSupervisor && summary?.projection && (
              <>
                <dt>{t.home.projection}</dt>
                <dd>
                  <Badge tone={kmLevelTone(summary.projection.level)}>
                    {Math.round(summary.projection.pct_of_limit)}% ·{' '}
                    {t.group.levels[summary.projection.level] ?? summary.projection.level}
                  </Badge>
                </dd>
              </>
            )}
            {isSupervisor && summary?.unlimited_km && (
              <>
                <dt>{t.home.projection}</dt>
                <dd className="meta-muted">∞ {t.group.unlimited}</dd>
              </>
            )}
          </dl>
          {/* Altas de campo de ESTE coche, ya preseleccionado. Son <button>
              (la tarjeta entera es un enlace) y hay que frenar el clic para no
              abrir la ficha. El principal bloqueado no las ofrece: avería e
              incidencia se registran sobre su sustituto (N9). */}
          {!blocked && (
            <div className="card-report-actions">
              <button
                type="button"
                className="report-btn"
                title={`${t.shell.tabs.breakdown} · ${vehicle.plate}`}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  // Fase 1 del ciclo: modal con el coche fijado, no la vista.
                  onBreakdown?.(vehicle)
                }}
              >
                <Wrench size={15} aria-hidden /> {t.shell.tabs.breakdown}
              </button>
              <button
                type="button"
                className="report-btn"
                title={`${t.shell.tabs.incident} · ${vehicle.plate}`}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  // Modal con selector de tipo (neumáticos/general/mantenimiento).
                  onIncident?.(vehicle)
                }}
              >
                <TriangleAlert size={15} aria-hidden /> {t.shell.tabs.incident}
              </button>
              {onAccident && (
                <button
                  type="button"
                  className="report-btn"
                  title={`${t.accidentModal.button} · ${vehicle.plate}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onAccident(vehicle)
                  }}
                >
                  <Siren size={15} aria-hidden /> {t.accidentModal.button}
                </button>
              )}
              {onUpdate && (
                // Actualización de campo en nombre del conductor: km,
                // mantenimiento y partes de incidencia.
                <button
                  type="button"
                  className="report-btn report-btn-icon"
                  aria-label={t.carUpdate.button}
                  title={`${t.carUpdate.button} · ${vehicle.plate}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onUpdate(vehicle)
                  }}
                >
                  <ClipboardList size={16} aria-hidden />
                </button>
              )}
              {onRemind && (
                // Recordatorio al conductor (correo/alerta): icono a la derecha.
                <button
                  type="button"
                  className="report-btn report-btn-icon report-btn-follow"
                  aria-label={t.reminder.button}
                  title={`${t.reminder.button} · ${vehicle.plate}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onRemind(vehicle)
                  }}
                >
                  <Mail size={16} aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
