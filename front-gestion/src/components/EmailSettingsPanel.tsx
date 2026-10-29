/**
 * Ajustes → Correo: las pestañas de configuración que no son plantillas.
 *
 * - **Recordatorio de km** (`section="reminder"`) y **de combustible**
 *   (`section="fuel"`), los dos MENSUALES con los mismos mandos —el panel
 *   es uno y lee y guarda los campos por su prefijo (`km_remind_` /
 *   `fuel_remind_`)—: cómo se fijan los días en
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
 * - **Recordatorio de ITV** (`section="itv"`) y **de mantenimiento**
 *   (`section="maintenance"`), los dos POR VENCIMIENTO: los días antes y
 *   después de la fecha límite en que sale correo mientras el aviso siga
 *   abierto, a quién va y, en la otra vista, el correo que saldrá.
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
  deadlineReminderOf,
  getEmailSettings,
  monthlyReminderOf,
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

export type SettingsSection = 'reminder' | 'fuel' | 'itv' | 'maintenance' | 'layout'
type Section = SettingsSection
/** Las dos vistas de un recordatorio: cuándo se avisa y qué correo sale. */
type ReminderView = 'schedule' | 'email'

/** Qué recordatorio enseña cada sección: el prefijo de sus campos en la fila
 * de ajustes, si es mensual o por vencimiento, y la plantilla de su correo. */
const REMINDERS = {
  reminder: { kind: 'km', monthly: true, templateKey: 'km_reading_pending' },
  fuel: { kind: 'fuel', monthly: true, templateKey: 'fuel_reading_pending' },
  itv: { kind: 'itv', monthly: false, templateKey: 'itv_due' },
  maintenance: { kind: 'maintenance', monthly: false, templateKey: 'maintenance_due' },
} as const
type ReminderSection = keyof typeof REMINDERS

/** Lo que admite la caja de días antes/después: cifras, comas y espacios. */
const OFFSET_MAX = 365
/** Lee «30, 15, 7, 1»: números de días sin repetir, dentro del rango; con
 * `allowZero`, el 0 vale (el mismo día). `null` si algo no vale. */
