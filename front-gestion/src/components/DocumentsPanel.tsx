import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Badge, Button, FileField, IconButton, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import {
  CalendarCheck,
  CalendarX,
  ExternalLink,
  FileX2,
  FolderOpen,
  Lock,
  Replace,
  Trash2,
  Users,
} from 'lucide-react'

import { TextCell } from './TextCell.tsx'

import {
  PERSONAL_DOCUMENT_TYPES,
  VEHICLE_DOCUMENT_TYPES,
  documentAcceptsIncidents,
  documentExpires,
  documentLinkRequired,
  linkableAlertKinds,
  linkableAlerts,
  linkableEventKinds,
  linkableEvents,
  linkableIncidents,
  type EventKind,
} from '../documentRules.ts'
import { documentStatusTone } from '../format.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useConfirm, useDeactivateConfirm } from './ConfirmDialog.tsx'
import { CollapsibleCard, type AccordionState } from './CollapsibleCard.tsx'
import { TableInfoBar } from './TableInfoBar.tsx'

import {
  connectGoogleUrl,
  createDocument,
  deleteDocument,
  fetchFolderFiles,
  fetchPickerConfig,
  listAlerts,
  listDocuments,
  listIncidents,
  listOpenIncidents,
  listVehicleEvents,
  purgeDocument,
  updateDocument,
  uploadDocument,
  verifyDocuments,
  type DocumentInput,
} from '../api.ts'
import { openDrivePicker, type PickedFile } from '../services/google-picker.ts'
import type {
  Alert,
  DriveFile,
  FlotaDocument,
  FlotaEvent,
  Incident,
  ManagedUser,
  PickerConfig,
  Vehicle,
} from '../types.ts'

/** A qué acompaña el documento, codificado en el valor del desplegable:
 * `incident:<id>`, `event:<id>` o `alert:<id>`; vacío = a nada. */
type DocumentLink = { incident: number | null; event: number | null; alert: number | null }

const NO_LINK: DocumentLink = { incident: null, event: null, alert: null }

function parseLink(link: string): DocumentLink {
  const [kind, id] = link.split(':')
  const n = Number(id)
  if (!n) return NO_LINK
  if (kind === 'event') return { ...NO_LINK, event: n }
  if (kind === 'alert') return { ...NO_LINK, alert: n }
  return { ...NO_LINK, incident: n }
}

function linkOf(doc: FlotaDocument | null): string {
  if (doc?.incident) return `incident:${doc.incident}`
  if (doc?.event) return `event:${doc.event}`
  if (doc?.alert) return `alert:${doc.alert}`
  return ''
}

/** Valor del desplegable para «a nada»: un `<select required>` con la opción
 * vacía seleccionada no pasa la validación nativa («Selecciona un elemento de
 * la lista»), así que la opción de «ninguna» lleva un centinela. */
const LINK_NONE = 'none'

/** Los tipos de registro que se piden al back, en el orden de los grupos. */
const EVENT_KINDS: readonly EventKind[] = ['itv', 'maintenance', 'insurance_renewal']

/** Solo enlaces http(s): corta javascript:/data: aunque el back ya sanea. */
function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : ''
}

/** Enlace al archivo: Drive si ya está archivado; staging local si no. */
function documentHref(doc: FlotaDocument): string {
  return safeHref(doc.drive_url) || safeHref(doc.file_url)
}

/** Quién lee el documento, en dos controles: el interruptor de lectura y el
 * candado. Los usan el alta y el modal que lo cambia después, para que digan
 * lo mismo en los dos sitios. */
function VisibilityFields({
  copy,
  sharedRead,
  onSharedRead,
  guarded,
  onGuarded,
}: {
  copy: ReturnType<typeof usePanelsCopy>['documents']
  sharedRead: boolean
  onSharedRead: (value: boolean) => void
  guarded: boolean
  onGuarded: (value: boolean) => void
}) {
  return (
    <div className="doc-visibility">
      <span className="doc-attach-label">{copy.visibility}</span>
      {/* Protegido manda: con el candado puesto no lo lee nadie de campo, así
          que el interruptor de lectura deja de tener nada que decidir. */}
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          checked={sharedRead}
          disabled={guarded}
          onChange={(e) => onSharedRead(e.target.checked)}
        />
        <span className="switch-track" aria-hidden />
        <span>{copy.sharedRead}</span>
      </label>
      <label className="baja-toggle">
        <input type="checkbox" checked={guarded} onChange={(e) => onGuarded(e.target.checked)} />
        {copy.protected}
      </label>
      <p className="muted ops-note">{guarded ? copy.protectedHint : copy.visibilityHint}</p>
    </div>
  )
}

