import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { BellOff, BellRing, ChevronRight, Gauge } from 'lucide-react'
import { Badge, Button, PageHeader } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchVehicleSummaries, listAlerts } from '../api.ts'
import { AlertResolveModal } from '../components/AlertResolveModal.tsx'
import { RegisterKmModal } from '../components/RegisterKmModal.tsx'
import { RegisterItvModal } from '../components/RegisterItvModal.tsx'
import { MaintenanceUpdateModal } from '../components/MaintenanceUpdateModal.tsx'
import { useAuth } from '../auth.ts'
import type { LayoutContext } from '../components/Layout.tsx'
import { alertLevelTone, fmtDate, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { disablePush, enablePush, pushState, type PushState } from '../push.ts'
import type { Alert, Vehicle, VehicleSummary } from '../types.ts'

// Crítica primero: a pie de vehículo se atiende lo urgente.
const LEVEL_RANK: Record<Alert['level'], number> = { critical: 0, warning: 1, info: 2 }

/** Acordeón por coche: sus alertas y el desglose por tipo de la cabecera. */
interface AlertGroup {
  key: string
  vehicle: number | null
  plate: string
  alerts: Alert[]
  /** Recuento por tipo, en orden de aparición (la lista ya viene por nivel). */
  types: Array<{ key: string; label: string; count: number }>
  worst: Alert['level']
}

/**
 * M5 — Bandeja de alertas del ámbito (HU-3.2/3.3/3.5/5.1/1.7). El back acota
 * por rol (conductor: sus vehículos; supervisor: su grupo) y solo la gestión
 * resuelve/descarta. Cada alerta enlaza a su acción natural.
 */
export function AlertsPage() {
  const { user } = useAuth()
  const { t } = useLang()
  const isSupervisor = user?.roles.includes('supervisor') ?? false
  // Modo "Mi vehículo" del supervisor: la bandeja se acota a su pareja (coche
  // propio + sustitución). Conductor o modo Flota: sin recorte.
  const ctx = useOutletContext<LayoutContext | null>()
  const ownIds = ctx && !ctx.fleetMode ? (ctx.ownPair?.ids ?? null) : null
  // Registrar desde el bottom-nav cierra alertas (ITV, lectura de km): la
  // bandeja tiene que releerse aunque el modal no sea suyo.
  const dataVersion = ctx?.dataVersion ?? 0

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [showClosed, setShowClosed] = useState(false)
  const [lastReadings, setLastReadings] = useState<Record<number, VehicleSummary>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // M8: estado del push en ESTE dispositivo ('disabled' oculta el toggle).
  const [push, setPush] = useState<PushState>('disabled')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')

  useEffect(() => {
    pushState().then(setPush, () => setPush('unknown'))
  }, [])

  async function togglePush() {
    setPushBusy(true)
    setPushError('')
    try {
      if (push === 'on') {
        await disablePush()
        setPush('off')
      } else {
        await enablePush()
        setPush('on')
      }
    } catch (err) {
      setPushError(asErrorMessage(err, t.alerts.pushError))
      pushState().then(setPush, () => {})
    } finally {
      setPushBusy(false)
    }
  }

  const load = useCallback(() => {
    setLoading(true)
    listAlerts(showClosed ? '' : 'open')
      .then((page) => {
        let sorted = [...page.results].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])
        // Modo "Mi vehículo" del supervisor: solo lo de su pareja (coche
        // propio + sustitución); en modo Flota se ve el grupo entero.
        if (ownIds) {
          sorted = sorted.filter((a) => a.vehicle !== null && ownIds.includes(a.vehicle))
        }
        setAlerts(sorted)
        // HU-3.3 (supervisor): la última lectura conocida de cada pendiente —
        // alimenta la pista «Última conocida» del modal de resolver por km.
        if (isSupervisor) {
          const pendingVehicles = [
            ...new Set(
              sorted
                .filter((a) => a.type === 'km_reading_pending' && a.status === 'open' && a.vehicle)
                .map((a) => a.vehicle as number),
            ),
          ]
          // Summaries en UNA petición (O2): antes era un GET por pendiente.
          // M12: y solo de los vehículos pendientes (`?ids=`), no de todo el
          // ámbito para tirar el resto en cliente.
          fetchVehicleSummaries(pendingVehicles)
            .then((summaries) =>
              setLastReadings(Object.fromEntries(summaries.map((s) => [s.vehicle, s]))),
            )
            .catch(() => setLastReadings({}))
        }
      })
      .catch((err) => setError(asErrorMessage(err, t.alerts.loadError)))
      .finally(() => setLoading(false))
  }, [showClosed, isSupervisor, ownIds, t])

  // `dataVersion`: registrar desde el nav cierra alertas — hay que releerlas.
  useEffect(load, [load, dataVersion])

  // Resolver es el ÚNICO cierre (descartar se retiró del dominio) y pasa por
  // un modal PERSONALIZADO por tipo: en lectura pendiente, registrar la
  // lectura; en el resto, observaciones que quedan en la resuelta.
  const [resolveFor, setResolveFor] = useState<Alert | null>(null)
  function close(alert: Alert) {
    setNotice('')
    setResolveFor(alert)
  }

  function resolved(alert: Alert) {
    setResolveFor(null)
    setNotice(t.alerts.resolved(alert.vehicle_plate || t.alerts.fleet))
    load()
  }

  const open = useMemo(() => alerts.filter((a) => a.status === 'open'), [alerts])
  const closed = useMemo(() => alerts.filter((a) => a.status !== 'open'), [alerts])

  // Clasificador GLOBAL de la bandeja. En «Todas», cada acordeón conserva su
  // select y sus secciones por tipo; al clasificar aquí, los acordeones se
  // quedan solo con ese tipo y, sin nada que clasificar dentro, pierden el
  // select y las secciones (lista plana).
  const [globalType, setGlobalType] = useState('all')
  const allTypes = useMemo(() => {
    const rows: Array<{ key: string; label: string; count: number }> = []
    for (const alert of open) {
      const row = rows.find((x) => x.key === alert.type)
      if (row) row.count += 1
      else rows.push({ key: alert.type, label: alert.type_display, count: 1 })
    }
    return rows
  }, [open])
  // Si el tipo elegido desaparece (p. ej. tras resolver), vuelta a «Todas».
  const activeGlobal =
    globalType === 'all' || allTypes.some((x) => x.key === globalType) ? globalType : 'all'
  const shownOpen =
    activeGlobal === 'all' ? open : open.filter((a) => a.type === activeGlobal)

  // Un acordeón por coche (las alertas de flota, sin vehículo, van juntas al
  // suyo), ordenados por urgencia: peor nivel primero y, a igualdad, el que
  // más alertas acumula.
  const groups = useMemo<AlertGroup[]>(() => {
    const map = new Map<string, AlertGroup>()
    for (const alert of shownOpen) {
      const key = alert.vehicle !== null ? String(alert.vehicle) : 'fleet'
      let group = map.get(key)
      if (!group) {
        group = {
          key,
          vehicle: alert.vehicle,
          plate: alert.vehicle !== null ? alert.vehicle_plate : t.alerts.groupFleet,
          alerts: [],
          types: [],
          worst: alert.level,
        }
        map.set(key, group)
      }
      group.alerts.push(alert)
      if (LEVEL_RANK[alert.level] < LEVEL_RANK[group.worst]) group.worst = alert.level
      const row = group.types.find((x) => x.key === alert.type)
      if (row) row.count += 1
      else group.types.push({ key: alert.type, label: alert.type_display, count: 1 })
    }
    return [...map.values()].sort(
      (a, b) =>
        LEVEL_RANK[a.worst] - LEVEL_RANK[b.worst] ||
        b.alerts.length - a.alerts.length ||
        a.plate.localeCompare(b.plate),
    )
  }, [shownOpen, t])

  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>
  if (error) return <div role="alert" className="form-error">{error}</div>

  return (
    <div>
      <PageHeader
        title={t.alerts.title}
        actions={
          <button type="button" className="link-btn" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? t.alerts.onlyOpen : t.alerts.showClosed}
          </button>
        }
      />

      {notice && <p role="status" className="form-ok">{notice}</p>}

      {/* M8: avisos push de este dispositivo (oculto si el back no los tiene).
          BG7: 'unknown' (fallo de red) NO oculta el panel — ofrece reintentar. */}
      {push !== 'disabled' && push !== 'unsupported' && (
        <section className="card">
          <div className="push-row">
            <BellRing size={18} aria-hidden className="doc-icon" />
            <div className="doc-info">
              <strong>{t.alerts.pushTitle}</strong>
              <span className="doc-sub">
                {push === 'on'
                  ? t.alerts.pushOn
                  : push === 'blocked'
                    ? t.alerts.pushBlocked
                    : push === 'unknown'
                      ? t.alerts.pushUnknown
                      : t.alerts.pushOff}
              </span>
            </div>
            {push === 'unknown' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => pushState().then(setPush, () => setPush('unknown'))}
              >
                {t.alerts.pushRetry}
              </Button>
            ) : (
              push !== 'blocked' && (
                <Button
                  size="sm"
                  variant={push === 'on' ? 'secondary' : 'primary'}
                  onClick={() => void togglePush()}
                  disabled={pushBusy}
                >
                  {pushBusy ? '…' : push === 'on' ? t.alerts.pushDisable : t.alerts.pushEnable}
                </Button>
              )
            )}
          </div>
          {pushError && <div role="alert" className="form-error">{pushError}</div>}
        </section>
      )}

      {open.length === 0 && (
        <div className="alerts-empty">
          <BellOff size={40} aria-hidden />
          <p>{t.alerts.empty}</p>
        </div>
      )}

      {/* Clasificador global: con un solo tipo abierto no hay nada que
          clasificar y no se pinta. */}
      {allTypes.length > 1 && (
        <select
          className="fleet-state-select alert-global-select"
          aria-label={t.alerts.classifyLabel}
          value={activeGlobal}
          onChange={(e) => setGlobalType(e.target.value)}
        >
          <option value="all">
            {t.alerts.tabAll} ({open.length})
          </option>
          {allTypes.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label} ({x.count})
            </option>
          ))}
        </select>
      )}

      {/* Un acordeón por coche, PLEGADO: la cabecera resume cuántas alertas
          hay y cuántas de cada tipo; desplegar enseña las tarjetas con su
          propio clasificador por tipo. */}
      <div className="alert-groups">
        {groups.map((group) => (
          <AlertGroupItem
            key={group.key}
            group={group}
            isSupervisor={isSupervisor}
            onClose={close}
          />
        ))}
      </div>

      {showClosed && closed.length > 0 && (
        <>
          <h3 className="closed-title">{t.alerts.closedTitle}</h3>
          <div className="vehicle-cards">
            {closed.map((alert) => (
              <section key={alert.id} className="card">
                <AlertCard alert={alert} isSupervisor={false} onClose={close} />
              </section>
            ))}
          </div>
        </>
      )}

      {resolveFor && resolveFor.vehicle !== null && resolveFor.type === 'km_reading_pending' && (
        <RegisterKmModal
          vehicle={{ id: resolveFor.vehicle, plate: resolveFor.vehicle_plate } as Vehicle}
          summary={lastReadings[resolveFor.vehicle] ?? null}
          onClose={() => setResolveFor(null)}
          onSaved={() => resolved(resolveFor)}
        />
      )}

      {resolveFor && resolveFor.vehicle !== null && resolveFor.type === 'itv_due' && (
        <RegisterItvModal
          vehicle={{ id: resolveFor.vehicle, plate: resolveFor.vehicle_plate } as Vehicle}
          // La cita la trae el propio aviso: sin pedir el resumen del coche.
          nextItvDate={resolveFor.due_date}
          onClose={() => setResolveFor(null)}
          onSaved={() => resolved(resolveFor)}
        />
      )}

      {resolveFor && resolveFor.vehicle !== null && resolveFor.type === 'maintenance_due' && (
        <MaintenanceUpdateModal
          vehicle={{ id: resolveFor.vehicle, plate: resolveFor.vehicle_plate } as Vehicle}
          onClose={() => setResolveFor(null)}
          onSaved={() => resolved(resolveFor)}
        />
      )}

      {resolveFor && !['km_reading_pending', 'itv_due', 'maintenance_due'].includes(resolveFor.type) && (
        <AlertResolveModal
          alert={resolveFor}
          summary={resolveFor.vehicle !== null ? lastReadings[resolveFor.vehicle] : undefined}
          onClose={() => setResolveFor(null)}
          onResolved={() => resolved(resolveFor)}
        />
      )}
    </div>
  )
}

