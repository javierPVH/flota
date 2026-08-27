import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { listVehicleUsages, setUsageSplit } from '../api.ts'
import { fmtDate, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Driver, Vehicle, VehicleUsageRow } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

interface Line {
  driver: string
  percent: string
}

/**
 * Reparto de uso de un vehículo (HU-2.5): personas con %, suma EXACTAMENTE
 * 100 (indicador en vivo; el back lo revalida y cierra el reparto vigente en
 * la misma transacción). Muestra el vigente y el histórico.
 */
export function UsageSplitModal({
  vehicle,
  drivers,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  drivers: Driver[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLang()
  const [usages, setUsages] = useState<VehicleUsageRow[]>([])
  const [lines, setLines] = useState<Line[]>([{ driver: '', percent: '100' }])
  const [startDate, setStartDate] = useState(todayIso())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const driverName = useMemo(() => {
    const map = new Map(drivers.map((d) => [d.id, d.name]))
    return (id: number) => map.get(id) ?? `#${id}`
  }, [drivers])

  useEffect(() => {
    listVehicleUsages(vehicle.id)
      .then((page) => {
        setUsages(page.results)
        // Prefill con el reparto vigente (sin fecha de fin).
        const current = page.results.filter((u) => !u.end_date)
        if (current.length > 0) {
          setLines(
            current.map((u) => ({
              driver: String(u.driver),
              percent: u.usage_percent ? String(Number(u.usage_percent)) : '',
            })),
          )
        }
      })
      .catch(() => setUsages([]))
  }, [vehicle.id])

  const total = lines.reduce((sum, line) => sum + (Number(line.percent) || 0), 0)
  const complete = lines.every((l) => l.driver && Number(l.percent) > 0)
  const balanced = Math.abs(total - 100) < 0.001

  function setLine(index: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await setUsageSplit({
        vehicle: vehicle.id,
        start_date: startDate,
        items: lines.map((l) => ({ driver: Number(l.driver), usage_percent: l.percent })),
      })
      onSaved()
    } catch (err) {
      setError(asErrorMessage(err, t.split.saveError))
    } finally {
      setSaving(false)
    }
  }

  const history = usages.filter((u) => u.end_date)

  return (
    <SupervisorModal open title={t.split.title(vehicle.plate)} onClose={onClose}>
      <form className="modal-form" onSubmit={handleSubmit}>
        <p className="doc-sub">{t.split.hint}</p>

        {lines.map((line, index) => (
          <div key={index} className="split-line">
            <SelectField
              label={index === 0 ? t.split.person : undefined}
              options={[
                { value: '', label: t.split.choose },
                ...drivers.map((d) => ({ value: String(d.id), label: d.name })),
              ]}
              value={line.driver}
              onValueChange={(value) => setLine(index, { driver: value })}
            />
            <TextInputField
              label={index === 0 ? '%' : undefined}
              type="number"
              min={1}
              max={100}
              inputMode="decimal"
              value={line.percent}
              onChange={(e) => setLine(index, { percent: e.target.value })}
            />
            {lines.length > 1 && (
              <button
                type="button"
                className="line-remove"
                aria-label={t.split.removePerson}
                onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}
              >
                <Trash2 size={18} aria-hidden />
              </button>
            )}
          </div>
        ))}

        <div className="split-tools">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setLines((ls) => [...ls, { driver: '', percent: '' }])}
          >
            <Plus size={15} aria-hidden /> {t.split.addPerson}
          </Button>
          <span className={`split-total ${balanced ? 'ok' : 'ko'}`}>{t.split.sum(total)}</span>
        </div>

        <TextInputField
          label={t.split.since}
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          required
        />

        {error && <div role="alert" className="form-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={saving || !balanced || !complete}>
            {saving ? t.split.saving : t.split.save}
          </Button>
        </div>

        {history.length > 0 && (
          <div className="split-history">
            <h4 className="panel-title">{t.split.history}</h4>
            <ul className="doc-list">
              {history.map((u) => (
                <li key={u.id} className="doc-item">
                  <div className="doc-info">
                    <strong>
                      {driverName(u.driver)} · {u.usage_percent ? `${Number(u.usage_percent)}%` : '—'}
                    </strong>
                    <span className="doc-sub">
                      {fmtDate(u.start_date)} → {fmtDate(u.end_date)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </SupervisorModal>
  )
}
