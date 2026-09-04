import { useCallback, useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Camera,
  ClipboardCheck,
  ClipboardList,
  ExternalLink,
  FileText,
  Fuel,
  Gauge,
  Mail,
  Siren,
  Wrench,
} from 'lucide-react'
import { Badge, Button, Panel } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  fetchKmWindow,
  fetchVehicle,
  fetchVehicleSummary,
  listAlerts,
  listDocuments,
  listIncidents,
  type KmWindow,
} from '../api.ts'
import { useAuth } from '../auth.ts'
import {
  AccordionTools,
  CollapsibleCard,
  useAccordion,
} from '../components/CollapsibleCard.tsx'
import { AccidentModal } from '../components/AccidentModal.tsx'
import { BreakdownModal } from '../components/BreakdownModal.tsx'
import { RegisterFuelModal } from '../components/RegisterFuelModal.tsx'
import { KmStatCard } from '../components/KmStatCard.tsx'
import { UpcomingDatesCard } from '../components/UpcomingDatesCard.tsx'
import { VehicleAlertsBreakdownsCard } from '../components/VehicleAlertsBreakdownsCard.tsx'
import { RegisterKmModal } from '../components/RegisterKmModal.tsx'
import { ReminderModal } from '../components/ReminderModal.tsx'
import { MaintenanceUpdateModal } from '../components/MaintenanceUpdateModal.tsx'
import { UploadDocumentModal } from '../components/UploadDocumentModal.tsx'
import { RegisterItvModal } from '../components/RegisterItvModal.tsx'
import type { LayoutContext } from '../components/Layout.tsx'
import { useLang } from '../i18n.tsx'
import {
  documentStatusTone,
  fmtDate,
  fmtKm,
  isOpenBreakdown,
  kmLevelTone,
  pendingThisMonth,
  scheduledActionAvailable,
  vehicleStateTone,
} from '../format.ts'
import type { Alert, FlotaDocument, Incident, Vehicle, VehicleSummary } from '../types.ts'

/** Solo enlaces http(s): corta javascript:/data: aunque el back ya sanea. */
function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : ''
}

/** Enlace al archivo: Drive si ya está archivado; staging local si no. */
function documentHref(doc: FlotaDocument): string {
  return safeHref(doc.drive_url) || safeHref(doc.file_url)
}

/**
 * M2 — Ficha de campo (HU-1.2 lectura, 4.1, 4.3): consulta rápida a pie de
 * vehículo + subida de documentos por cámara/galería (multipart; el back
 * archiva en la carpeta de Drive del vehículo — Fase A3).
 */
