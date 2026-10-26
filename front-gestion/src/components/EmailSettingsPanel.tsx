/**
 * Ajustes → Correo: las dos pestañas de configuración que no son plantillas.
 *
 * - **Recordatorio de km** (`section="reminder"`): el plazo del mes en que se
 *   reclama la lectura y la **cadencia** con la que se escribe al conductor
 *   (todos los días, pares, impares o un número de correos repartidos), con
 *   el **calendario que resulta** —calculado en cliente mientras se teclea,
 *   `kmRemindSchedule.ts`, espejo del back— y, debajo, el correo que saldrá:
 *   la plantilla **personalizada** si la hay o la **genérica** del tipo.
 * - **Aspecto del correo** (`section="layout"`): la caja corporativa que
 *   envuelve TODOS los correos —logotipo, color, nombre y pie— con la vista
 *   previa de cualquier plantilla dentro de ella, personalizada o genérica.
 *
 * La vista previa es el documento ENTERO que devuelve el back
 * (`document_html`, con el logotipo embebido) pintado en un iframe: es lo que
 * verá quien lo reciba, no una aproximación del navegador.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, SelectField, TextAreaField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang } from '@flota/ui/i18n'

import {
  type EmailPreview,
  type EmailSettingsRow,
  type EmailTemplateDefault,
  type EmailTemplateRow,
  type KmRemindModeValue,
  getEmailSettings,
  previewDefaultEmailTemplate,
  previewEmailTemplate,
  previewEmailWithLayout,
  updateEmailSettings,
} from '../api.ts'
import { fmtDate } from '../format.ts'
import {
  daysInMonth,
  maxEmails,
  remindPeriod,
  remindSchedule,
  same,
  toIso,
  todayDay,
  type Day,
  type KmRemindConfig,
} from '../kmRemindSchedule.ts'
import { useEmailSettingsCopy } from '../translations/emailSettings.ts'
import { useEmailTemplatesCopy } from '../translations/emailTemplates.ts'

type Section = 'reminder' | 'layout'

const KM_TEMPLATE_KEY = 'km_reading_pending'
const MODES: KmRemindModeValue[] = ['count', 'daily', 'odd', 'even']

interface Props {
  section: Section
  /** Las plantillas PERSONALIZADAS (filas del back). */
  templates: EmailTemplateRow[]
  /** Las genéricas de cada tipo: lo que sale cuando no hay personalizada. */
  defaults: EmailTemplateDefault[]
  /** Ir a la pestaña de una plantilla (para editarla o personalizarla). */
  onEditTemplate: (key: string) => void
}

/** Qué se previsualiza: una personalizada (por id) o la genérica de un tipo. */
type PreviewRef = { kind: 'custom'; id: number; key: string } | { kind: 'default'; key: string } | null

