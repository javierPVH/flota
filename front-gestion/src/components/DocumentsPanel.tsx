import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Badge, Button, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { ExternalLink, FolderOpen } from 'lucide-react'

import { documentStatusTone } from '../format.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useDeactivateConfirm } from './ConfirmDialog.tsx'
import { CollapsibleCard, type AccordionState } from './CollapsibleCard.tsx'

import {
  connectGoogleUrl,
  createDocument,
  deleteDocument,
  fetchFolderFiles,
  fetchPickerConfig,
  listDocuments,
  listIncidents,
  updateDocument,
  uploadDocument,
  type DocumentInput,
} from '../api.ts'
import { openDrivePicker, type PickedFile } from '../services/google-picker.ts'
import type {
  DriveFile,
  FlotaDocument,
  Incident,
  PickerConfig,
  Vehicle,
} from '../types.ts'

// Tipos de documento (lista cerrada del back, Épica 4). Etiquetas en panels.ts.
const DOCUMENT_TYPE_VALUES = [
  'registration_certificate',
  'technical_datasheet',
  'insurance',
  'contract',
  'delivery_report',
  'return_report',
  'accident_report',
  'damage_photos',
  'other',
] as const

/** Solo enlaces http(s): corta javascript:/data: aunque el back ya sanea. */
function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : ''
}

/** Enlace al archivo: Drive si ya está archivado; staging local si no. */
function documentHref(doc: FlotaDocument): string {
  return safeHref(doc.drive_url) || safeHref(doc.file_url)
}

interface AttachState {
  picked: PickedFile | null
  file: File | null
  manualUrl: string
}

const EMPTY_ATTACH: AttachState = { picked: null, file: null, manualUrl: '' }

interface FormState {
  type: string
  expiry_date: string
  incident: string
  notes: string
}

const EMPTY_FORM: FormState = { type: 'insurance', expiry_date: '', incident: '', notes: '' }

/** Sección "Documentos" de la ficha (G7): consultar, subir/elegir de Drive,
 * sustituir conservando versión, caducar/reactivar y eliminar. */
