import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, Modal, PageHeader, Panel, SelectField, TabButton, TextInputField } from '@flota/ui/ui'
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
import { fmtDate } from '../format.ts'
import { useLang } from '../i18n.tsx'

// Tipos de plantilla (lista cerrada del back). Se crean bajo demanda.
const TEMPLATE_KEYS: Array<{ key: string; label: string }> = [
  { key: 'insurance_due', label: 'Seguro (a la empresa de renting)' },
  { key: 'km_overage', label: 'Exceso de km (al conductor)' },
  { key: 'km_reading_pending', label: 'Lectura pendiente (al conductor)' },
  { key: 'generic', label: 'Genérica' },
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
export function EmailTemplatesPage() {
  const { language } = useLang()
  const [templates, setTemplates] = useState<EmailTemplateRow[]>([])
  const [signatures, setSignatures] = useState<EmailSignatureRow[]>([])
  const [logs, setLogs] = useState<EmailLogRow[]>([])
  const [activeKey, setActiveKey] = useState('insurance_due')
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
      .catch((err) => setError(asErrorMessage(err, 'No se pudieron cargar las plantillas.')))
    listEmailSignatures()
      .then((page) => setSignatures(page.results))
      .catch(() => setSignatures([]))
    listEmailLogs()
      .then((page) => setLogs(page.results.slice(0, 10)))
      .catch(() => setLogs([]))
  }, [])

  useEffect(load, [load])

  const active = templates.find((t) => t.key === activeKey) ?? null

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
    const url = window.prompt(
      kind === 'drive'
        ? 'URL del documento de Drive (la referencia, no el binario):'
        : 'URL del enlace:',
    )
    if (url && /^https?:\/\//i.test(url)) exec('createLink', url)
  }

  function insertImage() {
    const url = window.prompt('URL de la imagen (https://…):')
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
        await createEmailTemplate({ key: activeKey, ...payload })
      }
      setNotice('Plantilla guardada.')
      load()
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo guardar la plantilla.'))
    } finally {
      setSaving(false)
    }
  }

  async function handlePreview() {
    if (!active) return
    try {
      setPreview(await previewEmailTemplate(active.id))
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo previsualizar.'))
    }
  }

  async function handleTest() {
    if (!active) return
    try {
      const result = await sendTestEmail(active.id)
      setNotice(`Prueba enviada a ${result.sent_to}.`)
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo enviar la prueba.'))
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
      setError(asErrorMessage(err, 'No se pudo guardar la firma.'))
    }
  }

  return (
    <div>
      <PageHeader
        title="Plantillas de correo"
        subtitle="Respuestas genéricas de los avisos: seguro → empresa de renting, km → conductor. Texto enriquecido, firmas, imágenes y documentos."
      />

      {error && <div role="alert" className="form-error">{error}</div>}
      {notice && <p role="status" className="muted">{notice}</p>}

      <div className="chips-row catalog-tabs">
        {TEMPLATE_KEYS.map(({ key, label }) => (
          <TabButton key={key} active={activeKey === key} onClick={() => setActiveKey(key)}>
            {label} {templates.some((t) => t.key === key) ? '' : '·  sin definir'}
          </TabButton>
        ))}
      </div>

      <section className="card">
        <TextInputField
          label="Asunto (admite variables, p. ej. {{matricula}})"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />

        {/* Barra de herramientas del editor propio */}
        <div className="editor-toolbar" role="toolbar" aria-label="Formato del texto">
          <button type="button" title="Negrita" onClick={() => exec('bold')}><Bold size={15} /></button>
          <button type="button" title="Cursiva" onClick={() => exec('italic')}><Italic size={15} /></button>
          <button type="button" title="Subrayado" onClick={() => exec('underline')}><Underline size={15} /></button>
          <button type="button" title="Encabezado" onClick={() => exec('formatBlock', 'h2')}><Heading2 size={15} /></button>
          <button type="button" title="Lista" onClick={() => exec('insertUnorderedList')}><List size={15} /></button>
          <button type="button" title="Lista numerada" onClick={() => exec('insertOrderedList')}><ListOrdered size={15} /></button>
          <button type="button" title="Enlace" onClick={() => insertLink('link')}><Link2 size={15} /></button>
          <button type="button" title="Imagen (URL)" onClick={insertImage}><Image size={15} /></button>
          <button type="button" className="editor-drive" title="Insertar enlace de un documento de Drive" onClick={() => insertLink('drive')}>
            Drive
          </button>
          <SelectField
            aria-label="Insertar variable"
            containerClassName="editor-var"
            options={[
              { value: '', label: 'Insertar variable…' },
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
          aria-label="Cuerpo del correo"
          suppressContentEditableWarning
        />

        <div className="editor-footer">
          <SelectField
            label="Firma"
            options={[
              { value: '', label: '— Sin firma —' },
              ...signatures.map((s) => ({ value: String(s.id), label: s.name })),
            ]}
            value={signatureId}
            onValueChange={setSignatureId}
          />
          <div className="editor-actions">
            <Button variant="secondary" onClick={() => openSignature(null)}>
              Nueva firma
            </Button>
            {signatureId && (
              <Button
                variant="secondary"
                onClick={() =>
                  openSignature(signatures.find((s) => String(s.id) === signatureId) ?? null)
                }
              >
                Editar firma
              </Button>
            )}
            <Button variant="secondary" disabled={!active} onClick={handlePreview}>
              Previsualizar
            </Button>
            <Button variant="secondary" disabled={!active} onClick={handleTest}>
              Enviar prueba a mi correo
            </Button>
            <Button variant="primary" disabled={saving || !subject.trim()} onClick={handleSave}>
              {saving ? 'Guardando…' : 'Guardar plantilla'}
            </Button>
          </div>
        </div>
        <p className="muted">
          El HTML se sanea en servidor al guardar. Variables disponibles:{' '}
          {VARIABLES.map((v) => `{{${v}}}`).join(' · ')}
        </p>
      </section>

      {/* Últimos envíos (traza de soporte, EmailLog) */}
      <section className="card">
        <h3>Últimos envíos</h3>
        {logs.length === 0 ? (
          <p className="muted">Sin envíos registrados todavía.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Destinatario</th>
                <th scope="col">Asunto</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{fmtDate(log.created_at, language)}</td>
                  <td>{log.recipient || '—'}</td>
                  <td>{log.subject || '—'}</td>
                  <td>
                    <Badge
                      tone={
                        log.status === 'sent'
                          ? 'success'
                          : log.status === 'failed'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {log.status_display}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Previsualización con datos de ejemplo (HTML ya saneado en servidor) */}
      <Modal open={preview !== null} title="Previsualización" onClose={() => setPreview(null)} wide>
        {preview && (
          <div className="email-preview">
            <p className="muted">Asunto: <strong>{preview.subject}</strong></p>
            <Panel>
              <div dangerouslySetInnerHTML={{ __html: preview.body_html }} />
            </Panel>
          </div>
        )}
      </Modal>

      {/* Alta/edición de firma */}
      <Modal
        open={signatureModal}
        title={editingSignature ? `Editar firma · ${editingSignature.name}` : 'Nueva firma'}
        onClose={() => setSignatureModal(false)}
      >
        <div className="modal-form">
          <TextInputField
            label="Nombre"
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
            aria-label="Contenido de la firma"
            suppressContentEditableWarning
          />
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setSignatureModal(false)}>
              Cancelar
            </Button>
            <Button type="button" variant="primary" disabled={!signatureName.trim()} onClick={saveSignature}>
              Guardar firma
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
