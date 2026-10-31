import { useCallback, useEffect, useState } from 'react'
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarCheck,
  CalendarCog,
  Camera,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
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
  listKmReadings,
  type KmWindow,
} from '../api.ts'
import { isManagement, useAuth } from '../auth.ts'
import {
  AccordionTools,
  CollapsibleCard,
  useAccordion,
} from '../components/CollapsibleCard.tsx'
import { AccidentModal } from '../components/AccidentModal.tsx'
import { AlertResolveDispatcher } from '../components/AlertResolveDispatcher.tsx'
import { BreakdownModal } from '../components/BreakdownModal.tsx'
import { DocumentList } from '../components/DocumentList.tsx'
import { KmChart } from '../components/KmChart.tsx'
import { MaintenanceUpdateModal } from '../components/MaintenanceUpdateModal.tsx'
import { RegisterFuelModal } from '../components/RegisterFuelModal.tsx'
import { KmStatCard } from '../components/KmStatCard.tsx'
import { UpcomingDatesCard } from '../components/UpcomingDatesCard.tsx'
import { VehiclePendingCards } from '../components/VehiclePendingCards.tsx'
import { RegisterKmModal } from '../components/RegisterKmModal.tsx'
import { ReminderModal } from '../components/ReminderModal.tsx'
import {
  ScheduledActionInfo,
  type ScheduledKind,
} from '../components/ScheduledActionInfo.tsx'
import { VehicleUpdateModal } from '../components/VehicleUpdateModal.tsx'
import { UploadDocumentModal } from '../components/UploadDocumentModal.tsx'
import { RegisterItvModal } from '../components/RegisterItvModal.tsx'
import {
  ScheduleItvModal,
  ScheduleMaintenanceModal,
} from '../components/ScheduleModal.tsx'
import type { LayoutContext } from '../components/Layout.tsx'
import { useDomainLabels } from '../domainLabels.ts'
import { useLang } from '../i18n.tsx'
import { PENDING_CARDS } from '../pendingCards.ts'
import { useScheduleCopy } from '../translations/schedule.ts'
import {
  fmtKm,
  isOpenFieldIncident,
  kmLevelTone,
  pendingThisMonth,
  scheduledActionAvailable,
  vehicleStateTone,
} from '../format.ts'
import type {
  Alert,
  FlotaDocument,
  Incident,
  KmReading,
  Vehicle,
  VehicleSummary,
} from '../types.ts'

/**
 * M2 — Ficha de campo (HU-1.2 lectura, 4.1, 4.3): consulta rápida a pie de
 * vehículo + subida de documentos por cámara/galería (multipart; el back
 * archiva en la carpeta de Drive del vehículo — Fase A3).
 */