interface AttachState {
  picked: PickedFile | null
  file: File | null
  manualUrl: string
}

const EMPTY_ATTACH: AttachState = { picked: null, file: null, manualUrl: '' }

interface FormState {
  type: string
  expiry_date: string
  /** A qué acompaña (`incident:<id>` / `event:<id>`), o vacío. */
  link: string
  notes: string
  /** Confidencialidad: el interruptor de lectura y el candado. Nacen apagados
   * —un documento nuevo lo lee solo su responsable— y el responsable no se
   * pide aquí: lo pone el back con el conductor vigente. */
  shared_read: boolean
  protected: boolean
}

const emptyForm = (type: string): FormState => ({
  type,
  expiry_date: '',
  link: '',
  notes: '',
  shared_read: false,
  protected: false,
})

/** El titular de los documentos: un vehículo (la ficha del coche) O una
 * persona (la ficha del usuario: sus documentos personales, como el permiso
 * de conducir). Exactamente uno, igual que exige el back. */
type DocumentsOwner =
  | { vehicle: Vehicle; user?: undefined }
  | { user: ManagedUser; vehicle?: undefined }

/** Sección "Documentos" de la ficha (G7): consultar, subir/elegir de Drive,
 * sustituir conservando versión, caducar/reactivar y eliminar. En la ficha
 * de un usuario enseña solo LOS SUYOS: sin incidencias (son del coche), sin
 * carpeta de Drive que abrir y con los tipos personales. */
