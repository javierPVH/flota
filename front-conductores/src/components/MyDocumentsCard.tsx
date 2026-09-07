import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Camera, ChevronRight, ExternalLink, FileText } from 'lucide-react'
import { Badge, Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { listPersonalDocuments, uploadDocument } from '../api.ts'
import { useAuth } from '../auth.ts'
import { documentStatusTone, fmtDate } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { isNetworkError, newClientRef, safeEnqueue } from '../offline/queue.ts'
import type { FlotaDocument } from '../types.ts'

/** Tipos con sentido como documento PERSONAL (lista cerrada del back). */
const PERSONAL_TYPES = ['driving_license', 'other']

/** Solo enlaces http(s), como en los acordeones de documentos del vehículo. */
function documentHref(doc: FlotaDocument): string {
  const safe = (url: string) => (/^https?:\/\//i.test(url) ? url : '')
  return safe(doc.drive_url) || safe(doc.file_url)
}

/**
 * R3-43 — Acordeón «Mis documentos»: los documentos con titular PERSONA
 * (permiso de conducir…). Gestión ya los subía y el back ya los acotaba
 * (`users_for`), pero la app de campo solo listaba por vehículo: el conductor
 * no veía su propio permiso ni podía subir el suyo. La subida entra en la cola
 * offline (M7) como cualquier documento, con su `client_ref` (R3-34).
 */
export function MyDocumentsCard() {
  const { user } = useAuth()
  const { t, language } = useLang()
  const copy = t.myDocs

  const [documents, setDocuments] = useState<FlotaDocument[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ type: 'driving_license', expiry_date: '' })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const userId = user?.id ?? null
  const load = useCallback(() => {
    if (userId === null) return
    listPersonalDocuments(userId)
      .then((page) => {
        setDocuments(page.results)
        setLoadFailed(false)
      })
      .catch(() => setLoadFailed(true))
  }, [userId])
  useEffect(load, [load])

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
      load()
    } catch (caught) {
      if (
        isNetworkError(caught) &&
        (await safeEnqueue({ kind: 'document', payload, file, fileName: file.name, fileType: file.type }))
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
    <details className="card alert-group">
      <summary className="alert-group-head">
        <ChevronRight size={16} aria-hidden className="alert-group-chev" />
        <div className="alert-group-info">
          <div className="alert-group-title">
            <strong>{copy.title}</strong>
            <Badge tone="info" size="sm">
              {documents?.length ?? 0}
            </Badge>
          </div>
        </div>
      </summary>
      <div className="alert-group-body">
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
        {documents !== null && documents.length === 0 && (
          <p className="empty-note">{copy.empty}</p>
        )}
        {documents !== null && documents.length > 0 && (
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
        )}

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
      </div>
    </details>
  )
}
