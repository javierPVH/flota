import { useState } from 'react'
import { Ban, Download, Eye, FileText, Hourglass, KeyRound, PencilLine, Trash2 } from 'lucide-react'
import { Badge, Button, Modal, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  fetchDocumentFile,
  requestDocumentAccess,
  requestDocumentChange,
  requestDocumentDeletion,
} from '../api.ts'
import { documentExpires } from '../documentRules.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { documentStatusTone, fmtDate } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { saveBlob } from '../saveBlob.ts'
import type { FlotaDocument } from '../types.ts'
import { DocumentViewerModal } from './DocumentViewerModal.tsx'
import { SupervisorModal } from './SupervisorModal.tsx'

/** Los tipos que se pueden pedir para un documento, según de quién es: los
 * personales para el de una persona y los del coche para los demás. Es la
 * misma lista que ofrece cada formulario de subida, y la misma que acota el
 * back (`PERSONAL_DOCUMENT_TYPES`). */
const PERSONAL_TYPES = ['driving_license', 'other']
const VEHICLE_TYPES = [
  'registration_certificate',
  'technical_datasheet',
  'insurance',
  'contract',
  'return_report',
  'accident_report',
  'damage_photos',
  'other',
]

/** Lo que se PIDE desde la fila con un motivo: el borrado (la papelera) y el
 * acceso —verlo o bajárselo— cuando el tipo o el documento lo ponen con
 * solicitud. */
type AskKind = 'delete' | 'view' | 'download'

/** Por qué un botón de la fila no hace lo suyo: está PEDIDO (la gestión tiene
 * que concederlo) o NO SE PERMITE (no hay nada que pedir). */
type AccessInfo = { doc: FlotaDocument; kind: AskKind; state: 'pending' | 'denied' }

/**
 * Lista de documentos: tipo, fecha, caducidad, estado y lo que se puede hacer
 * con cada uno — **verlo** dentro de la app, **descargarlo**, **pedir que se
 * corrija** y **pedir su borrado**. La usan la ficha del coche, el tablero de
 * la home y «Mi perfil» — el mismo `<li>` estaba copiado en los tres.
 *
 * Aquí no se va a Drive ni para abrir ni para bajar: esta app es de quien
 * conduce, y un conductor no tiene cuenta en esa carpeta — tanto el enlace de
 * la carpeta como el `uc?export=download` le contestaban «no tienes acceso».
 * Las dos cosas las sirve el back con la cuenta de servicio, por la misma
 * puerta que ya autoriza la lectura. En gestión, donde sí hay cuentas de
 * Drive, el enlace sigue estando.
 *
 * Ni la papelera borra ni el lápiz corrige: los dos abren una **petición** para
 * la gestión (el conductor no da de baja ni reescribe documentación de la
 * flota, igual que no cambia el estado del coche). Hasta que se decida, la fila
 * lo dice y las dos acciones se apagan: un documento tiene **una petición
 * viva**, y pedir a la vez que se corrija y que se borre no es una petición.
 *
 * Y ver o descargar pueden ir **con solicitud** (lo decide la gestión por tipo
 * de documento o por documento; a quien supervisa, la descarga siempre): el
 * back manda `can_view` / `can_download` y en qué va la petición, y aquí el
 * botón de ver o bajar se cambia por el de PEDIRLO hasta que la gestión lo
 * conceda y vuelva el de siempre. Cada fila **dice cómo va su acceso** bajo
 * el nombre (lectura o descarga con solicitud, pedida, concedida o no
 * permitida; borrado no permitido), que un icono solo no lo cuenta; y los
 * botones que no hacen lo suyo —pedido, no permitido— van **apagados pero
 * vivos** (`.is-waiting`): el toque abre el porqué, como el botón de la ITV
 * que aún no toca. Un `disabled` con `title` en un móvil es un botón muerto.
 *
 * Corregir existe para no tener que borrar y volver a subir: así el archivo y
 * su rastro se quedan donde están.
 */
