import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Modal, PageHeader, Panel, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import {
  Bold,
  Heading2,
  Image,
  Info,
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

  // Editor. Cada plantilla tiene dos versiones —castellana e inglesa— y se
  // editan en la misma caja: el idioma inactivo se guarda en su buffer para no
  // perderlo al cambiar de pestaña, y al guardar se mandan las dos.
  const [editLang, setEditLang] = useState<'es' | 'en'>('es')
  const [subject, setSubject] = useState('')
  const [subjectEn, setSubjectEn] = useState('')
  const [bodyEs, setBodyEs] = useState('')
  const [bodyEn, setBodyEn] = useState('')
  const [signatureId, setSignatureId] = useState('')
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [saving, setSaving] = useState(false)
  /**
   * A9 — ¿hay cambios sin guardar?
   *
   * El cuerpo vivía SOLO en el DOM del `contentEditable` y se leía al guardar,
   * mientras que el efecto de hidratación reescribía `innerHTML` cada vez que
   * cambiaba la plantilla activa... y `activa` se recalcula con cada `load()`.
   * Resultado: guardar una firma, o simplemente que llegara una recarga,
   * borraba sin avisar lo que estuvieras escribiendo. Ahora el contenido va a
   * estado en cada pulsación, la hidratación solo ocurre al cambiar de
   * plantilla, y salir con cambios pendientes pide confirmación.
   */
  const [dirty, setDirty] = useState(false)
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

  // Vuelca la plantilla activa al editor al cambiar DE PLANTILLA (no en cada
  // recarga: A9). Se vuelve siempre al castellano: es la versión de referencia.
  const hydrated = useRef<string>('')
  useEffect(() => {
    const stamp = `${activeTab}:${active?.id ?? 'nueva'}`
    if (hydrated.current === stamp) return
    hydrated.current = stamp
    setSubject(active?.subject ?? '')
    setSubjectEn(active?.subject_en ?? '')
    setBodyEs(active?.body_html ?? '')
    setBodyEn(active?.body_html_en ?? '')
    setEditLang('es')
    setSignatureId(active?.signature != null ? String(active.signature) : '')
    if (bodyRef.current) bodyRef.current.innerHTML = active?.body_html ?? ''
    setDirty(false)
    setNotice('')
  }, [active, activeTab])

  // A9: aviso del navegador al recargar/cerrar con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /** Cambia de pestaña pidiendo confirmación si hay cambios sin guardar. */
  function switchTab(next: string) {
    if (next === activeTab) return
    if (dirty && !window.confirm(t.unsavedWarning)) return
    setDirty(false)
    setActiveTab(next)
  }

  /** Cambia de idioma guardando lo escrito antes de cargar la otra versión. */
  function switchLang(next: 'es' | 'en') {
    if (next === editLang) return
    const current = bodyRef.current?.innerHTML ?? ''
    if (editLang === 'es') setBodyEs(current)
    else setBodyEn(current)
    setEditLang(next)
    if (bodyRef.current) bodyRef.current.innerHTML = next === 'es' ? bodyEs : bodyEn
  }

  /**
   * A9 — lo escrito en la caja pasa a estado en cada cambio (tecla o comando de
   * la barra). No se reescribe `innerHTML` desde el estado, así que el cursor no
   * se mueve; lo que se gana es que el contenido deja de vivir solo en el DOM.
   */
  function syncBody() {
    const html = bodyRef.current?.innerHTML ?? ''
    if (editLang === 'es') setBodyEs(html)
    else setBodyEn(html)
    setDirty(true)
  }

  /** Comando del editor (contentEditable). El saneado real es del servidor. */
  function exec(command: string, value?: string) {
    bodyRef.current?.focus()
    document.execCommand(command, false, value)
    syncBody()
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
      // Lo que hay en la caja pertenece al idioma activo; la otra versión sale
      // de su buffer. Así se guardan las dos aunque solo se haya tocado una.
      // (A9: se relee el DOM por si el último cambio no pasó por `onInput`,
      // p. ej. un pegado con formato en algún navegador.)
      const inBox = bodyRef.current?.innerHTML ?? (editLang === 'es' ? bodyEs : bodyEn)
      const payload = {
        subject,
        body_html: editLang === 'es' ? inBox : bodyEs,
        subject_en: subjectEn,
        body_html_en: editLang === 'en' ? inBox : bodyEn,
        signature: signatureId ? Number(signatureId) : null,
      }
      if (active) {
        await updateEmailTemplate(active.id, payload)
      } else {
        await createEmailTemplate({ key: activeTab, ...payload })
      }
      setNotice(t.templateSaved)
      setDirty(false)
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
      setPreview(await previewEmailTemplate(active.id, editLang))
    } catch (err) {
      setError(asErrorMessage(err, t.previewError))
    }
  }

  async function handleTest() {
    if (!active) return
    try {
      const result = await sendTestEmail(active.id, editLang)
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

      {/* Aviso informativo: qué es esta sección (misma posición que el de
          «Qué es el borrado definitivo» en Erratas). */}
      <div className="alert-note tone-info" role="note">
        <Info size={18} aria-hidden />
        <div>
          <strong>{t.alertTitle}</strong>
          <p>{t.alertBody}</p>
        </div>
      </div>

      {error && <div role="alert" className="form-error">{error}</div>}
      {notice && <p role="status" className="muted">{notice}</p>}

      <SettingsSubtabs
        ariaLabel={t.title}
        active={activeTab}
        onChange={switchTab}
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
        {/* Qué versión se está editando. El castellano es la de referencia y
            siempre se usa; la inglesa, si está vacía, cae a ella al enviar. */}
        <div className="tpl-lang">
          <div className="seg-switch" role="group" aria-label={t.langLabel}>
            <button
              type="button"
              aria-pressed={editLang === 'es'}
              className={editLang === 'es' ? 'is-active' : ''}
              onClick={() => switchLang('es')}
            >
              {t.langEs}
            </button>
            <button
              type="button"
              aria-pressed={editLang === 'en'}
              className={editLang === 'en' ? 'is-active' : ''}
              onClick={() => switchLang('en')}
            >
              {t.langEn}
              {!(subjectEn.trim() || bodyEn.trim()) && (
                <span className="tpl-lang-empty">{t.langEmpty}</span>
              )}
            </button>
          </div>
          <p className="muted tpl-lang-note">
            {editLang === 'en' ? t.langEnNote : t.langEsNote}
          </p>
        </div>

        {editLang === 'es' ? (
          <TextInputField
            label={t.subjectLabel}
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value)
              setDirty(true)
            }}
          />
        ) : (
          <TextInputField
            label={t.subjectLabelEn}
            value={subjectEn}
            placeholder={subject}
            onChange={(e) => {
              setSubjectEn(e.target.value)
              setDirty(true)
            }}
          />
        )}

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
          onInput={syncBody}
          onBlur={syncBody}
        />

        <div className="editor-footer">
          <SelectField
            label={t.signatureLabel}
            options={[
              { value: '', label: t.noSignature },
              ...signatures.map((s) => ({ value: String(s.id), label: s.name })),
            ]}
            value={signatureId}
            onValueChange={(value) => {
              setSignatureId(value)
              setDirty(true)
            }}
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
            {dirty && <span className="tpl-dirty">{t.unsavedBadge}</span>}
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
