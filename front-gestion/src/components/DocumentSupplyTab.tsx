import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, FileField, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import type { BadgeTone } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download } from 'lucide-react'

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
import { documentExpires } from '../documentRules.ts'
import { fmtDate, fmtDateTime } from '../format.ts'
import { useAppLang } from '@flota/ui/i18n'
import { useRequestsCopy } from '../translations/requests.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { isDefaultView, useRequestFilter } from './requestFilter.ts'
import { RequestsFilterBar } from './RequestsFilterBar.tsx'
import { EMPTY_PICK, overridesFromPick } from './accessPick.ts'
import { AccessOverrideRows } from './AccessOverrideRows.tsx'
import { OwnerDocumentsAccess, type DocumentOwner } from './OwnerDocumentsAccess.tsx'
import { RequestManageTabs, type ManageTab } from './RequestManageTabs.tsx'
import { useAccessParts } from './useAccessParts.ts'

/** Estado → tono de la chapa. Pendiente avisa; las dos salidas informan. */
const TONE: Record<DocumentSupplyRequestRow['status'], BadgeTone> = {
  pending: 'warning',
  done: 'success',
  rejected: 'neutral',
}

const DECISIONS: DocumentSupplyDecision[] = ['done', 'reject']

/** Las tres maneras de ATENDER: subir el documento, elegir uno que ya existe
 * o nada (se entregó por otra vía). */
