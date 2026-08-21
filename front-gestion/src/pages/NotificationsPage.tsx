import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  Badge,
  Button,
  IconButton,
  Modal,
  PageHeader,
  Panel,
  SelectField,
  TextInputField,
} from '@flota/ui/ui'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import { Pause, Pencil, Play, Send, Trash2 } from 'lucide-react'

import {
  createNotificationSchedule,
  deleteNotificationSchedule,
  listAll,
  listNotificationSchedules,
  listVehicles,
  runNotificationSchedule,
  updateNotificationSchedule,
  type NotificationSchedule,
  type NotificationScheduleInput,
} from '../api.ts'
import { useAuth } from '../auth.ts'
import { useConfirm } from '../components/ConfirmDialog.tsx'
import {
  ALERT_LEVELS,
  ALERT_STATUSES,
  DOC_STATUSES,
  DOC_TYPES,
  REPORT_FILTERS,
  ROLES,
  type ReportFilterKey,
  type ReportKindKey,
} from '../reportFilters.ts'
import { useNotificationsCopy } from '../translations/notifications.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useReportsCopy } from '../translations/reports.ts'
import type { Vehicle } from '../types.ts'

/** El submit vive en el pie del modal, fuera del <form>: lo reengancha por id. */
const FORM_ID = 'notif-form'

/** Contenidos ofrecidos, en el mismo orden que la pantalla de Informes. */
const CONTENIDOS: Array<'summary' | ReportKindKey> = [
  'summary',
  'fleet',
  'kmreadings',
  'documents',
  'alerts',
  'invoices',
  'costs',
  'users',
]

/** Valores del formulario. Todo texto, como el resto de formularios de la app. */
interface FormValues {
  name: string
  name_with_date: boolean
  name_with_time: boolean
  content: string
  /** Filtros del informe activo; las claves son las que espera el servidor. */
  filters: Record<string, string>
  frequency: string
  weekday: string
  day_of_month: string
  send_at: string
  enabled: boolean
  send_email: boolean
  extra_recipients: string
  save_to_drive: boolean
  drive_folder: string
}

const VACIO: FormValues = {
  name: '',
  name_with_date: false,
  name_with_time: false,
  content: 'summary',
  filters: {},
  frequency: 'daily',
  weekday: '0',
  day_of_month: '1',
  send_at: '08:00',
  enabled: true,
  send_email: true,
  extra_recipients: '',
  save_to_drive: false,
  drive_folder: '',
}

/** "08:00:00" → "08:00" (el input type=time no admite segundos). */
function hhmm(value: string): string {
  return value.slice(0, 5)
}

function fromSchedule(row: NotificationSchedule): FormValues {
  return {
    name: row.name,
    name_with_date: row.name_with_date,
    name_with_time: row.name_with_time,
    content: row.content,
    filters: { ...row.filters },
    frequency: row.frequency,
    weekday: row.weekday === null ? '0' : String(row.weekday),
    day_of_month: row.day_of_month === null ? '1' : String(row.day_of_month),
    send_at: hhmm(row.send_at),
    enabled: row.enabled,
    send_email: row.send_email,
    extra_recipients: row.extra_recipients,
    save_to_drive: row.save_to_drive,
    drive_folder: row.drive_folder,
  }
}

/**
 * Ajustes → Notificaciones: los envíos programados del propio usuario.
 *
 * Cada fila es «qué se manda, cuándo y a dónde». El contenido lo genera el back
 * con el ámbito del dueño del envío, así que aquí no hay nada que elegir sobre
 * qué vehículos entran: son los de quien lo configura.
 */
