import { useState, type FormEvent } from 'react'
import { Button, Modal } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { updateDocument, type DocumentTypeAccess } from '../api.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { useDocumentsCopy } from '../translations/documents.ts'
import type { FlotaDocument } from '../types.ts'
import { overridesFromPick, pickFromDoc } from './accessPick.ts'
import { AccessOverrideRows } from './AccessOverrideRows.tsx'

/**
 * «Acceso» de UN documento: el ajuste que pisa lo de su tipo (Documentos →
 * Ajustes) solo en él, con el mismo aspecto que esa tabla: la leyenda de los
 * iconos arriba y una fila por mando, rótulo a la izquierda y conmutador de
 * iconos a la derecha (`AccessOverrideRows`, que también pinta la subida
 * desde la bandeja de solicitudes). Se guarda entero: lo que queda en «según
 * el tipo» viaja como nulo, que es lo que vuelve a dejar mandar al tipo.
 */
export function DocumentAccessModal({
  doc,
  rule,
  onClose,
  onSaved,
}: {
  doc: FlotaDocument
  /** La regla del tipo, para decir qué vale «según el tipo». */
  rule: DocumentTypeAccess | undefined
  onClose: () => void
  onSaved: () => void
}) {
  const copy = useDocumentsCopy().access.modal
  const etiqueta = useDomainLabels()
  const [pick, setPick] = useState(() => pickFromDoc(doc))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await updateDocument(doc.id, overridesFromPick(pick))
      onSaved()
    } catch (err) {
      setError(asErrorMessage(err, copy.saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open wide title={copy.title(etiqueta.docType(doc))} onClose={onClose}>
      <form className="ops-modal" onSubmit={submit}>
        <p className="muted ops-note">{copy.intro}</p>
        <AccessOverrideRows pick={pick} onChange={setPick} rule={rule} />
        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}
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
