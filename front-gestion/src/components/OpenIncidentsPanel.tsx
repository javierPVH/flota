import { useMemo, useState, type FormEvent } from 'react'
import { Badge, Button, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { manageIncident, updateIncident } from '../api.ts'
import { fmtDate, incidentPriorityTone } from '../format.ts'
import { DEFAULT_PRIORITY, priorityOptions } from '../incidentPriority.ts'
import { useLang } from '../i18n.tsx'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { Incident, Vehicle } from '../types.ts'
import { ResolveDispatcher } from './resolve/ResolveDispatcher.tsx'
import { incidentTarget, type ResolveTarget } from './resolve/resolveFlow.ts'

type ActionKind = 'edit' | 'manage'

/**
 * Pestaña «Estados abiertos» del modal de estado: las peticiones (incidencias)
 * sin resolver del vehículo, cada una con su ciclo — modificar el parte,
 * gestionarla (ubicación preferente) y resolverla. Resolver abre el modal
 * ESPECÍFICO del tipo a través del dispatcher (el mismo que el Panel y la
 * ficha); modificar y gestionar tienen su modal aquí.
 */
export function OpenIncidentsPanel({
  vehicle,
  incidents,
  loadFailed,
  onReload,
  onChanged,
}: {
  vehicle: Vehicle
  incidents: Incident[] | null
  loadFailed: boolean
  /** Recargar la lista tras guardar (la mantiene el modal padre). */
  onReload: () => void
  /** Algo cambió: la página puede refrescar sus datos. */
  onChanged: () => void
}) {
  const t = useVehiclesCopy()
  const { language } = useLang()
  const priorityChoices = useMemo(() => priorityOptions(t.priority), [t])

  const [action, setAction] = useState<{ kind: ActionKind; incident: Incident } | null>(null)
  const [resolving, setResolving] = useState<ResolveTarget | null>(null)
  const [edit, setEdit] = useState({
    date: '',
    description: '',
    mileage: '',
    cp: '',
    priority: DEFAULT_PRIORITY as string,
  })
  const [managePostalCode, setManagePostalCode] = useState('')
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
        priority: incident.priority ?? DEFAULT_PRIORITY,
      })
    } else {
      setManagePostalCode(incident.workshop_postal_code ?? '')
    }
    setAction({ kind, incident })
  }

  function done(message: string) {
    setAction(null)
    setResolving(null)
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
        priority: edit.priority,
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

  const modalTitle =
    action?.kind === 'edit'
      ? t.ops.editTitle(action.incident.type_display)
      : action
        ? t.ops.manageTitle(action.incident.type_display)
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

      {(incidents ?? []).map((incident) => (
        <div key={incident.id} className="ops-open-row">
          <div className="ops-open-main">
            <strong>{incident.type_display}</strong>
            <span className="muted">{incident.date ? fmtDate(incident.date, language) : '—'}</span>
            {incident.priority_display && (
              <Badge tone={incidentPriorityTone(incident.priority)}>
                {incident.priority_display}
              </Badge>
            )}
            <Badge tone={incident.status === 'open' ? 'warning' : 'info'}>
              {incident.status_display}
            </Badge>
          </div>
          {incident.description && <p className="muted ops-open-desc">{incident.description}</p>}
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
              onClick={() => {
                setError('')
                setNotice('')
                setResolving(incidentTarget(incident))
              }}
            >
              {t.ops.openResolveBtn}
            </Button>
          </div>
        </div>
      ))}

      {/* Modificar y gestionar comparten el contenedor (portal del DS). */}
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
              {/* La prioridad se puede reajustar mientras la petición vive. */}
              <SelectField
                label={t.priority.label}
                aria-label={t.priority.label}
                options={priorityChoices}
                value={edit.priority}
                onValueChange={(value) => setEdit((f) => ({ ...f, priority: value }))}
                required
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
              <Button
                type="submit"
                variant="primary"
                disabled={saving || !/^[0-9]{5}$/.test(managePostalCode)}
              >
                {saving ? t.ops.saving : t.ops.save}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Resolver: el modal específico del tipo (avería, neumáticos, ITV…). */}
      <ResolveDispatcher
        target={resolving}
        vehicles={[vehicle]}
        onClose={() => setResolving(null)}
        onDone={done}
      />
    </div>
  )
}
