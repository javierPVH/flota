import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Users } from 'lucide-react'
import { Badge, PageHeader } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  fetchKmWindow,
  fetchVehicleSummaries,
  listAlerts,
  listDocuments,
  listIncidents,
  listVehicles,
  type KmWindow,
} from '../api.ts'
import { useAuth } from '../auth.ts'
import type { LayoutContext } from '../components/Layout.tsx'
import { useAccordion } from '../components/CollapsibleCard.tsx'
import { FieldDeadlines } from '../components/FieldDeadlines.tsx'
import { KmStatCard } from '../components/KmStatCard.tsx'
import { UpcomingDatesCard } from '../components/UpcomingDatesCard.tsx'
import { VehicleAlertsBreakdownsCard } from '../components/VehicleAlertsBreakdownsCard.tsx'
import { VehicleCardList } from '../components/VehicleCards.tsx'
import {
  documentStatusTone,
  fmtDate,
  isOpenBreakdown,
  pendingThisMonth,
  vehicleStateTone,
} from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Alert, FlotaDocument, Incident, Vehicle, VehicleSummary } from '../types.ts'

/** Solo enlaces http(s), como en la ficha de campo (el back ya sanea). */
function documentHref(doc: FlotaDocument): string {
  const safe = (url: string) => (/^https?:\/\//i.test(url) ? url : '')
  return safe(doc.drive_url) || safe(doc.file_url)
}

/**
 * M1 — Mi vehículo (HU-1.1). El back acota el listado por rol (conductor:
 * asignación vigente; supervisor: su grupo ∪ su coche), pero esta vista es
 * SIEMPRE la personal: el supervisor ve aquí solo lo que conduce — su flota a
 * cargo vive en el modo Flota, con la lista del grupo entera.
 *
 * La home es un TABLERO del coche propio: ficha, km y advertencias (ITV,
 * próximo mantenimiento) a todo el ancho, más acordeones con sus averías
 * abiertas y sus documentos. Si conduce el de SUSTITUCIÓN, el tablero es el
 * del sustituto (marcado como tal, con el motivo) y una flecha a la izquierda
 * desliza al coche propio, que aparece BLOQUEADO — el mismo reel de las
 * tarjetas de la flota, a tamaño de tablero.
 */
export function MyVehiclesPage({ onGoFleet }: { onGoFleet?: () => void }) {
  const { user } = useAuth()
  const { t } = useLang()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [summaries, setSummaries] = useState<Record<number, VehicleSummary>>({})
  // N8a: ventana de registro de km — alimenta la cuenta atrás de los avisos.
  const [kmWindow, setKmWindow] = useState<KmWindow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Registrar algo desde el bottom-nav (ITV, km, mantenimiento…) sube este
  // contador: el tablero se recarga y deja de anunciar una cita ya cumplida.
  const dataVersion = useOutletContext<LayoutContext | null>()?.dataVersion ?? 0

  useEffect(() => {
    let alive = true
    // Summaries en UNA petición (O2): antes era un GET por coche. La ventana y
    // los summaries no deben tumbar la página si fallan: solo quitan avisos.
    Promise.all([
      listVehicles(),
      fetchVehicleSummaries().catch(() => [] as VehicleSummary[]),
      fetchKmWindow().catch(() => null),
    ])
      .then(([page, loaded, window_]) => {
        if (!alive) return
        setVehicles(page.results)
        setSummaries(Object.fromEntries(loaded.map((s) => [s.vehicle, s])))
        setKmWindow(window_)
      })
      .catch((err) => alive && setError(asErrorMessage(err, t.home.loadError)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [t, dataVersion])

  const isSupervisor = user?.roles.includes('supervisor')
  const hasManagementScope = Boolean(
    user?.roles.some((role) => role === 'admin' || role === 'supervisor'),
  )

  // El ámbito de gestión trae más que los coches propios: toda la flota para
  // admin y todo su grupo para supervisor. Aquí solo interesan los que conduce
  // el usuario (asignación vigente = `summary.driver`). Al conductor puro el
  // back ya le devuelve exactamente los suyos.
  const ownVehicles = useMemo(() => {
    if (!hasManagementScope) return vehicles
    return vehicles.filter((v) => summaries[v.id]?.driver?.id === user?.id)
  }, [hasManagementScope, vehicles, summaries, user?.id])

  // El tablero cubre el caso normal (regla "un coche por conductor"): un solo
  // coche, o el sustituto que conduce + su principal. Con varios coches
  // sueltos (histórico raro) queda la lista de tarjetas de siempre.
  const dashboard = useMemo(() => {
    const covering = ownVehicles.find((v) => summaries[v.id]?.substituting_for)
    if (covering) {
      const pair = summaries[covering.id]?.substituting_for
      const original = (pair && vehicles.find((x) => x.id === pair.main_id)) || null
      const rest = ownVehicles.filter((v) => v.id !== covering.id && v.id !== original?.id)
      if (rest.length === 0) return { vehicle: covering, original }
      return null
    }
    if (ownVehicles.length === 1) return { vehicle: ownVehicles[0], original: null }
    return null
  }, [ownVehicles, summaries, vehicles])

  // Averías abiertas y documentos de los coches del tablero (1 o la pareja).
  const dashKey = dashboard
    ? [dashboard.vehicle.id, ...(dashboard.original ? [dashboard.original.id] : [])].join(',')
    : ''
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [documents, setDocuments] = useState<Record<number, FlotaDocument[]>>({})
  const loadPanelData = useCallback(() => {
    if (!dashKey) return
    const ids = dashKey.split(',').map(Number)
    listAlerts('open')
      .then((page) =>
        setAlerts(
          page.results.filter(
            (alert) => alert.vehicle !== null && ids.includes(alert.vehicle),
          ),
        ),
      )
      .catch(() => setAlerts([]))
    // Solo lo relacionado con averías, y sin las ya cerradas (mismo filtro
    // que la sección de averías del modal de Actualizar mantenimiento).
    Promise.all(
      ids.map((vid) =>
        listIncidents(vid).then(
          (page) => page.results,
          () => [] as Incident[],
        ),
      ),
    ).then((pages) => setIncidents(pages.flat().filter(isOpenBreakdown)))
    Promise.all(
      ids.map((vid) =>
        listDocuments(vid).then(
          (page) => [vid, page.results] as const,
          () => [vid, [] as FlotaDocument[]] as const,
        ),
      ),
    ).then((pairs) => setDocuments(Object.fromEntries(pairs)))
  }, [dashKey])
  // `dataVersion`: guardar desde el nav (una avería, un documento) obliga a
  // releer también estos acordeones.
  useEffect(loadPanelData, [loadPanelData, dataVersion])

  // Reel de la pareja: arranca enseñando el sustituto (el coche operativo).
  const [showOriginal, setShowOriginal] = useState(false)

  function refreshSummaries() {
    fetchVehicleSummaries()
      .then((loaded) => setSummaries(Object.fromEntries(loaded.map((item) => [item.vehicle, item]))))
      .catch(() => {})
  }

  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>
  if (error) return <div role="alert" className="form-error">{error}</div>

  const panel = (vehicle: Vehicle, reelButton?: ReelButton) => (
    <OwnVehiclePanel
      vehicle={vehicle}
      summary={summaries[vehicle.id]}
      alerts={alerts.filter((alert) => alert.vehicle === vehicle.id)}
      incidents={incidents.filter((i) => i.vehicle === vehicle.id)}
      documents={documents[vehicle.id] ?? []}
      window={kmWindow}
      canManage={hasManagementScope}
      onChanged={() => {
        refreshSummaries()
        loadPanelData()
      }}
      reelButton={reelButton}
    />
  )

  return (
    <div>
      {/* Con un solo coche (o ninguno) el título "Mi vehículo" no informa de
          nada: el tablero ya lo dice todo. El header solo aparece con varios. */}
      {ownVehicles.length > 1 && (
        <PageHeader
          title={t.home.myVehicles}
          stats={[
            { value: ownVehicles.length, label: t.home.statVehicles },
            {
              value: ownVehicles.filter((v) => {
                const s = summaries[v.id]
                return s && pendingThisMonth(s)
              }).length,
              label: t.home.statPending,
            },
          ]}
        />
      )}

      {/* Vencimientos a la vista (km e ITV) cuando quedan pocos días. Va antes
          del tablero para que lo urgente se lea primero. Solo de LO SUYO:
          los del grupo viven en "Flota a cargo". */}
      <FieldDeadlines vehicles={ownVehicles} summaries={summaries} window={kmWindow} />

      {/* Tablero de un solo coche (con sus marcas si está bloqueado o es un
          sustituto huérfano de pareja visible). */}
      {dashboard && !dashboard.original && panel(dashboard.vehicle)}

      {/* Pareja de sustitución: SOLO se ve el tablero del sustituto; la flecha
          junto a su matrícula desliza al coche propio, que sale BLOQUEADO. */}
      {dashboard?.original && (
        <div className="sub-group own-reel">
          <div className="sub-reel">
            <div className={`sub-track${showOriginal ? ' show-original' : ''}`}>
              <div className="sub-slide" aria-hidden={!showOriginal} inert={!showOriginal}>
                {panel(dashboard.original, {
                  label: t.home.backToSubstitute(dashboard.vehicle.plate),
                  dir: 'right',
                  onClick: () => setShowOriginal(false),
                })}
              </div>
              <div className="sub-slide" aria-hidden={showOriginal} inert={showOriginal}>
                {panel(dashboard.vehicle, {
                  label: t.home.showOriginal(
                    summaries[dashboard.vehicle.id]?.substituting_for?.plate ?? '',
                  ),
                  dir: 'left',
                  onClick: () => setShowOriginal(true),
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Supervisor sin coche propio: se dice, y se le manda a su flota
          (girando el switch del shell, que es la única puerta a esa vista). */}
      {ownVehicles.length === 0 && (
        <div className="card">
          <p className="empty-note">{t.home.ownEmpty}</p>
          {onGoFleet && (
            <button type="button" className="quick-action" onClick={onGoFleet}>
              <Users size={18} aria-hidden /> {t.home.ownEmptyCta}
            </button>
          )}
        </div>
      )}

      {/* Varios coches sueltos (fuera del caso normal): la lista de tarjetas
          de la flota, a todo el ancho y sin botones (viven en el nav). */}
      {!dashboard && ownVehicles.length > 1 && (
        <div className="own-vehicles">
          <VehicleCardList
            vehicles={ownVehicles}
            lookup={vehicles}
            summaries={summaries}
            isSupervisor={isSupervisor}
            onRefresh={refreshSummaries}
          />
        </div>
      )}

    </div>
  )
}

interface ReelButton {
  label: string
  dir: 'left' | 'right'
  onClick: () => void
}

/**
 * Tablero de UN coche: ficha, km y advertencias en divs a todo el ancho, y
 * acordeones PLEGADOS con sus averías abiertas y sus documentos. Las marcas
 * de la pareja (🔁 sustitución / 🔒 bloqueado) van en la propia ficha.
 */
function OwnVehiclePanel({
  vehicle,
  summary,
  alerts,
  incidents,
  documents,
  window: kmWindow,
  canManage,
  onChanged,
  reelButton,
}: {
  vehicle: Vehicle
  summary: VehicleSummary | undefined
  alerts: Alert[]
  incidents: Incident[]
  documents: FlotaDocument[]
  window: KmWindow | null
  canManage: boolean
  onChanged: () => void
  /** Flecha junto a la matrícula: desliza al otro coche de la pareja. */
  reelButton?: ReelButton
}) {
  const { t, language } = useLang()
  const accordion = useAccordion(['alerts'], ['alerts'])
  const blocked = summary?.blocked_by_link ?? null
  const covering = summary?.substituting_for ?? null

  return (
    <div className="own-panel">
      {/* Ficha: identidad + marcas del vínculo, inequívocas de un vistazo. */}
      <div
        className={`card own-ficha${blocked ? ' card-blocked' : ''}${covering ? ' card-substitute' : ''}`}
      >
        <div className="vehicle-card-head">
          {reelButton && (
            <button
              type="button"
              className="sub-jump"
              title={reelButton.label}
              aria-label={reelButton.label}
              onClick={reelButton.onClick}
            >
              {reelButton.dir === 'left' ? (
                <ChevronLeft size={18} aria-hidden />
              ) : (
                <ChevronRight size={18} aria-hidden />
              )}
            </button>
          )}
          <span className="plate plate-lg">{vehicle.plate}</span>
          <Badge tone={vehicleStateTone(vehicle.state)}>{vehicle.state_display || '—'}</Badge>
          {covering && <Badge tone="info">{t.home.substituteTag}</Badge>}
          {blocked && <Badge tone="warning">🔒 {t.home.blocked}</Badge>}
        </div>
        <p className="vehicle-model">
          {vehicle.brand} {vehicle.model}
          {vehicle.year ? ` · ${vehicle.year}` : ''}
        </p>
        {covering && <p className="sub-note">{t.home.covering(covering.plate, covering.reason)}</p>}
        {blocked && (
          <p className="blocked-note">{t.home.blockedNote(blocked.reason, blocked.plate)}</p>
        )}
        <Link to={`/vehiculos/${vehicle.id}`} className="link-btn own-ficha-link">
          {t.common.seeCard}
        </Link>
      </div>

      {/* Km, a todo el ancho: el MISMO div que en la ficha de campo (última
          lectura, mejor día para registrar y píldora de pendiente; la acción
          de registrar vive en el nav inferior). */}
      <KmStatCard summary={summary} window={kmWindow} />

      {/* Próximas citas: lectura de km, ITV y mantenimiento — el MISMO div
          que en la ficha, con la fecha y cuántos días faltan. */}
      <UpcomingDatesCard vehicle={vehicle} summary={summary} window={kmWindow} />

      <VehicleAlertsBreakdownsCard
        vehicle={vehicle}
        summary={summary}
        alerts={alerts}
        breakdowns={incidents}
        canManage={canManage}
        accordion={accordion}
        onChanged={onChanged}
      />

      {/* Acordeón de documentos (los archivos viven en Drive; la subida, en el
          nav inferior). */}
      <details className="card alert-group">
        <summary className="alert-group-head">
          <ChevronRight size={16} aria-hidden className="alert-group-chev" />
          <div className="alert-group-info">
            <div className="alert-group-title">
              <strong>{t.vehicle.documentsTitle}</strong>
              <Badge tone="info" size="sm">
                {documents.length}
              </Badge>
            </div>
          </div>
        </summary>
        <div className="alert-group-body">
          {documents.length === 0 && <p className="empty-note">{t.vehicle.noDocuments}</p>}
          {documents.length > 0 && (
            <ul className="doc-list">
              {documents.map((doc) => {
                const href = documentHref(doc)
                return (
                  <li key={doc.id} className="doc-item">
                    <FileText size={18} aria-hidden className="doc-icon" />
                    <div className="doc-info">
                      <strong>{doc.type_display}</strong>
                      <span className="doc-sub">
                        {fmtDate(doc.created_at, language)}
                        {doc.expiry_date
                          ? t.vehicle.expires(fmtDate(doc.expiry_date, language))
                          : ''}
                      </span>
                    </div>
                    <Badge tone={documentStatusTone(doc.status)}>{doc.status_display}</Badge>
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="doc-open"
                        aria-label={t.vehicle.openDoc(doc.type_display)}
                      >
                        <ExternalLink size={18} aria-hidden />
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </details>
    </div>
  )
}
