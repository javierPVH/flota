import { useEffect, useState } from 'react'
import { Download, ExternalLink } from 'lucide-react'
import { Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchDocumentFile } from '../api.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { useLang } from '../i18n.tsx'
import type { FlotaDocument } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

/**
 * Ver un documento **dentro de la app**, sin pasar por Drive.
 *
 * Quien conduce no tiene cuenta en Drive: el enlace a la carpeta no le abre
 * nada. Aquí el back trae el archivo con la cuenta de servicio
 * (`/documents/{id}/preview/`) y se pinta en la ventana — una imagen como
 * imagen y un PDF en su visor.
 *
 * **La copia es de usar y tirar**: el servidor no guarda nada (los bytes van a
 * memoria y de ahí a la respuesta) y lo que llega al móvil vive en un blob que
 * se SUELTA al cerrar (`revokeObjectURL`). Por eso la carga empieza al abrir y
 * no antes: no se precarga lo que no se ha pedido ver.
 */
export function DocumentViewerModal({
  document: doc,
  onClose,
}: {
  document: FlotaDocument
  onClose: () => void
}) {
  const { t } = useLang()
  const etiqueta = useDomainLabels()
  const copy = t.docs
  const [url, setUrl] = useState('')
  const [tipo, setTipo] = useState('')
  const [nombre, setNombre] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    fetchDocumentFile(doc.id, { signal: controller.signal })
      .then(({ blob, filename }) => {
        objectUrl = URL.createObjectURL(blob)
        setTipo(blob.type)
        setNombre(filename)
        setUrl(objectUrl)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setError(asErrorMessage(caught, copy.viewError))
      })
    // Al cerrar (o al cambiar de documento) se suelta la copia: es lo que hace
    // que no quede nada en el móvil después de mirarlo.
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [doc.id, copy.viewError])

  const esImagen = tipo.startsWith('image/')

  return (
    <SupervisorModal
      open
      title={copy.viewTitle(etiqueta.docType(doc))}
      onClose={onClose}
      footer={
        <>
          {/* Un PDF en un móvil se lee mejor a pantalla completa, y algunos
              navegadores ni lo pintan dentro del marco. La pestaña usa el
              MISMO blob, así que muere igual al cerrar esta ventana. */}
          {url && !esImagen && (
            <a href={url} target="_blank" rel="noreferrer" className="link-btn">
              <ExternalLink size={16} aria-hidden /> {copy.viewNewTab}
            </a>
          )}
          {/* Guardarlo usa la copia que ya está aquí: no se vuelve a pedir el
              archivo al back solo por cambiar de idea mirándolo. */}
          {url && (
            <a href={url} download={nombre} className="link-btn">
              <Download size={16} aria-hidden /> {copy.download}
            </a>
          )}
          <Button type="button" onClick={onClose}>{t.carUpdate.close}</Button>
        </>
      }
    >
      <div className="doc-viewer">
        {error && <div role="alert" className="form-error">{error}</div>}
        {!error && !url && <p role="status" className="loading-state">{copy.viewLoading}</p>}
        {url &&
          (esImagen ? (
            <img src={url} alt={etiqueta.docType(doc)} className="doc-viewer-image" />
          ) : (
            <iframe src={url} title={etiqueta.docType(doc)} className="doc-viewer-frame" />
          ))}
        <p className="doc-sub">{copy.viewNote}</p>
      </div>
    </SupervisorModal>
  )
}
