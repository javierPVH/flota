import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, Paperclip } from 'lucide-react'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { listIncidents, uploadDocument } from '../api.ts'
import { documentExpires, incidentTypeRequiredBy, linkableIncidents } from '../documentRules.ts'
import { fmtDate } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { isNetworkError, newClientRef, safeEnqueue } from '../offline/queue.ts'
import type { Incident, Vehicle } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

const DOCUMENT_TYPES = [
  'registration_certificate',
  'technical_datasheet',
  'insurance',
  'contract',
  'return_report',
  'accident_report',
  'damage_photos',
  'other',
]

/** Subida de documentos desde la ficha, con el vehículo fijado. */
export function UploadDocumentModal({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  onClose: () => void
  onSaved?: () => void
}) {
  const { t } = useLang()
  const doc = t.vehicle
  const copy = t.uploadDoc
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [form, setForm] = useState({ type: 'other', expiry_date: '', incident: '', notes: '' })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    listIncidents(vehicle.id)
      .then((page) => setIncidents(page.results))
      .catch(() => setIncidents([]))
  }, [vehicle.id])

  // Qué pide el formulario según el tipo (mismas reglas que el back): la
  // caducidad solo a lo que caduca; el parte de accidente, un accidente abierto.
  const expires = documentExpires(form.type)
  const boundTo = incidentTypeRequiredBy(form.type)
  const linkable = linkableIncidents(incidents, form.type)

  function changeType(value: string) {
    setForm((current) => ({
      ...current,
      type: value,
      expiry_date: documentExpires(value) ? current.expiry_date : '',
      incident: linkableIncidents(incidents, value).some((row) => String(row.id) === current.incident)
        ? current.incident
        : '',
    }))
  }

  function reset() {
    setDone('')
    setError('')
    setFile(null)
    setForm({ type: 'other', expiry_date: '', incident: '', notes: '' })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!file) {
      setError(doc.chooseFile)
      return
    }
    if (boundTo && !form.incident) {
      setError(doc.linkAccidentRequired)
      return
    }
    setSaving(true)
    setError('')
    const payload = {
      vehicle: vehicle.id,
      type: form.type,
      expiry_date: form.expiry_date || null,
      incident: form.incident ? Number(form.incident) : null,
      notes: form.notes,
      // R3-34: misma referencia en el intento directo y en el reenvío offline.
      client_ref: newClientRef(),
    }
    try {
      const created = await uploadDocument(payload, file)
      setDone(created.status === 'pending_archive' ? doc.uploadOkPending : doc.uploadOkArchived)
      onSaved?.()
    } catch (caught) {
      if (
        isNetworkError(caught) &&
        (await safeEnqueue({ kind: 'document', payload, file, fileName: file.name, fileType: file.type }))
      ) {
        setDone(doc.uploadOffline)
        onSaved?.()
      } else {
        setError(asErrorMessage(caught, doc.uploadError))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <SupervisorModal
      open
      title={`${copy.title} · ${vehicle.plate}`}
      onClose={onClose}
      footer={done ? (
        <>
          <Button type="button" variant="secondary" onClick={reset}>{copy.another}</Button>
          <Button type="button" onClick={onClose}>{t.carUpdate.close}</Button>
        </>
      ) : undefined}
    >
      {done ? (
        <div className="km-saved">
          <CheckCircle2 size={52} aria-hidden className="km-saved-icon" />
          <h2>{copy.savedTitle}</h2>
          <p className="km-saved-detail" role="status">{done}</p>
        </div>
      ) : (
        <form className="modal-form" onSubmit={handleSubmit}>
          <SelectField
            label={doc.docType}
            options={DOCUMENT_TYPES.map((value) => ({ value, label: doc.docTypes[value] ?? value }))}
            value={form.type}
            onValueChange={changeType}
          />
          <div className="file-block">
            <span className="file-block-label">
              {doc.filePick} <span className="req-badge" aria-hidden>{t.common.required}</span>
            </span>
            {/* La misma caja de adjuntar del resto de la app (pulgar-friendly),
                no el «Seleccionar archivo» del sistema. */}
            <label className={`photo-attach${file ? ' has-file' : ''}`}>
              <Paperclip size={18} aria-hidden />
              {file ? file.name : doc.filePick}
              <input
                type="file"
                aria-label={doc.filePick}
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          {expires && (
            <TextInputField
              label={doc.expiry}
              type="date"
              value={form.expiry_date}
              onChange={(event) => setForm((current) => ({ ...current, expiry_date: event.target.value }))}
            />
          )}
          {boundTo ? (
            linkable.length > 0 ? (
              <SelectField
                label={doc.linkAccident}
                required
                requiredVisual
                options={[
                  { value: '', label: doc.linkChoose },
                  ...linkable.map((incident) => ({
                    value: String(incident.id),
                    label: `#${incident.id} · ${incident.type_display}${incident.date ? ` (${fmtDate(incident.date)})` : ''}`,
                  })),
                ]}
                value={form.incident}
                onValueChange={(value) => setForm((current) => ({ ...current, incident: value }))}
              />
            ) : (
              <p className="form-error" role="status">{doc.noOpenAccident}</p>
            )
          ) : (
            linkable.length > 0 && (
              <SelectField
                label={doc.linkIncident}
                required
                options={[
                  { value: '', label: doc.linkNone },
                  ...linkable.map((incident) => ({
                    value: String(incident.id),
                    label: `#${incident.id} · ${incident.type_display} · ${incident.status_display}${incident.date ? ` (${fmtDate(incident.date)})` : ''}`,
                  })),
                ]}
                value={form.incident}
                onValueChange={(value) => setForm((current) => ({ ...current, incident: value }))}
              />
            )
          )}
          <TextInputField
            label={doc.notes}
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          />
          {error && <div role="alert" className="form-error">{error}</div>}
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
            <Button type="submit" disabled={saving || (Boolean(boundTo) && linkable.length === 0)}>
              {saving ? doc.uploadSubmitting : copy.submit}
            </Button>
          </div>
        </form>
      )}
    </SupervisorModal>
  )
}
