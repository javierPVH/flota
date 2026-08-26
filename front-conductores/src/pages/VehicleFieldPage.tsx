import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Camera,
  ClipboardCheck,
  ClipboardList,
  ExternalLink,
  FileText,
  Gauge,
  Mail,
  Wrench,
} from 'lucide-react'
import { Badge, Button, Modal, Panel, SelectField, StatCard, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  fetchVehicle,
  fetchVehicleSummary,
  listDocuments,
  listIncidents,
  registerItv,
} from '../api.ts'
import { useAuth } from '../auth.ts'
import {
  AccordionTools,
  CollapsibleCard,
  useAccordion,
} from '../components/CollapsibleCard.tsx'
import { BreakdownModal } from '../components/BreakdownModal.tsx'
import { ReminderModal } from '../components/ReminderModal.tsx'
import { VehicleUpdateModal } from '../components/VehicleUpdateModal.tsx'
import { useLang } from '../i18n.tsx'
import {
  documentStatusTone,
  fmtDate,
  fmtKm,
  incidentStatusTone,
  itvClass,
  kmLevelTone,
  todayIso,
  pendingThisMonth,
  vehicleStateTone,
} from '../format.ts'
import { isNetworkError, safeEnqueue } from '../offline/queue.ts'
import type { FlotaDocument, Incident, Vehicle, VehicleSummary } from '../types.ts'

/** Solo enlaces http(s): corta javascript:/data: aunque el back ya sanea. */
function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : ''
}

/** Enlace al archivo: Drive si ya está archivado; staging local si no. */
function documentHref(doc: FlotaDocument): string {
  return safeHref(doc.drive_url) || safeHref(doc.file_url)
}

