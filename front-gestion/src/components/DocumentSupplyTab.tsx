import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, FileField, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import type { BadgeTone } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Ban, Check, Download, FileCheck2, FolderOpen, Handshake, Upload } from 'lucide-react'

import {
  type DocumentSupplyDecision,
  type DocumentSupplyRequestRow,
  type DocumentTypeAccess,
  fetchDocumentAs,
  grantDocumentAccess,
  listAll,
  listDocumentSupplyRequests,
  listDocumentTypeAccess,
  resolveDocumentSupplyRequest,
  uploadDocument,
} from '../api.ts'
import type { FlotaDocument } from '../types.ts'
import { exportCsv } from '../csv.ts'
import {
  PERSONAL_DOCUMENT_TYPES,
  VEHICLE_DOCUMENT_TYPES,
  documentExpires,
  documentLinkRequired,
  incidentTypeRequiredBy,
} from '../documentRules.ts'
import { fmtDate, fmtDateTime } from '../format.ts'
import { useAppLang } from '@flota/ui/i18n'
import { useRequestsCopy } from '../translations/requests.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { isDefaultView, useRequestFilter } from './requestFilter.ts'
import { RequestsFilterBar } from './RequestsFilterBar.tsx'
import { EMPTY_PICK, overridesFromPick } from './accessPick.ts'
import { AccessOverrideRows } from './AccessOverrideRows.tsx'
import { OwnerDocumentsAccess, RequesterAccess, type DocumentOwner } from './OwnerDocumentsAccess.tsx'
import { useAccessParts } from './useAccessParts.ts'

/** Estado → tono de la chapa. Pendiente avisa; las dos salidas informan. */
const TONE: Record<DocumentSupplyRequestRow['status'], BadgeTone> = {
  pending: 'warning',
  done: 'success',
  rejected: 'neutral',
}

/** Lo que se hace con la petición, en UNA elección: las tres maneras de
 * atenderla —subir el documento, elegir uno que ya existe o nada, que se
 * entregó por otra vía— y rechazarla. Antes eran un desplegable (atender /
 * rechazar) y, debajo, tres radios de «cómo»: dos preguntas para una decisión. */
type Choice = 'upload' | 'existing' | 'none' | 'reject'
const CHOICES: Choice[] = ['upload', 'existing', 'none', 'reject']
/** Con qué TIPO se puede atender subiendo: los que se dan de alta sin
 * acompañar a nada (una factura o unas fotos de daños necesitan su
 * incidencia, y aquí no hay dónde elegirla), según sea el titular. El de
 * salida es el pedido; se cambia cuando lo que hace falta es otro papel. */
function uploadableTypes(personal: boolean): readonly string[] {
  if (personal) return PERSONAL_DOCUMENT_TYPES
  return VEHICLE_DOCUMENT_TYPES.filter(
    (type) => !documentLinkRequired(type) && incidentTypeRequiredBy(type) === null,
  )
}

const CHOICE_ICON: Record<Choice, typeof Upload> = {
  upload: Upload,
  existing: FileCheck2,
  none: Handshake,
  reject: Ban,
}

/**
 * Concede a quien pidió lo que, con el acceso que ha quedado, vaya con
 * solicitud sobre ese documento: se mira el documento «como» esa persona y
 * se le concede la lectura y la descarga que no tenga ya y no estén cerradas.
 * Lanza si la persona ni lista el documento: ahí no hay nada que conceder.
 */
async function grantWhatIsOnRequest(docId: number, userId: number) {
  const visto = await fetchDocumentAs(docId, userId)
  if (visto.subject_lists === false) throw new Error('not-listed')
  if (!visto.can_view && visto.view_request !== 'denied') {
    await grantDocumentAccess(docId, { user: userId, kind: 'view' })
  }
  if (!visto.can_download && visto.download_request !== 'denied') {
    await grantDocumentAccess(docId, { user: userId, kind: 'download' })
  }
}

