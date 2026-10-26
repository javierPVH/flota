/**
 * Ajustes → Correo: las dos pestañas de configuración que no son plantillas.
 *
 * - **Recordatorio de km** (`section="reminder"`): en qué días del mes se
 *   reclama la lectura y cuántos correos recibe el conductor en ese plazo,
 *   con el calendario que resulta para el mes en curso y la vista previa
 *   del correo que saldrá.
 * - **Aspecto del correo** (`section="layout"`): la caja corporativa que
 *   envuelve TODOS los correos —logotipo, color, nombre y pie— con la vista
 *   previa de una plantilla cualquiera dentro de ella.
 *
 * La vista previa es el documento ENTERO que devuelve el back
 * (`document_html`, con el logotipo embebido) pintado en un iframe: es lo que
 * verá quien lo reciba, no una aproximación del navegador.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Panel, SelectField, TextAreaField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang } from '@flota/ui/i18n'

import {
  type EmailPreview,
  type EmailSettingsRow,
  type EmailTemplateRow,
  getEmailSettings,
  previewEmailTemplate,
  updateEmailSettings,
} from '../api.ts'
import { fmtDate } from '../format.ts'
import { useEmailSettingsCopy } from '../translations/emailSettings.ts'
import { useEmailTemplatesCopy } from '../translations/emailTemplates.ts'

type Section = 'reminder' | 'layout'

const KM_TEMPLATE_KEY = 'km_reading_pending'

interface Props {
  section: Section
  /** Las plantillas definidas: de ahí sale la que se previsualiza. */
  templates: EmailTemplateRow[]
  /** Ir a la pestaña de una plantilla (para «Editar la plantilla»). */
  onEditTemplate: (key: string) => void
}

