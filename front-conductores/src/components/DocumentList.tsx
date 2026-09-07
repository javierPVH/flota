import { ExternalLink, FileText } from 'lucide-react'
import { Badge } from '@flota/ui/ui'

import { documentStatusTone, fmtDate } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { FlotaDocument } from '../types.ts'

/**
 * Enlace al archivo, solo si es http(s): el back devuelve la URL de Drive o la
 * de `/media`, y una ruta relativa no se abre en una pestaña nueva.
 */
function documentHref(doc: FlotaDocument): string {
  const safe = (url: string) => (/^https?:\/\//i.test(url) ? url : '')
  return safe(doc.drive_url) || safe(doc.file_url)
}

/**
 * Lista de documentos: tipo, fecha, caducidad, estado y enlace al archivo (que
 * vive en Drive). La usan la ficha del coche, el tablero de la home y «Mi
 * perfil» — el mismo `<li>` estaba copiado en los tres.
 */
export function DocumentList({
  documents,
  emptyNote,
}: {
  documents: FlotaDocument[]
  /** Texto de lista vacía; por defecto, el de los documentos del vehículo. */
  emptyNote?: string
}) {
  const { t, language } = useLang()
  if (documents.length === 0) {
    return <p className="empty-note">{emptyNote ?? t.vehicle.noDocuments}</p>
  }
  return (
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
  )
}
