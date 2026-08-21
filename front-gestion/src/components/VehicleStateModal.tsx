import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Badge, Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  closeVehicleLink,
  createDocument,
  createVehicleLink,
  listAll,
  listEmailTemplates,
  noticePreviewVehicle,
  notifyVehicle,
  updateVehicleFields,
  uploadDocument,
  type EmailTemplateRow,
} from '../api.ts'
import { getNoticeLang, setNoticeLang, type NoticeLang } from '../emailPrefs.ts'
import { todayIso, vehicleStateTone } from '../format.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import { EmailOptions } from './EmailOptions.tsx'
import type { Vehicle, VehicleLinkRow } from '../types.ts'

// Tipos de documento (lista cerrada del back). Etiquetas desde panels.ts.
const DOC_TYPES = [
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

// Tipo de documento sugerido por defecto según el estado del vehículo
// («cada estado con sus características»). El usuario puede cambiarlo.
const STATE_DOC_TYPE: Record<string, string> = {
  accidente: 'damage_photos',
  broken: 'damage_photos',
  maintenance: 'other',
  itv: 'other',
  non_active: 'other',
}

// El motivo del vínculo de sustitución es el mismo dato que el estado —«En ITV»
// es `inspection`, «Averiado» es `breakdown`—, así que se deduce en vez de
// preguntarse dos veces (y de poder contradecirse). Los estados sin equivalencia
// se quedan fuera del mapa: ahí, y solo ahí, se pregunta.
const STATE_LINK_REASON: Record<string, string> = {
  broken: 'breakdown',
  maintenance: 'maintenance',
  itv: 'inspection',
  accidente: 'accident',
}

// Correo propuesto según el estado: cuando hay una plantilla para ese caso
// concreto se elige sola; el resto de estados son un comunicado de estado. Es
// una propuesta, no un candado: se puede cambiar después.
const STATE_TEMPLATE: Record<string, string> = {
  itv: 'itv_due',
}
const DEFAULT_TEMPLATE = 'state_notice'

// Etiqueta de recambio cuando la plantilla propuesta no está definida en
// Ajustes: el campo debe seguir enseñando de qué correo habla.
const FALLBACK_LABEL: Record<string, 'typeItv' | 'typeInsurance' | 'typeKmReading'> = {
  itv_due: 'typeItv',
  insurance_due: 'typeInsurance',
  km_reading_pending: 'typeKmReading',
}

interface Props {
  vehicle: Vehicle
  allVehicles: Vehicle[]
  links: VehicleLinkRow[]
  onClose: () => void
  onDone: () => void
}

/** Modal de operación del vehículo (desde el inventario): cambio de estado,
 * asociación de coche de sustitución y comunicado por email — todo en uno. */
export function VehicleStateModal({ vehicle, allVehicles, links, onClose, onDone }: Props) {
  const t = useVehiclesCopy()

  // Un coche activo no puede tener sustituto: al abrir sobre uno activo, la
  // sustitución arranca vacía; al pasar a activo se limpia (ver onChangeState).
  const initActive = (vehicle.state || 'active') === 'active'
  const [stateValue, setStateValue] = useState<string>(vehicle.state || 'active')
  // Motivo del vínculo de sustitución, solo para los estados que no lo implican.
  const [linkReason, setLinkReason] = useState('')
  // Descripción libre del estado (se guarda como nota del evento del histórico).
  const [description, setDescription] = useState('')
  const [substitute, setSubstitute] = useState('')
  const [start, setStart] = useState(initActive ? '' : todayIso())
  const [end, setEnd] = useState('')
  const [toDriver, setToDriver] = useState(false)
  const [toSupervisor, setToSupervisor] = useState(false)
  const [message, setMessage] = useState('')

  // Comunicado: el asunto y el cuerpo salen de una plantilla ya definida
  // (Ajustes → Plantillas); aquí solo se elige cuál y qué texto se le añade.
  const [templates, setTemplates] = useState<EmailTemplateRow[]>([])
  const [templateKey, setTemplateKey] = useState(
    STATE_TEMPLATE[vehicle.state || ''] ?? DEFAULT_TEMPLATE,
  )
  const [comPreview, setComPreview] = useState<
    { subject: string; body_html: string; has_template: boolean; has_en: boolean } | null
  >(null)
  // Que la vista previa falle no impide enviar, pero hay que decirlo: si no, el
  // acordeón desaparece sin más y parece que la función no está.
  const [comPreviewFailed, setComPreviewFailed] = useState(false)
  // Con plantilla o solo con el texto libre, y en qué idioma (queda guardado).
  const [useTemplate, setUseTemplate] = useState(true)
  const [comLang, setComLang] = useState<NoticeLang>(getNoticeLang)

  // Archivos del estado (Drive): tipo + ficheros a subir y/o enlace de Drive.
  const docCopy = usePanelsCopy().documents
  const [docType, setDocType] = useState<string>(STATE_DOC_TYPE[vehicle.state || ''] ?? 'other')
  const [docFiles, setDocFiles] = useState<File[]>([])
  const [docUrl, setDocUrl] = useState('')
  const docTypeOptions = useMemo(
    () => DOC_TYPES.map((value) => ({ value, label: docCopy.typeOptions[value] })),
    [docCopy],
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // Plantillas definidas: son los «correos predefinidos» del selector.
  useEffect(() => {
    listAll(listEmailTemplates())
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }, [])

  // Vista previa del comunicado, con el texto escrito ya sustituido en la
  // plantilla. Debounce ligero para no pedirla en cada tecla.
  // Sin plantilla, el back compone el comunicado solo con el texto escrito.
  const sentTemplateKey = useTemplate ? templateKey : ''

  useEffect(() => {
    let alive = true
    const id = setTimeout(() => {
      noticePreviewVehicle(vehicle.id, {
        template_key: sentTemplateKey,
        message: message.trim(),
        lang: comLang,
      })
        .then((res) => {
          if (!alive) return
          setComPreview(res)
          setComPreviewFailed(false)
        })
        .catch(() => {
          if (!alive) return
          setComPreview(null)
          setComPreviewFailed(true)
        })
    }, 300)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [vehicle.id, sentTemplateKey, comLang, message])

  function onChangeComLang(next: NoticeLang) {
    setComLang(next)
    setNoticeLang(next)
  }

  // Vínculo de sustitución vigente (como principal).
  const activeLink = useMemo(
    () => links.find((l) => l.main_vehicle === vehicle.id && l.end_date === null) ?? null,
    [links, vehicle.id],
  )
  const byId = useMemo(() => new Map(allVehicles.map((v) => [v.id, v])), [allVehicles])
  const busySubIds = useMemo(
    () => new Set(links.filter((l) => l.end_date === null).map((l) => l.substitute_vehicle)),
    [links],
  )

  const substituteOptions = useMemo(
    () => [
      { value: '', label: t.ops.choose },
      // Solo coches de sustitución: los disponibles primero; los ocupados en gris.
      ...allVehicles
        .filter((v) => v.is_substitute && v.id !== vehicle.id)
        .map((v) => ({ v, available: !busySubIds.has(v.id) }))
        .sort(
          (a, b) => Number(b.available) - Number(a.available) || a.v.plate.localeCompare(b.v.plate),
        )
        .map(({ v, available }) => ({
          value: String(v.id),
          label: `${v.plate} · ${v.brand} ${v.model} 🔁${available ? '' : ` · ${t.ops.unavailable}`}`,
          disabled: !available,
        })),
    ],
    [allVehicles, busySubIds, vehicle.id, t],
  )

  // Mientras no han llegado, se enseña la del comunicado de estado: es la que
  // el modal usaba fija y evita que el campo aparezca vacío un instante.
  const templateOptions = useMemo(() => {
    // Las desactivadas se siguen listando en la API, pero el envío no las usa:
    // ofrecerlas solo llevaría al texto por defecto.
    const rows = templates
      .filter((tpl) => tpl.is_active)
      .map((tpl) => ({ value: tpl.key, label: tpl.key_display }))
    // El correo que propone el estado debe estar siempre en la lista, aunque su
    // plantilla no exista: si no, el campo se quedaría en blanco.
    if (!rows.some((row) => row.value === templateKey)) {
      rows.unshift({ value: templateKey, label: t.email[FALLBACK_LABEL[templateKey] ?? 'typeComunicado'] })
    }
    return rows
  }, [templates, templateKey, t])

  const roleLabel = (role: string) =>
    role === 'driver' ? t.ops.driverLabel : role === 'supervisor' ? t.ops.supervisorLabel : role

  const isActive = stateValue === 'active'
  // Motivo que implica el estado elegido; undefined si no lo implica ninguno.
  const derivedLinkReason = STATE_LINK_REASON[stateValue]
  const linkReasonLabel = (value: string) =>
    t.linkReasonOptions.find((o) => o.value === value)?.label ?? value

  // Cambiar el estado: si pasa a "activo" no puede tener sustituto → se ignora
  // y se dejan los campos en blanco; si pasa a no activo, el inicio vuelve a hoy.
  function onChangeState(next: string) {
    setStateValue(next)
    // El correo propuesto sigue al estado, igual que el tipo de documento.
    setTemplateKey(STATE_TEMPLATE[next] ?? DEFAULT_TEMPLATE)
    if (next === 'active') {
      setSubstitute('')
      setStart('')
      setEnd('')
    } else {
      setStart((s) => s || todayIso())
      // Sugerir el tipo de documento relevante para el nuevo estado.
      setDocType(STATE_DOC_TYPE[next] ?? 'other')
    }
  }

  async function handleCloseLink() {
    if (!activeLink) return
    setSaving(true)
    setError('')
    try {
      await closeVehicleLink(activeLink.id, todayIso())
      onDone()
    } catch (err) {
      setError(asErrorMessage(err, t.ops.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    const wantState = stateValue !== vehicle.state
    const wantLink = Boolean(substitute)
    // El cuerpo lo pone la plantilla: basta con elegir destinatario. El texto
    // escrito es un añadido opcional ({{mensaje}}), no el comunicado entero.
    const wantCom = toDriver || toSupervisor
    const wantDocs = docFiles.length > 0 || docUrl.trim() !== ''
    if (!wantState && !wantLink && !wantCom && !wantDocs) {
      setError(t.ops.nothingToDo)
      return
    }
    if (end && start && end < start) {
      setError(t.ops.endBeforeStart)
      return
    }
    // Sin plantilla, el comunicado es el texto escrito: tiene que haber texto.
    if (wantCom && !useTemplate && !message.trim()) {
      setError(t.email.messageRequired)
      return
    }
    // El motivo del vínculo lo dice el estado; si el estado no lo dice, hay que
    // elegirlo (el back lo exige como enum cerrado).
    const linkReasonValue = derivedLinkReason ?? linkReason
    if (wantLink && !linkReasonValue) {
      setError(t.ops.reasonRequired)
      return
    }
    setSaving(true)
    try {
      // La nota del evento es la descripción tal cual: el tipo de evento ya sale
      // del estado, así que repetirlo en el texto solo duplicaría el dato.
      const changeReason = description.trim()
      // 1) Estado (el PATCH con change_reason emite el evento de cambio).
      if (wantState) {
        await updateVehicleFields(vehicle.id, {
          state: stateValue,
          change_reason: changeReason,
          expected_updated_at: vehicle.updated_at,
        })
      }
      // 2) Vínculo de sustitución (inicio = hoy por defecto; fin opcional).
      if (wantLink) {
        await createVehicleLink({
          main_vehicle: vehicle.id,
          substitute_vehicle: Number(substitute),
          reason: linkReasonValue,
          start_date: start,
          ...(end ? { end_date: end } : {}),
        })
      }
      // 2b) Archivos del estado → documentos del vehículo (se archivan en Drive).
      let docsCount = 0
      if (wantDocs) {
        for (const file of docFiles) {
          await uploadDocument({ vehicle: vehicle.id, type: docType }, file)
          docsCount += 1
        }
        if (docUrl.trim()) {
          await createDocument({ vehicle: vehicle.id, type: docType, drive_url: docUrl.trim() })
          docsCount += 1
        }
      }
      // 3) Comunicado por email (best-effort; devuelve enviados / omitidos).
      let comInfo = ''
      if (wantCom) {
        // El asunto y el cuerpo salen de la plantilla elegida (10b); el texto
        // escrito viaja como variable {{mensaje}}.
        const res = await notifyVehicle(vehicle.id, {
          template_key: sentTemplateKey,
          lang: comLang,
          message: message.trim(),
          to_driver: toDriver,
          to_supervisor: toSupervisor,
        })
        comInfo = t.ops.sentOk(res.sent.length)
        if (res.skipped.length) {
          comInfo += ` ${t.ops.skippedInfo(res.skipped.map((s) => roleLabel(s.role)).join(', '))}`
        }
      }
      onDone()
      // Con comunicado o archivos, mostramos el resultado; si no, cerramos.
      const parts: string[] = []
      if (comInfo) parts.push(comInfo)
      if (docsCount) parts.push(t.ops.docsSaved(docsCount))
      if (parts.length) setInfo(parts.join(' '))
      else onClose()
    } catch (err) {
      setError(asErrorMessage(err, t.ops.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  // Vista de resultado tras enviar comunicado.
  if (info) {
    return (
      <div className="ops-modal">
        <div className="ops-success" role="status">{info}</div>
        <div className="ops-actions">
          <Button variant="primary" onClick={onClose}>{t.ops.close}</Button>
        </div>
      </div>
    )
  }

  return (
    <form className="ops-modal" onSubmit={submit}>
      {/* Info relevante del estado actual. */}
      <div className="ops-info">
        <span>
          {t.ops.currentState}:{' '}
          <Badge tone={vehicleStateTone(vehicle.state)}>{vehicle.state_display || '—'}</Badge>
        </span>
        <span>{t.ops.driverLabel}: <strong>{vehicle.driver_name || t.ops.none}</strong></span>
        <span>{t.ops.supervisorLabel}: <strong>{vehicle.supervisor_name || t.ops.none}</strong></span>
      </div>

      {/* 1 · Estado: el qué (estado) y el por qué (descripción). El motivo del
          vínculo no se pide aquí porque el estado ya lo dice. */}
      <section className="ops-section">
        <h4>{t.ops.stateSection}</h4>
        <div className="ops-grid">
          <SelectField
            label={t.ops.newState}
            options={t.stateOptions}
            value={stateValue}
            onValueChange={onChangeState}
          />
        </div>
        <label className="ops-field-label" htmlFor="ops-description">{t.ops.description}</label>
        <textarea
          id="ops-description"
          className="ops-textarea"
          rows={3}
          placeholder={t.ops.descriptionPlaceholder}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </section>

      {/* 2 · Coche de sustitución (no aplica a coches de sustitución). */}
      {!vehicle.is_substitute && (
      <section className="ops-section">
        <h4>{t.ops.subSection}</h4>
        {activeLink ? (
          <div className="ops-activelink">
            <span>
              {t.ops.activeLink}:{' '}
              <strong>
                {byId.get(activeLink.substitute_vehicle)?.plate ??
                  `#${activeLink.substitute_vehicle}`}
              </strong>{' '}
              · {activeLink.start_date}
            </span>
            <Button type="button" variant="danger" size="sm" disabled={saving} onClick={handleCloseLink}>
              {t.ops.closeLink}
            </Button>
          </div>
        ) : (
          <>
            <div className="ops-sub-row">
              {/* `required` no es por obligar a elegir —«— Elegir —» sigue
                  valiendo— sino para que el campo no ofrezca «-- Ignorar --»:
                  su valor es la cadena `__ignore__` y llegaría al back como id. */}
              <SelectField
                label={t.ops.subSelect}
                required
                options={isActive ? [{ value: '', label: t.ops.ignoreActive }] : substituteOptions}
                value={substitute}
                onValueChange={setSubstitute}
                disabled={isActive}
              />
              <TextInputField
                label={t.ops.start}
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                disabled={isActive}
              />
              <TextInputField
                label={t.ops.end}
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                disabled={isActive}
              />
            </div>
            {/* El motivo es del vínculo, así que vive aquí: se enseña deducido
                del estado, y se pregunta cuando el estado no lo implica. */}
            {substitute && !isActive && (
              derivedLinkReason ? (
                <p className="muted ops-note">
                  {t.ops.subReasonFromState(linkReasonLabel(derivedLinkReason))}
                </p>
              ) : (
                <div className="ops-grid">
                  <SelectField
                    label={t.ops.subReason}
                    required
                    options={[{ value: '', label: t.ops.choose }, ...t.linkReasonOptions]}
                    value={linkReason}
                    onValueChange={setLinkReason}
                  />
                </div>
              )
            )}
            <p className="muted ops-note">{isActive ? t.ops.activeNote : t.ops.subNote}</p>
          </>
        )}
      </section>
      )}

      {/* 3 · Archivos del estado (todos los estados salvo «activo»). */}
      {!isActive && (
        <section className="ops-section">
          <h4>{t.ops.docsSection}</h4>
          <div className="ops-grid">
            <SelectField
              label={t.ops.docType}
              required
              options={docTypeOptions}
              value={docType}
              onValueChange={setDocType}
            />
          </div>
          <label className="file-field">
            <span>{t.ops.docFiles}</span>
            <input
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
              onChange={(e) => setDocFiles(e.target.files ? Array.from(e.target.files) : [])}
            />
          </label>
          <TextInputField
            label={t.ops.docUrl}
            value={docUrl}
            placeholder={t.ops.docUrlPlaceholder}
            onChange={(e) => setDocUrl(e.target.value)}
          />
          <p className="muted ops-note">{t.ops.docNote}</p>
        </section>
      )}

      {/* 4 · Comunicado: el contenido sale de una plantilla ya definida; aquí se
          elige cuál, a quién va y qué texto se le añade. */}
      <section className="ops-section">
        <h4>{t.ops.comSection}</h4>
        <EmailOptions
          useTemplate={useTemplate}
          onUseTemplateChange={setUseTemplate}
          lang={comLang}
          onLangChange={onChangeComLang}
          missingEnglish={
            (comLang === 'en' || comLang === 'both') &&
            comPreview !== null &&
            comPreview.has_template &&
            !comPreview.has_en
          }
        />
        <div className="ops-grid">
          <SelectField
            label={t.ops.comTemplate}
            required
            disabled={!useTemplate}
            options={templateOptions}
            value={templateKey}
            onValueChange={setTemplateKey}
          />
        </div>
        <div className="ops-checks">
          <label className="baja-toggle">
            <input
              type="checkbox"
              checked={toDriver}
              onChange={(e) => setToDriver(e.target.checked)}
            />
            {t.ops.comToDriver}
          </label>
          <label className="baja-toggle">
            <input
              type="checkbox"
              checked={toSupervisor}
              onChange={(e) => setToSupervisor(e.target.checked)}
            />
            {t.ops.comToSupervisor}
          </label>
        </div>
        <label className="ops-field-label" htmlFor="ops-message">{t.ops.comMessage}</label>
        <textarea
          id="ops-message"
          className="ops-textarea"
          rows={3}
          placeholder={t.ops.comPlaceholder}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <p className="muted ops-note">
          {comPreview && !comPreview.has_template ? t.email.noTemplateHint : t.email.templateHint}
        </p>
        {comPreviewFailed && (
          <p className="ops-note tone-warn">{t.email.previewUnavailable}</p>
        )}
        {/* Plegada: el correo ya está cargado, pero no roba sitio a las otras
            tres secciones del modal hasta que se quiere ver. */}
        {comPreview && (
          <details className="com-preview">
            <summary className="com-preview-head">{t.email.preview}</summary>
            <div className="email-preview">
              <div className="email-preview-subject">
                <span className="ops-field-label">{t.email.subjectLabel}:</span> {comPreview.subject}
              </div>
              <div
                className="email-preview-body"
                // Cuerpo saneado en servidor (nh3) + variables escapadas (mailer.render).
                dangerouslySetInnerHTML={{ __html: comPreview.body_html }}
              />
            </div>
          </details>
        )}
      </section>

      {error && <div role="alert" className="form-error">{error}</div>}

      <div className="ops-actions">
        <Button type="button" variant="secondary" onClick={onClose}>{t.ops.cancel}</Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? t.ops.saving : t.ops.save}
        </Button>
      </div>
    </form>
  )
}