export function VehicleFieldPage() {
  const { id } = useParams()
  const vehicleId = Number(id)
  const { t, language } = useLang()
  const { user } = useAuth()
  const isSupervisor = user?.roles.includes('supervisor') ?? false
  const canManage =
    user?.roles.some((role) => role === 'admin' || role === 'supervisor') ?? false
  // En modo "Mi vehículo", el nav inferior ya lleva las cinco acciones SOBRE
  // el coche operativo: su ficha no las repite. El principal bloqueado (el nav
  // apunta al sustituto) y las fichas en modo Flota conservan las suyas.
  const ctx = useOutletContext<LayoutContext | null>()
  const actionsInNav = Boolean(ctx && !ctx.fleetMode && ctx.ownPair?.target === vehicleId)

  // Acordeón de tarjetas (mejora): desplegadas por defecto; en móvil plegar
  // ahorra mucho scroll.
  const accordion = useAccordion(['situation', 'alerts', 'documents'])

  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [summary, setSummary] = useState<VehicleSummary | null>(null)
  // N8a: la ventana de registro — pinta el "mejor día" del div de km. Si
  // falla, solo desaparece esa línea.
  const [kmWindow, setKmWindow] = useState<KmWindow | null>(null)
  useEffect(() => {
    fetchKmWindow().then(setKmWindow, () => setKmWindow(null))
  }, [])
  const [documents, setDocuments] = useState<FlotaDocument[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // M4: registro de ITV (HU-5.1). La propuesta de fechas (HU-2.3) se retiró:
  // su bandeja de confirmación ya no existe en gestión, así que enviarlas solo
  // dejaba al conductor esperando una respuesta que nadie podía dar.
  const [itvOpen, setItvOpen] = useState(false)
  const [itvOk, setItvOk] = useState('')

  // Herramientas del supervisor (las mismas de las tarjetas de la flota).
  const [remindOpen, setRemindOpen] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const [documentOpen, setDocumentOpen] = useState(false)
  const [kmOpen, setKmOpen] = useState(false)
  // GAP-2: gasto de combustible (aqui lo usa la supervisora; el conductor lo
  // tiene en el nav, donde viven sus acciones).
  const [fuelOpen, setFuelOpen] = useState(false)
  // Parte guiado de accidente: la supervisora lo abre desde la ficha igual que
  // desde las tarjetas de la flota (el conductor lo tiene en el nav).
  const [accidentOpen, setAccidentOpen] = useState(false)

  // Tras guardar algo desde el modal de actualización: datos frescos.
  const reload = useCallback(() => {
    fetchVehicle(vehicleId).then(setVehicle, () => {})
    fetchVehicleSummary(vehicleId).then(setSummary, () => {})
    listIncidents(vehicleId)
      .then((page) => setIncidents(page.results.filter((i) => i.status !== 'closed')))
      .catch(() => {})
    listAlerts('open')
      .then((page) => setAlerts(page.results.filter((alert) => alert.vehicle === vehicleId)))
      .catch(() => {})
  }, [vehicleId])

  const loadDocuments = useCallback(() => {
    listDocuments(vehicleId)
      .then((page) => setDocuments(page.results))
      .catch(() => setDocuments([]))
  }, [vehicleId])

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([fetchVehicle(vehicleId), fetchVehicleSummary(vehicleId)])
      .then(([v, s]) => {
        if (!alive) return
        setVehicle(v)
        setSummary(s)
      })
      .catch((err) => alive && setError(asErrorMessage(err, t.vehicle.loadError)))
      .finally(() => alive && setLoading(false))
    loadDocuments()
    return () => {
      alive = false
    }
  }, [vehicleId, loadDocuments])

  // Incidencias abiertas del vehículo: el conductor las LEE (el back acota a
  // sus vehículos); gestionarlas sigue siendo cosa de gestión. También sirven
  // para ligar el acta/parte/fotos al subir un documento.
  useEffect(() => {
    listIncidents(vehicleId)
      .then((page) => setIncidents(page.results.filter((i) => i.status !== 'closed')))
      .catch(() => setIncidents([]))
  }, [vehicleId])

  useEffect(() => {
    listAlerts('open')
      .then((page) => setAlerts(page.results.filter((alert) => alert.vehicle === vehicleId)))
      .catch(() => setAlerts([]))
  }, [vehicleId])

  // Los modales del bottom-nav viven FUERA de la página: sin esto, registrar
  // la ITV (o los km) desde el nav dejaba la ficha con la cita ya cumplida.
  const dataVersion = ctx?.dataVersion ?? 0
  useEffect(() => {
    if (dataVersion === 0) return // 0 = aún no se ha guardado nada
    reload()
    loadDocuments()
  }, [dataVersion, reload, loadDocuments])


  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>
  if (error || !vehicle) return <div role="alert" className="form-error">{error || t.vehicle.notFound}</div>

  const kmPending = summary ? pendingThisMonth(summary) : false
  const blocked = summary?.blocked_by_link ?? null
  const projection = summary?.projection ?? null
  const contract = summary?.contract ?? null
  const itvAvailable = scheduledActionAvailable(
    summary?.next_itv_date ?? vehicle.next_itv_date,
  )
  const maintenanceAvailable = scheduledActionAvailable(summary?.next_maintenance_date)

  return (
    <div className="field-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} aria-hidden /> {t.vehicle.back}
      </Link>

      <header className="field-head">
        <span className="plate plate-lg">{vehicle.plate}</span>
        <Badge tone={vehicleStateTone(vehicle.state)}>{vehicle.state_display || '—'}</Badge>
        {/* Las marcas N9, como en las tarjetas: se ven sin bajar a los paneles. */}
        {(vehicle.is_substitute || summary?.substituting_for) && (
          <Badge tone="info">{t.home.substituteTag}</Badge>
        )}
        {blocked && <Badge tone="warning">🔒 {t.home.blocked}</Badge>}
      </header>
      <p className="vehicle-model">
        {vehicle.brand} {vehicle.model}
        {vehicle.year ? ` · ${vehicle.year}` : ''}
      </p>

      <div className="stat-row">
        {/* El MISMO div de km que el tablero de la home (KmStatCard): última
            lectura, mejor día para registrar y píldora de pendiente. */}
        <KmStatCard summary={summary} window={kmWindow} />
      </div>

      {/* Y las MISMAS «Próximas citas» que el tablero: lectura de km, ITV y
          mantenimiento, cada una con su fecha y cuántos días faltan. */}
      <UpcomingDatesCard vehicle={vehicle} summary={summary} window={kmWindow} />

      {/* Proyección contra el contrato (solo supervisor): el mismo cuadro
          compacto de la vista del grupo, aquí para UN coche. */}
      {isSupervisor && projection && contract && (
        <section className={`card km-card km-level-${projection.level}`}>
          <div className="km-card-head">
            <div className="km-card-id">
              <div className="km-card-plate">
                <strong>{t.home.projection}</strong>
                <Badge tone={kmLevelTone(projection.level)}>
                  {t.group.levels[projection.level] ?? projection.level}
                </Badge>
              </div>
            </div>
            <span className="km-pct">{Math.round(projection.pct_of_limit)}%</span>
          </div>
          <div
            className="km-progress"
            role="progressbar"
            aria-valuenow={Math.min(100, Math.round(projection.pct_of_limit))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t.group.progressLabel(Math.round(projection.pct_of_limit))}
          >
            <div
              className={`km-progress-fill ${
                projection.level === 'watch'
                  ? 'level-watch'
                  : projection.level === 'over'
                    ? 'level-over'
                    : 'level-ok'
              }`}
              style={{ width: `${Math.min(100, Math.round(projection.pct_of_limit))}%` }}
            />
          </div>
          <div className="km-caption">
            <span>
              {t.group.consumedOf(
                fmtKm(summary?.km_driven, language),
                fmtKm(contract.contract_km, language),
              )}
            </span>
          </div>
        </section>
      )}

      {/* N9: al abrir la ficha hay que ver de inmediato en qué lado del vínculo
          de sustitución está este coche. Va ANTES de todo lo accionable: si está
          bloqueado, lo que se registre aquí no es lo que toca. */}
      {summary?.blocked_by_link && (
        <Panel tone="warning">
          <p className="panel-note">
            <strong>{t.vehicle.blockedTitle}</strong>
            <br />
            {t.vehicle.blockedPanel(
              summary.blocked_by_link.reason,
              summary.blocked_by_link.plate,
            )}{' '}
            <Link to={`/vehiculos/${summary.blocked_by_link.substitute_id}`}>
              {summary.blocked_by_link.plate}
            </Link>
          </p>
        </Panel>
      )}

      {summary?.substituting_for && (
        <Panel tone="info">
          <p className="panel-note">
            <strong>{t.vehicle.coveringTitle}</strong>
            <br />
            {t.vehicle.coveringPanel(
              summary.substituting_for.plate,
              summary.substituting_for.reason,
            )}
          </p>
        </Panel>
      )}

      {kmPending && (
        <Panel tone="warning">
          <p className="panel-note">
            {t.vehicle.kmPending}{' '}
            <button type="button" className="link-btn" onClick={() => setKmOpen(true)}>{t.vehicle.kmPendingCta}</button>
          </p>
        </Panel>
      )}

      {/* Acciones en el orden operativo solicitado. En un principal bloqueado
          se apagan km, avería y documentos; la ITV sigue disponible. */}
      {!actionsInNav && (
      <div className="quick-actions">
        {blocked ? (
          <span className="quick-action is-disabled" aria-disabled="true" title={t.vehicle.blockedActions}>
            <Gauge size={20} aria-hidden /> {t.common.registerKm}
          </span>
        ) : (
          <button type="button" className="quick-action" onClick={() => setKmOpen(true)}>
            <Gauge size={20} aria-hidden /> {t.common.registerKm}
          </button>
        )}

        {blocked ? (
          <span className="quick-action is-disabled" aria-disabled="true" title={t.vehicle.blockedActions}>
            <Fuel size={20} aria-hidden /> {t.fuel.title}
          </span>
        ) : (
          <button type="button" className="quick-action" onClick={() => setFuelOpen(true)}>
            <Fuel size={20} aria-hidden /> {t.fuel.title}
          </button>
        )}

        <button
          type="button"
          className={`quick-action${itvAvailable ? '' : ' is-disabled'}`}
          disabled={!itvAvailable}
          title={!itvAvailable ? t.vehicle.scheduledActionUnavailable : undefined}
          onClick={() => {
            setItvOk('')
            setItvOpen(true)
          }}
        >
          <ClipboardCheck size={20} aria-hidden /> {t.vehicle.quickItv}
        </button>

        {isSupervisor && (
          <button
            type="button"
            className={`quick-action${maintenanceAvailable ? '' : ' is-disabled'}`}
            disabled={!maintenanceAvailable}
            title={!maintenanceAvailable ? t.vehicle.scheduledActionUnavailable : undefined}
            onClick={() => setUpdateOpen(true)}
          >
            <ClipboardList size={20} aria-hidden /> {t.carUpdate.maintenanceButton}
          </button>
        )}

        {blocked ? (
          <span className="quick-action is-disabled" aria-disabled="true" title={t.vehicle.blockedActions}>
            <Wrench size={20} aria-hidden /> {t.home.quickBreakdown}
          </span>
        ) : (
          <button type="button" className="quick-action" onClick={() => setBreakdownOpen(true)}>
            <Wrench size={20} aria-hidden /> {t.home.quickBreakdown}
          </button>
        )}

        {/* Accidente, junto a la avería y con el MISMO aviso de bloqueo que
            el resto: en un principal bloqueado, lo que se comunique aquí no es
            lo que toca (el parte va sobre el coche que está circulando). */}
        {isSupervisor &&
          (blocked ? (
            <span className="quick-action is-disabled" aria-disabled="true" title={t.vehicle.blockedActions}>
              <Siren size={20} aria-hidden /> {t.accidentModal.button}
            </span>
          ) : (
            <button type="button" className="quick-action" onClick={() => setAccidentOpen(true)}>
              <Siren size={20} aria-hidden /> {t.accidentModal.button}
            </button>
          ))}

        {blocked ? (
          <span className="quick-action is-disabled" aria-disabled="true" title={t.vehicle.blockedActions}>
            <Camera size={20} aria-hidden /> {t.vehicle.quickUpload}
          </span>
        ) : (
          <button type="button" className="quick-action" onClick={() => setDocumentOpen(true)}>
            <Camera size={20} aria-hidden /> {t.vehicle.quickUpload}
          </button>
        )}

        {isSupervisor && (
          <button type="button" className="quick-action" onClick={() => setRemindOpen(true)}>
            <Mail size={20} aria-hidden /> {t.reminder.button}
          </button>
        )}
      </div>
      )}

      {itvOk && <p role="status" className="form-ok">{itvOk}</p>}

      <AccordionTools accordion={accordion} />

      {/* Tres atributos independientes (HU-1.6), en solo lectura. */}
      <CollapsibleCard id="situation" headingClassName="panel-title" accordion={accordion} title={t.vehicle.situationTitle}>
        <dl className="vehicle-meta">
          <dt>{t.vehicle.state}</dt>
          <dd>
            <Badge tone={vehicleStateTone(vehicle.state)}>{vehicle.state_display || '—'}</Badge>
          </dd>
          <dt>{t.vehicle.substitution}</dt>
          <dd>{vehicle.is_substitute ? t.vehicle.isSubstitute : t.vehicle.mainVehicle}</dd>
          <dt>{t.vehicle.driver}</dt>
          <dd>{summary?.driver?.name ?? t.vehicle.noDriver}</dd>
          {vehicle.supervisor_name && (
            <>
              <dt>{t.vehicle.supervisor}</dt>
              <dd>{vehicle.supervisor_name}</dd>
            </>
          )}
          <dt>{t.vehicle.use}</dt>
          <dd>{vehicle.business_use || '—'}</dd>
        </dl>
      </CollapsibleCard>

      <VehicleAlertsBreakdownsCard
        vehicle={vehicle}
        summary={summary}
        alerts={alerts}
        breakdowns={incidents.filter(isOpenBreakdown)}
        canManage={canManage}
        accordion={accordion}
        onChanged={reload}
      />

      {/* Documentos (HU-4.1/4.3): viven en Drive; aquí solo la referencia. */}
      <CollapsibleCard
        id="documents"
        headingClassName="panel-title"
        accordion={accordion}
        title={t.vehicle.documentsTitle}
        actions={
          // La subida se resuelve en su VISTA propia, no en un formulario
          // desplegable dentro de la ficha (pantalla pequeña, un paso cada vez).
          <Link to={`/documentos/nuevo?vehiculo=${vehicleId}`}>
            <Button size="sm">
              <Camera size={16} aria-hidden /> {t.vehicle.upload}
            </Button>
          </Link>
        }
      >
        {documents.length === 0 && <p className="empty-note">{t.vehicle.noDocuments}</p>}
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
                    {doc.expiry_date ? t.vehicle.expires(fmtDate(doc.expiry_date, language)) : ''}
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

      </CollapsibleCard>

      {/* El modal de ITV vive en la RAIZ de la pagina, no dentro de la
          tarjeta de documentos: plegada, el modal no se montaba (BG). */}
      {itvOpen && (
        <RegisterItvModal
          vehicle={vehicle}
          nextItvDate={summary?.next_itv_date ?? vehicle.next_itv_date}
          onClose={() => setItvOpen(false)}
          onSaved={(message) => {
            setItvOk(message)
            reload()
          }}
        />
      )}

      {fuelOpen && (
        <RegisterFuelModal
          vehicle={vehicle}
          summary={summary}
          onClose={() => setFuelOpen(false)}
          onSaved={() => reload()}
        />
      )}

      {accidentOpen && (
        <AccidentModal
          vehicle={vehicle}
          onClose={() => setAccidentOpen(false)}
          onSaved={() => {
            reload()
            loadDocuments()
          }}
        />
      )}
      {breakdownOpen && (
        <BreakdownModal
          vehicle={vehicle}
          kmCurrent={summary?.km_current ?? null}
          onClose={() => setBreakdownOpen(false)}
          onSaved={() => {
            reload()
            loadDocuments()
          }}
        />
      )}
      {kmOpen && (
        <RegisterKmModal
          vehicle={vehicle}
          summary={summary}
          onClose={() => setKmOpen(false)}
          onSaved={reload}
        />
      )}
      {documentOpen && (
        <UploadDocumentModal
          vehicle={vehicle}
          onClose={() => setDocumentOpen(false)}
          onSaved={loadDocuments}
        />
      )}
      {remindOpen && (
        <ReminderModal
          vehicle={vehicle}
          summary={summary ?? undefined}
          onClose={() => setRemindOpen(false)}
        />
      )}
      {updateOpen && (
        <MaintenanceUpdateModal
          vehicle={vehicle}
          onClose={() => setUpdateOpen(false)}
          onSaved={reload}
        />
      )}
    </div>
  )
}