// Resultado de la ITV: valores libres del back, consensuados con gestión.
const ITV_RESULT_VALUES = ['done', 'not done'] as const

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

  // Acordeón de tarjetas (mejora): desplegadas por defecto; en móvil plegar
  // ahorra mucho scroll.
  const accordion = useAccordion(['situation', 'incidents', 'documents'])

  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [summary, setSummary] = useState<VehicleSummary | null>(null)
  const [documents, setDocuments] = useState<FlotaDocument[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [saving, setSaving] = useState(false)

  // M4: registro de ITV (HU-5.1). La propuesta de fechas (HU-2.3) se retiró:
  // su bandeja de confirmación ya no existe en gestión, así que enviarlas solo
  // dejaba al conductor esperando una respuesta que nadie podía dar.
  const [itvOpen, setItvOpen] = useState(false)
  const [itvForm, setItvForm] = useState({ event_date: todayIso(), result: 'done', next_due: '' })
  const [itvError, setItvError] = useState('')
  const [itvOk, setItvOk] = useState('')

  // Herramientas del supervisor (las mismas de las tarjetas de la flota).
  const [remindOpen, setRemindOpen] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [breakdownOpen, setBreakdownOpen] = useState(false)

  // Tras guardar algo desde el modal de actualización: datos frescos.
  const reload = useCallback(() => {
    fetchVehicle(vehicleId).then(setVehicle, () => {})
    fetchVehicleSummary(vehicleId).then(setSummary, () => {})
    listIncidents(vehicleId)
      .then((page) => setIncidents(page.results.filter((i) => i.status !== 'closed')))
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

  async function handleItv(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setItvError('')
    const payload = {
      vehicle: vehicleId,
      event_date: itvForm.event_date,
      // A13/C5: la próxima ITV solo acompaña al resultado FAVORABLE.
      itv: {
        result: itvForm.result,
        next_due: itvForm.result === 'done' ? itvForm.next_due : null,
      },
    }
    try {
      await registerItv(payload)
      setItvOpen(false)
      setItvForm({ event_date: todayIso(), result: 'done', next_due: '' })
      setItvOk(t.vehicle.itvOk)
      // La señal del back refresca next_itv_date: recarga la cabecera.
      fetchVehicle(vehicleId).then(setVehicle, () => {})
    } catch (err) {
      // Sin red (M7): a la cola offline — se enviará al reconectar.
      if (isNetworkError(err) && (await safeEnqueue({ kind: 'itv', payload }))) {
        setItvOpen(false)
        setItvForm({ event_date: todayIso(), result: 'done', next_due: '' })
        setItvOk(t.vehicle.itvOffline)
      } else {
        setItvError(asErrorMessage(err, t.vehicle.itvError))
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>
  if (error || !vehicle) return <div role="alert" className="form-error">{error || t.vehicle.notFound}</div>

  const kmPending = summary ? pendingThisMonth(summary) : false
  const blocked = summary?.blocked_by_link ?? null
  const projection = summary?.projection ?? null
  const contract = summary?.contract ?? null

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
        <StatCard
          label={t.vehicle.kmLabel}
          value={summary ? fmtKm(summary.km_current, language) : '—'}
          sub={
            summary?.km_reading_date
              ? t.vehicle.readingOf(fmtDate(summary.km_reading_date, language))
              : t.vehicle.noReadings
          }
          accent={kmPending ? 'warning' : 'teal'}
        />
        <StatCard
          label={t.vehicle.nextItv}
          value={
            <span className={itvClass(vehicle.next_itv_date)}>
              {fmtDate(vehicle.next_itv_date, language)}
            </span>
          }
          sub={
            itvClass(vehicle.next_itv_date) === 'itv-overdue'
              ? t.vehicle.itvOverdue
              : itvClass(vehicle.next_itv_date) === 'itv-soon'
                ? t.vehicle.itvSoon
                : ' '
          }
          accent={itvClass(vehicle.next_itv_date) ? 'warning' : 'primary'}
        />
        {/* GAP-8: el próximo mantenimiento, con el mismo semáforo que la ITV. */}
        {summary?.next_maintenance_date && (
          <StatCard
            label={t.home.nextMaintenance}
            value={
              <span className={itvClass(summary.next_maintenance_date)}>
                {fmtDate(summary.next_maintenance_date, language)}
              </span>
            }
            sub={
              itvClass(summary.next_maintenance_date) === 'itv-overdue'
                ? t.vehicle.itvOverdue
                : itvClass(summary.next_maintenance_date) === 'itv-soon'
                  ? t.vehicle.itvSoon
                  : ' '
            }
            accent={itvClass(summary.next_maintenance_date) ? 'warning' : 'primary'}
          />
        )}
      </div>

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
            <Link to={`/registrar?vehiculo=${vehicle.id}`}>{t.vehicle.kmPendingCta}</Link>
          </p>
        </Panel>
      )}

      {/* Accesos directos de campo (M2 + M4). En un principal bloqueado (N9)
          se apagan: km, documentos y averías van sobre el sustituto. La ITV
          sigue viva — es del coche físico, esté cubierto o no. */}
      <div className="quick-actions">
        {blocked ? (
          <>
            <span className="quick-action is-disabled" aria-disabled="true" title={t.vehicle.blockedActions}>
              <Gauge size={20} aria-hidden /> {t.common.registerKm}
            </span>
            <span className="quick-action is-disabled" aria-disabled="true" title={t.vehicle.blockedActions}>
              <Camera size={20} aria-hidden /> {t.vehicle.quickUpload}
            </span>
            <span className="quick-action is-disabled" aria-disabled="true" title={t.vehicle.blockedActions}>
              <Wrench size={20} aria-hidden /> {t.home.quickBreakdown}
            </span>
          </>
        ) : (
          <>
            <Link to={`/registrar?vehiculo=${vehicle.id}`} className="quick-action">
              <Gauge size={20} aria-hidden /> {t.common.registerKm}
            </Link>
            <Link to={`/documentos/nuevo?vehiculo=${vehicle.id}`} className="quick-action">
              <Camera size={20} aria-hidden /> {t.vehicle.quickUpload}
            </Link>
            {/* C3: comunicar avería desde la propia ficha, con el coche ya elegido. */}
            <button
              type="button"
              className="quick-action"
              onClick={() => setBreakdownOpen(true)}
            >
              <Wrench size={20} aria-hidden /> {t.home.quickBreakdown}
            </button>
          </>
        )}
        <button
          type="button"
          className="quick-action"
          onClick={() => {
            setItvOk('')
            setItvError('')
            setItvOpen(true)
          }}
        >
          <ClipboardCheck size={20} aria-hidden /> {t.vehicle.quickItv}
        </button>
      </div>

      {/* Herramientas del supervisor: las mismas que en las tarjetas de la
          flota, para no tener que volver a la lista. */}
      {isSupervisor && (
        <div className="quick-actions">
          <button type="button" className="quick-action" onClick={() => setUpdateOpen(true)}>
            <ClipboardList size={20} aria-hidden /> {t.carUpdate.button}
          </button>
          <button type="button" className="quick-action" onClick={() => setRemindOpen(true)}>
            <Mail size={20} aria-hidden /> {t.reminder.button}
          </button>
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

      {/* Incidencias abiertas (mejora 🟡): el conductor ve qué le pasa a SU
          vehículo; la gestión (cerrar, coste…) sigue en el front de gestión. */}
      {incidents.length > 0 && (
        <CollapsibleCard id="incidents" headingClassName="panel-title" accordion={accordion} title={t.vehicle.incidentsTitle}>
          <ul className="doc-list">
            {incidents.map((i) => (
              <li key={i.id} className="doc-item">
                <Wrench size={18} aria-hidden className="doc-icon" />
                <div className="doc-info">
                  <strong>{i.type_display}</strong>
                  <span className="doc-sub">
                    {i.date ? fmtDate(i.date, language) : t.vehicle.noDate}
                    {i.description ? ` · ${i.description}` : ''}
                  </span>
                </div>
                <Badge tone={incidentStatusTone(i.status)}>{i.status_display}</Badge>
              </li>
            ))}
          </ul>
        </CollapsibleCard>
      )}

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
        <Modal open={itvOpen} title={t.vehicle.itvTitle(vehicle.plate)} onClose={() => setItvOpen(false)}>
          <form className="modal-form" onSubmit={handleItv}>
            <TextInputField
              label={t.vehicle.itvDate}
              type="date"
              max={todayIso()}
              value={itvForm.event_date}
              onChange={(e) => setItvForm((f) => ({ ...f, event_date: e.target.value }))}
              required
            />
            <SelectField
              label={t.vehicle.itvResult}
              options={[
                { value: ITV_RESULT_VALUES[0], label: t.vehicle.itvResultDone },
                { value: ITV_RESULT_VALUES[1], label: t.vehicle.itvResultNotDone },
              ]}
              value={itvForm.result}
              onValueChange={(value) => setItvForm((f) => ({ ...f, result: value }))}
            />
            <TextInputField
              label={t.vehicle.itvNextDue}
              type="date"
              min={itvForm.event_date}
              value={itvForm.result === 'done' ? itvForm.next_due : ''}
              onChange={(e) => setItvForm((f) => ({ ...f, next_due: e.target.value }))}
              // A13: obligatoria si la ITV se pasó; deshabilitada si no. Antes
              // se podía enviar vacía (400) y, sin red, se encolaba para ser
              // descartada en el flush: pérdida de trabajo de campo.
              required={itvForm.result === 'done'}
              disabled={itvForm.result !== 'done'}
            />
            <p className="doc-sub">{t.vehicle.itvAutoClose}</p>
            {itvError && <div role="alert" className="form-error">{itvError}</div>}
            <div className="form-actions">
              <Button type="button" variant="secondary" onClick={() => setItvOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t.vehicle.itvSubmitting : t.vehicle.itvSubmit}
              </Button>
            </div>
          </form>
        </Modal>

      {breakdownOpen && (
        <BreakdownModal
          vehicle={vehicle}
          onClose={() => setBreakdownOpen(false)}
          onSaved={() => {
            reload()
            loadDocuments()
          }}
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
        <VehicleUpdateModal
          vehicle={vehicle}
          summary={summary ?? undefined}
          onClose={() => setUpdateOpen(false)}
          onSaved={reload}
        />
      )}
    </div>
  )
}
