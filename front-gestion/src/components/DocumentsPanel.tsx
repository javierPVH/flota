import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Badge, Button, FileField, IconButton, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import {
  CalendarCheck,
  CalendarX,
  ExternalLink,
  FileX2,
  FolderOpen,
  Replace,
  Trash2,
} from 'lucide-react'

import { TextCell } from './TextCell.tsx'

import { documentExpires, incidentTypeRequiredBy, linkableIncidents } from '../documentRules.ts'
import { documentStatusTone } from '../format.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useConfirm, useDeactivateConfirm } from './ConfirmDialog.tsx'
import { CollapsibleCard, type AccordionState } from './CollapsibleCard.tsx'
import { TableInfoBar } from './TableInfoBar.tsx'

import {
  connectGoogleUrl,
  createDocument,
  deleteDocument,
  fetchFolderFiles,
  fetchPickerConfig,
  listDocuments,
  listOpenIncidents,
  purgeDocument,
  updateDocument,
  uploadDocument,
  verifyDocuments,
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
  'itv_report',
  'workshop_invoice',
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
  const confirm = useConfirm()
  const [docs, setDocs] = useState<FlotaDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  // Búsqueda en cliente sobre los documentos ya cargados (barra informativa).
  const [search, setSearch] = useState('')

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

  // R3-30: `t` por ref — con `t` en las deps, el botón es/en recargaba los
  // documentos del vehículo (el diccionario solo pinta el error).
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })

  const load = useCallback(() => {
    setLoading(true)
    listDocuments({ vehicle: vehicle.id, type: typeFilter || undefined })
      .then((page) => {
        setDocs(page.results)
        setError('')
        // En cada carga se comprueba que los archivos siguen en Drive: lo que
        // ya no está se marca en la fila (y ofrece el borrado definitivo). La
        // tabla no espera a Drive: se pinta con la lista y se corrige después.
        verifyDocuments({ vehicle: vehicle.id })
          .then(({ checked, missing }) => {
            const ahora = new Date().toISOString()
            setDocs((actuales) =>
              actuales.map((doc) => {
                if (!checked.includes(doc.id)) return doc
                if (missing.includes(doc.id)) {
                  return { ...doc, drive_missing_at: doc.drive_missing_at ?? ahora }
                }
                return doc.drive_missing_at ? { ...doc, drive_missing_at: null } : doc
              }),
            )
          })
          .catch(() => undefined) // sin Drive a mano, la lista sigue valiendo
      })
      .catch((err) => setError(asErrorMessage(err, tRef.current.loadError)))
      .finally(() => setLoading(false))
  }, [vehicle.id, typeFilter])

  useEffect(load, [load])

  useEffect(() => {
    fetchPickerConfig()
      .then(setPicker)
      .catch(() => setPicker({ enabled: false }))
  }, [])

  const openCreate = useCallback((replaceDoc: FlotaDocument | null = null) => {
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
    // Solo lo que sigue abierto: lo que se adjunta se adjunta a lo que está
    // en marcha. Si la incidencia del documento sustituido ya se cerró, se
    // suelta (no se puede elegir lo que no se ofrece).
    listOpenIncidents({ vehicle: vehicle.id })
      .then((rows) => {
        setIncidents(rows)
        setForm((f) =>
          rows.some((row) => String(row.id) === f.incident) ? f : { ...f, incident: '' },
        )
      })
      .catch(() => setIncidents([]))
  }, [vehicle.id])

  // Qué pide el formulario según el tipo elegido (mismas reglas que el back).
  const expires = documentExpires(form.type)
  const boundTo = incidentTypeRequiredBy(form.type)
  const linkable = useMemo(() => linkableIncidents(incidents, form.type), [incidents, form.type])

  function changeType(value: string) {
    // Al cambiar de tipo caen los campos que ese tipo no tiene: la caducidad
    // de lo que no caduca y la incidencia que el tipo nuevo no admite.
    setForm((f) => ({
      ...f,
      type: value,
      expiry_date: documentExpires(value) ? f.expiry_date : '',
      incident: linkableIncidents(incidents, value).some((row) => String(row.id) === f.incident)
        ? f.incident
        : '',
    }))
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
    if (expires && !form.expiry_date) {
      setFormError(t.expiryRequired)
      return
    }
    if (boundTo && !form.incident) {
      setFormError(t.incidentRequired)
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

  const toggleStatus = useCallback(async (doc: FlotaDocument) => {
    try {
      await updateDocument(doc.id, { status: doc.status === 'expired' ? 'valid' : 'expired' })
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.statusError))
    }
  }, [load, t.statusError])

  const handleDelete = useCallback(async (doc: FlotaDocument) => {
    // N7: nada se borra — doble confirmación y desactivación con motivo. El
    // borrado definitivo (también en Drive) lo hace el superusuario en erratas.
    const reason = await deactivateConfirm(t.deactivateTarget(doc.type_display))
    if (reason === null) return
    try {
      await deleteDocument(doc.id, reason)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.deactivateError))
    }
  }, [deactivateConfirm, load, t])

  const handlePurge = useCallback(async (doc: FlotaDocument) => {
    // El archivo ya no existe (lo comprobó la carga): no hay nada que
    // conservar ni que restaurar, así que el registro se borra del todo aquí,
    // sin pasar por erratas. El back lo exige igual (solo con la marca).
    const ok = await confirm({
      title: t.purge,
      message: t.purgeConfirm(doc.type_display),
      confirmLabel: t.purge,
      tone: 'danger',
    })
    if (!ok) return
    try {
      await purgeDocument(doc.id)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.purgeError))
    }
  }, [confirm, load, t])

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

  // Filtro en cliente: tipo, notas, usuario, estado, caducidad o fecha de subida.
  const visibleDocs = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return docs
    return docs.filter((doc) =>
      `${doc.type_display} ${doc.notes ?? ''} ${doc.uploaded_by_name ?? ''} ${doc.status_display} ${doc.expiry_date ?? ''} ${doc.created_at.slice(0, 10)}`
        .toLowerCase()
        .includes(term),
    )
  }, [docs, search])

  // Tabla de documentos con el estilo unificado (TableWithPanel).
  const columns = useMemo<Array<TableWithPanelColumn<FlotaDocument>>>(() => [
    {
      key: 'type',
      label: t.columns.type,
      getValue: (doc) => doc.type_display,
      render: (doc) => (
        <span>
          <strong>{doc.type_display}</strong>
          {doc.replaces ? <span className="doc-version">{t.replacesTag(doc.replaces)}</span> : null}
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
      // Las notas en columna propia: antes iban debajo del tipo y una nota
      // larga levantaba la fila. Recortadas a una línea; el modal las lee enteras.
      key: 'notes',
      label: t.columns.notes,
      getValue: (doc) => doc.notes ?? '',
      render: (doc) => (
        <TextCell text={doc.notes ?? ''} title={t.columns.notes} label={t.notesOpen} inline />
      ),
    },
    {
      key: 'status',
      label: t.columns.status,
      getValue: (doc) => doc.status_display,
      render: (doc) => (
        <span className="doc-status">
          <Badge tone={documentStatusTone(doc.status)}>{doc.status_display}</Badge>
          {doc.drive_missing_at && (
            <span title={t.driveMissingTitle}>
              <Badge tone="danger">{t.driveMissing}</Badge>
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t.columns.actions,
      align: 'right',
      searchable: false,
      sortable: false,
      // Solo iconos, con su nombre en `aria-label`/`title` (el mismo patrón que
      // Facturas): cuatro botones con texto por fila no cabían en la tabla.
      render: (doc) => {
        // Sin archivo detrás no hay nada que abrir: el enlace se va y, en
        // lugar de «Eliminar» (erratas), sale el borrado definitivo.
        const missing = Boolean(doc.drive_missing_at)
        const href = missing ? '' : documentHref(doc)
        const estado = doc.status === 'expired' ? t.markValid : t.markExpired
        return (
          <div className="row-actions">
            {href && (
              <a
                className="doc-open-icon"
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={t.open}
                title={t.open}
              >
                <ExternalLink size={15} aria-hidden />
              </a>
            )}
            <IconButton aria-label={t.replace} title={t.replace} onClick={() => openCreate(doc)}>
              <Replace size={15} />
            </IconButton>
            {doc.status !== 'pending_archive' && (
              <IconButton
                variant={doc.status === 'expired' ? 'default' : 'warning'}
                aria-label={estado}
                title={estado}
                onClick={() => toggleStatus(doc)}
              >
                {doc.status === 'expired' ? <CalendarCheck size={15} /> : <CalendarX size={15} />}
              </IconButton>
            )}
            {missing ? (
              <IconButton
                variant="danger"
                aria-label={t.purge}
                title={t.purge}
                onClick={() => handlePurge(doc)}
              >
                <FileX2 size={15} />
              </IconButton>
            ) : (
              <IconButton
                variant="danger"
                aria-label={t.delete}
                title={t.delete}
                onClick={() => handleDelete(doc)}
              >
                <Trash2 size={15} />
              </IconButton>
            )}
          </div>
        )
      },
    },
  ], [handleDelete, handlePurge, openCreate, t, toggleStatus])

  return (
    <CollapsibleCard
      id="documents"
      accordion={accordion}
      title={t.title}
      actions={
        accordion.isOpen('documents') ? (
          <div className="section-tools">
            <Button variant="primary" onClick={() => openCreate()}>
              {t.add}
            </Button>
          </div>
        ) : (
          // Resumen al colapsar: nº de documentos.
          <span className="acc-summary">{t.collapsedCount(docs.length)}</span>
        )
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
        <>
          {/* Barra informativa tipo tarjeta (como en Vehículos): contador +
              buscador + filtro de tipo. */}
          <TableInfoBar
            count={visibleDocs.length}
            recordsLabel={t.records}
            searchLabel={t.searchLabel}
            searchPlaceholder={t.searchPlaceholder}
            search={search}
            onSearchChange={setSearch}
          >
            <div className="filter-field filter-field--role">
              <label>{t.filterType}</label>
              <SelectField
                aria-label={t.filterType}
                containerClassName="role-filter"
                required
                options={[{ value: '', label: t.allTypes }, ...typeOptions]}
                value={typeFilter}
                onValueChange={setTypeFilter}
              />
            </div>
          </TableInfoBar>
          <TableWithPanel<FlotaDocument>
            rows={visibleDocs}
            columns={columns}
            rowKey={(doc) => String(doc.id)}
            rowClassName={(doc) => (doc.status === 'expired' ? 'row-muted' : '')}
            enableColumnSort
            showControlPanel={false}
            enablePagination
            defaultPageSize={25}
            pageSizeOptions={[25, 50, 100]}
            emptyStateLabel={t.empty(Boolean(typeFilter) || Boolean(search))}
          />
        </>
      )}

      <Modal
        open={modalOpen}
        title={replacing ? t.modalTitleReplace(replacing.type_display) : t.modalTitleNew(vehicle.plate)}
        onClose={() => setModalOpen(false)}
      >
        <form className="modal-form" onSubmit={handleSubmit}>
          <SelectField
            label={t.typeLabel}
            required
            options={typeOptions}
            value={form.type}
            onValueChange={changeType}
          />
          {/* La caducidad solo se pide a lo que caduca (póliza, contrato,
              informe de ITV, permiso), y ahí es obligatoria. */}
          {expires && (
            <TextInputField
              label={t.expiryLabel}
              type="date"
              required
              requiredVisual
              value={form.expiry_date}
              onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
            />
          )}
          {/* Incidencia: un parte de accidente va SIEMPRE ligado a un accidente
              abierto; el resto se puede ligar a cualquier incidencia sin cerrar. */}
          {boundTo ? (
            linkable.length > 0 ? (
              <SelectField
                label={t.incidentRequiredLabel}
                required
                requiredVisual
                options={[
                  { value: '', label: t.incidentChoose },
                  ...linkable.map((i) => ({ value: String(i.id), label: t.incidentOption(i) })),
                ]}
                value={form.incident}
                onValueChange={(value) => setForm((f) => ({ ...f, incident: value }))}
              />
            ) : (
              <p className="form-error" role="status">
                {t.noOpenIncident(t.typeOptions[form.type as keyof typeof t.typeOptions])}
              </p>
            )
          ) : (
            linkable.length > 0 && (
              <SelectField
                label={t.incidentLabel}
                required
                options={[
                  { value: '', label: t.incidentNone },
                  ...linkable.map((i) => ({ value: String(i.id), label: t.incidentOption(i) })),
                ]}
                value={form.incident}
                onValueChange={(value) => setForm((f) => ({ ...f, incident: value }))}
              />
            )
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
                <FileField
                  label={t.filePickLabel}
                  accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
                  value={attach.file}
                  onFiles={(files) =>
                    setAttach({ picked: null, file: files[0] ?? null, manualUrl: '' })
                  }
                />
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
            <Button
              type="submit"
              variant="primary"
              disabled={saving || (Boolean(boundTo) && linkable.length === 0)}
            >
              {saving ? t.saving : replacing ? t.replace : t.save}
            </Button>
          </div>
        </form>
      </Modal>
    </CollapsibleCard>
  )
}