/**
 * Acordeón de UN coche. Dentro, un select clasifica sus alertas por tipo
 * («Todas (N)» por defecto + un tipo por opción con su recuento); la cabecera
 * sigue resumiendo el total sin filtrar.
 */
function AlertGroupItem({
  group,
  isSupervisor,
  onClose,
}: {
  group: AlertGroup
  isSupervisor: boolean
  onClose: (alert: Alert) => void
}) {
  const { t } = useLang()
  const [type, setType] = useState('all')
  const active = type === 'all' || group.types.some((x) => x.key === type) ? type : 'all'
  const shown = active === 'all' ? group.alerts : group.alerts.filter((a) => a.type === active)
  return (
    <details className="card alert-group">
      <summary className="alert-group-head">
        <ChevronRight size={16} aria-hidden className="alert-group-chev" />
        <div className="alert-group-info">
          <div className="alert-group-title">
            <span className="plate">{group.plate}</span>
            <Badge tone={alertLevelTone(group.worst)} size="sm">
              {t.alerts.groupCount(group.alerts.length)}
            </Badge>
          </div>
          <span className="alert-group-types">
            {group.types.map((x) => `${x.label} ×${x.count}`).join(' · ')}
          </span>
        </div>
      </summary>
      <div className="alert-group-body">
        {/* Con un solo tipo no hay nada que clasificar: el select no se pinta. */}
        {group.types.length > 1 && (
          <select
            className="fleet-state-select alert-type-select"
            aria-label={t.alerts.typeFilter}
            value={active}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="all">
              {t.alerts.tabAll} ({group.alerts.length})
            </option>
            {group.types.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label} ({x.count})
              </option>
            ))}
          </select>
        )}
        {active === 'all' && group.types.length > 1
          ? // En «Todas», las alertas van por SECCIONES de tipo: una línea
            // horizontal divide los grupos y el título pliega/despliega.
            // Nacen ENCOGIDAS: al abrir el coche se ve el índice de tipos.
            group.types.map((row) => (
              <details key={row.key} className="alert-type-section">
                <summary className="alert-type-head">
                  <ChevronRight size={14} aria-hidden className="alert-type-chev" />
                  {`${row.label} ×${row.count}`}
                </summary>
                {group.alerts
                  .filter((alert) => alert.type === row.key)
                  .map((alert) => (
                    <AlertCard
                      key={alert.id}
                      alert={alert}
                      isSupervisor={isSupervisor}
                      onClose={onClose}
                      showPlate={false}
                      showType={false}
                    />
                  ))}
              </details>
            ))
          : shown.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                isSupervisor={isSupervisor}
                onClose={onClose}
                showPlate={false}
              />
            ))}
        {/* La ficha es la MISMA para todas las alertas del coche: un solo
            enlace al pie, en vez de repetir el botón en cada una. */}
        {group.vehicle !== null && (
          <div className="alert-group-foot">
            <Link to={`/vehiculos/${group.vehicle}`} className="link-btn">
              {t.common.seeCard} · {group.plate}
            </Link>
          </div>
        )}
      </div>
    </details>
  )
}