function parseOffsetDays(text: string, allowZero: boolean): number[] | null {
  const piezas = text.split(/[,;\s]+/).filter(Boolean)
  const out = new Set<number>()
  for (const p of piezas) {
    if (!/^\d+$/.test(p)) return null
    const n = Number(p)
    if (n > OFFSET_MAX || (n === 0 && !allowZero)) return null
    out.add(n)
  }
  return [...out]
}

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
  // El recordatorio de la sección (ninguno en «Aspecto»).
  const reminder = section === 'layout' ? null : REMINDERS[section as ReminderSection]
  const isMonthly = reminder?.monthly ?? false
  const isDeadline = reminder !== null && !reminder.monthly
  const kind = reminder?.kind ?? 'km'
  const templateKey = reminder?.templateKey ?? 'km_reading_pending'
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
  // Interruptor del recordatorio de la sección (mensual o por vencimiento).
  const [remEnabled, setRemEnabled] = useState(true)
  const [by, setBy] = useState<KmRemindByValue>('window')
  const [daysText, setDaysText] = useState('')
  // La última lista de días que valía: mientras lo tecleado no vale, el
  // calendario la sigue enseñando en vez de caer al plazo.
  const [validDays, setValidDays] = useState<number[]>([])
  const [fromDay, setFromDay] = useState('20')
  const [untilDay, setUntilDay] = useState('5')
  const [mode, setMode] = useState<KmRemindModeValue>('count')
  const [emails, setEmails] = useState('2')
  // A quién va el recordatorio.
  const [toDriver, setToDriver] = useState(true)
  const [toSupervisor, setToSupervisor] = useState(false)
  const [adminIds, setAdminIds] = useState<number[]>([])
  // Por vencimiento: los días antes y después, como texto.
  const [beforeText, setBeforeText] = useState('')
  const [afterText, setAfterText] = useState('')
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
  const kmTemplate = customOf(templateKey)
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
    let key: string = templateKey
    if (section === 'layout') {
      if (chosenKey && previewKeys.includes(chosenKey)) key = chosenKey
      else if (!previewKeys.includes(templateKey)) key = previewKeys[0] ?? ''
    }
    if (!key) return null
    const custom = customOf(key)
    if (custom) return { kind: 'custom', id: custom.id, key }
    if (defaults.some((d) => d.key === key)) return { kind: 'default', key }
    return null
  }, [section, templateKey, chosenKey, previewKeys, customOf, defaults])
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

  /** Vuelca en el formulario el recordatorio de la sección: los mandos del
   * mensual (km o combustible) o los del de vencimiento (ITV o
   * mantenimiento), leídos de la fila por su prefijo. */
  const applyReminder = useCallback((data: EmailSettingsRow, sec: Section) => {
    const rem = sec === 'layout' ? null : REMINDERS[sec as ReminderSection]
    if (!rem) return
    if (rem.monthly) {
      const m = monthlyReminderOf(data, rem.kind)
      setRemEnabled(m.enabled)
      setBy(m.by)
      setDaysText(m.days)
      setValidDays(parseRemindDays(m.days).days)
      setFromDay(String(m.from_day))
      setUntilDay(String(m.until_day))
      setMode(m.mode)
      setEmails(String(m.emails))
      setToDriver(m.to_driver)
      setToSupervisor(m.to_supervisor)
      setAdminIds(m.admin_ids)
    } else {
      const d = deadlineReminderOf(data, rem.kind)
      setRemEnabled(d.enabled)
      setBeforeText(d.days_before)
      setAfterText(d.days_after)
      setToDriver(d.to_driver)
      setToSupervisor(d.to_supervisor)
      setAdminIds(d.admin_ids)
    }
  }, [])

  /** Vuelca una fila del back en el formulario: la fila y lo de «Aspecto».
   * El recordatorio de la sección lo vuelca el ajuste de abajo, que sigue a
   * la fila Y a la sección (así no se captura aquí una sección vieja). */
  const applyRow = useCallback((data: EmailSettingsRow) => {
    setRow(data)
    setEnabled(data.layout_enabled)
    setBrandName(data.brand_name)
    setBrandColor(data.brand_color)
    setFooter(data.footer_text)
    setLogoFile(null)
    setLogoClear(false)
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  // Los mandos del recordatorio siguen a la FILA (la carga y cada guardado)
  // y a la SECCIÓN (son los mismos campos del formulario para los cuatro):
  // con una fila nueva se vuelca el recordatorio de la pestaña activa y, al
  // cambiar de pestaña, el de la nueva, volviendo a «cuándo». Se ajusta
  // durante el render (el patrón de React para «estado que depende de una
  // prop»), no en un efecto: así no hay un pintado con los mandos de la
  // pestaña anterior.
  const [applied, setApplied] = useState<{ row: EmailSettingsRow | null; section: Section }>({
    row: null,
    section,
  })
  if (applied.row !== row || applied.section !== section) {
    setApplied({ row, section })
    if (row) applyReminder(row, section)
    if (applied.section !== section) setReminderView('schedule')
  }

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
    if (reminder && reminderView !== 'email') return
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
  }, [previewRef, previewId, templates, lang, row?.updated_at, section, reminder, reminderView, layoutKey])

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
  const nobody = !toDriver && !toSupervisor && adminIds.length === 0
  // Por vencimiento: las dos listas leídas a cada tecla.
  const beforeDays = useMemo(() => parseOffsetDays(beforeText, true), [beforeText])
  const afterDays = useMemo(() => parseOffsetDays(afterText, false), [afterText])
  const offsetsError = beforeDays === null || afterDays === null
  const offsetsNone =
    !offsetsError && remEnabled && (beforeDays?.length ?? 0) === 0 && (afterDays?.length ?? 0) === 0
  const cannotSave = isDeadline
    ? offsetsError || offsetsNone || nobody
    : tooMany || Boolean(daysError) || nobody
  const today = useMemo(() => todayDay(), [])
  // Para el ejemplo del recordatorio por vencimiento: una fecha límite a 30 días.
  const exampleDue = useMemo<Day>(() => {
    const d = new Date(today.year, today.month - 1, today.day + 30)
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
  }, [today])
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
  // Solo el de km: la ventana de campo es la del registro de km.
  const beforeWindow =
    kind === 'km' &&
    remEnabled &&
    !noList &&
    (row?.km_window_start ?? 0) > 0 &&
    firstRemindDay < (row?.km_window_start ?? 0)
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
      const p = `${kind}_remind_`
      if (isMonthly) {
        form.set(`${p}enabled`, remEnabled ? 'true' : 'false')
        form.set(`${p}by`, by)
        // La lista solo viaja yendo por días: por plazo no se usa, y lo que
        // hubiera a medias no tiene por qué bloquear el guardado.
        if (by === 'days') form.set(`${p}days`, daysText)
        form.set(`${p}from_day`, fromDay)
        form.set(`${p}until_day`, untilDay)
        form.set(`${p}mode`, mode)
        form.set(`${p}emails`, emails)
        form.set(`${p}to_driver`, toDriver ? 'true' : 'false')
        form.set(`${p}to_supervisor`, toSupervisor ? 'true' : 'false')
        form.set(`${p}admins`, adminIds.join(','))
      } else if (isDeadline) {
        form.set(`${p}enabled`, remEnabled ? 'true' : 'false')
        form.set(`${p}days_before`, beforeText)
        form.set(`${p}days_after`, afterText)
        form.set(`${p}to_driver`, toDriver ? 'true' : 'false')
        form.set(`${p}to_supervisor`, toSupervisor ? 'true' : 'false')
        form.set(`${p}admins`, adminIds.join(','))
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

  // La copia del recordatorio de la sección: el de combustible y los de
  // vencimiento dicen lo suyo donde el de km habla de la lectura.
  const copy = kind === 'fuel' ? t.fuel : isDeadline ? t.deadline : t.reminder
  const words = {
    intro: isDeadline ? t.deadline.intro[kind] : kind === 'fuel' ? t.fuel.intro : t.reminder.intro,
    enabledOn: copy.enabledOn,
    enabledOff: copy.enabledOff,
    stopHint: copy.stopHint,
    variablesHint: copy.variablesHint,
    scheduleTitle: isDeadline ? t.deadline.title : t.reminder.title,
    templateTitle: isDeadline ? t.deadline.templateTitle : t.reminder.templateTitle,
  }

  /** A quién va cada correo: conductor, supervisor y/o administradores
   * concretos, elegidos uno a uno. El mismo bloque en los cuatro. */
  const recipientsFieldset = (
    <fieldset className="es-fieldset es-reminder-recipients" disabled={!remEnabled}>
      <legend>{t.reminder.recipientsTitle}</legend>
      <div className="es-recipients">
        <label className="baja-toggle es-toggle">
          <input type="checkbox" checked={toDriver} onChange={(e) => setToDriver(e.target.checked)} />
          <span>
            <strong>{t.reminder.toDriver}</strong>
            <span className="muted"> · {t.reminder.toDriverHint}</span>
          </span>
        </label>
        <label className="baja-toggle es-toggle">
          <input type="checkbox" checked={toSupervisor} onChange={(e) => setToSupervisor(e.target.checked)} />
          <span>
            <strong>{t.reminder.toSupervisor}</strong>
            <span className="muted"> · {t.reminder.toSupervisorHint}</span>
          </span>
        </label>
      </div>
      <div className="es-admins-head">
        <strong>{t.reminder.adminsTitle}</strong>
        <span className="muted"> · {t.reminder.adminsHint}</span>
      </div>
      {row.admin_options.length === 0 ? (
        <p className="muted">{t.reminder.adminsEmpty}</p>
      ) : (
        <div className="es-admins" role="group" aria-label={t.reminder.adminsTitle}>
          {row.admin_options.map((a) => (
            <label key={a.id} className={`es-admin${adminIds.includes(a.id) ? ' is-active' : ''}`}>
              <input
                type="checkbox"
                checked={adminIds.includes(a.id)}
                onChange={(e) =>
                  setAdminIds((ids) =>
                    e.target.checked ? [...ids, a.id].sort((x, y) => x - y) : ids.filter((id) => id !== a.id),
                  )
                }
              />
              <span>
                <strong>{a.name}</strong>
                <span className="muted">{a.email}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {nobody && <p className="form-error">{t.reminder.nobody}</p>}
    </fieldset>
  )

  /** El formulario de un recordatorio por vencimiento: los días antes y
   * después, a quién, y el resumen de lo que resulta. */
  const deadlineForm = (
    <form
      className="es-reminder es-deadline"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="es-reminder-intro">
        <p className="muted">{words.intro}</p>
        <label className="baja-toggle es-toggle es-toggle-main">
          <input type="checkbox" checked={remEnabled} onChange={(e) => setRemEnabled(e.target.checked)} />
          <span>
            <strong>{t.deadline.enabled}</strong>
            <span className="muted"> · {remEnabled ? words.enabledOn : words.enabledOff}</span>
          </span>
        </label>
        <fieldset className="es-fieldset" disabled={!remEnabled}>
          <legend>{t.deadline.title}</legend>
          <div className="es-days">
            <TextInputField
              label={t.deadline.daysBefore}
              value={beforeText}
              placeholder="30, 15, 7, 1"
              inputMode="numeric"
              aria-invalid={beforeDays === null || undefined}
              onChange={(e) => setBeforeText(cleanDaysText(e.target.value))}
            />
            <span className={beforeDays === null ? 'form-error' : 'muted'}>
              {beforeDays === null ? t.deadline.daysError : t.deadline.daysBeforeHint}
            </span>
          </div>
          <div className="es-days">
            <TextInputField
              label={t.deadline.daysAfter}
              value={afterText}
              placeholder="1, 7, 15"
              inputMode="numeric"
              aria-invalid={afterDays === null || undefined}
              onChange={(e) => setAfterText(cleanDaysText(e.target.value))}
            />
            <span className={afterDays === null ? 'form-error' : 'muted'}>
              {afterDays === null ? t.deadline.daysError : t.deadline.daysAfterHint}
            </span>
          </div>
          {offsetsNone && <p className="form-error">{t.deadline.daysNone}</p>}
        </fieldset>
      </div>
      {recipientsFieldset}
      <div className="es-reminder-foot">
        <p className="muted">{words.stopHint}</p>
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={saving || cannotSave}>
            {saving ? t.saving : t.save}
          </Button>
        </div>
      </div>
      <aside className={`email-settings-schedule es-reminder-schedule${remEnabled ? '' : ' is-off'}`} aria-live="polite">
        <strong>{t.deadline.summaryTitle}</strong>
        {!remEnabled && <Panel tone="warning">{t.deadline.summaryOff}</Panel>}
        {!offsetsError && (
          <>
            <p className="es-summary">
              {t.deadline.summaryBefore(
                beforeDays.length,
                [...beforeDays].sort((a, b) => b - a).map(t.deadline.dayBefore).join(', '),
              )}
            </p>
            <p className="es-summary">
              {t.deadline.summaryAfter(
                afterDays.length,
                [...afterDays].sort((a, b) => a - b).map(t.deadline.dayAfter).join(', '),
              )}
            </p>
            {beforeDays.length + afterDays.length > 0 && (
              <details className="es-dates" open>
                <summary>{t.deadline.exampleTitle(fmtDate(toIso(exampleDue), lang))}</summary>
                <ol>
                  {[...beforeDays.map((d) => -d), ...afterDays].sort((a, b) => a - b).map((offset) => {
                    const d = new Date(exampleDue.year, exampleDue.month - 1, exampleDue.day + offset)
                    return (
                      <li key={offset}>
                        {fmtDate(toIso({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }), lang)}
                        <span className="muted"> · {offset <= 0 ? t.deadline.dayBefore(-offset) : t.deadline.dayAfter(offset)}</span>
                      </li>
                    )
                  })}
                </ol>
              </details>
            )}
          </>
        )}
      </aside>
    </form>
  )

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

      {reminder ? (
        <>
          <div className="seg-switch es-views" role="tablist" aria-label={words.scheduleTitle}>
            <button
              type="button"
              role="tab"
              aria-selected={reminderView === 'schedule'}
              className={reminderView === 'schedule' ? 'is-active' : ''}
              onClick={() => setReminderView('schedule')}
            >
              {words.scheduleTitle}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={reminderView === 'email'}
              className={reminderView === 'email' ? 'is-active' : ''}
              onClick={() => setReminderView('email')}
            >
              {words.templateTitle}
            </button>
          </div>
          {reminderView === 'schedule' && isDeadline ? (
            deadlineForm
          ) : reminderView === 'schedule' ? (
          <form
            className="es-reminder"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="es-reminder-intro">
              <p className="muted">{words.intro}</p>
              <label className="baja-toggle es-toggle es-toggle-main">
                <input type="checkbox" checked={remEnabled} onChange={(e) => setRemEnabled(e.target.checked)} />
                <span>
                  <strong>{t.reminder.enabled}</strong>
                  <span className="muted"> · {remEnabled ? words.enabledOn : words.enabledOff}</span>
                </span>
              </label>

              <fieldset className="es-fieldset" disabled={!remEnabled}>
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
            <fieldset className="es-fieldset es-reminder-cadence" disabled={!remEnabled || by === 'days'}>
              <legend>{t.reminder.cadenceTitle}</legend>
                {by === 'days' && <p className="muted es-cadence-off">{t.reminder.cadenceOff}</p>}
                <div className="es-modes" role="radiogroup" aria-label={t.reminder.cadenceTitle}>
                  {MODES.map((m) => (
                    <label key={m} className={`es-mode${mode === m ? ' is-active' : ''}`}>
                      <input
                        type="radio"
                        name={`${kind}_remind_mode`}
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
            {recipientsFieldset}
            <div className="es-reminder-foot">
              <p className="muted">{words.stopHint}</p>
              <div className="form-actions">
                <Button type="submit" variant="primary" disabled={saving || cannotSave}>
                  {saving ? t.saving : t.save}
                </Button>
              </div>
            </div>

            <aside
              className={`email-settings-schedule es-reminder-schedule${remEnabled ? '' : ' is-off'}`}
              aria-live="polite"
            >
              <strong>{t.reminder.scheduleTitle}</strong>
              {!remEnabled && <Panel tone="warning">{t.reminder.scheduleOff}</Panel>}
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
              <Button type="button" variant="secondary" onClick={() => onEditTemplate(templateKey)}>
                {kmTemplate ? t.reminder.editTemplate : t.reminder.customise}
              </Button>
            </div>
            <p className="muted field-hint">{words.variablesHint}</p>
            {previewFrame(words.templateTitle)}
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
