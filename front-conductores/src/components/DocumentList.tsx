import { useState } from 'react'
import { Download, Eye, FileText, PencilLine, Trash2 } from 'lucide-react'
import { Badge, Button, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchDocumentFile, requestDocumentChange, requestDocumentDeletion } from '../api.ts'
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
  const [asking, setAsking] = useState<FlotaDocument | null>(null)
  // El de corregir es OTRO modal: pregunta qué debería decir el documento.
  const [fixing, setFixing] = useState<FlotaDocument | null>(null)
  const [fix, setFix] = useState({ type: '', expiry_date: '', notes: '' })
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Lo pedido en esta pantalla, para marcar la fila sin esperar a la recarga
  // (la lista puede venir de un padre que no recarga).
  const [asked, setAsked] = useState<number[]>([])
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

  async function submitAsk() {
    if (!asking) return
    setSaving(true)
    setError('')
    try {
      await requestDocumentDeletion(asking.id, reason.trim())
      setAsked((current) => [...current, asking.id])
      setNotice(copy.deleteOk)
      setAsking(null)
      setReason('')
      onChanged?.()
    } catch (caught) {
      setError(asErrorMessage(caught, copy.deleteError))
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

  if (documents.length === 0) {
    return <p className="empty-note">{emptyNote ?? t.vehicle.noDocuments}</p>
  }
  return (
    <>
      {notice && <p className="reminder-done" role="status">{notice}</p>}
      {downloadError && <p role="alert" className="form-error">{downloadError}</p>}
      <ul className="doc-list">
        {documents.map((doc) => {
          const pending = doc.deletion_pending || asked.includes(doc.id)
          return (
            <li key={doc.id} className="doc-item">
              <FileText size={18} aria-hidden className="doc-icon" />
              <div className="doc-info">
                <strong>{etiqueta.docType(doc)}</strong>
                <span className="doc-sub">
                  {fmtDate(doc.created_at, language)}
                  {doc.expiry_date ? t.vehicle.expires(fmtDate(doc.expiry_date, language)) : ''}
                </span>
                {pending && <span className="doc-sub doc-pending">{copy.deletePendingNote}</span>}
              </div>
              {pending ? (
                <Badge tone="warning" className="doc-pending-badge">
                  {copy.deletePending}
                </Badge>
              ) : (
                <Badge tone={documentStatusTone(doc.status)}>{etiqueta.docStatus(doc)}</Badge>
              )}
              <div className="doc-actions">
                <button
                  type="button"
                  className="doc-open"
                  aria-label={copy.viewDoc(etiqueta.docType(doc))}
                  onClick={() => setViewing(doc)}
                >
                  <Eye size={18} aria-hidden />
                </button>
                <button
                  type="button"
                  className="doc-open"
                  disabled={downloading === doc.id}
                  aria-label={copy.downloadDoc(etiqueta.docType(doc))}
                  onClick={() => void download(doc)}
                >
                  <Download size={18} aria-hidden />
                </button>
                {/* Pedida ya, no se vuelve a pedir: una por documento —y eso
                    vale para las dos, corregir y borrar. */}
                <button
                  type="button"
                  className="doc-open"
                  disabled={pending}
                  aria-label={copy.fixDoc(etiqueta.docType(doc))}
                  title={pending ? copy.deletePendingNote : undefined}
                  onClick={() => openFix(doc)}
                >
                  <PencilLine size={18} aria-hidden />
                </button>
                <button
                  type="button"
                  className="doc-remove"
                  disabled={pending}
                  aria-label={copy.askDeleteDoc(etiqueta.docType(doc))}
                  title={pending ? copy.deletePendingNote : undefined}
                  onClick={() => {
                    setAsking(doc)
                    setReason('')
                    setError('')
                    setNotice('')
                  }}
                >
                  <Trash2 size={18} aria-hidden />
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {viewing && (
        <DocumentViewerModal document={viewing} onClose={() => setViewing(null)} />
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
          title={copy.deleteTitle(etiqueta.docType(asking))}
          onClose={() => setAsking(null)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setAsking(null)}>
                {t.common.cancel}
              </Button>
              <Button type="button" variant="danger" disabled={saving} onClick={submitAsk}>
                {saving ? copy.deleteSubmitting : copy.deleteSubmit}
              </Button>
            </>
          }
        >
          <div className="modal-form">
            <p className="update-hint">{copy.deleteHint}</p>
            <TextInputField
              label={copy.deleteReason}
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
