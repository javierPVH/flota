import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Modal, PageHeader, Panel, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Bold,
  Heading2,
  Image,
  Info,
  Italic,
  Link2,
  List,
  ListOrdered,
  Underline,
  Users,
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
import { TemplateVars } from '../components/TemplateVars.tsx'
import { useEmailTemplatesCopy } from '../translations/emailTemplates.ts'
import { useDomainLabels } from '../domainLabels.ts'

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
// El nombre en claro y qué trae cada una están en la copia (`t.variables`).

/**
 * N10c — Gestor maestro de plantillas de correo (solo admin).
 * Editor enriquecido propio sobre contentEditable (sin librerías): negrita,
 * cursiva, listas, enlaces, encabezados, imágenes por URL y enlaces de Drive.
 * El HTML se sanea SIEMPRE en servidor (nh3) al guardar.
 */
export function EmailTemplatesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useEmailTemplatesCopy()
  const etiqueta = useDomainLabels()
  const lang = useAppLang()
  const [templates, setTemplates] = useState<EmailTemplateRow[]>([])
  const [signatures, setSignatures] = useState<EmailSignatureRow[]>([])
  const [logs, setLogs] = useState<EmailLogRow[]>([])
  // La pestaña activa: 'logs' (Últimos envíos, primera) o una clave de plantilla.
  const [activeTab, setActiveTab] = useState(LOGS_TAB)
  const [logsSearch, setLogsSearch] = useState('')
  // Cómo se lee la tabla de envíos: orden por fecha y agrupados (por fecha de
  // envío y/o por estado; el que se marca primero va fuera, como en Alertas).
  const [logsSortAsc, setLogsSortAsc] = useState(false)
  const [logsGroupDate, setLogsGroupDate] = useState(false)
  const [logsGroupStatus, setLogsGroupStatus] = useState(false)
  const [logsGroupFirst, setLogsGroupFirst] = useState<'date' | 'status' | null>(null)
  // Un envío puede llevar VARIOS destinatarios (los informes programados van a
  // una lista): la celda enseña el primero y este modal, todos.
  const [logRecipients, setLogRecipients] = useState<EmailLogRow | null>(null)
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
  // Una variable se pega DONDE se estaba escribiendo: el asunto o el cuerpo.
  // El destino se recuerda al enfocar cada uno (el asunto guarda además su
  // <input> para poder insertar en la posición del cursor).
  const [varTarget, setVarTarget] = useState<'subject' | 'body'>('body')
  const subjectRef = useRef<HTMLInputElement | null>(null)
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

  // R3-30: `t` por ref — con `t` en las deps, el botón es/en recargaba
  // plantillas, firmas y últimos envíos (solo pinta el error).
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })

  const load = useCallback(() => {
    listEmailTemplates()
      .then((page) => setTemplates(page.results))
      .catch((err) => setError(asErrorMessage(err, tRef.current.loadTemplatesError)))
    listEmailSignatures()
      .then((page) => setSignatures(page.results))
      .catch(() => setSignatures([]))
    listEmailLogs()
      .then((page) => setLogs(page.results))
      .catch(() => setLogs([]))
  }, [])

  useEffect(load, [load])

  const isLogs = activeTab === LOGS_TAB
  const active = isLogs ? null : (templates.find((tpl) => tpl.key === activeTab) ?? null)

  /** Lo buscado, en trozos: se separan por comas para poder pedir VARIOS
   * destinatarios de una vez. Cada trozo se busca en todo (destinatarios, tipo,
   * asunto y estado) y basta con que case uno: así «sara, ITV» trae los de Sara
   * y los de ITV. */
  const logTerms = useMemo(
    () =>
      logsSearch
        .split(',')
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean),
    [logsSearch],
  )

  /** Los destinatarios de una fila (el back guarda la lista separada por comas). */
  const recipientsOf = useCallback(
    (log: EmailLogRow) =>
      log.recipient
        .split(',')
        .map((addr) => addr.trim())
        .filter(Boolean),
    [],
  )

  /** ¿Esta dirección es la que se está buscando? */
  const isHit = useCallback(
    (addr: string) =>
      logTerms.length > 0 && logTerms.some((term) => addr.toLowerCase().includes(term)),
    [logTerms],
  )

  /** Los destinatarios con los que casan la búsqueda DELANTE: si buscas uno
   * concreto en un envío a diez, no tiene sentido que salga el décimo. */
  const sortedRecipients = useCallback((log: EmailLogRow) => {
    const list = recipientsOf(log)
    if (logTerms.length === 0) return list
    return [...list.filter(isHit), ...list.filter((addr) => !isHit(addr))]
  }, [isHit, logTerms.length, recipientsOf])

  // Últimos envíos filtrados (franja de opciones de la tabla).
  const visibleLogs = useMemo(() => {
    if (logTerms.length === 0) return logs
    return logs.filter((log) => {
      const heno =
        `${log.recipient} ${log.subject} ${etiqueta.emailStatus(log)} ${t.templateKeys[log.template_key] ?? log.template_key}`.toLowerCase()
      return logTerms.some((term) => heno.includes(term))
    })
  }, [logs, logTerms, t, etiqueta])

  // Columnas de la tabla de últimos envíos (mismo estilo que las de vehículos).
  const logColumns = useMemo<Array<TableWithPanelColumn<EmailLogRow>>>(() => [
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
      // Como la descripción de una incidencia: ancho fijo, lo que no cabe se
      // recorta y el botón abre la lista entera. Con la búsqueda puesta, el
      // destinatario que casa va delante y en verde.
      key: 'recipient',
      label: t.logColumns.recipient,
      width: 260,
      getValue: (log) => log.recipient,
      render: (log) => {
        const lista = sortedRecipients(log)
        if (lista.length === 0) return '—'
        return (
          <div className="rcpt-cell">
            <span className={`rcpt-main${isHit(lista[0]) ? ' rcpt-hit' : ''}`}>{lista[0]}</span>
            {/* Con uno solo no hay nada que abrir: la celda ya lo dice entero
                (y el title de la celda lo enseña si no cabe). */}
            {lista.length > 1 && (
              <button
                type="button"
                className="rcpt-more"
                title={t.logsRecipientsTitle}
                aria-label={`${t.logsRecipientsTitle} (${t.logsRecipientsCount(lista.length)})`}
                onClick={() => setLogRecipients(log)}
              >
                <Users size={13} aria-hidden />
                {t.logsRecipientsMore(lista.length - 1)}
              </button>
            )}
          </div>
        )
      },
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
      getValue: (log) => etiqueta.emailStatus(log),
      render: (log) => (
        <Badge
          tone={log.status === 'sent' ? 'success' : log.status === 'failed' ? 'danger' : 'neutral'}
        >
          {etiqueta.emailStatus(log)}
        </Badge>
      ),
    },
  ], [isHit, lang, sortedRecipients, t, etiqueta])

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

  /** Marca o desmarca un agrupado de la tabla de envíos recordando en qué
   * orden se pidieron: el primero va fuera y el otro parte cada bloque. */
  function cambiarGrupoLogs(cual: 'date' | 'status', activo: boolean) {
    const otroActivo = cual === 'date' ? logsGroupStatus : logsGroupDate
    const otro = cual === 'date' ? 'status' : 'date'
    if (cual === 'date') setLogsGroupDate(activo)
    else setLogsGroupStatus(activo)
    if (activo) {
      if (!otroActivo) setLogsGroupFirst(cual)
    } else {
      setLogsGroupFirst(otroActivo ? otro : null)
    }
  }

  /** Comando del editor (contentEditable). El saneado real es del servidor. */
  function exec(command: string, value?: string) {
    bodyRef.current?.focus()
    document.execCommand(command, false, value)
    syncBody()
  }

  /** Pega `{{nombre}}` en el asunto, justo donde estaba el cursor. */
  function insertInSubject(name: string) {
    const input = subjectRef.current
    const texto = editLang === 'es' ? subject : subjectEn
    const desde = input?.selectionStart ?? texto.length
    const hasta = input?.selectionEnd ?? texto.length
    const trozo = `{{${name}}}`
    const nuevo = `${texto.slice(0, desde)}${trozo}${texto.slice(hasta)}`
    if (editLang === 'es') setSubject(nuevo)
    else setSubjectEn(nuevo)
    setDirty(true)
    // El cursor se queda tras lo pegado, listo para seguir escribiendo.
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(desde + trozo.length, desde + trozo.length)
    })
  }

  function insertVariable(name: string) {
    if (varTarget === 'subject') insertInSubject(name)
    else exec('insertText', `{{${name}}}`)
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
          >
            {/* Cómo se lee la tabla: orden por fecha y los dos agrupados. */}
            <div className="filter-toggles">
              <button
                type="button"
                className="baja-toggle"
                title={t.logsSortTitle}
                onClick={() => setLogsSortAsc((v) => !v)}
              >
                {logsSortAsc ? (
                  <ArrowUpNarrowWide size={14} aria-hidden />
                ) : (
                  <ArrowDownWideNarrow size={14} aria-hidden />
                )}{' '}
                {logsSortAsc ? t.logsSortAsc : t.logsSortDesc}
              </button>
              <label className="baja-toggle">
                <input
                  type="checkbox"
                  checked={logsGroupDate}
                  onChange={(e) => cambiarGrupoLogs('date', e.target.checked)}
                />
                {t.logsGroupDate}
              </label>
              <label className="baja-toggle">
                <input
                  type="checkbox"
                  checked={logsGroupStatus}
                  onChange={(e) => cambiarGrupoLogs('status', e.target.checked)}
                />
                {t.logsGroupStatus}
              </label>
            </div>
          </TableInfoBar>
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
            // Ordena y agrupa por la fecha de envío; el estado agrupa por su
            // valor. Con los dos puestos, fuera va el que se marcó primero.
            monthSortDateColumnKey="created_at"
            monthSortDirectionDefault={logsSortAsc ? 'asc' : 'desc'}
            groupRowsByYearMonth={logsGroupDate}
            groupRowsByColumnKey={logsGroupStatus ? 'status' : undefined}
            groupValueFirst={logsGroupFirst === 'status'}
            // El sentido del orden es estado interno de la tabla: se siembra al
            // montar, así que cambiarlo obliga a remontarla.
            key={`${logsSortAsc ? 'asc' : 'desc'}-${logsGroupFirst ?? ''}`}
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
            onFocus={(e) => {
              subjectRef.current = e.currentTarget
              setVarTarget('subject')
            }}
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
            onFocus={(e) => {
              subjectRef.current = e.currentTarget
              setVarTarget('subject')
            }}
            onChange={(e) => {
              setSubjectEn(e.target.value)
              setDirty(true)
            }}
          />
        )}

        {/* Las variables, con su nombre en claro: se pulsan y se pegan donde
            se estaba escribiendo. Antes eran un desplegable de la barra del
            editor, que solo servía para el cuerpo y no decía qué traía cada
            una (el asunto había que teclearlo a mano: «· {{matricula}}»). La
            misma tira sale en el modal de envío del vehículo. */}
        <TemplateVars
          onInsert={insertVariable}
          targetLabel={varTarget === 'subject' ? t.variablesTarget.subject : t.variablesTarget.body}
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
        </div>

        <div
          ref={bodyRef}
          className="editor-body"
          contentEditable
          onFocus={() => setVarTarget('body')}
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
        <p className="muted">{t.sanitizeHint}</p>
      </section>
      )}

      {/* Todos los destinatarios de un envío (la celda solo enseña el primero) */}
      <Modal
        open={logRecipients !== null}
        title={t.logColumns.recipient}
        onClose={() => setLogRecipients(null)}
      >
        {logRecipients && (
          <div>
            <p className="muted">
              {t.logsRecipientsCount(recipientsOf(logRecipients).length)} · {logRecipients.subject}
            </p>
            <ul className="rcpt-list">
              {sortedRecipients(logRecipients).map((addr) => (
                <li key={addr} className={isHit(addr) ? 'rcpt-hit' : undefined}>
                  {addr}
                  {isHit(addr) && <span className="rcpt-tag">{t.logsRecipientsMatch}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>

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