export function EmailSettingsPanel({ section, templates, defaults, onEditTemplate }: Props) {
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
  const [mode, setMode] = useState<KmRemindModeValue>('count')
  const [emails, setEmails] = useState('2')
  const [enabled, setEnabled] = useState(true)
  const [brandName, setBrandName] = useState('')
  const [brandColor, setBrandColor] = useState('#009491')
  const [footer, setFooter] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoClear, setLogoClear] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // --- Qué plantilla se previsualiza -------------------------------------
  const customOf = useCallback(
    (key: string) => templates.find((tpl) => tpl.key === key) ?? null,
    [templates],
  )
  const kmTemplate = customOf(KM_TEMPLATE_KEY)
  // Los tipos que se pueden previsualizar en «Aspecto»: todos los que tienen
  // genérica (los seis) y, por si la lista de genéricas no llegó, los
  // personalizados.
  const previewKeys = useMemo(() => {
    const keys = defaults.map((d) => d.key)
    for (const tpl of templates) if (!keys.includes(tpl.key)) keys.push(tpl.key)
    return keys
  }, [defaults, templates])
  const [chosenKey, setChosenKey] = useState<string>('')
  const previewRef = useMemo<PreviewRef>(() => {
    let key = KM_TEMPLATE_KEY
    if (section === 'layout') {
      if (chosenKey && previewKeys.includes(chosenKey)) key = chosenKey
      else if (!previewKeys.includes(KM_TEMPLATE_KEY)) key = previewKeys[0] ?? ''
    }
    if (!key) return null
    const custom = customOf(key)
    if (custom) return { kind: 'custom', id: custom.id, key }
    if (defaults.some((d) => d.key === key)) return { kind: 'default', key }
    return null
  }, [section, chosenKey, previewKeys, customOf, defaults])
  const previewId = previewRef ? `${previewRef.kind}:${previewRef.key}` : ''
  // La vista previa se guarda con la clave que la pidió: si la clave cambia,
  // la anterior no se enseña mientras llega la nueva.
  const [previewFor, setPreviewFor] = useState<{ id: string; data: EmailPreview | null; error: string }>({
    id: '',
    data: null,
    error: '',
  })
  const preview = previewFor.id === previewId ? previewFor.data : null
  const previewError = previewFor.id === previewId ? previewFor.error : ''

  /** Vuelca una fila del back en el formulario. */
  const applyRow = useCallback((data: EmailSettingsRow) => {
    setRow(data)
    setFromDay(String(data.km_remind_from_day))
    setUntilDay(String(data.km_remind_until_day))
    setMode(data.km_remind_mode)
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
  // se guardan los ajustes (`row.updated_at`): es él quien la maqueta. En
  // «Aspecto» va además con lo que se está tecleando (nombre, color, pie,
  // logotipo) SIN guardar, con un respiro de 400 ms entre teclas: lo que se
  // ve es lo que saldría si se guardara ahora.
  const layoutKey = `${enabled}|${brandName}|${brandColor}|${footer}|${logoFile?.name ?? ''}|${logoClear}`
  useEffect(() => {
    if (!previewRef || !row) return
    let cancelled = false
    const custom = previewRef.kind === 'custom' ? templates.find((x) => x.id === previewRef.id) : null
    const wantsEn = lang === 'en' && (previewRef.kind === 'default' || Boolean(custom?.has_en))
    const reqLang = wantsEn ? 'en' : 'es'
    const ask = () => {
      let req: Promise<EmailPreview>
      if (section === 'layout') {
        const form = new FormData()
        form.set('lang', reqLang)
        if (previewRef.kind === 'default') form.set('key', previewRef.key)
        form.set('layout_enabled', enabled ? 'true' : 'false')
        form.set('brand_name', brandName)
        form.set('brand_color', brandColor)
        form.set('footer_text', footer)
        if (logoFile) form.set('logo', logoFile)
        else if (logoClear) form.set('logo_clear', '1')
        req = previewEmailWithLayout(
          previewRef.kind === 'custom' ? { id: previewRef.id } : { key: previewRef.key },
          form,
        )
      } else {
        req =
          previewRef.kind === 'custom'
            ? previewEmailTemplate(previewRef.id, reqLang)
            : previewDefaultEmailTemplate(previewRef.key, reqLang)
      }
      req
        .then((data) => {
          if (!cancelled) setPreviewFor({ id: previewId, data, error: '' })
        })
        .catch((err) => {
          if (!cancelled)
            setPreviewFor({ id: previewId, data: null, error: asErrorMessage(err, tRef.current.previewError) })
        })
    }
    const timer = section === 'layout' ? window.setTimeout(ask, 400) : null
    if (timer === null) ask()
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
    // `layoutKey` resume lo tecleado en «Aspecto»; las piezas sueltas se leen
    // dentro, al pedirla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewRef, previewId, templates, lang, row?.updated_at, section, layoutKey])

  // --- Calendario en vivo --------------------------------------------------
  const liveCfg = useMemo<KmRemindConfig>(
    () => ({
      fromDay: Number(fromDay) || 1,
      untilDay: Number(untilDay) || 0,
      mode,
      emails: Number(emails) || 1,
    }),
    [fromDay, untilDay, mode, emails],
  )
  const tope = maxEmails(liveCfg.fromDay, liveCfg.untilDay)
  const tooMany = mode === 'count' && liveCfg.emails > tope
  const today = useMemo(() => todayDay(), [])
  // El mes que se enseña: el que se está reclamando hoy, o el actual.
  const [calYear, calMonth] = remindPeriod(today, liveCfg) ?? [today.year, today.month]
  const schedule = useMemo(() => remindSchedule(calYear, calMonth, liveCfg), [calYear, calMonth, liveCfg])
  // El plazo entero (todos sus días), para sombrearlo en el calendario.
  const windowDays = useMemo(
    () => new Set(remindSchedule(calYear, calMonth, { ...liveCfg, mode: 'daily' }).map(toIso)),
    [calYear, calMonth, liveCfg],
  )
  const emailDays = useMemo(() => new Set(schedule.map(toIso)), [schedule])
  // Los meses que cubre el plazo: el del periodo y, con cola, el siguiente.
  const months = useMemo<Array<[number, number]>>(() => {
    const out: Array<[number, number]> = [[calYear, calMonth]]
    const windowEnd = [...windowDays].sort().pop() ?? ''
    if (windowEnd && Number(windowEnd.slice(5, 7)) !== calMonth) {
      out.push(calMonth === 12 ? [calYear + 1, 1] : [calYear, calMonth + 1])
    }
    return out
  }, [calYear, calMonth, windowDays])

  async function save() {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const form = new FormData()
      if (section === 'reminder') {
        form.set('km_remind_from_day', fromDay)
        form.set('km_remind_until_day', untilDay)
        form.set('km_remind_mode', mode)
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

  const templateLabel = (key: string) =>
    tt.templateKeys[key] ?? defaults.find((d) => d.key === key)?.key_display ?? key

  const previewFrame = (title: string) => (
    <div className="email-settings-preview">
      {previewError && <div role="alert" className="form-error">{previewError}</div>}
      {preview ? (
        <>
          <p className="muted">
            {tt.previewSubject} <strong>{preview.subject}</strong>
          </p>
          <iframe className="email-settings-frame" title={title} sandbox="" srcDoc={preview.document_html} />
        </>
      ) : (
        !previewError && previewId && <p className="muted">{t.loading}</p>
      )}
    </div>
  )

  const weekdays = weekdayNames(lang)

  /** Un mes del calendario: el plazo sombreado y los días con correo marcados. */
  const calendar = (year: number, month: number) => {
    const first = new Date(year, month - 1, 1)
    const offset = (first.getDay() + 6) % 7 // lunes = 0
    const total = daysInMonth(year, month)
    const cells: Array<Day | null> = []
    for (let i = 0; i < offset; i += 1) cells.push(null)
    for (let d = 1; d <= total; d += 1) cells.push({ year, month, day: d })
    while (cells.length % 7 !== 0) cells.push(null)
    return (
      <table className="es-cal" key={`${year}-${month}`}>
        <caption>
          {first.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { month: 'long', year: 'numeric' })}
        </caption>
        <thead>
          <tr>
            {weekdays.map((w) => (
              <th key={w} scope="col">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: cells.length / 7 }, (_, w) => (
            <tr key={w}>
              {cells.slice(w * 7, w * 7 + 7).map((d, i) => {
                if (!d) return <td key={`out-${i}`} className="is-out" />
                const iso = toIso(d)
                const cls = [
                  windowDays.has(iso) ? 'is-window' : '',
                  emailDays.has(iso) ? 'is-email' : '',
                  same(d, today) ? 'is-today' : '',
                ]
                  .filter(Boolean)
                  .join(' ')
                return (
                  <td
                    key={iso}
                    className={cls || undefined}
                    title={emailDays.has(iso) ? t.reminder.scheduleEmail : undefined}
                  >
                    {d.day}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <section className="card email-settings">
      {error && <div role="alert" className="form-error">{error}</div>}
      {notice && <p role="status" className="muted">{notice}</p>}

      {section === 'reminder' ? (
        <>
          <div className="email-settings-grid is-reminder">
            <form
              className="email-settings-form"
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
            >
              <h3>{t.reminder.title}</h3>
              <p className="muted">{t.reminder.intro}</p>

              <fieldset className="es-fieldset">
                <legend>{t.reminder.windowTitle}</legend>
                <div className="es-window">
                  <span>{t.reminder.fromDay}</span>
                  <TextInputField
                    aria-label={t.reminder.fromDay}
                    type="number"
                    min={1}
                    max={28}
                    required
                    value={fromDay}
                    onChange={(e) => setFromDay(e.target.value)}
                  />
                  <span className="muted">{t.reminder.fromDayHint}</span>
                </div>
                <div className="es-window">
                  <span>{t.reminder.untilDay}</span>
                  <TextInputField
                    aria-label={t.reminder.untilDay}
                    type="number"
                    min={0}
                    max={28}
                    required
                    value={untilDay}
                    onChange={(e) => setUntilDay(e.target.value)}
                  />
                  <span className="muted">{t.reminder.untilDayHint}</span>
                </div>
              </fieldset>

              <fieldset className="es-fieldset">
                <legend>{t.reminder.cadenceTitle}</legend>
                <div className="es-modes" role="radiogroup" aria-label={t.reminder.cadenceTitle}>
                  {MODES.map((m) => (
                    <label key={m} className={`es-mode${mode === m ? ' is-active' : ''}`}>
                      <input
                        type="radio"
                        name="km_remind_mode"
                        value={m}
                        checked={mode === m}
                        onChange={() => setMode(m)}
                      />
                      <span className="es-mode-body">
                        <strong>{t.reminder.modes[m]}</strong>
                        <span className="muted">{t.reminder.modes[`${m}Hint`]}</span>
                        {m === 'count' && (
                          <span className="es-count">
                            <TextInputField
                              aria-label={t.reminder.emails}
                              type="number"
                              min={1}
                              max={tope}
                              required
                              disabled={mode !== 'count'}
                              value={emails}
                              onChange={(e) => setEmails(e.target.value)}
                            />
                            <span className={tooMany ? 'form-error' : 'muted'}>
                              {tooMany ? t.reminder.emailsTooMany(tope) : t.reminder.emailsMax(tope)}
                            </span>
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="muted">{t.reminder.stopHint}</p>
              <div className="form-actions">
                <Button type="submit" variant="primary" disabled={saving || tooMany}>
                  {saving ? t.saving : t.save}
                </Button>
              </div>
            </form>

            <aside className="email-settings-schedule" aria-live="polite">
              <strong>{t.reminder.scheduleTitle}</strong>
              <p className="es-summary">
                {t.reminder.scheduleSummary(
                  schedule.length,
                  fmtDate(toIso(schedule[0]), lang),
                  fmtDate(toIso(schedule[schedule.length - 1]), lang),
                )}
              </p>
              <div className="es-calendars">{months.map(([y, m]) => calendar(y, m))}</div>
              <ul className="es-legend">
                <li>
                  <i className="is-window" /> {t.reminder.scheduleWindow}
                </li>
                <li>
                  <i className="is-email" /> {t.reminder.scheduleEmail}
                </li>
                <li>
                  <i className="is-today" /> {t.reminder.scheduleToday}
                </li>
              </ul>
              <details className="es-dates">
                <summary>
                  {t.reminder.scheduleDates} ({schedule.length})
                </summary>
                <ol>
                  {schedule.map((d) => (
                    <li key={toIso(d)}>{fmtDate(toIso(d), lang)}</li>
                  ))}
                </ol>
              </details>
            </aside>
          </div>

          <div className="email-settings-template">
            <div className="es-template-head">
              <h3>{t.reminder.templateTitle}</h3>
              <Badge tone={kmTemplate ? 'brand' : 'neutral'}>
                {kmTemplate ? t.reminder.customBadge : t.reminder.genericBadge}
              </Badge>
              <span className="muted">{kmTemplate ? t.reminder.usingCustom : t.reminder.usingGeneric}</span>
              <Button type="button" variant="secondary" onClick={() => onEditTemplate(KM_TEMPLATE_KEY)}>
                {kmTemplate ? t.reminder.editTemplate : t.reminder.customise}
              </Button>
            </div>
            <p className="muted field-hint">{t.reminder.variablesHint}</p>
            {previewFrame(t.reminder.templateTitle)}
          </div>
        </>
      ) : (
        <div className="email-settings-grid is-layout">
          <form
            className="email-settings-form"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <h3>{t.layout.title}</h3>
            <p className="muted">{t.layout.intro}</p>
            <label className="baja-toggle es-toggle">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>
                {t.layout.enabled}
                <span className="muted"> · {t.layout.enabledHint}</span>
              </span>
            </label>

            <fieldset className="es-fieldset" disabled={!enabled}>
              <legend>{t.layout.sectionHeader}</legend>
              <div className="es-row">
                <TextInputField
                  label={t.layout.brandName}
                  value={brandName}
                  maxLength={80}
                  required
                  onChange={(e) => setBrandName(e.target.value)}
                />
                <div className="es-color">
                  <span className="es-color-label">{t.layout.brandColor}</span>
                  <div className="es-color-input">
                    <input
                      type="color"
                      aria-label={t.layout.brandColor}
                      value={/^#[0-9a-fA-F]{6}$/.test(brandColor) ? brandColor : '#009491'}
                      onChange={(e) => setBrandColor(e.target.value)}
                    />
                    <TextInputField
                      aria-label={t.layout.brandColorHint}
                      value={brandColor}
                      pattern="#[0-9a-fA-F]{6}"
                      required
                      onChange={(e) => setBrandColor(e.target.value)}
                    />
                  </div>
                  <span className="muted field-hint">{t.layout.brandColorHint}</span>
                </div>
              </div>
            </fieldset>

            <fieldset className="es-fieldset" disabled={!enabled}>
              <legend>{t.layout.sectionLogo}</legend>
              <div className="es-logo">
                <img
                  src={logoFile ? URL.createObjectURL(logoFile) : row.logo_data_url}
                  alt={t.layout.logo}
                  className={logoClear ? 'is-cleared' : undefined}
                />
                <div className="es-logo-ctl">
                  <Badge tone={logoFile ? 'warning' : row.has_custom_logo && !logoClear ? 'brand' : 'neutral'}>
                    {logoFile
                      ? t.layout.logoFile(logoFile.name)
                      : row.has_custom_logo && !logoClear
                        ? t.layout.logoCustom
                        : t.layout.logoFactory}
                  </Badge>
                  <span className="muted field-hint">{t.layout.logoHint}</span>
                  <div className="form-actions">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      aria-label={t.layout.logoChoose}
                      className="es-file"
                      onChange={(e) => {
                        setLogoFile(e.target.files?.[0] ?? null)
                        setLogoClear(false)
                      }}
                    />
                    <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
                      {t.layout.logoChoose}
                    </Button>
                    {(row.has_custom_logo || logoFile) && !logoClear && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setLogoClear(row.has_custom_logo)
                          setLogoFile(null)
                          if (fileRef.current) fileRef.current.value = ''
                        }}
                      >
                        {t.layout.logoDefault}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </fieldset>

            <fieldset className="es-fieldset" disabled={!enabled}>
              <legend>{t.layout.sectionFooter}</legend>
              <TextAreaField
                label={t.layout.footer}
                value={footer}
                rows={3}
                maxLength={1000}
                onChange={(e) => setFooter(e.target.value)}
              />
              <span className="muted field-hint">{t.layout.footerHint}</span>
            </fieldset>

            <div className="form-actions">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? t.saving : t.save}
              </Button>
            </div>
          </form>
          <div className="email-settings-preview-col">
            <div className="es-template-head">
              <h3>{t.layout.previewTitle}</h3>
              <span className="muted">{t.layout.previewLive}</span>
            </div>
            {previewKeys.length > 0 ? (
              <SelectField
                label={t.layout.previewTemplate}
                aria-label={t.layout.previewTemplate}
                value={previewRef?.key ?? ''}
                onChange={(e) => setChosenKey(e.target.value)}
                options={previewKeys.map((key) => ({
                  value: key,
                  label: customOf(key) ? templateLabel(key) : t.layout.previewGeneric(templateLabel(key)),
                }))}
              />
            ) : (
              <p className="muted">{t.layout.previewEmpty}</p>
            )}
            {previewFrame(t.layout.previewTitle)}
          </div>
        </div>
      )}
    </section>
  )
}

/** Lunes…domingo, abreviados en el idioma de la app. */
function weekdayNames(lang: string): string[] {
  const locale = lang === 'en' ? 'en-GB' : 'es-ES'
  // El 5 de enero de 2026 es lunes.
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2026, 0, 5 + i).toLocaleDateString(locale, { weekday: 'short' }).replace('.', ''),
  )
}