export function DocumentsPanel({
  vehicle,
  user,
  accordion,
}: DocumentsOwner & { accordion: AccordionState }) {
  const t = usePanelsCopy().documents
  const personal = !vehicle
  // Filtro/titular que viaja al back en cada llamada (`{vehicle}` o `{user}`).
  const ownerFilter = useMemo<{ vehicle?: number; user?: number }>(
    () => (vehicle ? { vehicle: vehicle.id } : { user: user.id }),
    [vehicle, user],
  )
  const ownerLabel = vehicle
    ? vehicle.plate
    : `${user.first_name} ${user.last_name}`.trim() || user.username
  const defaultType = personal ? 'driving_license' : 'insurance'
  const typeOptions = useMemo(
    () =>
      (personal ? PERSONAL_DOCUMENT_TYPES : VEHICLE_DOCUMENT_TYPES).map((value) => ({
        value,
        label: t.typeOptions[value],
      })),
    [personal, t],
  )
  /** Cómo se lee la regla de un documento, en una chapa. */
  const visibilityLabel = useCallback(
    (doc: FlotaDocument) =>
      doc.protected ? t.protected : doc.shared_read ? t.sharedRead : t.onlyResponsible,
    [t],
  )
  const deactivateConfirm = useDeactivateConfirm()
  const confirm = useConfirm()
  const [docs, setDocs] = useState<FlotaDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  /** El documento cuya visibilidad se está cambiando, si hay alguno. */
  const [visibilityDoc, setVisibilityDoc] = useState<FlotaDocument | null>(null)
  // Búsqueda en cliente sobre los documentos ya cargados (barra informativa).
  const [search, setSearch] = useState('')
  // Agrupar la tabla en bloques plegables por tipo de documento (un nivel,
  // alfabético): la casilla de la barra.
  const [groupByType, setGroupByType] = useState(false)

  const [picker, setPicker] = useState<PickerConfig | null>(null)
  const [folderFiles, setFolderFiles] = useState<DriveFile[] | null>(null)
  const [folderError, setFolderError] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [replacing, setReplacing] = useState<FlotaDocument | null>(null)
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultType))
  const [attach, setAttach] = useState<AttachState>(EMPTY_ATTACH)
  const [incidents, setIncidents] = useState<Incident[]>([])
  // Los registros del coche a los que puede acompañar un documento (ITV,
  // mantenimientos, renovaciones de seguro), cargados al abrir el alta.
  const [events, setEvents] = useState<FlotaEvent[]>([])
  // Las alertas abiertas a las que puede acompañar (la ITV programada del informe).
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // R3-30: `t` por ref — con `t` en las deps, el botón es/en recargaba los
  // documentos del vehículo (el diccionario solo pinta el error).
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })

  const load = useCallback(() => {
    setLoading(true)
    listDocuments({ ...ownerFilter, type: typeFilter || undefined })
      .then((page) => {
        setDocs(page.results)
        setError('')
        // En cada carga se comprueba que los archivos siguen en Drive: lo que
        // ya no está se marca en la fila (y ofrece el borrado definitivo). La
        // tabla no espera a Drive: se pinta con la lista y se corrige después.
        verifyDocuments(ownerFilter)
          .then(({ checked, missing }) => {
            const ahora = new Date().toISOString()
            setDocs((actuales) =>
              actuales.map((doc) => {
                if (!checked.includes(doc.id)) return doc
                if (missing.includes(doc.id)) {
                  return { ...doc, drive_missing_at: doc.drive_missing_at ?? ahora }
                }
                return doc.drive_missing_at ? { ...doc, drive_missing_at: null } : doc
              }),
            )
          })
          .catch(() => undefined) // sin Drive a mano, la lista sigue valiendo
      })
      .catch((err) => setError(asErrorMessage(err, tRef.current.loadError)))
      .finally(() => setLoading(false))
  }, [ownerFilter, typeFilter])

  useEffect(load, [load])

  useEffect(() => {
    fetchPickerConfig()
      .then(setPicker)
      .catch(() => setPicker({ enabled: false }))
  }, [])

  const openCreate = useCallback((replaceDoc: FlotaDocument | null = null) => {
    setReplacing(replaceDoc)
    setForm(
      replaceDoc
        ? {
            type: replaceDoc.type,
            expiry_date: '',
            link: linkOf(replaceDoc),
            notes: '',
            // La versión nueva se lee como la anterior: sustituir es cambiar
            // el papel, no a quién se le enseña.
            shared_read: replaceDoc.shared_read,
            protected: replaceDoc.protected,
          }
        : emptyForm(defaultType),
    )
    setAttach(EMPTY_ATTACH)
    setFormError('')
    setModalOpen(true)
    // Las incidencias y los registros son del coche: un documento personal no
    // se liga a nada.
    if (!vehicle) {
      setIncidents([])
      setEvents([])
      setAlerts([])
      return
    }
    // Lo que tiene el coche a lo que puede acompañar un documento: sus
    // incidencias (las abiertas siempre; las cerradas más recientes para la
    // factura, que llega después de la reparación) y sus registros de ITV,
    // mantenimiento y renovación de seguro. Cada carga que falle deja su
    // lista vacía: el resto se ofrece igual.
    const cargaIncidencias = Promise.allSettled([
      listOpenIncidents({ vehicle: vehicle.id }),
      listIncidents({ vehicle: vehicle.id, status: 'closed' }).then((page) => page.results),
    ]).then((res) => {
      const abiertas = res[0].status === 'fulfilled' ? res[0].value : []
      const cerradas = res[1].status === 'fulfilled' ? res[1].value : []
      const ids = new Set(abiertas.map((row) => row.id))
      return [...abiertas, ...cerradas.filter((row) => !ids.has(row.id))]
    })
    const cargaRegistros = Promise.allSettled(
      EVENT_KINDS.map((kind) => listVehicleEvents(vehicle.id, kind).then((page) => page.results)),
    ).then((res) => res.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])))
    // La ITV programada es la alerta `itv_due` abierta del coche.
    const cargaAlertas = listAlerts({ vehicle: vehicle.id, type: 'itv_due', status: 'open' })
      .then((page) => page.results)
      .catch((): Alert[] => [])
    Promise.all([cargaIncidencias, cargaRegistros, cargaAlertas]).then(
      ([rows, registros, avisos]) => {
        setIncidents(rows)
        setEvents(registros)
        setAlerts(avisos)
        // Si lo que ligaba el documento sustituido ya no se ofrece (la
        // incidencia se cerró y el tipo no admite cerradas), se suelta.
        setForm((f) => {
          const { incident, event, alert } = parseLink(f.link)
          const sigue = incident
            ? linkableIncidents(rows, f.type).some((row) => row.id === incident)
            : event
              ? linkableEvents(registros, f.type).some((row) => row.id === event)
              : alert
                ? linkableAlerts(avisos, f.type).some((row) => row.id === alert)
                : true
          return sigue ? f : { ...f, link: '' }
        })
      },
    )
  }, [defaultType, vehicle])

  // Qué pide el formulario según el tipo elegido (mismas reglas que el back).
  const expires = documentExpires(form.type)
  const linkRequired = documentLinkRequired(form.type)
  const linkableInc = useMemo(() => linkableIncidents(incidents, form.type), [incidents, form.type])
  const linkableEv = useMemo(() => linkableEvents(events, form.type), [events, form.type])
  const linkableAl = useMemo(() => linkableAlerts(alerts, form.type), [alerts, form.type])
  // Un solo desplegable con lo que tiene el coche, agrupado por su categoría:
  // incidencias y, detrás, cada tipo de registro o alerta que el documento admita.
  const linkOptions = useMemo(() => {
    const grupos = t.linkGroups
    const opciones = linkableInc.map((i) => ({
      value: `incident:${i.id}`,
      label: t.incidentOption(i),
      group: grupos.incidents,
    }))
    for (const kind of linkableEventKinds(form.type)) {
      for (const e of linkableEv) {
        if (e.event_type !== kind) continue
        opciones.push({ value: `event:${e.id}`, label: t.eventOption(e), group: grupos[kind] })
      }
    }
    if (linkableAlertKinds(form.type).length) {
      for (const a of linkableAl) {
        opciones.push({ value: `alert:${a.id}`, label: t.alertOption(a), group: grupos.scheduled })
      }
    }
    return opciones
  }, [form.type, linkableAl, linkableEv, linkableInc, t])
  // Cómo se llama el desplegable y qué se dice si está vacío, según el tipo.
  const linkCopy = t.linkCopyFor(form.type)
  // Con solo incidencias que ofrecer, el rótulo habla de incidencias.
  const soloIncidencias =
    documentAcceptsIncidents(form.type) &&
    !linkableEventKinds(form.type).length &&
    !linkableAlertKinds(form.type).length

  /** ¿Sigue ofreciéndose `link` para un documento de `type`? */
  const linkOffered = useCallback(
    (link: string, type: string) => {
      const { incident, event, alert } = parseLink(link)
      if (incident) return linkableIncidents(incidents, type).some((row) => row.id === incident)
      if (event) return linkableEvents(events, type).some((row) => row.id === event)
      if (alert) return linkableAlerts(alerts, type).some((row) => row.id === alert)
      return true
    },
    [alerts, events, incidents],
  )

  function changeType(value: string) {
    // Al cambiar de tipo caen los campos que ese tipo no tiene: la caducidad
    // de lo que no caduca y el vínculo que el tipo nuevo no admite.
    setForm((f) => ({
      ...f,
      type: value,
      expiry_date: documentExpires(value) ? f.expiry_date : '',
      link: linkOffered(f.link, value) ? f.link : '',
    }))
  }

  async function pickFromDrive(mode: 'file' | 'upload') {
    if (!picker?.access_token || !picker.api_key) return
    setFormError('')
    try {
      const result = await openDrivePicker({
        accessToken: picker.access_token,
        apiKey: picker.api_key,
        appId: picker.app_id,
        mode,
      })
      if (result) setAttach({ picked: result, file: null, manualUrl: '' })
    } catch (err) {
      setFormError(asErrorMessage(err, t.pickerError))
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const { picked, file, manualUrl } = attach
    if (!picked && !file && !manualUrl) {
      setFormError(t.attachRequired)
      return
    }
    if (expires && !form.expiry_date) {
      setFormError(t.expiryRequired)
      return
    }
    if (linkRequired && !form.link) {
      setFormError(linkCopy.required)
      return
    }
    setSaving(true)
    setFormError('')
    const base: DocumentInput = {
      ...ownerFilter,
      type: form.type,
      expiry_date: form.expiry_date || null,
      // Un documento personal no acompaña a nada (el back lo rechazaría).
      ...(personal ? {} : parseLink(form.link)),
      notes: form.notes || undefined,
      replaces: replacing?.id ?? null,
      shared_read: form.shared_read,
      protected: form.protected,
    }
    try {
      if (file) {
        await uploadDocument(base, file)
      } else {
        await createDocument({
          ...base,
          drive_url: picked?.url ?? manualUrl,
          drive_file_id: picked?.id || undefined,
        })
      }
      // Sustituir conserva el anterior (`replaces`) y lo marca caducado (HU-4.4).
      if (replacing && replacing.status !== 'expired') {
        await updateDocument(replacing.id, { status: 'expired' })
      }
      setModalOpen(false)
      load()
    } catch (err) {
      setFormError(asErrorMessage(err, t.saveError))
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = useCallback(async (doc: FlotaDocument) => {
    try {
      await updateDocument(doc.id, { status: doc.status === 'expired' ? 'valid' : 'expired' })
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.statusError))
    }
  }, [load, t.statusError])

  const handleDelete = useCallback(async (doc: FlotaDocument) => {
    // N7: nada se borra — doble confirmación y desactivación con motivo. El
    // borrado definitivo (también en Drive) lo hace el superusuario en erratas.
    const reason = await deactivateConfirm(t.deactivateTarget(doc.type_display))
    if (reason === null) return
    try {
      await deleteDocument(doc.id, reason)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.deactivateError))
    }
  }, [deactivateConfirm, load, t])

  const handlePurge = useCallback(async (doc: FlotaDocument) => {
    // El archivo ya no existe (lo comprobó la carga): no hay nada que
    // conservar ni que restaurar, así que el registro se borra del todo aquí,
    // sin pasar por erratas. El back lo exige igual (solo con la marca).
    const ok = await confirm({
      title: t.purge,
      message: t.purgeConfirm(doc.type_display),
      confirmLabel: t.purge,
      tone: 'danger',
    })
    if (!ok) return
    try {
      await purgeDocument(doc.id)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.purgeError))
    }
  }, [confirm, load, t])

  async function toggleFolder() {
    if (folderFiles || !vehicle) {
      setFolderFiles(null)
      return
    }
    setFolderError('')
    try {
      const result = await fetchFolderFiles(vehicle.drive_folder_id)
      if (result.error) setFolderError(t.driveUnavailable)
      setFolderFiles(result.files)
    } catch (err) {
      setFolderError(asErrorMessage(err, t.folderListError))
    }
  }

  const pickerReady = Boolean(picker?.enabled && picker.has_drive && picker.access_token)
  const needsConnect = Boolean(picker?.enabled && !picker.has_drive)
  // La carpeta de Drive que se enlaza es la del coche; la de una persona
  // (`Usuarios/<correo>`) la crea el archivador y no viaja en su ficha.
  const folderUrl = vehicle ? safeHref(vehicle.drive_folder_url) : ''
  const folderId = vehicle?.drive_folder_id ?? ''

  // Filtro en cliente: tipo, notas, usuario, estado, caducidad o fecha de subida.
  const visibleDocs = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return docs
    return docs.filter((doc) =>
      `${doc.type_display} ${doc.notes ?? ''} ${doc.uploaded_by_name ?? ''} ${doc.status_display} ${doc.expiry_date ?? ''} ${doc.created_at.slice(0, 10)}`
        .toLowerCase()
        .includes(term),
    )
  }, [docs, search])

  // Tabla de documentos con el estilo unificado (TableWithPanel).
  const columns = useMemo<Array<TableWithPanelColumn<FlotaDocument>>>(() => [
    {
      key: 'type',
      label: t.columns.type,
      getValue: (doc) => doc.type_display,
      render: (doc) => (
        <span>
          <strong>{doc.type_display}</strong>
          {doc.replaces ? <span className="doc-version">{t.replacesTag(doc.replaces)}</span> : null}
        </span>
      ),
    },
    {
      key: 'created_at',
      label: t.columns.uploaded,
      isDate: true,
      getValue: (doc) => doc.created_at.slice(0, 10),
      render: (doc) => doc.created_at.slice(0, 10),
    },
    {
      key: 'uploaded_by',
      label: t.columns.by,
      getValue: (doc) => doc.uploaded_by_name || '',
      render: (doc) => doc.uploaded_by_name || '—',
    },
    {
      key: 'expiry_date',
      label: t.columns.expiry,
      isDate: true,
      getValue: (doc) => doc.expiry_date ?? '',
      render: (doc) => doc.expiry_date ?? '—',
    },
    {
      // A qué acompaña: la incidencia (#id) o el registro (ITV, renovación…).
      key: 'link',
      label: t.columns.link,
      getValue: (doc) =>
        doc.incident ? `#${doc.incident}` : doc.event_display || doc.alert_display || '',
      render: (doc) =>
        doc.incident ? `#${doc.incident}` : doc.event_display || doc.alert_display || '—',
    },
    {
      // Las notas en columna propia: antes iban debajo del tipo y una nota
      // larga levantaba la fila. Recortadas a una línea; el modal las lee enteras.
      key: 'notes',
      label: t.columns.notes,
      getValue: (doc) => doc.notes ?? '',
      render: (doc) => (
        <TextCell text={doc.notes ?? ''} title={t.columns.notes} label={t.notesOpen} inline />
      ),
    },
    {
      key: 'status',
      label: t.columns.status,
      getValue: (doc) => doc.status_display,
      render: (doc) => (
        <span className="doc-status">
          <Badge tone={documentStatusTone(doc.status)}>{doc.status_display}</Badge>
          {doc.drive_missing_at && (
            <span title={t.driveMissingTitle}>
              <Badge tone="danger">{t.driveMissing}</Badge>
            </span>
          )}
        </span>
      ),
    },
    {
      // Quién lo lee, en dos líneas: la regla arriba y de quién es debajo.
      key: 'visibility',
      label: t.columns.visibility,
      getValue: (doc) => visibilityLabel(doc),
      render: (doc) => (
        <div className="stack-cell">
          <Badge tone={doc.protected ? 'danger' : doc.shared_read ? 'success' : 'warning'}>
            {visibilityLabel(doc)}
          </Badge>
          {doc.responsible_name && (
            <span className="stack-cell-sub muted">{doc.responsible_name}</span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      label: t.columns.actions,
      align: 'right',
      searchable: false,
      sortable: false,
      // Solo iconos, con su nombre en `aria-label`/`title` (el mismo patrón que
      // Facturas): cuatro botones con texto por fila no cabían en la tabla.
      render: (doc) => {
        // Sin archivo detrás no hay nada que abrir: el enlace se va y, en
        // lugar de «Eliminar» (erratas), sale el borrado definitivo.
        const missing = Boolean(doc.drive_missing_at)
        const href = missing ? '' : documentHref(doc)
        const estado = doc.status === 'expired' ? t.markValid : t.markExpired
        return (
          <div className="row-actions">
            {href && (
              <a
                className="doc-open-icon"
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={t.open}
                title={t.open}
              >
                <ExternalLink size={15} aria-hidden />
              </a>
            )}
            <IconButton aria-label={t.replace} title={t.replace} onClick={() => openCreate(doc)}>
              <Replace size={15} />
            </IconButton>
            {/* Quién lo lee se decide también DESPUÉS de subirlo: un
                interruptor que solo se puede poner en el alta no sirve. */}
            <IconButton
              aria-label={t.editVisibility}
              title={t.editVisibility}
              onClick={() => setVisibilityDoc(doc)}
            >
              {doc.protected ? <Lock size={15} /> : <Users size={15} />}
            </IconButton>
            {doc.status !== 'pending_archive' && (
              <IconButton
                variant={doc.status === 'expired' ? 'default' : 'warning'}
                aria-label={estado}
                title={estado}
                onClick={() => toggleStatus(doc)}
              >
                {doc.status === 'expired' ? <CalendarCheck size={15} /> : <CalendarX size={15} />}
              </IconButton>
            )}
            {missing ? (
              <IconButton
                variant="danger"
                aria-label={t.purge}
                title={t.purge}
                onClick={() => handlePurge(doc)}
              >
                <FileX2 size={15} />
              </IconButton>
            ) : (
              <IconButton
                variant="danger"
                aria-label={t.delete}
                title={t.delete}
                onClick={() => handleDelete(doc)}
              >
                <Trash2 size={15} />
              </IconButton>
            )}
          </div>
        )
      },
    },
  ], [handleDelete, handlePurge, openCreate, t, toggleStatus, visibilityLabel])

  // Los documentos personales no acompañan a nada: la columna sobra.
  const visibleColumns = useMemo(
    () => (personal ? columns.filter((column) => column.key !== 'link') : columns),
    [columns, personal],
  )

  return (
    <CollapsibleCard
      id="documents"
      accordion={accordion}
      title={personal ? t.titlePersonal : t.title}
      actions={
        accordion.isOpen('documents') ? (
          <div className="section-tools">
            <Button variant="primary" onClick={() => openCreate()}>
              {t.add}
            </Button>
          </div>
        ) : (
          // Resumen al colapsar: nº de documentos.
          <span className="acc-summary">{t.collapsedCount(docs.length)}</span>
        )
      }
    >

      {needsConnect && (
        <div className="drive-connect">
          <p>
            {t.connectLead}<strong>{t.connectStrong}</strong>{t.connectTail}
          </p>
          <Button variant="secondary" onClick={() => (window.location.href = connectGoogleUrl())}>
            {t.connectButton}
          </Button>
        </div>
      )}

      {(folderUrl || (pickerReady && folderId)) && (
        <p className="drive-folder-row">
          <FolderOpen size={15} aria-hidden />
          {folderUrl ? (
            <a href={folderUrl} target="_blank" rel="noreferrer">
              {t.driveFolder}
            </a>
          ) : (
            <span>{t.driveFolder}</span>
          )}
          {pickerReady && folderId && (
            <Button variant="secondary" size="sm" onClick={toggleFolder}>
              {folderFiles ? t.hideContents : t.showContents}
            </Button>
          )}
        </p>
      )}
      {folderError && <div role="alert" className="form-error">{folderError}</div>}
      {folderFiles && (
        <ul className="drive-folder-files">
          {folderFiles.length === 0 && <li>{t.folderEmpty}</li>}
          {folderFiles.map((f) => (
            <li key={f.id}>
              <a href={safeHref(f.url)} target="_blank" rel="noreferrer">
                {f.name}
              </a>
            </li>
          ))}
        </ul>
      )}

      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <>
          {/* Barra informativa tipo tarjeta (como en Vehículos): contador +
              buscador + filtro de tipo. */}
          <TableInfoBar
            count={visibleDocs.length}
            recordsLabel={t.records}
            searchLabel={t.searchLabel}
            searchPlaceholder={t.searchPlaceholder}
            search={search}
            onSearchChange={setSearch}
          >
            <div className="filter-field filter-field--role">
              <label>{t.filterType}</label>
              <SelectField
                aria-label={t.filterType}
                containerClassName="role-filter"
                required
                options={[{ value: '', label: t.allTypes }, ...typeOptions]}
                value={typeFilter}
                onValueChange={setTypeFilter}
              />
            </div>
            {/* Los bloques por tipo: una cabecera plegable por cada tipo con
                sus filas debajo, como agrupa la bandeja de alertas. */}
            <label className="baja-toggle">
              <input
                type="checkbox"
                checked={groupByType}
                onChange={(e) => setGroupByType(e.target.checked)}
              />
              {t.groupByType}
            </label>
          </TableInfoBar>
          <TableWithPanel<FlotaDocument>
            rows={visibleDocs}
            columns={visibleColumns}
            rowKey={(doc) => String(doc.id)}
            rowClassName={(doc) => (doc.status === 'expired' ? 'row-muted' : '')}
            enableColumnSort
            showControlPanel={false}
            enablePagination
            defaultPageSize={25}
            pageSizeOptions={[25, 50, 100]}
            emptyStateLabel={t.empty(Boolean(typeFilter) || Boolean(search))}
            groupRowsByColumnKey={groupByType ? 'type' : undefined}
          />
        </>
      )}

      <Modal
        open={modalOpen}
        title={replacing ? t.modalTitleReplace(replacing.type_display) : t.modalTitleNew(ownerLabel)}
        onClose={() => setModalOpen(false)}
      >
        <form className="modal-form" onSubmit={handleSubmit}>
          <SelectField
            label={t.typeLabel}
            required
            options={typeOptions}
            value={form.type}
            onValueChange={changeType}
          />
          {/* La caducidad solo se pide a lo que caduca (póliza, contrato,
              informe de ITV, permiso), y ahí es obligatoria. */}
          {expires && (
            <TextInputField
              label={t.expiryLabel}
              type="date"
              required
              requiredVisual
              value={form.expiry_date}
              onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
            />
          )}
          {/* A qué acompaña: un parte de accidente va SIEMPRE ligado a un
              accidente abierto y una factura de taller a una incidencia, una
              ITV o un mantenimiento; la póliza y el informe de ITV pueden ir
              con su registro; lo demás, con cualquier incidencia sin cerrar.
              Un solo desplegable con lo que tiene el coche, por categorías. */}
          {linkRequired ? (
            linkOptions.length > 0 ? (
              <SelectField
                label={linkCopy.label}
                required
                requiredVisual
                options={[{ value: '', label: linkCopy.choose }, ...linkOptions]}
                value={form.link}
                onValueChange={(value) => setForm((f) => ({ ...f, link: value }))}
              />
            ) : (
              <p className="form-error" role="status">
                {linkCopy.none(t.typeOptions[form.type as keyof typeof t.typeOptions])}
              </p>
            )
          ) : (
            linkOptions.length > 0 && (
              <SelectField
                label={soloIncidencias ? t.incidentLabel : t.recordLabel}
                required
                options={[
                  { value: LINK_NONE, label: soloIncidencias ? t.incidentNone : t.recordNone },
                  ...linkOptions,
                ]}
                value={form.link || LINK_NONE}
                onValueChange={(value) =>
                  setForm((f) => ({ ...f, link: value === LINK_NONE ? '' : value }))
                }
              />
            )
          )}
          <TextInputField
            label={t.notesLabel}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />

          <VisibilityFields
            copy={t}
            sharedRead={form.shared_read}
            onSharedRead={(value) => setForm((f) => ({ ...f, shared_read: value }))}
            guarded={form.protected}
            onGuarded={(value) => setForm((f) => ({ ...f, protected: value }))}
          />

          <div className="doc-attach">
            <span className="doc-attach-label">{t.fileLabel}</span>
            {pickerReady && (
              <div className="doc-attach-drive">
                <Button type="button" variant="secondary" onClick={() => pickFromDrive('upload')}>
                  {t.uploadToDrive}
                </Button>
                <Button type="button" variant="secondary" onClick={() => pickFromDrive('file')}>
                  {t.pickFromDrive}
                </Button>
              </div>
            )}
            {attach.picked ? (
              <p className="doc-attach-picked">
                📄 {attach.picked.name}{' '}
                <Button type="button" variant="secondary" size="sm" onClick={() => setAttach(EMPTY_ATTACH)}>
                  {t.removeAttachment}
                </Button>
              </p>
            ) : (
              <>
                <FileField
                  label={t.filePickLabel}
                  accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
                  value={attach.file}
                  onFiles={(files) =>
                    setAttach({ picked: null, file: files[0] ?? null, manualUrl: '' })
                  }
                />
                <TextInputField
                  label={t.urlLabel}
                  value={attach.manualUrl}
                  onChange={(e) => setAttach({ picked: null, file: null, manualUrl: e.target.value })}
                  placeholder="https://drive.google.com/…"
                  disabled={Boolean(attach.file)}
                />
              </>
            )}
          </div>

          {formError && <div role="alert" className="form-error">{formError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              {t.cancel}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving || (linkRequired && linkOptions.length === 0)}
            >
              {saving ? t.saving : replacing ? t.replace : t.save}
            </Button>
          </div>
        </form>
      </Modal>

      {visibilityDoc && (
        <VisibilityModal
          doc={visibilityDoc}
          copy={t}
          onClose={() => setVisibilityDoc(null)}
          onSaved={() => {
            setVisibilityDoc(null)
            load()
          }}
        />
      )}
    </CollapsibleCard>
  )
}

/** Cambiar quién lee un documento YA subido. Solo eso: lo demás de la fila se
 * corrige sustituyéndolo, que es como funciona el histórico (HU-4.4). */
function VisibilityModal({
  doc,
  copy,
  onClose,
  onSaved,
}: {
  doc: FlotaDocument
  copy: ReturnType<typeof usePanelsCopy>['documents']
  onClose: () => void
  onSaved: () => void
}) {
  const [sharedRead, setSharedRead] = useState(doc.shared_read)
  const [guarded, setGuarded] = useState(doc.protected)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await updateDocument(doc.id, { shared_read: sharedRead, protected: guarded })
      onSaved()
    } catch (err) {
      setError(asErrorMessage(err, copy.saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open title={copy.visibilityTitle(doc.type_display)} onClose={onClose}>
      <form className="ops-modal" onSubmit={submit}>
        <VisibilityFields
          copy={copy}
          sharedRead={sharedRead}
          onSharedRead={setSharedRead}
          guarded={guarded}
          onGuarded={setGuarded}
        />
        {/* El responsable no se edita aquí: lo puso el alta y cambiarlo es
            cambiar de quién es el documento, no cómo se lee. */}
        <p className="muted ops-note">
          {doc.responsible_name ? copy.responsibleIs(doc.responsible_name) : copy.noResponsible}
        </p>
        {error && <div role="alert" className="form-error">{error}</div>}
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? copy.saving : copy.save}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