export function AlertCard({
  alert,
  isSupervisor,
  onClose,
  onRegisterKm,
  showPlate = true,
  showType = true,
}: {
  alert: Alert
  isSupervisor: boolean
  onClose: (alert: Alert) => void
  /** En la ficha, registrar km se resuelve sin abandonar la página. */
  onRegisterKm?: () => void
  /** Dentro del acordeón de su coche la matrícula ya la dice la cabecera. */
  showPlate?: boolean
  /** Dentro de la sección de su tipo, el tipo ya lo dice el título. */
  showType?: boolean
}) {
  const { t } = useLang()
  const isOpen = alert.status === 'open'
  // Vencimiento ya pasado: la fecha se resalta (el rojo dice "esto ya tocaba").
  const overdue = Boolean(alert.due_date && alert.due_date < todayIso())
  // Sin tarjeta propia: la abierta vive dentro del acordeón de su coche y la
  // cerrada la envuelve su sección en `.card`. La franja izquierda lleva el
  // color del nivel: se distingue la crítica del aviso de un vistazo.
  return (
    <div className={`alert-card level-${alert.level}${isOpen ? '' : ' alert-closed'}`}>
      <div className="alert-card-head">
        {showType && <span className="alert-type">{alert.type_display}</span>}
        <Badge tone={alertLevelTone(alert.level)} size="sm">
          {alert.level_display}
        </Badge>
        {!isOpen && (
          <Badge tone="success" size="sm">
            {alert.status_display}
          </Badge>
        )}
      </div>
      <p className="alert-message">
        {showPlate && alert.vehicle && (
          <Link to={`/vehiculos/${alert.vehicle}`} className="plate alert-plate">
            {alert.vehicle_plate}
          </Link>
        )}{' '}
        {alert.message}
      </p>
      <div className="alert-foot">
        <span className="alert-meta">
          {alert.due_date && (
            <span className={overdue ? 'alert-due-over' : ''}>
              {t.alerts.due(fmtDate(alert.due_date))}
            </span>
          )}
          {alert.due_date ? ' · ' : ''}
          {t.alerts.created(fmtDate(alert.created_at))}
        </span>
        {isOpen && (
          <span className="alert-actions-inline">
            {/* El supervisor ya no lleva el botón suelto: su «Resolver» abre
                directamente el formulario de registrar la lectura. */}
            {!isSupervisor && alert.vehicle && alert.type === 'km_reading_pending' && (
              onRegisterKm ? (
                <button type="button" className="link-btn" onClick={onRegisterKm}>
                  <Gauge size={16} aria-hidden /> {t.common.registerKm}
                </button>
              ) : (
                <Link to={`/registrar?vehiculo=${alert.vehicle}`} className="link-btn">
                  <Gauge size={16} aria-hidden /> {t.common.registerKm}
                </Link>
              )
            )}
            {isSupervisor && (
              <Button size="sm" variant="secondary" onClick={() => onClose(alert)}>
                {t.alerts.resolve}
              </Button>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