export function EmailSettingsPanel({ section, templates, onEditTemplate }: Props) {
  const t = useEmailSettingsCopy()
  const tt = useEmailTemplatesCopy()
  // La copia, por ref: los efectos no dependen del idioma.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const lang = useAppLang()
  const [row, setRow] = useState<EmailSettingsRow | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  // Lo editable, como texto (es un formulario).
  const [fromDay, setFromDay] = useState('20')
  const [untilDay, setUntilDay] = useState('5')
  const [emails, setEmails] = useState('2')
  const [enabled, setEnabled] = useState(true)
  const [brandName, setBrandName] = useState('')
  const [brandColor, setBrandColor] = useState('#009491')
  const [footer, setFooter] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoClear, setLogoClear] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Vista previa.
  const kmTemplate = useMemo(() => templates.find((tpl) => tpl.key === KM_TEMPLATE_KEY) ?? null, [templates])
  // La elegida en «Aspecto»; en el recordatorio siempre es la de km.
  const [chosenKey, setChosenKey] = useState<string>('')
  const previewKey = useMemo(() => {
    if (section === 'reminder') return kmTemplate ? KM_TEMPLATE_KEY : ''
    if (chosenKey && templates.some((tpl) => tpl.key === chosenKey)) return chosenKey
    return kmTemplate ? KM_TEMPLATE_KEY : (templates[0]?.key ?? '')
  }, [section, chosenKey, kmTemplate, templates])
  // La vista previa se guarda con la clave que la pidió: si la clave cambia,
  // la anterior no se enseña mientras llega la nueva.
  const [previewFor, setPreviewFor] = useState<{ key: string; data: EmailPreview | null; error: string }>({
    key: '',
    data: null,
    error: '',
  })
  const preview = previewFor.key === previewKey ? previewFor.data : null
  const previewError = previewFor.key === previewKey ? previewFor.error : ''

  /** Vuelca una fila del back en el formulario. */
  const applyRow = useCallback((data: EmailSettingsRow) => {
    setRow(data)
    setFromDay(String(data.km_remind_from_day))
    setUntilDay(String(data.km_remind_until_day))
    setEmails(String(data.km_remind_emails))
    setEnabled(data.layout_enabled)
    setBrandName(data.brand_name)
    setBrandColor(data.brand_color)
    setFooter(data.footer_text)
    setLogoFile(null)
    setLogoClear(false)
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  useEffect(() => {
    let alive = true
    getEmailSettings()
      .then((data) => {
        if (alive) applyRow(data)
      })
      .catch((err) => {
        if (alive) setError(asErrorMessage(err, tRef.current.loadError))
      })
    return () => {
      alive = false
    }
  }, [applyRow])

  // La vista previa se pide al back cada vez que cambia la plantilla elegida o
  // se guardan los ajustes (`row.updated_at`): es él quien la maqueta.
  useEffect(() => {
    const tpl = templates.find((x) => x.key === previewKey)
    if (!tpl) return
    let cancelled = false
    previewEmailTemplate(tpl.id, lang === 'en' && tpl.has_en ? 'en' : 'es')
      .then((data) => {
        if (!cancelled) setPreviewFor({ key: tpl.key, data, error: '' })
      })
      .catch((err) => {
        if (!cancelled)
          setPreviewFor({ key: tpl.key, data: null, error: asErrorMessage(err, tRef.current.previewError) })
      })
    return () => {
      cancelled = true
    }
  }, [previewKey, templates, lang, row?.updated_at])

  async function save() {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const form = new FormData()
      if (section === 'reminder') {
        form.set('km_remind_from_day', fromDay)
        form.set('km_remind_until_day', untilDay)
        form.set('km_remind_emails', emails)
      } else {
        form.set('layout_enabled', enabled ? 'true' : 'false')
        form.set('brand_name', brandName)
        form.set('brand_color', brandColor)
        form.set('footer_text', footer)
        if (logoFile) form.set('logo', logoFile)
        else if (logoClear) form.set('logo_clear', '1')
      }
      applyRow(await updateEmailSettings(form))
      setNotice(t.saved)
    } catch (err) {
      setError(asErrorMessage(err, t.loadError))
    } finally {
      setSaving(false)
    }
  }

  if (!row) {
    return (
      <section className="card">
        {error ? <div role="alert" className="form-error">{error}</div> : <p className="muted">{t.loading}</p>}
      </section>
    )
  }

  const previewBlock = (title: string) => (
    <div className="email-settings-preview">
      <h3>{title}</h3>
      {section === 'reminder' && !kmTemplate && <Panel tone="warning">{t.reminder.previewMissing}</Panel>}
      {previewError && <div role="alert" className="form-error">{previewError}</div>}
      {preview ? (
        <>
          <p className="muted">
            {tt.previewSubject} <strong>{preview.subject}</strong>
          </p>
          <iframe
            className="email-settings-frame"
            title={title}
            sandbox=""
            srcDoc={preview.document_html}
          />
        </>
      ) : (
        !previewError && previewKey && <p className="muted">{t.loading}</p>
      )}
    </div>
  )

  return (
    <section className="card email-settings">
      {error && <div role="alert" className="form-error">{error}</div>}
      {notice && <p role="status" className="muted">{notice}</p>}

      {section === 'reminder' ? (
        <div className="email-settings-grid">
          <form
            className="email-settings-form"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <h3>{t.reminder.title}</h3>
            <p className="muted">{t.reminder.intro}</p>
            <TextInputField
              label={t.reminder.fromDay}
              type="number"
              min={1}
              max={28}
              required
              value={fromDay}
              onChange={(e) => setFromDay(e.target.value)}
            />
            <p className="muted field-hint">{t.reminder.fromDayHint}</p>
            <TextInputField
              label={t.reminder.untilDay}
              type="number"
              min={0}
              max={28}
              required
              value={untilDay}
              onChange={(e) => setUntilDay(e.target.value)}
            />
            <p className="muted field-hint">{t.reminder.untilDayHint}</p>
            <TextInputField
              label={t.reminder.emails}
              type="number"
              min={1}
              max={6}
              required
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
            />
            <p className="muted field-hint">{t.reminder.emailsHint}</p>
            <div className="email-settings-schedule">
              <strong>{t.reminder.scheduleTitle}</strong>
              <ol>
                {row.km_remind_dates.map((d) => (
                  <li key={d}>{fmtDate(d, lang)}</li>
                ))}
              </ol>
              {row.km_remind_dates.length === 1 && Number(emails) > 1 && (
                <p className="muted">{t.reminder.scheduleEmpty}</p>
              )}
            </div>
            <p className="muted">{t.reminder.variablesHint}</p>
            <div className="form-actions">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? t.saving : t.save}
              </Button>
              {kmTemplate && (
                <Button type="button" variant="secondary" onClick={() => onEditTemplate(KM_TEMPLATE_KEY)}>
                  {t.reminder.editTemplate}
                </Button>
              )}
            </div>
          </form>
          {previewBlock(t.reminder.previewTitle)}
        </div>
      ) : (
        <div className="email-settings-grid">
          <form
            className="email-settings-form"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <h3>{t.layout.title}</h3>
            <p className="muted">{t.layout.intro}</p>
            <label className="baja-toggle">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              {t.layout.enabled}
            </label>
            <p className="muted">{t.layout.enabledHint}</p>
            <TextInputField
              label={t.layout.brandName}
              value={brandName}
              maxLength={80}
              required
              onChange={(e) => setBrandName(e.target.value)}
            />
            <div className="email-settings-color">
              <TextInputField
                label={t.layout.brandColor}
                value={brandColor}
                pattern="#[0-9a-fA-F]{6}"
                required
                onChange={(e) => setBrandColor(e.target.value)}
              />
              <p className="muted field-hint">{t.layout.brandColorHint}</p>
              <input
                type="color"
                aria-label={t.layout.brandColor}
                value={/^#[0-9a-fA-F]{6}$/.test(brandColor) ? brandColor : '#009491'}
                onChange={(e) => setBrandColor(e.target.value)}
              />
            </div>
            <TextAreaField
              label={t.layout.footer}
              value={footer}
              rows={3}
              maxLength={1000}
              onChange={(e) => setFooter(e.target.value)}
            />
            <p className="muted field-hint">{t.layout.footerHint}</p>
            <div className="email-settings-logo">
              <strong>{t.layout.logo}</strong>
              <img
                src={logoFile ? URL.createObjectURL(logoFile) : row.logo_data_url}
                alt={t.layout.logo}
                className={logoClear ? 'is-cleared' : undefined}
              />
              <p className="muted">
                {row.has_custom_logo && !logoClear ? t.layout.logoCustom : t.layout.logoFactory} · {t.layout.logoHint}
              </p>
              <div className="form-actions">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  aria-label={t.layout.logoChoose}
                  onChange={(e) => {
                    setLogoFile(e.target.files?.[0] ?? null)
                    setLogoClear(false)
                  }}
                />
                {row.has_custom_logo && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setLogoClear(true)
                      setLogoFile(null)
                      if (fileRef.current) fileRef.current.value = ''
                    }}
                  >
                    {t.layout.logoDefault}
                  </Button>
                )}
              </div>
            </div>
            <div className="form-actions">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? t.saving : t.save}
              </Button>
            </div>
          </form>
          <div>
            {templates.length > 0 ? (
              <SelectField
                label={t.layout.previewTemplate}
                aria-label={t.layout.previewTemplate}
                value={previewKey}
                onChange={(e) => setChosenKey(e.target.value)}
                options={templates.map((tpl) => ({
                  value: tpl.key,
                  label: tt.templateKeys[tpl.key as keyof typeof tt.templateKeys] ?? tpl.key_display,
                }))}
              />
            ) : (
              <p className="muted">{t.layout.previewEmpty}</p>
            )}
            {previewBlock(t.layout.previewTitle)}
          </div>
        </div>
      )}
    </section>
  )
}