export function VehicleFieldPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const vehicleId = Number(id)
  const { t, language } = useLang()
  const programar = useScheduleCopy()
  const etiqueta = useDomainLabels()
  const { user } = useAuth()
  const isSupervisor = user?.roles.includes('supervisor') ?? false
  const canManage = isManagement(user)
  // En modo "Mi vehículo", el nav inferior ya lleva las cinco acciones SOBRE
  // el coche operativo: su ficha no las repite. El principal bloqueado (el nav
  // apunta al sustituto) y las fichas en modo Flota conservan las suyas.
  const ctx = useOutletContext<LayoutContext | null>()
  const actionsInNav = Boolean(ctx && !ctx.fleetMode && ctx.ownPair?.target === vehicleId)

  // Acordeón de tarjetas (mejora): desplegadas por defecto; en móvil plegar
  // ahorra mucho scroll.
  // Las tres tarjetas de lo pendiente arrancan PLEGADAS (su recuento se lee en
  // el título); las demás, desplegadas como siempre.
  // La proyección entra como una ficha más del acordeón y arranca PLEGADA: su
  // resumen (nivel, % y barra) se lee sin abrir nada, y dentro va la gráfica.
  const accordion = useAccordion(
    ['situation', 'projection', ...PENDING_CARDS, 'documents'],
    ['projection', ...PENDING_CARDS],
  )

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
  // Las lecturas de la gráfica se piden SOLO al desplegar (`null` = aún no):
  // es una petición más y la tarjeta nace plegada.
  const [kmReadings, setKmReadings] = useState<KmReading[] | null>(null)
  // La alerta de exceso, resolviéndose desde la propia tarjeta.
  const [overageResolve, setOverageResolve] = useState<Alert | null>(null)
  const [overageOk, setOverageOk] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // M4: registro de ITV (HU-5.1). La propuesta de fechas (HU-2.3) se retiró:
  // su bandeja de confirmación ya no existe en gestión, así que enviarlas solo
  // dejaba al conductor esperando una respuesta que nadie podía dar.
  const [itvOpen, setItvOpen] = useState(false)
  const [itvOk, setItvOk] = useState('')
  // La cita está lejos: en vez de un botón muerto, el aviso de cuándo se abre.
  const [scheduledInfo, setScheduledInfo] = useState<ScheduledKind | null>(null)

  // Herramientas del supervisor (las mismas de las tarjetas de la flota).
  const [remindOpen, setRemindOpen] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const [documentOpen, setDocumentOpen] = useState(false)
  const [kmOpen, setKmOpen] = useState(false)
  // GAP-2: gasto de combustible (aqui lo usa la supervisora; el conductor lo
  // tiene en el nav, donde viven sus acciones). Se abre SOLO si se llega con
  // `?registrar=combustible`: es a donde apunta el aviso del inicio, y el modal
  // no tiene página propia. Va en el estado inicial y no en un efecto —
  // abrirlo después es una animación de más y un modal que parpadea.
  const [fuelOpen, setFuelOpen] = useState(() => params.get('registrar') === 'combustible')
  // Parte guiado de accidente: la supervisora lo abre desde la ficha igual que
  // desde las tarjetas de la flota (el conductor lo tiene en el nav).
  const [accidentOpen, setAccidentOpen] = useState(false)
  // Citar la ITV y programar el mantenimiento, los mismos dos gestos que
  // ofrece la tarjeta de la lista. Los guarda el back acotado a su grupo.
  const [scheduleOpen, setScheduleOpen] = useState<'itv' | 'maintenance' | null>(null)
  const [scheduleOk, setScheduleOk] = useState('')

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

  // Al desplegar la proyección. Va en un efecto y no en el propio botón para
  // que «Desplegar todo» la traiga igual; si falla, la gráfica dice que no hay
  // lecturas suficientes y la tarjeta se lee igual. Y SOLO si la tarjeta se
  // pinta: el id del acordeón existe para todos, así que «Desplegar todo» lo
  // abría también en la ficha de quien conduce —que no ve la proyección— y
  // pedía las lecturas para una gráfica que no se monta.
  const projectionOpen = accordion.isOpen('projection')
  const projectionShown = isSupervisor && summary?.projection != null && summary?.contract != null
  useEffect(() => {
    if (!projectionShown || !projectionOpen || kmReadings !== null) return
    let vivo = true
    listKmReadings(vehicleId)
      .then((page) => vivo && setKmReadings(page.results))
      .catch(() => vivo && setKmReadings([]))
    return () => {
      vivo = false
    }
  }, [projectionShown, projectionOpen, kmReadings, vehicleId])

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
  // Lo que hace «problemático» al coche es la ALERTA abierta, no el nivel de
  // la barra: el motor es quien decide que la proyección se ha pasado del
  // margen, y sin alerta no hay nada que cerrar.
  const overageAlert = alerts.find((alert) => alert.type === 'km_overage') ?? null
  const itvAvailable = scheduledActionAvailable(
    summary?.next_itv_date ?? vehicle.next_itv_date,
  )
  // Sin cita no hay ITV que registrar, y quien conduce no la programa: el
  // botón no se le ofrece (a quien gestiona sí —puede haberse pasado una sin
  // cita en el sistema—). Es la misma regla que ya aplica «Actualizar», que
  // sin ITV programada no saca su pestaña.
  const itvOffered = Boolean(summary?.next_itv_date ?? vehicle.next_itv_date) || canManage
  const maintenanceAvailable = scheduledActionAvailable(summary?.next_maintenance_date)

  return (
    <div className="field-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} aria-hidden /> {t.vehicle.back}
      </Link>

      <header className="field-head">
        <span className="plate plate-lg">{vehicle.plate}</span>
        <Badge tone={vehicleStateTone(vehicle.state)}>{etiqueta.vehicleState(vehicle) || '—'}</Badge>
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

      {/* El MISMO div de km que el tablero de la home (`KmStatCard`), a todo
          el ancho: última lectura, mejor día para registrar y píldora de
          pendiente. */}
      <KmStatCard summary={summary} window={kmWindow} />

      {/* Y las MISMAS «Próximas citas» que el tablero: lectura de km, ITV y
          mantenimiento, cada una con su fecha y cuántos días faltan. */}
      <UpcomingDatesCard vehicle={vehicle} summary={summary} window={kmWindow} />

      {/* Proyección contra el contrato (solo supervisor): el mismo cuadro
          compacto de la vista del grupo, aquí para UN coche —y, como allí, con
          la evolución de las lecturas dentro y «Resolver» cuando hay alerta
          de exceso abierta—. El resumen (nivel, % y barra) se queda FUERA del
          acordeón: es lo que se viene a mirar, y plegarlo dejaría la tarjeta
          sin decir nada. */}
      {isSupervisor && projection && contract && (
        <section
          className={`card km-card km-level-${projection.level}${
            projectionOpen ? '' : ' acc-closed'
          }`}
        >
          <div className="km-card-head">
            <div className="km-card-id">
              <button
                type="button"
                className="acc-toggle km-card-toggle"
                aria-expanded={projectionOpen}
                aria-controls="projection-chart"
                onClick={() => accordion.toggle('projection')}
              >
                <ChevronDown size={18} aria-hidden className="acc-chevron" />
                <strong>{t.home.projection}</strong>
                <Badge tone={kmLevelTone(projection.level)}>
                  {t.group.levels[projection.level] ?? projection.level}
                </Badge>
              </button>
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
          {/* Con la alerta abierta, el coche se resuelve desde aquí: el mismo
              modal de la bandeja y de «Proyección de km», que propone otro
              conductor —lo único que cambia de verdad unos km contratados—.
              Va FUERA del acordeón: la acción no se esconde. */}
          {overageAlert && (
            <div className="km-actions">
              <Button
                type="button"
                variant="secondary"
                aria-label={t.group.resolveLabel(vehicle.plate)}
                onClick={() => {
                  // Como el resto de acuses de la ficha: el de la vez anterior
                  // se va al volver a abrir, o se leería junto al modal nuevo.
                  setOverageOk('')
                  setOverageResolve(overageAlert)
                }}
              >
                {t.group.resolve}
              </Button>
            </div>
          )}
          <div id="projection-chart" hidden={!projectionOpen}>
            {kmReadings === null ? (
              <p className="empty-note">{t.common.loading}</p>
            ) : (
              <KmChart readings={kmReadings} />
            )}
          </div>
        </section>
      )}

      {overageOk && (
        <p role="status" className="form-ok">
          {overageOk}
        </p>
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

        {/* Con la cita lejos estos dos van apagados pero VIVOS: el toque abre
            el aviso que dice cuándo es y desde qué día se podrá registrar. Un
            botón muerto con un `title` no se explica en un móvil. */}
        {itvOffered && (
          <button
            type="button"
            className={`quick-action${itvAvailable ? '' : ' is-waiting'}`}
            title={!itvAvailable ? t.vehicle.scheduledActionUnavailable : undefined}
            onClick={() => {
              if (!itvAvailable) {
                setScheduledInfo('itv')
                return
              }
              setItvOk('')
              setItvOpen(true)
            }}
          >
            <ClipboardCheck size={20} aria-hidden /> {t.vehicle.quickItv}
          </button>
        )}

        {isSupervisor && (
          <button
            type="button"
            className={`quick-action${maintenanceAvailable ? '' : ' is-waiting'}`}
            title={!maintenanceAvailable ? t.vehicle.scheduledActionUnavailable : undefined}
            onClick={() =>
              maintenanceAvailable ? setUpdateOpen(true) : setScheduledInfo('maintenance')
            }
          >
            <ClipboardList size={20} aria-hidden /> {t.carUpdate.maintenanceButton}
          </button>
        )}

        {/* PROGRAMAR no es registrar: no se apagan con el coche bloqueado
            —la ITV de este coche vence aunque otro lo cubra— ni esperan a la
            ventana de los 30 días, que es para lo ya citado. */}
        {canManage && (
          <>
            <button
              type="button"
              className="quick-action"
              onClick={() => {
                setScheduleOk('')
                setScheduleOpen('itv')
              }}
            >
              <CalendarCheck size={20} aria-hidden /> {programar.itv.button}
            </button>
            <button
              type="button"
              className="quick-action"
              onClick={() => {
                setScheduleOk('')
                setScheduleOpen('maintenance')
              }}
            >
              <CalendarCog size={20} aria-hidden /> {programar.maintenance.button}
            </button>
          </>
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
            <Camera size={20} aria-hidden /> {t.vehicle.quickDocument}
          </span>
        ) : (
          <button type="button" className="quick-action" onClick={() => setDocumentOpen(true)}>
            <Camera size={20} aria-hidden /> {t.vehicle.quickDocument}
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
      {scheduleOk && <p role="status" className="form-ok">{scheduleOk}</p>}

      <AccordionTools accordion={accordion} />

      {/* Tres atributos independientes (HU-1.6), en solo lectura. */}
      <CollapsibleCard id="situation" headingClassName="panel-title" accordion={accordion} title={t.vehicle.situationTitle}>
        <dl className="vehicle-meta">
          <dt>{t.vehicle.state}</dt>
          <dd>
            <Badge tone={vehicleStateTone(vehicle.state)}>{etiqueta.vehicleState(vehicle) || '—'}</Badge>
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

      <VehiclePendingCards
        vehicle={vehicle}
        summary={summary}
        alerts={alerts}
        incidents={incidents.filter(isOpenFieldIncident)}
        canManage={canManage}
        accordion={accordion}
        onChanged={reload}
        window={kmWindow}
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
        <DocumentList documents={documents} onChanged={loadDocuments} />

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
          kmEstimated={summary?.km_estimated ?? false}
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
          driver={summary?.driver ?? null}
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
      {scheduledInfo && (
        <ScheduledActionInfo
          kind={scheduledInfo}
          date={
            scheduledInfo === 'itv'
              ? summary?.next_itv_date ?? vehicle.next_itv_date
              : summary?.next_maintenance_date
          }
          plate={vehicle.plate}
          onClose={() => setScheduledInfo(null)}
        />
      )}
      {scheduleOpen === 'itv' && (
        <ScheduleItvModal
          vehicle={vehicle}
          onClose={() => setScheduleOpen(null)}
          onSaved={(message) => {
            setScheduleOk(message)
            reload()
          }}
        />
      )}
      {scheduleOpen === 'maintenance' && (
        <ScheduleMaintenanceModal
          vehicle={vehicle}
          summary={summary}
          onClose={() => setScheduleOpen(null)}
          onSaved={(message) => {
            setScheduleOk(message)
            reload()
          }}
        />
      )}
      {overageResolve && (
        <AlertResolveDispatcher
          alert={overageResolve}
          summary={summary}
          onClose={() => setOverageResolve(null)}
          onResolved={() => {
            setOverageResolve(null)
            setOverageOk(t.group.resolved)
            reload()
          }}
        />
      )}
      {updateOpen &&
        // Ese botón dice «Mantenimiento»: en **Mi vehículo** abre eso y nada
        // más —km, combustible e ITV ya están arriba, cada uno en el suyo—, y
        // en **Flota** sigue abriendo «Actualizar» entera, que es donde se
        // repasa el coche de otro de una sentada.
        (ctx?.fleetMode ?? true ? (
          <VehicleUpdateModal
            vehicle={vehicle}
            summary={summary}
            initialTab="maintenance"
            onClose={() => setUpdateOpen(false)}
            onSaved={reload}
          />
        ) : (
          <MaintenanceUpdateModal
            vehicle={vehicle}
            summary={summary}
            onClose={() => setUpdateOpen(false)}
            onSaved={reload}
          />
        ))}
    </div>
  )
}
