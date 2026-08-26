import { useState, type FormEvent } from 'react'
import { Badge, Button, Modal, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  manageIncident,
  resolveIncident,
  updateIncident,
} from '../api.ts'
import { fmtDate } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { Incident } from '../types.ts'

/** La gestión guardada (fase 2), tal y como viaja en `details.management`. */
interface Management {
  workshop?: string
  appointment_at?: string
}

type ActionKind = 'edit' | 'manage' | 'resolve'

const managementOf = (incident: Incident): Management =>
  ((incident.details as { management?: Management } | null)?.management) ?? {}

/**
 * Pestaña «Estados abiertos» del modal de estado: las peticiones (incidencias)
 * sin resolver del vehículo, cada una con su ciclo — modificar el parte,
 * gestionarla (ubicación preferente) y resolverla (cierra).
 * Cada acción abre su propio modal (el DS los monta por portal).
 */
export function OpenIncidentsPanel({
  incidents,
  loadFailed,
  onReload,
  onChanged,
}: {
  incidents: Incident[] | null
  loadFailed: boolean
  /** Recargar la lista tras guardar (la mantiene el modal padre). */
  onReload: () => void
  /** Algo cambió: la página puede refrescar sus datos. */
  onChanged: () => void
}) {
  const t = useVehiclesCopy()
  const { language } = useLang()

  const [action, setAction] = useState<{ kind: ActionKind; incident: Incident } | null>(null)
  const [edit, setEdit] = useState({ date: '', description: '', mileage: '', cp: '' })
  const [managePostalCode, setManagePostalCode] = useState('')
  const [resolution, setResolution] = useState({ overcost: '', observations: '', downtime: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  /** Abrir una acción precarga su formulario con lo ya guardado. */
  function openAction(kind: ActionKind, incident: Incident) {
    setError('')
    setNotice('')
    if (kind === 'edit') {
      setEdit({
        date: incident.date ?? '',
        description: incident.description,
        mileage: incident.mileage != null ? String(incident.mileage) : '',
        cp: incident.workshop_postal_code ?? '',
      })
    } else if (kind === 'manage') {
      setManagePostalCode(incident.workshop_postal_code ?? '')
    } else {
      setResolution({ overcost: '', observations: '', downtime: '' })
    }
    setAction({ kind, incident })
  }

  function done(message: string) {
    setAction(null)
    setNotice(message)
    onReload()
    onChanged()
  }

  async function submitEdit(e: FormEvent) {
    e.preventDefault()
    if (!action) return
    setSaving(true)
    setError('')
    try {
      await updateIncident(action.incident.id, {
        date: edit.date || null,
        description: edit.description,
        mileage: edit.mileage.trim() ? Number(edit.mileage) : null,
        workshop_postal_code: edit.cp,
      })
      done(t.ops.editSaved)
    } catch (err) {
      setError(asErrorMessage(err, t.ops.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  async function submitManage(e: FormEvent) {
    e.preventDefault()
    if (!action) return
    setSaving(true)
    setError('')
    try {
      await manageIncident(action.incident.id, { workshop_postal_code: managePostalCode })
      done(t.ops.manageSaved)
    } catch (err) {
      setError(asErrorMessage(err, t.ops.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  async function submitResolve(e: FormEvent) {
    e.preventDefault()
    if (!action) return
    setSaving(true)
    setError('')
    const payload: { overcost?: string; observations?: string; downtime_days?: number } = {}
    if (resolution.overcost.trim()) payload.overcost = resolution.overcost.trim()
    if (resolution.observations.trim()) payload.observations = resolution.observations.trim()
    if (resolution.downtime.trim()) payload.downtime_days = Number(resolution.downtime)
    try {
      await resolveIncident(action.incident.id, payload)
      done(t.ops.resolveDone)
    } catch (err) {
      setError(asErrorMessage(err, t.ops.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  const modalTitle =
    action?.kind === 'edit'
      ? t.ops.editTitle(action.incident.type_display)
      : action?.kind === 'manage'
        ? t.ops.manageTitle(action.incident.type_display)
        : action
          ? t.ops.resolveTitle(action.incident.type_display)
          : ''

  return (
    <div className="ops-open-list">
      {notice && (
        <p className="ops-success" role="status">
          {notice}
        </p>
      )}
      {incidents === null && !loadFailed && <p className="muted ops-note">{t.ops.openLoading}</p>}
      {loadFailed && (
        <div role="alert" className="form-error">
          {t.ops.openLoadError}
        </div>
      )}
      {incidents !== null && incidents.length === 0 && (
        <p className="muted ops-note">{t.ops.openEmpty}</p>
      )}

      {(incidents ?? []).map((incident) => {
        const management = managementOf(incident)
        return (
          <div key={incident.id} className="ops-open-row">
            <div className="ops-open-main">
              <strong>{incident.type_display}</strong>
              <span className="muted">{incident.date ? fmtDate(incident.date, language) : '—'}</span>
              <Badge tone={incident.status === 'open' ? 'warning' : 'info'}>
                {incident.status_display}
              </Badge>
            </div>
            {incident.description && <p className="muted ops-open-desc">{incident.description}</p>}
            {(management.workshop || management.appointment_at) && (
              <p className="muted ops-open-desc">
                {management.workshop ? `${t.ops.openWorkshopLabel}: ${management.workshop}` : ''}
                {management.workshop && management.appointment_at ? ' · ' : ''}
                {management.appointment_at
                  ? `${t.ops.openAppointmentLabel}: ${management.appointment_at.replace('T', ' ')}`
                  : ''}
              </p>
            )}
            <div className="ops-open-actions">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => openAction('edit', incident)}
              >
                {t.ops.openEditBtn}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => openAction('manage', incident)}
              >
                {t.ops.openManageBtn}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={() => openAction('resolve', incident)}
              >
                {t.ops.openResolveBtn}
              </Button>
            </div>
          </div>
        )
      })}

      {/* Los tres modales de acción comparten el contenedor (portal del DS). */}
      <Modal open={Boolean(action)} title={modalTitle} onClose={() => setAction(null)}>
        {action?.kind === 'edit' && (
          <form className="ops-modal" onSubmit={submitEdit}>
            <div className="ops-grid">
              <TextInputField
                label={t.ops.editDate}
                aria-label={t.ops.editDate}
                type="date"
                value={edit.date}
                onChange={(e) => setEdit((f) => ({ ...f, date: e.target.value }))}
              />
              <TextInputField
                label={t.ops.editMileage}
                aria-label={t.ops.editMileage}
                type="number"
                min={0}
                value={edit.mileage}
                onChange={(e) => setEdit((f) => ({ ...f, mileage: e.target.value }))}
              />
              <TextInputField
                label={t.ops.editCp}
                aria-label={t.ops.editCp}
                inputMode="numeric"
                pattern="[0-9]{5}"
                maxLength={5}
                value={edit.cp}
                onChange={(e) => setEdit((f) => ({ ...f, cp: e.target.value }))}
              />
            </div>
            <label className="ops-field-label" htmlFor="open-edit-description">
              {t.ops.description}
            </label>
            <textarea
              id="open-edit-description"
              className="ops-textarea"
              rows={3}
              value={edit.description}
              onChange={(e) => setEdit((f) => ({ ...f, description: e.target.value }))}
            />
            {error && (
              <div role="alert" className="form-error">
                {error}
              </div>
            )}
            <div className="ops-actions">
              <Button type="button" variant="secondary" onClick={() => setAction(null)}>
                {t.ops.cancel}
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? t.ops.saving : t.ops.save}
              </Button>
            </div>
          </form>
        )}

        {action?.kind === 'manage' && (
          <form className="ops-modal" onSubmit={submitManage}>
            <div className="ops-grid">
              <TextInputField
                label={t.ops.managePostalCode}
                aria-label={t.ops.managePostalCode}
                inputMode="numeric"
                pattern="[0-9]{5}"
                maxLength={5}
                value={managePostalCode}
                onChange={(e) => setManagePostalCode(e.target.value)}
                required
              />
            </div>
            <p className="muted ops-note">{t.ops.manageModalNote}</p>
            {error && (
              <div role="alert" className="form-error">
                {error}
              </div>
            )}
            <div className="ops-actions">
              <Button type="button" variant="secondary" onClick={() => setAction(null)}>
                {t.ops.cancel}
              </Button>
              <Button type="submit" variant="primary" disabled={saving || !/^[0-9]{5}$/.test(managePostalCode)}>
                {saving ? t.ops.saving : t.ops.save}
              </Button>
            </div>
          </form>
        )}

        {action?.kind === 'resolve' && (
          <form className="ops-modal" onSubmit={submitResolve}>
            <div className="ops-grid">
              <TextInputField
                label={t.ops.resolveOvercost}
                aria-label={t.ops.resolveOvercost}
                type="number"
                min={0}
                step="0.01"
                value={resolution.overcost}
                onChange={(e) => setResolution((f) => ({ ...f, overcost: e.target.value }))}
              />
              <TextInputField
                label={t.ops.resolveDowntime}
                aria-label={t.ops.resolveDowntime}
                type="number"
                min={0}
                value={resolution.downtime}
                onChange={(e) => setResolution((f) => ({ ...f, downtime: e.target.value }))}
              />
            </div>
            <label className="ops-field-label" htmlFor="open-resolve-observations">
              {t.ops.resolveObservations}
            </label>
            <textarea
              id="open-resolve-observations"
              className="ops-textarea"
              rows={3}
              value={resolution.observations}
              onChange={(e) => setResolution((f) => ({ ...f, observations: e.target.value }))}
            />
            <p className="muted ops-note">{t.ops.resolveHint}</p>
            {error && (
              <div role="alert" className="form-error">
                {error}
              </div>
            )}
            <div className="ops-actions">
              <Button type="button" variant="secondary" onClick={() => setAction(null)}>
                {t.ops.cancel}
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? t.ops.saving : t.ops.resolveSubmit}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
