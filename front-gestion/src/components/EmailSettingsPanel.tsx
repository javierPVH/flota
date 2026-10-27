/**
 * Ajustes → Correo: las dos pestañas de configuración que no son plantillas.
 *
 * - **Recordatorio de km** (`section="reminder"`): cómo se fijan los días en
 *   que se reclama la lectura —un conmutador entre el **plazo** del mes (del
 *   día X al Y) con la **cadencia** con la que se escribe al conductor
 *   (todos los días, pares, impares o un número de correos repartidos) y una
 *   lista de **días concretos** («5, 20, 28», los mismos cada mes; el día
 *   que un mes no tiene no manda nada ese mes, y el calendario lo dice), con
 *   la que la cadencia se apaga porque sale un correo cada día de la lista—,
 *   con el **calendario
 *   que resulta** —calculado en cliente mientras se teclea,
 *   `kmRemindSchedule.ts`, espejo del back— y, en la otra vista, el correo
 *   que saldrá: la plantilla **personalizada** si la hay o la **genérica**
 *   del tipo.
 * - **Aspecto del correo** (`section="layout"`): la caja corporativa que
 *   envuelve TODOS los correos —logotipo, color, nombre y pie— con la vista
 *   previa de cualquier plantilla dentro de ella, personalizada o genérica.
 *
 * La vista previa es el documento ENTERO que devuelve el back
 * (`document_html`, con el logotipo embebido) pintado en un iframe: es lo que
 * verá quien lo reciba, no una aproximación del navegador.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Panel, SelectField, TextAreaField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang } from '@flota/ui/i18n'

import {
  type EmailPreview,
  type EmailSettingsRow,
  type EmailTemplateDefault,
  type EmailTemplateRow,
  type KmRemindByValue,
  type KmRemindModeValue,
  getEmailSettings,
  previewDefaultEmailTemplate,
  previewEmailTemplate,
  previewEmailDraft,
  updateEmailSettings,
} from '../api.ts'
import { fmtDate } from '../format.ts'
import {
  daysInMonth,
  maxEmails,
  missingRemindDays,
  parseRemindDays,
  remindPeriod,
  remindSchedule,
  same,
  toIso,
  todayDay,
  windowDays as windowDaysOf,
  type Day,
  type KmRemindConfig,
} from '../kmRemindSchedule.ts'
import { useEmailSettingsCopy } from '../translations/emailSettings.ts'
import { useEmailTemplatesCopy } from '../translations/emailTemplates.ts'

type Section = 'reminder' | 'layout'
/** Las dos vistas del recordatorio: cuándo se avisa y qué correo sale. */
type ReminderView = 'schedule' | 'email'

const KM_TEMPLATE_KEY = 'km_reading_pending'

/** Lo que admite la caja de días concretos: cifras, comas y espacios. Un
 * punto o un punto y coma —el separador que se teclea por costumbre— se
 * vuelve coma, y cualquier otro carácter no entra (tampoco pegado). */