type How = 'upload' | 'existing' | 'none'
const HOWS: How[] = ['upload', 'existing', 'none']

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
  // El modal en dos pestañas: la decisión y la documentación del titular.
  const [tab, setTab] = useState<ManageTab>('decide')
  const [docsCount, setDocsCount] = useState<number | null>(null)
  const [decision, setDecision] = useState<DocumentSupplyDecision>('done')
  const [how, setHow] = useState<How>('upload')
  const [file, setFile] = useState<File | null>(null)
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
    setTab('decide')
    setDocsCount(null)
    setDecision('done')
    setHow('upload')
    setFile(null)
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

  /** Lo que el tipo pedido dice hoy de quién lo lee (chapas). */
  const typeSays = (row: DocumentSupplyRequestRow) => {
    const rule = accessByType.get(row.type as FlotaDocument['type'])
    const falso = {
      type: row.type,
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
    const atiende = decision === 'done'
    const sube = atiende && how === 'upload'
    if (sube && !file) {
      setModalError(copy.fileRequired)
      return
    }
    if (sube && documentExpires(managing.type) && !expiry) {
      setModalError(copy.expiryRequired)
      return
    }
    if (atiende && how === 'existing' && !picked) {
      setModalError(copy.pickRequired)
      return
    }
    setSaving(true)
    setModalError('')
    const quien = ownerLabel(managing)
    let documento: number | null = atiende && how === 'existing' ? (picked?.id ?? null) : null
    try {
      if (sube) {
        const creado = await uploadDocument(
          {
            ...ownerOf(managing),
            type: managing.type,
            expiry_date: expiry || null,
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

  const hint: Record<DocumentSupplyDecision, string> = useMemo(
    () => ({ done: copy.optDoneHint, reject: copy.optRejectHint }),
    [copy],
  )
  const label: Record<DocumentSupplyDecision, string> = useMemo(
    () => ({ done: copy.optDone, reject: copy.optReject }),
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
            </div>

            <RequestManageTabs
              tab={tab}
              onChange={setTab}
              docsCount={docsCount}
              ariaLabel={t.manage.tabsAria}
            />

            {/* Las dos pestañas siguen montadas (`hidden`): lo escrito en la
                decisión no se pierde al mirar la documentación, y la lista
                no se vuelve a pedir al volver. */}
            <form className="modal-form manage-pane" onSubmit={submit} hidden={tab !== 'decide'}>
              <SelectField
                label={copy.decision}
                options={DECISIONS.map((value) => ({ value, label: label[value] }))}
                value={decision}
                onValueChange={(value) => setDecision(value as DocumentSupplyDecision)}
              />
              <p className="muted" style={{ margin: 0 }}>
                {hint[decision]}
              </p>
              {decision === 'done' && (
                <>
                  {/* Cómo se atiende: subiendo, con uno que ya existe o sin
                      archivo. Tres radios y no un archivo opcional, para que
                      «sin archivo» sea una decisión y no un olvido. */}
                  <div className="pill-choices" role="radiogroup" aria-label={copy.howLabel}>
                    <span className="ops-checks-label">{copy.howLabel}</span>
                    {HOWS.map((option) => (
                      <label key={option} className="baja-toggle">
                        <input
                          type="radio"
                          name="supply-how"
                          checked={how === option}
                          onChange={() => setHow(option)}
                        />
                        {option === 'upload'
                          ? copy.howUpload
                          : option === 'existing'
                            ? copy.howExisting
                            : copy.howNone}
                      </label>
                    ))}
                  </div>
                  {how === 'upload' && (
                    <>
                      <FileField
                        label={copy.file}
                        accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
                        value={file}
                        onFiles={(files) => setFile(files[0] ?? null)}
                      />
                      {/* La caducidad solo a lo que caduca, y obligatoria en
                          gestión: las mismas reglas que el alta de la ficha. */}
                      {file && documentExpires(managing.type) && (
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
                      {/* Con qué acceso nace: lo de su tipo (y se dice qué es
                          hoy) o un ajuste propio, con los mismos mandos que el
                          modal «Acceso» de la fila. */}
                      <div className="pill-choices" role="radiogroup" aria-label={copy.accessLabel}>
                        <span className="ops-checks-label">{copy.accessLabel}</span>
                        <label className="baja-toggle">
                          <input
                            type="radio"
                            name="supply-access"
                            checked={accessMode === 'type'}
                            onChange={() => setAccessMode('type')}
                          />
                          {copy.accessByType}
                        </label>
                        <label className="baja-toggle">
                          <input
                            type="radio"
                            name="supply-access"
                            checked={accessMode === 'own'}
                            onChange={() => setAccessMode('own')}
                          />
                          {copy.accessOwn}
                        </label>
                      </div>
                      {accessMode === 'type' ? (
                        <p className="muted doc-access-cell" style={{ margin: 0 }}>
                          {copy.accessTypeSays}{' '}
                          {typeSays(managing).map((part) => (
                            <Badge key={part} tone="neutral" size="sm">
                              {part}
                            </Badge>
                          ))}
                        </p>
                      ) : (
                        <AccessOverrideRows
                          pick={pick}
                          onChange={setPick}
                          rule={accessByType.get(managing.type as FlotaDocument['type'])}
                        />
                      )}
                    </>
                  )}
                  {how === 'existing' && (
                    <div className="manage-picked">
                      {picked ? (
                        <>
                          <Badge tone="brand">{copy.picked(etiqueta.docType(picked))}</Badge>
                          <Button size="sm" variant="secondary" onClick={() => setPicked(null)}>
                            {copy.unpick}
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="muted">{copy.pickRequired}</span>
                          <Button size="sm" variant="secondary" onClick={() => setTab('docs')}>
                            {t.manage.tabDocs}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                  {how !== 'none' && managing.requested_by && (
                    <div>
                      <label className="baja-toggle">
                        <input
                          type="checkbox"
                          checked={grantToo}
                          onChange={(event) => setGrantToo(event.target.checked)}
                        />
                        {copy.grantToo(managing.requested_by_name)}
                      </label>
                      <p className="muted" style={{ margin: '0.25rem 0 0' }}>
                        {copy.grantTooHint}
                      </p>
                    </div>
                  )}
                </>
              )}
              <TextInputField
                label={copy.note}
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
                <Button type="submit" disabled={saving}>
                  {saving ? copy.submitting : copy.submit}
                </Button>
              </div>
            </form>

            {/* La documentación que ya hay del titular: a quién se le da
                acceso a qué, y de dónde se elige el documento con el que se
                atiende (que devuelve a la decisión con él puesto). */}
            <div className="manage-pane" hidden={tab !== 'docs'}>
              <OwnerDocumentsAccess
                owner={ownerOf(managing)}
                ownerLabel={ownerLabel(managing)}
                requester={
                  managing.requested_by
                    ? { id: managing.requested_by, name: managing.requested_by_name }
                    : null
                }
                onLoaded={setDocsCount}
                onPick={(doc) => {
                  setPicked(doc)
                  setDecision('done')
                  setHow('existing')
                  setTab('decide')
                }}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
