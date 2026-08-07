import { useMemo, useState, type FormEvent } from 'react'
import { Badge, Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  closeVehicleLink,
  createDocument,
  createVehicleLink,
  notifyVehicle,
  updateVehicleFields,
  uploadDocument,
} from '../api.ts'
import { todayIso, vehicleStateTone } from '../format.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
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
  // Motivo ÚNICO: sirve como motivo del cambio de estado y de la sustitución.
  const [reason, setReason] = useState('breakdown')
  // Descripción libre del estado (se guarda junto al motivo en el histórico).
  const [description, setDescription] = useState('')
  const [substitute, setSubstitute] = useState('')
  const [start, setStart] = useState(initActive ? '' : todayIso())
  const [end, setEnd] = useState('')
  const [toDriver, setToDriver] = useState(false)
  const [toSupervisor, setToSupervisor] = useState(false)
  const [message, setMessage] = useState('')

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

  const roleLabel = (role: string) =>
    role === 'driver' ? t.ops.driverLabel : role === 'supervisor' ? t.ops.supervisorLabel : role

  const isActive = stateValue === 'active'

  // Cambiar el estado: si pasa a "activo" no puede tener sustituto → se ignora
  // y se dejan los campos en blanco; si pasa a no activo, el inicio vuelve a hoy.
  function onChangeState(next: string) {
    setStateValue(next)
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
    const wantCom = Boolean(message.trim()) && (toDriver || toSupervisor)
    const wantDocs = docFiles.length > 0 || docUrl.trim() !== ''
    if (!wantState && !wantLink && !wantCom && !wantDocs) {
      setError(t.ops.nothingToDo)
      return
    }
    if (end && start && end < start) {
      setError(t.ops.endBeforeStart)
      return
    }
    setSaving(true)
    try {
      // Motivo único: etiqueta legible para el histórico del estado; valor (enum)
      // para el vínculo de sustitución.
      const reasonLabel = t.linkReasonOptions.find((o) => o.value === reason)?.label ?? reason
      const changeReason = description.trim() ? `${reasonLabel} — ${description.trim()}` : reasonLabel
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
          reason,
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
        // Comunicado de estado: tira de la plantilla `state_notice` (10b); el
        // texto escrito viaja como variable {{mensaje}}.
        const res = await notifyVehicle(vehicle.id, {
          template_key: 'state_notice',
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

      {/* 1 · Estado (con el motivo ÚNICO). */}
      <section className="ops-section">
        <h4>{t.ops.stateSection}</h4>
        <div className="ops-grid">
          <SelectField
            label={t.ops.newState}
            options={t.stateOptions}
            value={stateValue}
            onValueChange={onChangeState}
          />
          <SelectField
            label={t.ops.reason}
            options={t.linkReasonOptions}
            value={reason}
            onValueChange={setReason}
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

      {/* 1b · Archivos del estado (todos los estados salvo «activo»). */}
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

      {/* 2 · Sustitución (no aplica a coches de sustitución). */}
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
              <SelectField
                label={t.ops.subSelect}
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
            <p className="muted ops-note">{isActive ? t.ops.activeNote : t.ops.subNote}</p>
          </>
        )}
      </section>
      )}

      {/* 3 · Comunicado */}
      <section className="ops-section">
        <h4>{t.ops.comSection}</h4>
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