/**
 * Bandeja de **peticiones de documento**: el papel que al campo le falta.
 *
 * Las otras cuatro peticiones sobre documentos hablan de uno que ya existe y
 * que quien pide ya ve (borrarlo, corregirlo, abrir su archivo). Esta es la de
 * antes de todo eso —«necesito el contrato de mi coche y no está», o está y su
 * tipo está cerrado al conductor, con lo que ni se lista—, así que no cuelga de
 * ningún documento: cuelga del titular y de un TIPO.
 *
 * Y se puede **atender aquí mismo**: se adjunta el archivo, se sube con el alta
 * de siempre —con sus reglas y su archivador, no con un camino paralelo— y la
 * fila se queda con cuál fue. Son **dos llamadas**, y en ese orden: si la
 * segunda falla, el documento ya está subido, así que se dice y no se tumba
 * nada. Atender **no da acceso por sí solo**: lo subido se lee con la regla de
 * su tipo, que se decide en Documentos → Ajustes.
 */
export function DocumentSupplyTab({ onCountsChange }: { onCountsChange?: () => void }) {
  const t = useRequestsCopy()
  const etiqueta = useDomainLabels()
  const copy = t.supply
  const lang = useAppLang()

  const [rows, setRows] = useState<DocumentSupplyRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [managing, setManaging] = useState<DocumentSupplyRequestRow | null>(null)
  // La documentación del titular va en SU modal, encima de la decisión: se
  // abre para elegir con qué documento se atiende y para dar acceso a lo
  // que ya hay. Fue una pestaña, y la decisión no se leía entera.
  const [docsOpen, setDocsOpen] = useState(false)
  const [docsCount, setDocsCount] = useState<number | null>(null)
  // El acuse de lo guardado en esa lista, que se cierra al guardar, y los
  // documentos que se marcaron en ella, con su acceso para quien pide: son
  // los «elegidos» entre los que se atiende con uno que ya existe.
  const [docsNotice, setDocsNotice] = useState('')
  const [chosenDocs, setChosenDocs] = useState<FlotaDocument[]>([])
  const [choice, setChoice] = useState<Choice>('upload')
  const [file, setFile] = useState<File | null>(null)
  // El tipo del documento que se sube: el pedido, salvo que se cambie.
  const [docType, setDocType] = useState('')
  const [expiry, setExpiry] = useState('')
  // El acceso del documento que se sube: según su tipo o un ajuste propio.
  const [accessMode, setAccessMode] = useState<'type' | 'own'>('type')
  const [pick, setPick] = useState(EMPTY_PICK)
  // Con uno que ya existe: el elegido en la lista de abajo.
  const [picked, setPicked] = useState<FlotaDocument | null>(null)
  // Y concederle ya a quien pidió lo que quede con solicitud.
  const [grantToo, setGrantToo] = useState(true)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState('')
  const [rules, setRules] = useState<DocumentTypeAccess[]>([])

  // R3-30: `t` por ref — con el diccionario en las deps, el botón es/en
  // re-descargaba la bandeja entera (solo pinta el mensaje de error).
  const tRef = useRef(copy)
  useEffect(() => {
    tRef.current = copy
  })

  const load = useCallback(() => {
    setLoading(true)
    listAll(listDocumentSupplyRequests({}))
      .then((loaded) => {
        setRows(loaded)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, tRef.current.loadError)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])
  // Quién lee cada tipo: lo que dice «según su tipo» al subir.
  useEffect(() => {
    listDocumentTypeAccess().then(setRules).catch(() => setRules([]))
  }, [])
  const accessByType = useMemo(() => new Map(rules.map((r) => [r.type, r])), [rules])
  const accessParts = useAccessParts(accessByType)

  /** De quién es el papel: del coche (su matrícula) o de una persona. */
  const ownerLabel = useCallback(
    (r: DocumentSupplyRequestRow) =>
      r.vehicle ? r.vehicle_plate : copy.ownerPersonal(r.user_name),
    [copy],
  )

  function openManage(row: DocumentSupplyRequestRow) {
    setManaging(row)
    setDocsOpen(false)
    setDocsCount(null)
    setDocsNotice('')
    setChosenDocs([])
    setChoice('upload')
    setFile(null)
    setDocType(row.type)
    setExpiry('')
    setAccessMode('type')
    setPick(EMPTY_PICK)
    setPicked(null)
    setGrantToo(true)
    setNote('')
    setModalError('')
  }

  /** El titular de la petición: el coche o la persona. */
  const ownerOf = (row: DocumentSupplyRequestRow): DocumentOwner =>
    row.vehicle ? { vehicle: row.vehicle } : { user: row.user as number }

  /** Lo que un tipo dice hoy de quién lo lee (chapas). */
  const typeSays = (type: string) => {
    const rule = accessByType.get(type as FlotaDocument['type'])
    const falso = {
      type,
      supervisor_read_override: null,
      driver_read_override: null,
      driver_view_override: null,
      driver_download_override: null,
      driver_delete_override: null,
      effective_access: rule
        ? {
            supervisor_read: rule.supervisor_read,
            driver_read: rule.driver_read,
            driver_view: rule.driver_view,
            driver_download: rule.driver_download,
            driver_delete: rule.driver_delete,
          }
        : undefined,
    } as unknown as FlotaDocument
    const parts = accessParts(falso)
    return [...parts.supervisor, ...parts.driver]
  }

  /** Atender subiendo el documento son DOS llamadas (tres con la concesión),
   * en este orden: el alta de siempre —con el acceso elegido—, la concesión a
   * quien pidió de lo que quede con solicitud, y la resolución con el
   * documento. Con uno que ya existe, las dos últimas. */
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!managing) return
    const decision: DocumentSupplyDecision = choice === 'reject' ? 'reject' : 'done'
    const sube = choice === 'upload'
    if (sube && !file) {
      setModalError(copy.fileRequired)
      return
    }
    if (sube && documentExpires(docType) && !expiry) {
      setModalError(copy.expiryRequired)
      return
    }
    if (choice === 'existing' && !picked) {
      setModalError(copy.pickRequired)
      return
    }
    setSaving(true)
    setModalError('')
    const quien = ownerLabel(managing)
    let documento: number | null = choice === 'existing' ? (picked?.id ?? null) : null
    try {
      if (sube) {
        const creado = await uploadDocument(
          {
            ...ownerOf(managing),
            type: docType,
            expiry_date: documentExpires(docType) ? expiry || null : null,
            // El acceso con el que nace: lo de su tipo (nada que mandar) o el
            // ajuste propio, que pisa lo del tipo solo en este documento.
            ...(accessMode === 'own' ? overridesFromPick(pick) : {}),
            // Sin notas: el porqué de quien lo pidió («me lo piden en la
            // obra») es de la petición, no del documento, y en la lista de
            // la ficha solo sería ruido. La fila guarda con cuál se atendió.
          },
          file as File,
        )
        documento = creado.id
      }
    } catch (err) {
      setModalError(asErrorMessage(err, copy.uploadError))
      setSaving(false)
      return
    }
    // La concesión va ANTES de resolver, y su fallo no tumba nada: la
    // petición se atiende igual y se dice que el acceso queda por conceder.
    let sinConceder = false
    if (documento !== null && grantToo && managing.requested_by) {
      try {
        await grantWhatIsOnRequest(documento, managing.requested_by)
      } catch {
        sinConceder = true
      }
    }
    try {
      await resolveDocumentSupplyRequest(managing.id, decision, note.trim(), documento)
      setNotice(
        (decision === 'done' ? copy.okDone(quien) : copy.okReject(quien)) +
          (sinConceder ? ` ${copy.grantFailed}` : ''),
      )
      setManaging(null)
      load()
      onCountsChange?.()
    } catch (err) {
      // El documento ya está subido: decirlo y no tumbar nada, que es el mismo
      // trato que da el despachador de resolver al soltar un sustituto.
      setModalError(
        documento === null ? asErrorMessage(err, copy.error) : copy.resolveAfterUpload,
      )
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo<Array<TableWithPanelColumn<DocumentSupplyRequestRow>>>(
    () => [
      {
        key: 'requester',
        label: copy.columns.requester,
        getValue: (r) => r.requested_by_name,
        render: (r) => <strong>{r.requested_by_name || '—'}</strong>,
      },
      {
        key: 'owner',
        label: copy.columns.owner,
        getValue: (r) => ownerLabel(r),
        render: (r) =>
          r.vehicle ? (
            <Link to={`/vehiculos/${r.vehicle}`} className="cell-link">
              {r.vehicle_plate}
            </Link>
          ) : (
            <Link to={`/conductores/${r.user}`} className="cell-link">
              {copy.ownerPersonal(r.user_name)}
            </Link>
          ),
      },
      {
        key: 'type',
        label: copy.columns.type,
        getValue: (r) => etiqueta.docType(r),
        render: (r) => etiqueta.docType(r),
      },
      {
        key: 'note',
        label: copy.columns.note,
        getValue: (r) => r.note,
        render: (r) =>
          r.note ? (
            <div className="cell-truncate" title={r.note}>
              {r.note}
            </div>
          ) : (
            <span className="muted">{copy.noNote}</span>
          ),
      },
      {
        key: 'requested',
        label: copy.columns.requested,
        isDate: true,
        getValue: (r) => r.created_at,
        render: (r) => fmtDate(r.created_at, lang),
      },
      {
        key: 'status',
        label: copy.columns.status,
        getValue: (r) => etiqueta.requestStatus('supply', r),
        render: (r) => <Badge tone={TONE[r.status]}>{etiqueta.requestStatus('supply', r)}</Badge>,
      },
      {
        key: 'resolved',
        label: copy.columns.resolved,
        // Con qué se atendió va en el VALOR, no solo en la pintura: así se
        // busca por el documento en la tabla y sale en el CSV.
        getValue: (r) => `${r.resolved_at ?? ''} ${r.document_name}`.trim(),
        render: (r) =>
          r.resolved_at ? (
            <>
              {fmtDateTime(r.resolved_at, lang)}
              <div className="muted">{r.resolved_by_name || '—'}</div>
              {r.document_name && <div className="muted">{r.document_name}</div>}
            </>
          ) : (
            '—'
          ),
      },
      {
        key: 'actions',
        label: copy.columns.actions,
        align: 'right',
        searchable: false,
        sortable: false,
        render: (r) =>
          r.status === 'pending' ? (
            <Button variant="primary" size="sm" onClick={() => openManage(r)}>
              {copy.manage}
            </Button>
          ) : null,
      },
    ],
    [copy, lang, etiqueta, ownerLabel],
  )

  // El filtro de la bandeja: lo que la tabla enseña y cuántas hay de cada
  // grupo (pendientes de salida).
  const { search, setSearch, groups, setGroups, counts, filtered } = useRequestFilter(
    rows,
    columns,
  )

  /** Cada tarjeta: su título y la línea que dice qué pasa al elegirla. */
  const choiceCopy: Record<Choice, { label: string; hint: string }> = useMemo(
    () => ({
      upload: { label: copy.choiceUpload, hint: copy.choiceUploadHint },
      existing: { label: copy.choiceExisting, hint: copy.choiceExistingHint(docsCount) },
      none: { label: copy.choiceNone, hint: copy.choiceNoneHint },
      reject: { label: copy.choiceReject, hint: copy.choiceRejectHint },
    }),
    [copy, docsCount],
  )
  /** El botón del pie dice lo que va a pasar, no «Resolver». */
  const submitLabel: Record<Choice, string> = useMemo(
    () => ({
      upload: copy.submitUpload,
      existing: copy.submitExisting,
      none: copy.submitNone,
      reject: copy.submitReject,
    }),
    [copy],
  )

  return (
    <div>
      {/* La barra de la bandeja: buscador y las tres casillas de estado, con
          solo «Pendientes» marcada de salida; exportar, a su derecha. */}
      <RequestsFilterBar
        count={filtered.length}
        search={search}
        onSearchChange={setSearch}
        groups={groups}
        onGroupsChange={setGroups}
        counts={counts}
        doneLabel={copy.statusDone}
        actions={
          <Button
            variant="secondary"
            disabled={filtered.length === 0}
            onClick={() => exportCsv(copy.csvName, columns, filtered)}
          >
            <Download size={16} aria-hidden /> {t.exportCsv}
          </Button>
        }
      />

      <p className="muted">
        {copy.help}
        <strong>{copy.helpStrong}</strong>
        {copy.helpRest}
      </p>

      {notice && (
        <div role="status" className="notice-ok">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}

      {loading ? (
        <p className="loading-state" role="status">
          {t.loading}
        </p>
      ) : (
        <TableWithPanel<DocumentSupplyRequestRow>
          rows={filtered}
          columns={columns}
          rowKey={(r) => String(r.id)}
          rowClassName={(r) => (r.status === 'pending' ? 'row-pending' : '')}
          enableColumnSort
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          // Mirando solo lo pendiente, vacío no es «sin resultados»: es que
          // no queda nada por decidir.
          emptyStateLabel={isDefaultView(groups, search) ? t.emptyPending : copy.empty}
        />
      )}

      <Modal
        open={managing !== null}
        title={copy.modalTitle(managing ? etiqueta.docType(managing) : '')}
        onClose={() => setManaging(null)}
        wide
      >
        {managing && (
          <div className="manage-modal">
            {/* Lo que se pide, en una caja: quién, cuándo, de quién es el
                papel (con su ficha a un clic) y para qué lo necesita. */}
            <div className="ops-info request-info">
              <span>
                <strong>{copy.columns.requester}:</strong> {managing.requested_by_name || '—'}
              </span>
              <span>
                <strong>{copy.columns.requested}:</strong> {fmtDate(managing.created_at, lang)}
              </span>
              <span>
                <strong>{copy.columns.owner}:</strong>{' '}
                {managing.vehicle ? (
                  <Link
                    to={`/vehiculos/${managing.vehicle}`}
                    className="cell-link"
                    title={copy.goToVehicle}
                  >
                    {managing.vehicle_plate}
                  </Link>
                ) : (
                  <Link
                    to={`/conductores/${managing.user}`}
                    className="cell-link"
                    title={copy.goToUser}
                  >
                    {copy.ownerPersonal(managing.user_name)}
                  </Link>
                )}
              </span>
              <span className="request-info-note">
                <strong>{copy.noteLabel}:</strong>{' '}
                {managing.note || <span className="muted">{copy.noNote}</span>}
              </span>
              {/* Lo que el titular YA tiene, a un clic: para dar acceso a lo
                  que hay o para atender con uno de ellos. */}
              <span className="request-info-docs">
                <Button size="sm" variant="secondary" onClick={() => setDocsOpen(true)}>
                  <FolderOpen size={14} aria-hidden />{' '}
                  {docsCount === null ? copy.docsButton : copy.docsButtonCount(docsCount)}
                </Button>
              </span>
            </div>

            {docsNotice && (
              <div role="status" className="notice-ok">
                {docsNotice}
              </div>
            )}

            <form className="modal-form manage-pane" onSubmit={submit}>
              {/* UNA elección en cuatro tarjetas, cada una con lo que pasa al
                  elegirla: era un desplegable (atender / rechazar) más tres
                  radios de «cómo» que se partían en dos líneas. */}
              <div className="choice-cards" role="radiogroup" aria-label={copy.choiceLabel}>
                {CHOICES.map((option) => {
                  const Icon = CHOICE_ICON[option]
                  return (
                    <label
                      key={option}
                      className={`choice-card${option === 'reject' ? ' choice-card--danger' : ''}`}
                    >
                      <input
                        type="radio"
                        name="supply-choice"
                        value={option}
                        checked={choice === option}
                        onChange={() => setChoice(option)}
                      />
                      <Icon size={20} aria-hidden className="choice-card-icon" />
                      <span className="choice-card-text">
                        <strong>{choiceCopy[option].label}</strong>
                        <span className="muted">{choiceCopy[option].hint}</span>
                      </span>
                    </label>
                  )
                })}
              </div>

              {/* Lo que pide la tarjeta elegida, en su caja. */}
              {choice === 'upload' && (
                <div className="choice-detail">
                  <FileField
                    label={copy.file}
                    accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
                    value={file}
                    onFiles={(files) => setFile(files[0] ?? null)}
                  />
                  {/* Con qué acceso nace: lo de su tipo (y se dice qué es
                      hoy, al lado) o un ajuste propio, con los mismos mandos
                      que el modal «Acceso» de la fila. Un conmutador y no dos
                      radios: es una posición u otra. */}
                  <div className="choice-access">
                    <span className="ops-checks-label">{copy.accessLabel}</span>
                    <div className="seg-switch" role="radiogroup" aria-label={copy.accessLabel}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={accessMode === 'type'}
                        className={accessMode === 'type' ? 'is-active' : ''}
                        onClick={() => setAccessMode('type')}
                      >
                        {copy.accessByType}
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={accessMode === 'own'}
                        className={accessMode === 'own' ? 'is-active' : ''}
                        onClick={() => setAccessMode('own')}
                      >
                        {copy.accessOwn}
                      </button>
                    </div>
                    {accessMode === 'type' && (
                      <span className="muted doc-access-cell choice-access-says">
                        {copy.accessTypeSays}{' '}
                        {typeSays(docType).map((part) => (
                          <Badge key={part} tone="neutral" size="sm">
                            {part}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </div>
                  {/* El TIPO con el que se atiende y, en la misma fila, su
                      caducidad: el pedido de salida, y se cambia cuando lo
                      que hace falta es otro papel (se dice cuál se pidió).
                      Va después del conmutador porque el acceso «según su
                      tipo» habla de ESTE tipo, y antes de los mandos del
                      ajuste propio, que se leen después de saber qué se sube. */}
                  <div className="choice-row">
                    <SelectField
                      label={copy.typeLabel}
                      options={uploadableTypes(!managing.vehicle).map((value) => ({
                        value,
                        label: etiqueta.docType({ type: value, type_display: value }),
                      }))}
                      value={docType}
                      onValueChange={(value) => {
                        setDocType(value)
                        if (!documentExpires(value)) setExpiry('')
                      }}
                    />
                    {/* La caducidad solo a lo que caduca, y obligatoria en
                        gestión: las mismas reglas que el alta de la ficha. */}
                    {documentExpires(docType) && (
                      <TextInputField
                        label={copy.expiry}
                        type="date"
                        // Sin `required` nativo a propósito: la validación
                        // propia dice POR QUÉ hace falta (ese tipo caduca), y
                        // el aviso del navegador se la comería antes del envío.
                        requiredVisual
                        value={expiry}
                        onChange={(event) => setExpiry(event.target.value)}
                      />
                    )}
                    {docType !== managing.type && (
                      <p className="muted choice-row-note">
                        {copy.typeRequested(etiqueta.docType(managing))}
                      </p>
                    )}
                  </div>
                  {accessMode === 'own' && (
                    <AccessOverrideRows
                      pick={pick}
                      onChange={setPick}
                      rule={accessByType.get(docType as FlotaDocument['type'])}
                    />
                  )}
                </div>
              )}
              {choice === 'existing' && (
                <div className="choice-detail">
                  {/* Lo elegido en la ventana (y el marcado para atender, si
                      vino de «Atender con este»), con el acceso de cada uno
                      para quien pide; de aquí se marca con cuál se atiende. */}
                  {(() => {
                    const elegidos =
                      picked && !chosenDocs.some((d) => d.id === picked.id)
                        ? [picked, ...chosenDocs]
                        : chosenDocs
                    if (elegidos.length === 0) {
                      return (
                        <div className="manage-picked">
                          <span className="muted">{copy.pickRequired}</span>
                          <Button size="sm" variant="primary" onClick={() => setDocsOpen(true)}>
                            <FolderOpen size={14} aria-hidden /> {copy.pickFromDocs}
                          </Button>
                        </div>
                      )
                    }
                    return (
                      <>
                        <p className="muted" style={{ margin: 0 }}>
                          {copy.pickedIntro}
                        </p>
                        <table className="data owner-docs-table">
                          <thead>
                            <tr>
                              <th>{t.ownerDocs.columns.document}</th>
                              {managing.requested_by && (
                                <th>{t.ownerDocs.columns.forPerson(managing.requested_by_name)}</th>
                              )}
                              <th className="owner-docs-actions-head">{t.ownerDocs.columns.actions}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {elegidos.map((doc) => {
                              const esElegido = picked?.id === doc.id
                              return (
                                <tr key={doc.id} className={esElegido ? 'row-checked' : ''}>
                                  <td>
                                    <strong>{etiqueta.docType(doc)}</strong>
                                    <div className="muted">
                                      {fmtDate(doc.created_at, lang)}
                                      {doc.uploaded_by_name && ` · ${doc.uploaded_by_name}`}
                                    </div>
                                  </td>
                                  {managing.requested_by && (
                                    <td>
                                      <RequesterAccess doc={doc} />
                                    </td>
                                  )}
                                  <td>
                                    <div className="row-actions owner-docs-actions">
                                      {esElegido ? (
                                        <>
                                          <Badge tone="brand">{copy.pickedRow}</Badge>
                                          <Button size="sm" variant="secondary" onClick={() => setPicked(null)}>
                                            {copy.unpick}
                                          </Button>
                                        </>
                                      ) : (
                                        <Button size="sm" variant="secondary" onClick={() => setPicked(doc)}>
                                          <Check size={14} aria-hidden /> {t.ownerDocs.pick}
                                        </Button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                        <div className="manage-picked">
                          {!picked && <span className="muted">{copy.pickRequired}</span>}
                          <Button size="sm" variant="secondary" onClick={() => setDocsOpen(true)}>
                            <FolderOpen size={14} aria-hidden /> {copy.pickMore}
                          </Button>
                        </div>
                      </>
                    )
                  })()}
                </div>
              )}
              {/* Concederle ya a quien pidió lo que le vaya con solicitud:
                  solo cuando hay un documento con el que atender. */}
              {(choice === 'upload' || choice === 'existing') && managing.requested_by && (
                <label className="baja-toggle choice-grant">
                  <input
                    type="checkbox"
                    checked={grantToo}
                    onChange={(event) => setGrantToo(event.target.checked)}
                  />
                  <span>
                    {copy.grantToo(managing.requested_by_name)}
                    <span className="muted">{copy.grantTooHint}</span>
                  </span>
                </label>
              )}
              <TextInputField
                label={choice === 'reject' ? copy.noteReject : copy.note}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              {modalError && (
                <div role="alert" className="form-error">
                  {modalError}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
                <Button type="button" variant="secondary" onClick={() => setManaging(null)}>
                  {t.cancel}
                </Button>
                <Button
                  type="submit"
                  variant={choice === 'reject' ? 'danger' : 'primary'}
                  disabled={saving}
                >
                  {saving ? copy.submitting : submitLabel[choice]}
                </Button>
              </div>
            </form>

            {/* La documentación que ya hay del titular, en su modal: a quién
                se le da acceso a qué, y de dónde se elige el documento con el
                que se atiende («Atender con este» lo pone y cierra). */}
            {docsOpen && (
              <Modal open xl title={copy.docsModalTitle} onClose={() => setDocsOpen(false)}>
                <OwnerDocumentsAccess
                  owner={ownerOf(managing)}
                  ownerLabel={ownerLabel(managing)}
                  requester={
                    managing.requested_by
                      ? { id: managing.requested_by, name: managing.requested_by_name }
                      : null
                  }
                  onLoaded={setDocsCount}
                  onDone={(acuse, docs) => {
                    setDocsNotice(acuse)
                    setChosenDocs(docs)
                    setDocsOpen(false)
                  }}
                  onPick={(doc) => {
                    setPicked(doc)
                    setChoice('existing')
                    setDocsOpen(false)
                  }}
                />
              </Modal>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
