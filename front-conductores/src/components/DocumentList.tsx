import { useState } from 'react'
import { Download, Eye, FileText, Trash2 } from 'lucide-react'
import { Badge, Button, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchDocumentFile, requestDocumentDeletion } from '../api.ts'
import { documentStatusTone, fmtDate } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { saveBlob } from '../saveBlob.ts'
import type { FlotaDocument } from '../types.ts'
import { DocumentViewerModal } from './DocumentViewerModal.tsx'
import { SupervisorModal } from './SupervisorModal.tsx'

/**
 * Lista de documentos: tipo, fecha, caducidad, estado y lo que se puede hacer
 * con cada uno — **verlo** dentro de la app, **descargarlo** y **pedir su
 * borrado**. La usan la ficha del coche, el tablero de la home y «Mi perfil»
 * — el mismo `<li>` estaba copiado en los tres.
 *
 * Aquí no se va a Drive ni para abrir ni para bajar: esta app es de quien
 * conduce, y un conductor no tiene cuenta en esa carpeta — tanto el enlace de
 * la carpeta como el `uc?export=download` le contestaban «no tienes acceso».
 * Las dos cosas las sirve el back con la cuenta de servicio, por la misma
 * puerta que ya autoriza la lectura. En gestión, donde sí hay cuentas de
 * Drive, el enlace sigue estando.
 *
 * La papelera **no borra**: abre una petición para la gestión (el conductor no
 * da de baja documentación de la flota, igual que no cambia el estado del
 * coche). Hasta que se decida, la fila lo dice y la papelera se apaga.
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
  const [viewing, setViewing] = useState<FlotaDocument | null>(null)
  const [asking, setAsking] = useState<FlotaDocument | null>(null)
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
                <strong>{doc.type_display}</strong>
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
                <Badge tone={documentStatusTone(doc.status)}>{doc.status_display}</Badge>
              )}
              <div className="doc-actions">
                <button
                  type="button"
                  className="doc-open"
                  aria-label={copy.viewDoc(doc.type_display)}
                  onClick={() => setViewing(doc)}
                >
                  <Eye size={18} aria-hidden />
                </button>
                <button
                  type="button"
                  className="doc-open"
                  disabled={downloading === doc.id}
                  aria-label={copy.downloadDoc(doc.type_display)}
                  onClick={() => void download(doc)}
                >
                  <Download size={18} aria-hidden />
                </button>
                {/* Pedida ya, no se vuelve a pedir: una por documento. */}
                <button
                  type="button"
                  className="doc-remove"
                  disabled={pending}
                  aria-label={copy.askDeleteDoc(doc.type_display)}
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

      {asking && (
        <SupervisorModal
          open
          title={copy.deleteTitle(asking.type_display)}
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
