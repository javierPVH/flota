import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Modal, PageHeader, Panel, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import {
  Bold,
  Heading2,
  Image,
  Italic,
  Link2,
  List,
  ListOrdered,
  Underline,
} from 'lucide-react'

import {
  createEmailSignature,
  createEmailTemplate,
  listEmailLogs,
  listEmailSignatures,
  listEmailTemplates,
  previewEmailTemplate,
  sendTestEmail,
  updateEmailSignature,
  updateEmailTemplate,
  type EmailLogRow,
  type EmailSignatureRow,
  type EmailTemplateRow,
} from '../api.ts'
import { useAppLang } from '@flota/ui/i18n'

import { fmtDate } from '../format.ts'
import { SettingsSubtabs } from '../components/SettingsSubtabs.tsx'
import { TableInfoBar } from '../components/TableInfoBar.tsx'
import { useEmailTemplatesCopy } from '../translations/emailTemplates.ts'

// Pestaña especial (primera): traza de últimos envíos (EmailLog).
const LOGS_TAB = 'logs'

// Tipos de plantilla (lista cerrada del back). Se crean bajo demanda.
const TEMPLATE_KEYS = [
  'insurance_due',
  'itv_due',
  'state_notice',
  'km_overage',
  'km_reading_pending',
  'generic',
]

// Variables interpolables (allowlist del back — mailer.ALLOWED_VARIABLES).
const VARIABLES = [
  'matricula',
  'conductor',
  'empresa',
  'fecha_vencimiento',
  'km_exceso',
  'mensaje',
]

/**
 * N10c — Gestor maestro de plantillas de correo (solo admin).
 * Editor enriquecido propio sobre contentEditable (sin librerías): negrita,
 * cursiva, listas, enlaces, encabezados, imágenes por URL y enlaces de Drive.
 * El HTML se sanea SIEMPRE en servidor (nh3) al guardar.
 */