export function DocumentList({
  documents,
  emptyNote,
  onChanged,
}: {
  documents: FlotaDocument[]
  /** Texto de lista vacía; por defecto, el de los documentos del vehículo. */
  emptyNote?: string
  /** Recarga de quien enmarca la lista, tras pedir un borrado. */
  onChanged?: () => void
}) {
  const { t, language } = useLang()
  const copy = t.docs
  // Las etiquetas del back vienen en castellano: se traducen por código.
  const etiqueta = useDomainLabels()
  const [viewing, setViewing] = useState<FlotaDocument | null>(null)
  const [asking, setAsking] = useState<{ doc: FlotaDocument; kind: AskKind } | null>(null)
  // El porqué de un botón apagado, al tocarlo.
  const [info, setInfo] = useState<AccessInfo | null>(null)
  // El de corregir es OTRO modal: pregunta qué debería decir el documento.
  const [fixing, setFixing] = useState<FlotaDocument | null>(null)
  const [fix, setFix] = useState({ type: '', expiry_date: '', notes: '' })
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Lo pedido en esta pantalla, para marcar la fila sin esperar a la recarga
  // (la lista puede venir de un padre que no recarga): el borrado o la
  // corrección por documento, y el acceso por documento y clase.
  const [asked, setAsked] = useState<number[]>([])
  const [askedAccess, setAskedAccess] = useState<string[]>([])
  // Id del que se está bajando: la descarga pasa por el back (trae el binario
  // de Drive), así que puede tardar y el botón tiene que decirlo.
  const [downloading, setDownloading] = useState(0)
  const [downloadError, setDownloadError] = useState('')

  async function download(doc: FlotaDocument) {
    setDownloading(doc.id)
    setDownloadError('')
    try {
      const { blob, filename } = await fetchDocumentFile(doc.id, { download: true })
      saveBlob(blob, filename)
    } catch (caught) {
      setDownloadError(asErrorMessage(caught, copy.downloadError))
    } finally {
      setDownloading(0)
    }
  }

  function openAsk(doc: FlotaDocument, kind: AskKind) {
    setAsking({ doc, kind })
    setReason('')
    setError('')
    setNotice('')
  }

  async function submitAsk() {
    if (!asking) return
    const { doc, kind } = asking
    setSaving(true)
    setError('')
    try {
      if (kind === 'delete') {
        await requestDocumentDeletion(doc.id, reason.trim())
        setAsked((current) => [...current, doc.id])
        setNotice(copy.deleteOk)
      } else {
        await requestDocumentAccess(doc.id, kind, reason.trim())
        setAskedAccess((current) => [...current, `${doc.id}:${kind}`])
        setNotice(copy.accessOk)
      }
      setAsking(null)
      setReason('')
      onChanged?.()
    } catch (caught) {
      setError(asErrorMessage(caught, kind === 'delete' ? copy.deleteError : copy.accessError))
    } finally {
      setSaving(false)
    }
  }

  function openFix(doc: FlotaDocument) {
    setFixing(doc)
    // Se abre con lo que el documento dice HOY: se corrige lo que esté mal y
    // el back descarta lo que venga igual.
    setFix({ type: doc.type, expiry_date: doc.expiry_date ?? '', notes: doc.notes ?? '' })
    setReason('')
    setError('')
    setNotice('')
  }

  async function submitFix() {
    if (!fixing) return
    setSaving(true)
    setError('')
    try {
      await requestDocumentChange(
        fixing.id,
        {
          type: fix.type,
          // La caducidad solo viaja si el tipo elegido caduca: el back la
          // descartaría igual, y así no se manda una fecha que no se pidió.
          ...(documentExpires(fix.type) ? { expiry_date: fix.expiry_date } : {}),
          notes: fix.notes,
        },
        reason.trim(),
      )
      setAsked((current) => [...current, fixing.id])
      setNotice(copy.fixOk)
      setFixing(null)
      onChanged?.()
    } catch (caught) {
      setError(asErrorMessage(caught, copy.fixError))
    } finally {
      setSaving(false)
    }
  }

  /** En qué va la petición de ver o bajar ESTE documento, contando también lo
   * pedido en esta pantalla sin esperar a la recarga. */
  function requestState(doc: FlotaDocument, kind: 'view' | 'download') {
    const state = kind === 'view' ? doc.view_request : doc.download_request
    if (state === 'denied' || state === 'granted') return state
    if (state === 'pending' || askedAccess.includes(`${doc.id}:${kind}`)) return 'pending'
    return ''
  }

  /** El botón de una acción que no se hace directamente: pedirla si va CON
   * SOLICITUD; y, pedida o no permitida, apagado pero vivo: el toque explica. */
  function askButton(doc: FlotaDocument, kind: 'view' | 'download', label: string) {
    const name = etiqueta.docType(doc)
    const state = requestState(doc, kind)
    if (state === 'denied') {
      const denied = kind === 'view' ? copy.viewDenied(name) : copy.downloadDenied(name)
      return (
        <button
          type="button"
          className="doc-open is-waiting"
          aria-label={denied}
          onClick={() => setInfo({ doc, kind, state: 'denied' })}
        >
          <Ban size={18} aria-hidden />
        </button>
      )
    }
    const requested = state === 'pending'
    return (
      <button
        type="button"
        className={`doc-open${requested ? ' is-waiting' : ''}`}
        aria-label={label}
        onClick={() => (requested ? setInfo({ doc, kind, state: 'pending' }) : openAsk(doc, kind))}
      >
        {requested ? <Hourglass size={18} aria-hidden /> : <KeyRound size={18} aria-hidden />}
      </button>
    )
  }

  /** Cómo va el acceso a un documento, para decirlo bajo su nombre: solo lo
   * que no es lo de siempre (ver y bajar directamente, pedir el borrado). */
  function accessLine(doc: FlotaDocument): string {
    const parts: string[] = []
    for (const kind of ['view', 'download'] as const) {
      const direct = kind === 'view' ? doc.can_view !== false : doc.can_download !== false
      const state = requestState(doc, kind)
      const label = kind === 'view' ? copy.accessView : copy.accessDownload
      if (state === 'granted') parts.push(`${label}: ${copy.accessState.granted}`)
      else if (state === 'denied') parts.push(`${label}: ${copy.accessState.denied}`)
      else if (!direct) {
        parts.push(`${label}: ${state === 'pending' ? copy.accessState.pending : copy.accessState.request}`)
      }
    }
    if (doc.can_request_delete === false) parts.push(`${copy.accessDelete}: ${copy.accessState.deleteDenied}`)
    return parts.join(' · ')
  }

  /** De qué habla el aviso o la petición: «la lectura de X», «la descarga
   * de X», «el borrado de X». */
  function whatOf(kind: AskKind, doc: FlotaDocument): string {
    const name = etiqueta.docType(doc)
    if (kind === 'view') return copy.accessViewOf(name)
    if (kind === 'download') return copy.accessDownloadOf(name)
    return copy.accessDeleteOf(name)
  }

  if (documents.length === 0) {
    return <p className="empty-note">{emptyNote ?? t.vehicle.noDocuments}</p>
  }
  const askWhat = asking ? whatOf(asking.kind, asking.doc) : ''
  return (
    <>
      {notice && <p className="reminder-done" role="status">{notice}</p>}
      {downloadError && <p role="alert" className="form-error">{downloadError}</p>}
      <ul className="doc-list">
        {documents.map((doc) => {
          const pending = doc.deletion_pending || asked.includes(doc.id)
          const name = etiqueta.docType(doc)
          return (
            <li key={doc.id} className="doc-item">
              <FileText size={18} aria-hidden className="doc-icon" />
              <div className="doc-info">
                <strong>{name}</strong>
                <span className="doc-sub">
                  {fmtDate(doc.created_at, language)}
                  {doc.expiry_date ? t.vehicle.expires(fmtDate(doc.expiry_date, language)) : ''}
                </span>
                {pending && <span className="doc-sub doc-pending">{copy.deletePendingNote}</span>}
                {/* Cómo va su acceso, cuando no es lo de siempre. */}
                {accessLine(doc) && <span className="doc-sub doc-access">{accessLine(doc)}</span>}
              </div>
              {pending ? (
                <Badge tone="warning" className="doc-pending-badge">
                  {copy.deletePending}
                </Badge>
              ) : (
                <Badge tone={documentStatusTone(doc.status)}>{etiqueta.docStatus(doc)}</Badge>
              )}
              <div className="doc-actions">
                {/* Ver y bajar: directamente, o pidiéndolo si el tipo (o el
                    documento) va con solicitud. Un documento sin la marca
                    (una copia cacheada vieja) se trata como directo. */}
                {doc.can_view !== false ? (
                  <button
                    type="button"
                    className="doc-open"
                    aria-label={copy.viewDoc(name)}
                    onClick={() => setViewing(doc)}
                  >
                    <Eye size={18} aria-hidden />
                  </button>
                ) : (
                  askButton(doc, 'view', copy.askViewDoc(name))
                )}
                {doc.can_download !== false ? (
                  <button
                    type="button"
                    className="doc-open"
                    disabled={downloading === doc.id}
                    aria-label={copy.downloadDoc(name)}
                    onClick={() => void download(doc)}
                  >
                    <Download size={18} aria-hidden />
                  </button>
                ) : (
                  askButton(doc, 'download', copy.askDownloadDoc(name))
                )}
                {/* Pedida ya, no se vuelve a pedir: una por documento —y eso
                    vale para las dos, corregir y borrar. */}
                <button
                  type="button"
                  className="doc-open"
                  disabled={pending}
                  aria-label={copy.fixDoc(name)}
                  title={pending ? copy.deletePendingNote : undefined}
                  onClick={() => openFix(doc)}
                >
                  <PencilLine size={18} aria-hidden />
                </button>
                {/* Y la papelera puede estar cerrada del todo («no permitir»
                    en el tipo o en el documento): apagada pero viva, el
                    toque dice por qué. */}
                {doc.can_request_delete === false ? (
                  <button
                    type="button"
                    className="doc-remove is-waiting"
                    aria-label={copy.deleteDenied(name)}
                    onClick={() => setInfo({ doc, kind: 'delete', state: 'denied' })}
                  >
                    <Trash2 size={18} aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="doc-remove"
                    disabled={pending}
                    aria-label={copy.askDeleteDoc(name)}
                    title={pending ? copy.deletePendingNote : undefined}
                    onClick={() => openAsk(doc, 'delete')}
                  >
                    <Trash2 size={18} aria-hidden />
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {viewing && (
        <DocumentViewerModal document={viewing} onClose={() => setViewing(null)} />
      )}

      {/* Por qué ese botón no hace lo suyo: pedido (y qué pasará cuando se
          conceda) o no permitido (y de quién depende). */}
      {info && (
        <Modal
          open
          title={copy.infoTitle(etiqueta.docType(info.doc))}
          onClose={() => setInfo(null)}
          footer={
            <Button type="button" onClick={() => setInfo(null)}>
              {copy.infoOk}
            </Button>
          }
        >
          <div className="scheduled-info">
            {info.state === 'pending' ? <Hourglass size={20} aria-hidden /> : <Ban size={20} aria-hidden />}
            <div>
              <strong>
                {info.state === 'pending'
                  ? copy.infoPending(whatOf(info.kind, info.doc))
                  : copy.infoDenied(whatOf(info.kind, info.doc))}
              </strong>
              <p className="doc-sub">
                {info.state === 'pending' ? copy.infoPendingNext : copy.infoDeniedWhy}
              </p>
            </div>
          </div>
        </Modal>
      )}

      {fixing && (
        <SupervisorModal
          open
          title={copy.fixTitle(etiqueta.docType(fixing))}
          onClose={() => setFixing(null)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setFixing(null)}>
                {t.common.cancel}
              </Button>
              <Button type="button" disabled={saving} onClick={submitFix}>
                {saving ? copy.fixSubmitting : copy.fixSubmit}
              </Button>
            </>
          }
        >
          <div className="modal-form">
            <p className="update-hint">{copy.fixHint}</p>
            <label className="reminder-check">
              {copy.fixType}
              <select
                className="update-input"
                value={fix.type}
                onChange={(event) =>
                  setFix((current) => ({ ...current, type: event.target.value }))
                }
              >
                {(fixing.vehicle ? VEHICLE_TYPES : PERSONAL_TYPES).map((value) => (
                  <option key={value} value={value}>
                    {t.vehicle.docTypes[value] ?? value}
                  </option>
                ))}
              </select>
            </label>
            {/* La caducidad solo a lo que caduca, como en el alta. */}
            {documentExpires(fix.type) && (
              <label className="reminder-check">
                {copy.fixExpiry}
                <input
                  type="date"
                  className="update-input"
                  value={fix.expiry_date}
                  onChange={(event) =>
                    setFix((current) => ({ ...current, expiry_date: event.target.value }))
                  }
                />
              </label>
            )}
            <label className="reminder-check">
              {copy.fixNotes}
              <input
                type="text"
                className="update-input"
                value={fix.notes}
                onChange={(event) =>
                  setFix((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </label>
            <TextInputField
              label={copy.fixReason}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            {error && <div role="alert" className="form-error">{error}</div>}
          </div>
        </SupervisorModal>
      )}

      {asking && (
        <SupervisorModal
          open
          title={
            asking.kind === 'delete'
              ? copy.deleteTitle(etiqueta.docType(asking.doc))
              : copy.accessTitle(askWhat)
          }
          onClose={() => setAsking(null)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setAsking(null)}>
                {t.common.cancel}
              </Button>
              <Button
                type="button"
                variant={asking.kind === 'delete' ? 'danger' : 'primary'}
                disabled={saving}
                onClick={submitAsk}
              >
                {saving
                  ? copy.deleteSubmitting
                  : asking.kind === 'delete'
                    ? copy.deleteSubmit
                    : copy.accessSubmit}
              </Button>
            </>
          }
        >
          <div className="modal-form">
            <p className="update-hint">
              {asking.kind === 'delete' ? copy.deleteHint : copy.accessHint}
            </p>
            <TextInputField
              label={asking.kind === 'delete' ? copy.deleteReason : copy.accessReason}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            {error && <div role="alert" className="form-error">{error}</div>}
          </div>
        </SupervisorModal>
      )}
    </>
  )
}