const cleanDaysText = (text: string) => text.replace(/[.;]/g, ',').replace(/[^\d,\s]/g, '')
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
  const [reminderView, setReminderView] = useState<ReminderView>('schedule')
  const [kmEnabled, setKmEnabled] = useState(true)
  const [by, setBy] = useState<KmRemindByValue>('window')
  const [daysText, setDaysText] = useState('')
  // La última lista de días que valía: mientras lo tecleado no vale, el
  // calendario la sigue enseñando en vez de caer al plazo.
  const [validDays, setValidDays] = useState<number[]>([])
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
    setKmEnabled(data.km_remind_enabled)
    setBy(data.km_remind_by)
    setDaysText(data.km_remind_days)
    setValidDays(parseRemindDays(data.km_remind_days).days)
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
    if (section === 'reminder' && reminderView !== 'email') return
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
        req = previewEmailDraft(
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
  }, [previewRef, previewId, templates, lang, row?.updated_at, section, reminderView, layoutKey])

  // --- Calendario en vivo --------------------------------------------------
  // Los días concretos se leen a cada tecla; mientras no valgan, el
  // calendario sigue enseñando los últimos válidos (`validDays`).
  const parsedDays = useMemo(() => parseRemindDays(daysText), [daysText])
  const daysError = by === 'days' ? parsedDays.error : ''
  // Por días sin ninguna lista válida todavía no hay calendario que enseñar.
  const noList = by === 'days' && validDays.length === 0
  const liveCfg = useMemo<KmRemindConfig>(
    () => ({
      by: by === 'days' && validDays.length > 0 ? 'days' : 'window',
      days: validDays,
      fromDay: Number(fromDay) || 1,
      untilDay: Number(untilDay) || 0,
      mode,
      emails: Number(emails) || 1,
    }),
    [by, validDays, fromDay, untilDay, mode, emails],
  )
  const tope = maxEmails(liveCfg.fromDay, liveCfg.untilDay)
  const tooMany = by === 'window' && mode === 'count' && liveCfg.emails > tope
  const cannotSave = tooMany || Boolean(daysError)
  const today = useMemo(() => todayDay(), [])
  // El mes que se enseña: el que se está reclamando hoy, o el actual.
  const [calYear, calMonth] = remindPeriod(today, liveCfg) ?? [today.year, today.month]
  const schedule = useMemo(
    () => (noList ? [] : remindSchedule(calYear, calMonth, liveCfg)),
    [noList, calYear, calMonth, liveCfg],
  )
  // El plazo entero (todos sus días), para sombrearlo en el calendario.
  const windowDays = useMemo(
    () => new Set(noList ? [] : windowDaysOf(calYear, calMonth, liveCfg).map(toIso)),
    [noList, calYear, calMonth, liveCfg],
  )
  // El primer día en que se recuerda, para avisar si es antes de que el
  // conductor pueda registrar (la ventana de campo, N8a).
  const firstRemindDay = liveCfg.by === 'days' ? liveCfg.days[0] : liveCfg.fromDay
  const beforeWindow =
    kmEnabled && !noList && (row?.km_window_start ?? 0) > 0 && firstRemindDay < (row?.km_window_start ?? 0)
  const emailDays = useMemo(() => new Set(schedule.map(toIso)), [schedule])
  // Por días concretos, los de la lista que el mes enseñado no tiene: ahí no
  // sale nada, y hay que decirlo (si no tiene ninguno, ese mes no sale nada).
  const missingDays = missingRemindDays(calYear, calMonth, liveCfg)
  const monthName = new Date(calYear, calMonth - 1, 1).toLocaleDateString(
    lang === 'en' ? 'en-GB' : 'es-ES',
    { month: 'long' },
  )
  const monthLabel = monthName.charAt(0).toUpperCase() + monthName.slice(1)
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
        form.set('km_remind_enabled', kmEnabled ? 'true' : 'false')
        form.set('km_remind_by', by)
        // La lista solo viaja yendo por días: por plazo no se usa, y lo que
        // hubiera a medias no tiene por qué bloquear el guardado.
        if (by === 'days') form.set('km_remind_days', daysText)
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
          <div className="seg-switch es-views" role="tablist" aria-label={t.reminderTab}>
            <button
              type="button"
              role="tab"
              aria-selected={reminderView === 'schedule'}
              className={reminderView === 'schedule' ? 'is-active' : ''}
              onClick={() => setReminderView('schedule')}
            >
              {t.reminder.title}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={reminderView === 'email'}
              className={reminderView === 'email' ? 'is-active' : ''}
              onClick={() => setReminderView('email')}
            >
              {t.reminder.templateTitle}
            </button>
          </div>
          {reminderView === 'schedule' ? (
          <form
            className="es-reminder"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="es-reminder-intro">
              <p className="muted">{t.reminder.intro}</p>
              <label className="baja-toggle es-toggle es-toggle-main">
                <input type="checkbox" checked={kmEnabled} onChange={(e) => setKmEnabled(e.target.checked)} />
                <span>
                  <strong>{t.reminder.enabled}</strong>
                  <span className="muted"> · {kmEnabled ? t.reminder.enabledOn : t.reminder.enabledOff}</span>
                </span>
              </label>

              <fieldset className="es-fieldset" disabled={!kmEnabled}>
                <legend>{t.reminder.byTitle}</legend>
                {/* Por plazo o por días concretos: un conmutador, no dos
                    casillas, porque es una cosa u otra. */}
                <div className="seg-switch es-by" role="radiogroup" aria-label={t.reminder.byTitle}>
                  {(['window', 'days'] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      role="radio"
                      aria-checked={by === opt}
                      className={by === opt ? 'is-active' : ''}
                      onClick={() => setBy(opt)}
                    >
                      {opt === 'window' ? t.reminder.byWindow : t.reminder.byDays}
                    </button>
                  ))}
                </div>
                {by === 'days' ? (
                  <div className="es-days">
                    <TextInputField
                      label={t.reminder.days}
                      value={daysText}
                      placeholder="5, 20, 28"
                      inputMode="numeric"
                      required
                      aria-invalid={Boolean(daysError) || undefined}
                      onChange={(e) => {
                        const limpio = cleanDaysText(e.target.value)
                        setDaysText(limpio)
                        const p = parseRemindDays(limpio)
                        if (!p.error) setValidDays(p.days)
                      }}
                    />
                    <span className={daysError ? 'form-error' : 'muted'}>
                      {daysError === 'order'
                        ? t.reminder.daysErrors.order(parsedDays.day ?? 0, parsedDays.prev ?? 0)
                        : daysError
                          ? t.reminder.daysErrors[daysError]
                          : t.reminder.daysHint}
                    </span>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
              </fieldset>
            </div>

            {/* Con días concretos la cadencia no aplica: la caja entera se
                apaga (sus radios con ella) y dice por qué. */}
            <fieldset className="es-fieldset es-reminder-cadence" disabled={!kmEnabled || by === 'days'}>
              <legend>{t.reminder.cadenceTitle}</legend>
                {by === 'days' && <p className="muted es-cadence-off">{t.reminder.cadenceOff}</p>}
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
            <div className="es-reminder-foot">
              <p className="muted">{t.reminder.stopHint}</p>
              <div className="form-actions">
                <Button type="submit" variant="primary" disabled={saving || cannotSave}>
                  {saving ? t.saving : t.save}
                </Button>
              </div>
            </div>

            <aside
              className={`email-settings-schedule es-reminder-schedule${kmEnabled ? '' : ' is-off'}`}
              aria-live="polite"
            >
              <strong>{t.reminder.scheduleTitle}</strong>
              {!kmEnabled && <Panel tone="warning">{t.reminder.scheduleOff}</Panel>}
              <p className="es-summary">
                {noList
                  ? t.reminder.scheduleNoList
                  : schedule.length === 0
                  ? t.reminder.scheduleNone(monthLabel)
                  : t.reminder.scheduleSummary(
                      schedule.length,
                      fmtDate(toIso(schedule[0]), lang),
                      fmtDate(toIso(schedule[schedule.length - 1]), lang),
                    )}
              </p>
              {schedule.length > 0 && missingDays.length > 0 && (
                <Panel tone="warning">
                  {t.reminder.scheduleMissing(missingDays.join(', '), monthLabel)}
                </Panel>
              )}
              {beforeWindow && <Panel tone="warning">{t.reminder.beforeWindow(row.km_window_start)}</Panel>}
              <div className="es-calendars">{months.map(([y, m]) => calendar(y, m))}</div>
              <ul className="es-legend">
                <li>
                  <i className="is-window" />{' '}
                  {liveCfg.by === 'days' ? t.reminder.scheduleWindowDays : t.reminder.scheduleWindow}
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
          </form>
          ) : (
          <div className="email-settings-template">
            <div className="es-template-head">
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
          )}
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