export function EmailTemplatesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useEmailTemplatesCopy()
  const lang = useAppLang()
  const [templates, setTemplates] = useState<EmailTemplateRow[]>([])
  const [signatures, setSignatures] = useState<EmailSignatureRow[]>([])
  const [logs, setLogs] = useState<EmailLogRow[]>([])
  // La pestaña activa: 'logs' (Últimos envíos, primera) o una clave de plantilla.
  const [activeTab, setActiveTab] = useState(LOGS_TAB)
  const [logsSearch, setLogsSearch] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Editor
  const [subject, setSubject] = useState('')
  const [signatureId, setSignatureId] = useState('')
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<{ subject: string; body_html: string } | null>(null)

  // Firmas
  const [signatureModal, setSignatureModal] = useState(false)
  const [signatureName, setSignatureName] = useState('')
  const signatureBodyRef = useRef<HTMLDivElement | null>(null)
  const [editingSignature, setEditingSignature] = useState<EmailSignatureRow | null>(null)

  const load = useCallback(() => {
    listEmailTemplates()
      .then((page) => setTemplates(page.results))
      .catch((err) => setError(asErrorMessage(err, t.loadTemplatesError)))
    listEmailSignatures()
      .then((page) => setSignatures(page.results))
      .catch(() => setSignatures([]))
    listEmailLogs()
      .then((page) => setLogs(page.results))
      .catch(() => setLogs([]))
  }, [t])

  useEffect(load, [load])

  const isLogs = activeTab === LOGS_TAB
  const active = isLogs ? null : (templates.find((tpl) => tpl.key === activeTab) ?? null)

  // Últimos envíos filtrados (franja de opciones de la tabla).
  const visibleLogs = useMemo(() => {
    const term = logsSearch.trim().toLowerCase()
    if (!term) return logs
    return logs.filter((log) =>
      `${log.recipient} ${log.subject} ${log.status_display} ${t.templateKeys[log.template_key] ?? log.template_key}`
        .toLowerCase()
        .includes(term),
    )
  }, [logs, logsSearch, t])

  // Columnas de la tabla de últimos envíos (mismo estilo que las de vehículos).
  const logColumns: Array<TableWithPanelColumn<EmailLogRow>> = [
    {
      key: 'created_at',
      label: t.logColumns.date,
      isDate: true,
      getValue: (log) => log.created_at.slice(0, 10),
      render: (log) => fmtDate(log.created_at, lang),
    },
    {
      key: 'template_key',
      label: t.logColumns.template,
      getValue: (log) => t.templateKeys[log.template_key] ?? log.template_key,
      render: (log) => (t.templateKeys[log.template_key] ?? log.template_key) || '—',
    },
    {
      key: 'recipient',
      label: t.logColumns.recipient,
      getValue: (log) => log.recipient,
      render: (log) => log.recipient || '—',
    },
    {
      key: 'subject',
      label: t.logColumns.subject,
      getValue: (log) => log.subject,
      render: (log) => log.subject || '—',
    },
    {
      key: 'status',
      label: t.logColumns.status,
      getValue: (log) => log.status_display,
      render: (log) => (
        <Badge
          tone={log.status === 'sent' ? 'success' : log.status === 'failed' ? 'danger' : 'neutral'}
        >
          {log.status_display}
        </Badge>
      ),
    },
  ]

  // Vuelca la plantilla activa al editor al cambiar de pestaña o recargar.
  useEffect(() => {
    setSubject(active?.subject ?? '')
    setSignatureId(active?.signature != null ? String(active.signature) : '')
    if (bodyRef.current) bodyRef.current.innerHTML = active?.body_html ?? ''
    setNotice('')
  }, [active])

  /** Comando del editor (contentEditable). El saneado real es del servidor. */
  function exec(command: string, value?: string) {
    bodyRef.current?.focus()
    document.execCommand(command, false, value)
  }

  function insertVariable(name: string) {
    exec('insertText', `{{${name}}}`)
  }

  function insertLink(kind: 'link' | 'drive') {
    const url = window.prompt(kind === 'drive' ? t.promptDriveUrl : t.promptLinkUrl)
    if (url && /^https?:\/\//i.test(url)) exec('createLink', url)
  }

  function insertImage() {
    const url = window.prompt(t.promptImageUrl)
    if (url && /^https?:\/\//i.test(url)) exec('insertImage', url)
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const payload = {
        subject,
        body_html: bodyRef.current?.innerHTML ?? '',
        signature: signatureId ? Number(signatureId) : null,
      }
      if (active) {
        await updateEmailTemplate(active.id, payload)
      } else {
        await createEmailTemplate({ key: activeTab, ...payload })
      }
      setNotice(t.templateSaved)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.saveTemplateError))
    } finally {
      setSaving(false)
    }
  }

  async function handlePreview() {
    if (!active) return
    try {
      setPreview(await previewEmailTemplate(active.id))
    } catch (err) {
      setError(asErrorMessage(err, t.previewError))
    }
  }

  async function handleTest() {
    if (!active) return
    try {
      const result = await sendTestEmail(active.id)
      setNotice(t.testSent(result.sent_to))
    } catch (err) {
      setError(asErrorMessage(err, t.testError))
    }
  }

  function openSignature(signature: EmailSignatureRow | null) {
    setEditingSignature(signature)
    setSignatureName(signature?.name ?? '')
    setSignatureModal(true)
    // El modal monta el contentEditable en el siguiente frame.
    requestAnimationFrame(() => {
      if (signatureBodyRef.current) signatureBodyRef.current.innerHTML = signature?.body_html ?? ''
    })
  }

  async function saveSignature() {
    try {
      const payload = {
        name: signatureName.trim(),
        body_html: signatureBodyRef.current?.innerHTML ?? '',
      }
      if (editingSignature) await updateEmailSignature(editingSignature.id, payload)
      else await createEmailSignature(payload)
      setSignatureModal(false)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.saveSignatureError))
    }
  }

  return (
    <div>
      {!embedded && <PageHeader title={t.title} subtitle={t.subtitle} />}

      {error && <div role="alert" className="form-error">{error}</div>}
      {notice && <p role="status" className="muted">{notice}</p>}

      <SettingsSubtabs
        ariaLabel={t.title}
        active={activeTab}
        onChange={setActiveTab}
        items={[
          { key: LOGS_TAB, label: t.logsTitle },
          ...TEMPLATE_KEYS.map((key) => ({
            key,
            label: t.templateKeys[key] ?? key,
            suffix: templates.some((tpl) => tpl.key === key) ? undefined : t.undefinedSuffix,
          })),
        ]}
      />

      {isLogs ? (
        <section>
          <TableInfoBar
            count={visibleLogs.length}
            recordsLabel={t.records}
            searchLabel={t.searchLabel}
            searchPlaceholder={t.logsSearchPlaceholder}
            search={logsSearch}
            onSearchChange={setLogsSearch}
          />
          <TableWithPanel<EmailLogRow>
            rows={visibleLogs}
            columns={logColumns}
            rowKey={(log) => String(log.id)}
            enableColumnSort
            showControlPanel={false}
            enablePagination
            defaultPageSize={25}
            pageSizeOptions={[25, 50, 100]}
            emptyStateLabel={t.logsEmpty}
          />
        </section>
      ) : (
      <section className="card">
        <TextInputField
          label={t.subjectLabel}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />

        {/* Barra de herramientas del editor propio */}
        <div className="editor-toolbar" role="toolbar" aria-label={t.toolbarLabel}>
          <button type="button" title={t.bold} onClick={() => exec('bold')}><Bold size={15} /></button>
          <button type="button" title={t.italic} onClick={() => exec('italic')}><Italic size={15} /></button>
          <button type="button" title={t.underline} onClick={() => exec('underline')}><Underline size={15} /></button>
          <button type="button" title={t.heading} onClick={() => exec('formatBlock', 'h2')}><Heading2 size={15} /></button>
          <button type="button" title={t.list} onClick={() => exec('insertUnorderedList')}><List size={15} /></button>
          <button type="button" title={t.orderedList} onClick={() => exec('insertOrderedList')}><ListOrdered size={15} /></button>
          <button type="button" title={t.link} onClick={() => insertLink('link')}><Link2 size={15} /></button>
          <button type="button" title={t.image} onClick={insertImage}><Image size={15} /></button>
          <button type="button" className="editor-drive" title={t.driveTitle} onClick={() => insertLink('drive')}>
            Drive
          </button>
          <SelectField
            aria-label={t.insertVariable}
            containerClassName="editor-var"
            options={[
              { value: '', label: t.insertVariableOption },
              ...VARIABLES.map((v) => ({ value: v, label: `{{${v}}}` })),
            ]}
            value=""
            onValueChange={(value) => value && insertVariable(value)}
          />
        </div>

        <div
          ref={bodyRef}
          className="editor-body"
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label={t.bodyLabel}
          suppressContentEditableWarning
        />

        <div className="editor-footer">
          <SelectField
            label={t.signatureLabel}
            options={[
              { value: '', label: t.noSignature },
              ...signatures.map((s) => ({ value: String(s.id), label: s.name })),
            ]}
            value={signatureId}
            onValueChange={setSignatureId}
          />
          <div className="editor-actions">
            <Button variant="secondary" onClick={() => openSignature(null)}>
              {t.newSignature}
            </Button>
            {signatureId && (
              <Button
                variant="secondary"
                onClick={() =>
                  openSignature(signatures.find((s) => String(s.id) === signatureId) ?? null)
                }
              >
                {t.editSignature}
              </Button>
            )}
            <Button variant="secondary" disabled={!active} onClick={handlePreview}>
              {t.preview}
            </Button>
            <Button variant="secondary" disabled={!active} onClick={handleTest}>
              {t.sendTest}
            </Button>
            <Button variant="primary" disabled={saving || !subject.trim()} onClick={handleSave}>
              {saving ? t.saving : t.saveTemplate}
            </Button>
          </div>
        </div>
        <p className="muted">
          {t.sanitizeHint} {VARIABLES.map((v) => `{{${v}}}`).join(' · ')}
        </p>
      </section>
      )}

      {/* Previsualización con datos de ejemplo (HTML ya saneado en servidor) */}
      <Modal open={preview !== null} title={t.previewTitle} onClose={() => setPreview(null)} wide>
        {preview && (
          <div className="email-preview">
            <p className="muted">{t.previewSubject} <strong>{preview.subject}</strong></p>
            <Panel>
              <div dangerouslySetInnerHTML={{ __html: preview.body_html }} />
            </Panel>
          </div>
        )}
      </Modal>

      {/* Alta/edición de firma */}
      <Modal
        open={signatureModal}
        title={editingSignature ? t.editSignatureTitle(editingSignature.name) : t.newSignatureTitle}
        onClose={() => setSignatureModal(false)}
      >
        <div className="modal-form">
          <TextInputField
            label={t.signatureName}
            value={signatureName}
            onChange={(e) => setSignatureName(e.target.value)}
            required
          />
          <div
            ref={signatureBodyRef}
            className="editor-body editor-body-sm"
            contentEditable
            role="textbox"
            aria-multiline="true"
            aria-label={t.signatureBodyLabel}
            suppressContentEditableWarning
          />
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setSignatureModal(false)}>
              {t.cancel}
            </Button>
            <Button type="button" variant="primary" disabled={!signatureName.trim()} onClick={saveSignature}>
              {t.saveSignature}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