export function NotificationsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useNotificationsCopy()
  // Las etiquetas de los filtros son LAS MISMAS que en Informes: si allí se
  // renombra un tipo de documento, aquí cambia solo.
  const r = useReportsCopy()
  const docCopy = usePanelsCopy().documents
  const confirm = useConfirm()
  const { user } = useAuth()

  const [rows, setRows] = useState<NotificationSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [editing, setEditing] = useState<NotificationSchedule | null>(null)
  const [creating, setCreating] = useState(false)
  const [values, setValues] = useState<FormValues>(VACIO)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true)
      listNotificationSchedules({ signal })
        .then((page) => {
          setRows(page.results)
          setError('')
        })
        .catch((err) => {
          if (isAbortError(err)) return
          setError(asErrorMessage(err, t.loadError))
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [t.loadError],
  )

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  // Los filtros de vehículo, marca y estado se alimentan de la flota, igual que
  // en Informes: las opciones son las que existen de verdad, no un enum entero.
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  useEffect(() => {
    const controller = new AbortController()
    listAll(listVehicles({ include_baja: 1 }, { signal: controller.signal }), {
      signal: controller.signal,
    })
      .then(setVehicles)
      .catch(() => setVehicles([]))
    return () => controller.abort()
  }, [])

  const todos = { value: '', label: r.downloads.all }

  /** Opciones de un filtro, con las etiquetas de la pantalla de Informes. */
  function filterOptions(key: ReportFilterKey): Array<{ value: string; label: string }> {
    if (key === 'vehicle') {
      return [
        todos,
        ...vehicles.map((v) => ({ value: String(v.id), label: v.plate })),
      ]
    }
    if (key === 'brand') {
      const marcas = [...new Set(vehicles.map((v) => v.brand?.trim()).filter(Boolean))].sort(
        (a, b) => String(a).localeCompare(String(b)),
      )
      return [todos, ...marcas.map((b) => ({ value: String(b), label: String(b) }))]
    }
    if (key === 'state') {
      const estados = new Map<string, string>()
      for (const v of vehicles) if (v.state) estados.set(v.state, v.state_display || v.state)
      return [todos, ...[...estados].map(([value, label]) => ({ value, label }))]
    }
    if (key === 'type') {
      return [todos, ...DOC_TYPES.map((d) => ({ value: d, label: docCopy.typeOptions[d] }))]
    }
    if (key === 'level') {
      return [
        todos,
        ...ALERT_LEVELS.map((lv) => ({ value: lv, label: r.downloads.alertLevel[lv] ?? lv })),
      ]
    }
    if (key === 'role') {
      return [todos, ...ROLES.map((x) => ({ value: x, label: r.downloads.roleLabels[x] ?? x }))]
    }
    // `status` significa una cosa en documentos y otra en alertas.
    const lista = values.content === 'documents' ? DOC_STATUSES : ALERT_STATUSES
    const etiquetas =
      values.content === 'documents' ? r.downloads.docStatus : r.downloads.alertStatus
    return [todos, ...lista.map((x) => ({ value: x, label: etiquetas[x] ?? x }))]
  }

  function filterLabel(key: ReportFilterKey): string {
    const d = r.downloads
    if (key === 'vehicle') return r.vehicleColumn
    if (key === 'brand') return d.filterBrand
    if (key === 'state') return d.filterStatus
    if (key === 'type') return d.filterType
    if (key === 'level') return d.filterLevel
    if (key === 'role') return d.filterRole
    return d.filterStatus
  }

  function openCreate() {
    // El correo del usuario activo ya viene puesto: es el destinatario natural
    // y así se ve, en vez de quedar implícito en un campo vacío.
    setValues({ ...VACIO, extra_recipients: user?.email ?? '' })
    setFormError('')
    setEditing(null)
    setCreating(true)
  }

  function openEdit(row: NotificationSchedule) {
    setValues(fromSchedule(row))
    setFormError('')
    setCreating(false)
    setEditing(row)
  }

  // Identidad estable a propósito: `Modal` recibe `onClose` como dependencia de
  // su efecto de foco, y una función nueva en cada render hacía que ese efecto
  // se rehiciera con cada tecla y el foco saltara fuera del campo.
  const closeForm = useCallback(() => {
    setCreating(false)
    setEditing(null)
  }, [])

  /** Solo se manda lo que aplica: el back rechaza combinaciones incoherentes. */
  function payload(): NotificationScheduleInput {
    return {
      name: values.name.trim(),
      name_with_date: values.name_with_date,
      name_with_time: values.name_with_time,
      content: values.content,
      // Solo los filtros del informe elegido: al cambiar de informe, los del
      // anterior no deben viajar (el servidor los rechazaría).
      filters: esResumen
        ? {}
        : Object.fromEntries(
            (REPORT_FILTERS[values.content as ReportKindKey] ?? [])
              .map((key) => [key, values.filters[key] ?? ''])
              .filter(([, value]) => value !== ''),
          ),
      frequency: values.frequency,
      weekday: values.frequency === 'weekly' ? Number(values.weekday) : null,
      day_of_month: values.frequency === 'monthly' ? Number(values.day_of_month) : null,
      send_at: values.send_at,
      enabled: values.enabled,
      send_email: values.send_email,
      extra_recipients: values.extra_recipients.trim(),
      save_to_drive: values.save_to_drive,
      drive_folder: values.save_to_drive ? values.drive_folder.trim() : '',
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFormError('')
    try {
      if (editing) await updateNotificationSchedule(editing.id, payload())
      else await createNotificationSchedule(payload())
      closeForm()
      load()
    } catch (err) {
      setFormError(asErrorMessage(err, t.saveError))
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(row: NotificationSchedule) {
    setBusyId(row.id)
    try {
      await updateNotificationSchedule(row.id, { enabled: !row.enabled })
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.saveError))
    } finally {
      setBusyId(null)
    }
  }

  async function runNow(row: NotificationSchedule) {
    setBusyId(row.id)
    setNotice('')
    try {
      const result = await runNotificationSchedule(row.id)
      if (result.error) setError(result.error)
      else setNotice(result.queued ? t.runOk : t.runQueued)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.runError))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(row: NotificationSchedule) {
    // Configuración propia: se borra de verdad, así que se pregunta una vez.
    if (!(await confirm({ message: t.confirmDelete(row.name), tone: 'danger', confirmLabel: t.delete })))
      return
    setBusyId(row.id)
    try {
      await deleteNotificationSchedule(row.id)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.deleteError))
    } finally {
      setBusyId(null)
    }
  }

  function whenLabel(row: NotificationSchedule): string {
    const hora = hhmm(row.send_at)
    if (row.frequency === 'weekly') return t.whenWeekly(t.weekdays[row.weekday ?? 0], hora)
    if (row.frequency === 'monthly') return t.whenMonthly(row.day_of_month ?? 1, hora)
    return t.whenDaily(hora)
  }

  function destinationLabel(row: NotificationSchedule): string {
    if (row.send_email && row.save_to_drive) return t.destBoth
    return row.save_to_drive ? t.destDrive : t.destEmail
  }

  function fechaHora(iso: string | null): string {
    if (!iso) return t.never
    const d = new Date(iso)
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }

  const esResumen = values.content === 'summary'

  /** Cómo quedará el nombre: mismo criterio que `composed_name` del servidor. */
  const namePreview = (() => {
    const ahora = new Date()
    const dosDigitos = (n: number) => String(n).padStart(2, '0')
    const partes = [values.name.trim() || t.fields.namePlaceholder]
    if (values.name_with_date) {
      partes.push(
        `${ahora.getFullYear()}-${dosDigitos(ahora.getMonth() + 1)}-${dosDigitos(ahora.getDate())}`,
      )
    }
    // Guion y no dos puntos, como en el servidor: es un nombre de fichero.
    if (values.name_with_time) {
      partes.push(`${dosDigitos(ahora.getHours())}-${dosDigitos(ahora.getMinutes())}`)
    }
    return partes.join(' ')
  })()

  /** Filtros que ofrece el informe elegido, y cuáles están puestos. */
  const filtrosDelInforme = esResumen ? [] : (REPORT_FILTERS[values.content as ReportKindKey] ?? [])
  const filtrosPuestos = filtrosDelInforme.filter((key) => (values.filters[key] ?? '') !== '')

  /** Direcciones escritas: son las únicas a las que se envía. */
  const destinatarios = values.extra_recipients
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

  /** Cuándo saldrá, con la misma frase que la columna de la tabla. */
  function cuandoTexto(): string {
    if (values.frequency === 'weekly') {
      return t.whenWeekly(t.weekdays[Number(values.weekday)], values.send_at)
    }
    if (values.frequency === 'monthly') {
      return t.whenMonthly(Number(values.day_of_month), values.send_at)
    }
    return t.whenDaily(values.send_at)
  }

  /**
   * La frase del pie: qué · cuándo · a dónde.
   *
   * El formulario tiene cuatro bloques y decisiones que se condicionan entre
   * sí; leer aquí lo que va a pasar evita tener que repasarlos antes de guardar.
   */
  const resumen = (() => {
    const queSeEnvia = t.content[values.content as keyof typeof t.content]
    const contenido = esResumen
      ? queSeEnvia
      : `${queSeEnvia} (CSV${filtrosPuestos.length ? `, ${t.review.filtered}` : ''})`
    const destinos: string[] = []
    if (values.send_email) {
      destinos.push(
        destinatarios.length ? t.review.recipients(destinatarios.length) : t.review.noRecipients,
      )
    }
    if (values.save_to_drive) {
      destinos.push(values.send_email ? t.review.drive : t.review.onlyDrive)
    }
    const donde = destinos.length ? destinos.join(' ') : t.review.noDestination
    return `${contenido} · ${cuandoTexto().toLowerCase()} · ${donde}`
  })()

  return (
    <div>
      {!embedded && <PageHeader title={t.title} subtitle={t.subtitle} />}

      {/* El aviso de que los envíos salen por tandas vive dentro del formulario,
          junto a la hora: es donde importa y no repite el mismo texto dos veces
          en la misma pantalla. */}
      {error && <div role="alert" className="form-error">{error}</div>}
      {notice && <div role="status" className="form-ok">{notice}</div>}

      <div className="filters-bar" style={{ justifyContent: 'space-between' }}>
        <span className="muted">{t.records(rows.length)}</span>
        <Button variant="primary" onClick={openCreate}>
          {t.create}
        </Button>
      </div>

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : rows.length === 0 ? (
        <Panel>
          <p style={{ margin: 0 }}>
            <strong>{t.empty}</strong>
            <br />
            {t.emptyHint}
          </p>
        </Panel>
      ) : (
        <div className="notif-table-wrap">
        <table className="notif-table">
          <thead>
            <tr>
              <th>{t.columns.name}</th>
              <th>{t.columns.content}</th>
              <th>{t.columns.when}</th>
              <th>{t.columns.destination}</th>
              <th>{t.columns.nextRun}</th>
              <th>{t.columns.lastRun}</th>
              <th style={{ textAlign: 'right' }}>{t.columns.actions}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.enabled ? undefined : 'is-paused'}>
                <td>
                  <strong>{row.name}</strong>
                  {!row.enabled && (
                    <>
                      {' '}
                      <Badge tone="warning">{t.paused}</Badge>
                    </>
                  )}
                </td>
                <td>
                  {row.content_display}
                  {row.content !== 'summary' && <span className="muted"> · {t.fmt[row.fmt]}</span>}
                </td>
                <td>{whenLabel(row)}</td>
                <td>{destinationLabel(row)}</td>
                <td>{row.enabled ? fechaHora(row.next_run_at) : '—'}</td>
                <td>
                  {fechaHora(row.last_run_at)}
                  {row.last_status === 'failed' && (
                    <>
                      {' '}
                      {/* El motivo del fallo, en el tooltip: `Badge` no lo acepta. */}
                      <span title={row.last_error}>
                        <Badge tone="danger">{t.statusFailed}</Badge>
                      </span>
                    </>
                  )}
                </td>
                <td>
                  <div className="row-actions">
                    <IconButton
                      aria-label={t.runNow}
                      title={t.runNow}
                      disabled={busyId === row.id}
                      onClick={() => runNow(row)}
                    >
                      <Send size={15} />
                    </IconButton>
                    <IconButton
                      aria-label={row.enabled ? t.disable : t.enable}
                      title={row.enabled ? t.disable : t.enable}
                      disabled={busyId === row.id}
                      onClick={() => toggleEnabled(row)}
                    >
                      {row.enabled ? <Pause size={15} /> : <Play size={15} />}
                    </IconButton>
                    <IconButton aria-label={t.edit} title={t.edit} onClick={() => openEdit(row)}>
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton
                      variant="danger"
                      aria-label={t.delete}
                      title={t.delete}
                      disabled={busyId === row.id}
                      onClick={() => remove(row)}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <Modal
        open={creating || editing !== null}
        title={editing ? t.editTitle : t.createTitle}
        onClose={closeForm}
        wide
        footer={
          <div className="notif-foot">
            {formError ? (
              <div role="alert" className="form-error notif-foot-error">
                {formError}
              </div>
            ) : (
              <p className="notif-review">
                <strong>{t.review.label}</strong> {resumen}
              </p>
            )}
            <div className="notif-foot-actions">
              <Button type="button" variant="secondary" onClick={closeForm}>
                {t.cancel}
              </Button>
              <Button type="submit" form={FORM_ID} variant="primary" disabled={saving}>
                {saving ? t.saving : t.save}
              </Button>
            </div>
          </div>
        }
      >
        {/* Cuatro bloques en el orden en que se decide: qué, cuándo, a quién y
            cómo se llama. La numeración la pone el CSS con un contador. */}
        <form id={FORM_ID} className="notif-form" onSubmit={submit}>
          <fieldset className="notif-step">
            <legend className="notif-step-title">{t.steps.what}</legend>
            <SelectField
              label={t.fields.content}
              options={CONTENIDOS.map((clave) => ({ value: clave, label: t.content[clave] }))}
              value={values.content}
              onValueChange={(value) =>
                setValues((v) => ({
                  ...v,
                  content: value,
                  // El resumen no genera fichero: se apaga Drive al elegirlo, que
                  // es la combinación que el back rechaza. Y los filtros se
                  // vacían porque cada informe admite los suyos.
                  save_to_drive: value === 'summary' ? false : v.save_to_drive,
                  filters: {},
                }))
              }
            />
            <p className="notif-hint">{esResumen ? t.contentHint.summary : t.contentHint.report}</p>

            {/* Filtros del informe elegido: los mismos que ofrece su tarjeta en
                Informes, para que lo programado y lo descargado coincidan. */}
            {filtrosDelInforme.length > 0 && (
              <>
                <div className="notif-grid">
                  {filtrosDelInforme.map((key) => (
                    <SelectField
                      key={key}
                      label={filterLabel(key)}
                      enableSearchFilter
                      options={filterOptions(key)}
                      value={values.filters[key] ?? ''}
                      onValueChange={(value) =>
                        setValues((v) => ({ ...v, filters: { ...v.filters, [key]: value } }))
                      }
                    />
                  ))}
                </div>
                <p className="notif-hint">{t.fields.filtersHint}</p>
              </>
            )}
            {!esResumen && <p className="notif-hint">{t.fields.fmtNote}</p>}
          </fieldset>

          <fieldset className="notif-step">
            <legend className="notif-step-title">{t.steps.when}</legend>
            {/* Frecuencia, su día y la hora caben en una fila: es una sola
                decisión y se lee de un tirón. */}
            <div className="notif-grid">
              <SelectField
                label={t.fields.frequency}
                options={[
                  { value: 'daily', label: t.frequency.daily },
                  { value: 'weekly', label: t.frequency.weekly },
                  { value: 'monthly', label: t.frequency.monthly },
                ]}
                value={values.frequency}
                onValueChange={(value) => setValues((v) => ({ ...v, frequency: value }))}
              />

              {values.frequency === 'weekly' && (
                <SelectField
                  label={t.fields.weekday}
                  options={t.weekdays.map((label, index) => ({ value: String(index), label }))}
                  value={values.weekday}
                  onValueChange={(value) => setValues((v) => ({ ...v, weekday: value }))}
                />
              )}

              {values.frequency === 'monthly' && (
                <SelectField
                  label={t.fields.dayOfMonth}
                  // 1–28: así el envío existe también en febrero.
                  options={Array.from({ length: 28 }, (_, i) => ({
                    value: String(i + 1),
                    label: String(i + 1),
                  }))}
                  value={values.day_of_month}
                  onValueChange={(value) => setValues((v) => ({ ...v, day_of_month: value }))}
                />
              )}

              <TextInputField
                label={t.fields.sendAt}
                type="time"
                value={values.send_at}
                onChange={(e) => setValues((v) => ({ ...v, send_at: e.target.value }))}
                required
              />
            </div>
            <p className="notif-hint">{t.precisionNote}</p>
          </fieldset>

          <fieldset className="notif-step">
            <legend className="notif-step-title">{t.steps.where}</legend>
            <label className="baja-toggle">
              <input
                type="checkbox"
                checked={values.send_email}
                onChange={(e) => setValues((v) => ({ ...v, send_email: e.target.checked }))}
              />
              {t.fields.sendEmail}
            </label>

            {values.send_email && (
              <>
                <TextInputField
                  label={t.fields.recipients}
                  placeholder={t.fields.recipientsPlaceholder}
                  value={values.extra_recipients}
                  onChange={(e) => setValues((v) => ({ ...v, extra_recipients: e.target.value }))}
                  required
                />
                <p className="notif-hint">{t.fields.recipientsHint}</p>
              </>
            )}

            {esResumen ? (
              <p className="notif-hint">{t.fields.summaryNoDrive}</p>
            ) : (
              <>
                <label className="baja-toggle">
                  <input
                    type="checkbox"
                    checked={values.save_to_drive}
                    onChange={(e) => setValues((v) => ({ ...v, save_to_drive: e.target.checked }))}
                  />
                  {t.fields.saveToDrive}
                </label>
                {values.save_to_drive && (
                  <>
                    <TextInputField
                      label={t.fields.driveFolder}
                      value={values.drive_folder}
                      onChange={(e) => setValues((v) => ({ ...v, drive_folder: e.target.value }))}
                      required
                    />
                    <p className="notif-hint">{t.fields.driveFolderHint}</p>
                    <p className="notif-hint">{t.driveOffNote}</p>
                  </>
                )}
              </>
            )}
          </fieldset>

          <fieldset className="notif-step">
            <legend className="notif-step-title">{t.steps.name}</legend>
            <TextInputField
              label={t.fields.name}
              placeholder={t.fields.namePlaceholder}
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              required
            />
            <p className="notif-hint">{t.fields.nameHint}</p>
            {/* Con la fecha o la hora, dos entregas se distinguen sin abrirlas y
                en Drive no se pisan. */}
            <div className="notif-name-opts">
              <label className="baja-toggle">
                <input
                  type="checkbox"
                  checked={values.name_with_date}
                  onChange={(e) => setValues((v) => ({ ...v, name_with_date: e.target.checked }))}
                />
                {t.fields.nameWithDate}
              </label>
              <label className="baja-toggle">
                <input
                  type="checkbox"
                  checked={values.name_with_time}
                  onChange={(e) => setValues((v) => ({ ...v, name_with_time: e.target.checked }))}
                />
                {t.fields.nameWithTime}
              </label>
            </div>
            <p className="notif-preview">{t.fields.namePreview(namePreview)}</p>
          </fieldset>

          <div className="notif-enabled">
            <label className="baja-toggle">
              <input
                type="checkbox"
                checked={values.enabled}
                onChange={(e) => setValues((v) => ({ ...v, enabled: e.target.checked }))}
              />
              {t.fields.enabled}
            </label>
            <p className="notif-hint">{t.fields.enabledHint}</p>
          </div>
        </form>
      </Modal>
    </div>
  )
}