export function DocumentsPanel({
  vehicle,
  accordion,
}: {
  vehicle: Vehicle
  accordion: AccordionState
}) {
  const t = usePanelsCopy().documents
  const typeOptions = useMemo(
    () => DOCUMENT_TYPE_VALUES.map((value) => ({ value, label: t.typeOptions[value] })),
    [t],
  )
  const deactivateConfirm = useDeactivateConfirm()
  const [docs, setDocs] = useState<FlotaDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  const [picker, setPicker] = useState<PickerConfig | null>(null)
  const [folderFiles, setFolderFiles] = useState<DriveFile[] | null>(null)
  const [folderError, setFolderError] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [replacing, setReplacing] = useState<FlotaDocument | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [attach, setAttach] = useState<AttachState>(EMPTY_ATTACH)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    listDocuments({ vehicle: vehicle.id, type: typeFilter || undefined })
      .then((page) => {
        setDocs(page.results)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
      .finally(() => setLoading(false))
  }, [vehicle.id, typeFilter, t])

  useEffect(load, [load])

  useEffect(() => {
    fetchPickerConfig()
      .then(setPicker)
      .catch(() => setPicker({ enabled: false }))
  }, [])

  function openCreate(replaceDoc: FlotaDocument | null = null) {
    setReplacing(replaceDoc)
    setForm(
      replaceDoc
        ? {
            type: replaceDoc.type,
            expiry_date: '',
            incident: replaceDoc.incident ? String(replaceDoc.incident) : '',
            notes: '',
          }
        : EMPTY_FORM,
    )
    setAttach(EMPTY_ATTACH)
    setFormError('')
    setModalOpen(true)
    listIncidents({ vehicle: vehicle.id })
      .then((page) => setIncidents(page.results))
      .catch(() => setIncidents([]))
  }

  async function pickFromDrive(mode: 'file' | 'upload') {
    if (!picker?.access_token || !picker.api_key) return
    setFormError('')
    try {
      const result = await openDrivePicker({
        accessToken: picker.access_token,
        apiKey: picker.api_key,
        appId: picker.app_id,
        mode,
      })
      if (result) setAttach({ picked: result, file: null, manualUrl: '' })
    } catch (err) {
      setFormError(asErrorMessage(err, t.pickerError))
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const { picked, file, manualUrl } = attach
    if (!picked && !file && !manualUrl) {
      setFormError(t.attachRequired)
      return
    }
    setSaving(true)
    setFormError('')
    const base: DocumentInput = {
      vehicle: vehicle.id,
      type: form.type,
      expiry_date: form.expiry_date || null,
      incident: form.incident ? Number(form.incident) : null,
      notes: form.notes || undefined,
      replaces: replacing?.id ?? null,
    }
    try {
      if (file) {
        await uploadDocument(base, file)
      } else {
        await createDocument({
          ...base,
          drive_url: picked?.url ?? manualUrl,
          drive_file_id: picked?.id || undefined,
        })
      }
      // Sustituir conserva el anterior (`replaces`) y lo marca caducado (HU-4.4).
      if (replacing && replacing.status !== 'expired') {
        await updateDocument(replacing.id, { status: 'expired' })
      }
      setModalOpen(false)
      load()
    } catch (err) {
      setFormError(asErrorMessage(err, t.saveError))
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(doc: FlotaDocument) {
    try {
      await updateDocument(doc.id, { status: doc.status === 'expired' ? 'valid' : 'expired' })
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.statusError))
    }
  }

  async function handleDelete(doc: FlotaDocument) {
    // N7: nada se borra — doble confirmación y desactivación con motivo.
    const reason = await deactivateConfirm(t.deactivateTarget(doc.type_display))
    if (reason === null) return
    try {
      await deleteDocument(doc.id, reason)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.deactivateError))
    }
  }

  async function toggleFolder() {
    if (folderFiles) {
      setFolderFiles(null)
      return
    }
    setFolderError('')
    try {
      const result = await fetchFolderFiles(vehicle.drive_folder_id)
      if (result.error) setFolderError(t.driveUnavailable)
      setFolderFiles(result.files)
    } catch (err) {
      setFolderError(asErrorMessage(err, t.folderListError))
    }
  }

  const pickerReady = Boolean(picker?.enabled && picker.has_drive && picker.access_token)
  const needsConnect = Boolean(picker?.enabled && !picker.has_drive)
  const folderUrl = safeHref(vehicle.drive_folder_url)

  // Tabla de documentos con el estilo unificado (TableWithPanel).
  const columns: Array<TableWithPanelColumn<FlotaDocument>> = [
    {
      key: 'type',
      label: t.columns.type,
      getValue: (doc) => doc.type_display,
      render: (doc) => (
        <span>
          <strong>{doc.type_display}</strong>
          {doc.replaces ? <span className="doc-version">{t.replacesTag(doc.replaces)}</span> : null}
          {doc.notes ? <div className="doc-notes">{doc.notes}</div> : null}
        </span>
      ),
    },
    {
      key: 'created_at',
      label: t.columns.uploaded,
      isDate: true,
      getValue: (doc) => doc.created_at.slice(0, 10),
      render: (doc) => doc.created_at.slice(0, 10),
    },
    {
      key: 'uploaded_by',
      label: t.columns.by,
      getValue: (doc) => doc.uploaded_by_name || '',
      render: (doc) => doc.uploaded_by_name || '—',
    },
    {
      key: 'expiry_date',
      label: t.columns.expiry,
      isDate: true,
      getValue: (doc) => doc.expiry_date ?? '',
      render: (doc) => doc.expiry_date ?? '—',
    },
    {
      key: 'incident',
      label: t.columns.incident,
      getValue: (doc) => doc.incident ?? -1,
      render: (doc) => (doc.incident ? `#${doc.incident}` : '—'),
    },
    {
      key: 'status',
      label: t.columns.status,
      getValue: (doc) => doc.status_display,
      render: (doc) => <Badge tone={documentStatusTone(doc.status)}>{doc.status_display}</Badge>,
    },
    {
      key: 'actions',
      label: t.columns.actions,
      align: 'right',
      searchable: false,
      sortable: false,
      render: (doc) => {
        const href = documentHref(doc)
        return (
          <div className="row-actions">
            {href && (
              <a className="doc-open" href={href} target="_blank" rel="noreferrer">
                <ExternalLink size={14} aria-hidden /> {t.open}
              </a>
            )}
            <Button variant="secondary" size="sm" onClick={() => openCreate(doc)}>
              {t.replace}
            </Button>
            {doc.status !== 'pending_archive' && (
              <Button variant="secondary" size="sm" onClick={() => toggleStatus(doc)}>
                {doc.status === 'expired' ? t.markValid : t.markExpired}
              </Button>
            )}
            <Button variant="danger" size="sm" onClick={() => handleDelete(doc)}>
              {t.delete}
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <CollapsibleCard
      id="documents"
      accordion={accordion}
      title={t.title}
      actions={
        <div className="section-tools">
          <SelectField
            label={t.filterType}
            options={[{ value: '', label: t.allTypes }, ...typeOptions]}
            value={typeFilter}
            onValueChange={setTypeFilter}
          />
          <Button variant="primary" onClick={() => openCreate()}>
            {t.add}
          </Button>
        </div>
      }
    >

      {needsConnect && (
        <div className="drive-connect">
          <p>
            {t.connectLead}<strong>{t.connectStrong}</strong>{t.connectTail}
          </p>
          <Button variant="secondary" onClick={() => (window.location.href = connectGoogleUrl())}>
            {t.connectButton}
          </Button>
        </div>
      )}

      {(folderUrl || (pickerReady && vehicle.drive_folder_id)) && (
        <p className="drive-folder-row">
          <FolderOpen size={15} aria-hidden />
          {folderUrl ? (
            <a href={folderUrl} target="_blank" rel="noreferrer">
              {t.driveFolder}
            </a>
          ) : (
            <span>{t.driveFolder}</span>
          )}
          {pickerReady && vehicle.drive_folder_id && (
            <Button variant="secondary" size="sm" onClick={toggleFolder}>
              {folderFiles ? t.hideContents : t.showContents}
            </Button>
          )}
        </p>
      )}
      {folderError && <div role="alert" className="form-error">{folderError}</div>}
      {folderFiles && (
        <ul className="drive-folder-files">
          {folderFiles.length === 0 && <li>{t.folderEmpty}</li>}
          {folderFiles.map((f) => (
            <li key={f.id}>
              <a href={safeHref(f.url)} target="_blank" rel="noreferrer">
                {f.name}
              </a>
            </li>
          ))}
        </ul>
      )}

      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <TableWithPanel<FlotaDocument>
          rows={docs}
          columns={columns}
          rowKey={(doc) => String(doc.id)}
          rowClassName={(doc) => (doc.status === 'expired' ? 'row-muted' : '')}
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={t.empty(Boolean(typeFilter))}
        />
      )}

      <Modal
        open={modalOpen}
        title={replacing ? t.modalTitleReplace(replacing.type_display) : t.modalTitleNew(vehicle.plate)}
        onClose={() => setModalOpen(false)}
      >
        <form className="modal-form" onSubmit={handleSubmit}>
          <SelectField
            label={t.typeLabel}
            options={typeOptions}
            value={form.type}
            onValueChange={(value) => setForm((f) => ({ ...f, type: value }))}
          />
          <TextInputField
            label={t.expiryLabel}
            type="date"
            value={form.expiry_date}
            onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
          />
          {incidents.length > 0 && (
            <SelectField
              label={t.incidentLabel}
              options={[
                { value: '', label: t.incidentNone },
                ...incidents.map((i) => ({
                  value: String(i.id),
                  label: `#${i.id} · ${i.type_display}${i.date ? ` (${i.date})` : ''}`,
                })),
              ]}
              value={form.incident}
              onValueChange={(value) => setForm((f) => ({ ...f, incident: value }))}
            />
          )}
          <TextInputField
            label={t.notesLabel}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />

          <div className="doc-attach">
            <span className="doc-attach-label">{t.fileLabel}</span>
            {pickerReady && (
              <div className="doc-attach-drive">
                <Button type="button" variant="secondary" onClick={() => pickFromDrive('upload')}>
                  {t.uploadToDrive}
                </Button>
                <Button type="button" variant="secondary" onClick={() => pickFromDrive('file')}>
                  {t.pickFromDrive}
                </Button>
              </div>
            )}
            {attach.picked ? (
              <p className="doc-attach-picked">
                📄 {attach.picked.name}{' '}
                <Button type="button" variant="secondary" size="sm" onClick={() => setAttach(EMPTY_ATTACH)}>
                  {t.removeAttachment}
                </Button>
              </p>
            ) : (
              <>
                {/* UX4: input de fichero con etiqueta real. */}
                <label className="file-field">
                  <span>{t.filePickLabel}</span>
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
                    onChange={(e) =>
                      setAttach({ picked: null, file: e.target.files?.[0] ?? null, manualUrl: '' })
                    }
                  />
                </label>
                <TextInputField
                  label={t.urlLabel}
                  value={attach.manualUrl}
                  onChange={(e) => setAttach({ picked: null, file: null, manualUrl: e.target.value })}
                  placeholder="https://drive.google.com/…"
                  disabled={Boolean(attach.file)}
                />
              </>
            )}
          </div>

          {formError && <div role="alert" className="form-error">{formError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? t.saving : replacing ? t.replace : t.save}
            </Button>
          </div>
        </form>
      </Modal>
    </CollapsibleCard>
  )
}
