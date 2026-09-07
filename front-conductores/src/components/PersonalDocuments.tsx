import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Camera } from 'lucide-react'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { listPersonalDocuments, uploadDocument } from '../api.ts'
import { useAuth } from '../auth.ts'
import { useLang } from '../i18n.tsx'
import { isNetworkError, newClientRef, safeEnqueue } from '../offline/queue.ts'
import type { FlotaDocument } from '../types.ts'
import { DocumentList } from './DocumentList.tsx'

/** Tipos con sentido como documento PERSONAL (lista cerrada del back). */
const PERSONAL_TYPES = ['driving_license', 'other']

export interface PersonalDocumentsState {
  userId: number | null
  documents: FlotaDocument[] | null
  loadFailed: boolean
  reload: () => void
}

/**
 * Documentos con titular PERSONA del usuario en sesión. Se carga aquí, fuera
 * del panel, porque quien lo enmarca (la pestaña «del conductor») necesita el
 * recuento antes de pintar el contenido: así se pide UNA vez.
 */
export function usePersonalDocuments(): PersonalDocumentsState {
  const { user } = useAuth()
  const [documents, setDocuments] = useState<FlotaDocument[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const userId = user?.id ?? null
  const reload = useCallback(() => {
    if (userId === null) return
    listPersonalDocuments(userId)
      .then((page) => {
        setDocuments(page.results)
        setLoadFailed(false)
      })
      .catch(() => setLoadFailed(true))
  }, [userId])
  useEffect(reload, [reload])

  return { userId, documents, loadFailed, reload }
}

/**
 * R3-43 — Documentación del CONDUCTOR: los documentos con titular persona
 * (permiso de conducir…). Gestión ya los subía y el back ya los acotaba
 * (`users_for`), pero la app de campo solo listaba por vehículo: el conductor
 * no veía su propio permiso ni podía subir el suyo. La subida entra en la cola
 * offline (M7) como cualquier documento, con su `client_ref` (R3-34).
 *
 * Va sin tarjeta propia: lo enmarcan la pestaña «del conductor» de la home y
 * la pantalla «Mi perfil».
 */
export function PersonalDocumentsPanel({
  userId,
  documents,
  loadFailed,
  reload,
}: PersonalDocumentsState) {
  const { t } = useLang()
  const copy = t.myDocs

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ type: 'driving_license', expiry_date: '' })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (userId === null) return
    if (!file) {
      setError(t.vehicle.chooseFile)
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    // Titular PERSONA (sin vehículo); misma cola y misma idempotencia que el
    // resto de documentos de campo.
    const payload = {
      user: userId,
      type: form.type,
      expiry_date: form.expiry_date || null,
      client_ref: newClientRef(),
    }
    try {
      await uploadDocument(payload, file)
      setNotice(copy.uploadOk)
      setShowForm(false)
      setFile(null)
      setForm({ type: 'driving_license', expiry_date: '' })
      reload()
    } catch (caught) {
      if (
        isNetworkError(caught) &&
        (await safeEnqueue({
          kind: 'document',
          payload,
          file,
          fileName: file.name,
          fileType: file.type,
        }))
      ) {
        setNotice(copy.uploadOffline)
        setShowForm(false)
        setFile(null)
      } else {
        setError(asErrorMessage(caught, copy.uploadError))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <p className="doc-sub">{copy.hint}</p>
      {loadFailed && (
        <div role="alert" className="form-error">
          {copy.loadError}
        </div>
      )}
      {notice && (
        <p className="reminder-done" role="status">
          {notice}
        </p>
      )}
      {documents !== null && <DocumentList documents={documents} emptyNote={copy.empty} />}

      {!showForm && (
        <Button type="button" variant="secondary" size="sm" onClick={() => setShowForm(true)}>
          {copy.upload}
        </Button>
      )}
      {showForm && (
        <form className="modal-form" onSubmit={handleSubmit}>
          <SelectField
            label={copy.type}
            aria-label={copy.type}
            options={PERSONAL_TYPES.map((value) => ({ value, label: copy.types[value] ?? value }))}
            value={form.type}
            onValueChange={(type) => setForm((current) => ({ ...current, type }))}
          />
          <TextInputField
            label={copy.expiry}
            aria-label={copy.expiry}
            type="date"
            value={form.expiry_date}
            onChange={(e) => setForm((current) => ({ ...current, expiry_date: e.target.value }))}
          />
          <label className={`photo-attach${file ? ' has-file' : ''}`}>
            <Camera size={18} aria-hidden />
            {file ? file.name : t.vehicle.filePick}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {error && (
            <div role="alert" className="form-error">
              {error}
            </div>
          )}
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? copy.submitting : copy.submit}
            </Button>
          </div>
        </form>
      )}
    </>
  )
}
