import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  createVehicle,
  deleteVehicle,
  listDrivers,
  listVehicles,
  updateVehicle,
  type VehicleInput,
} from '../api.ts'
import type { Driver, Vehicle, VehicleStatus } from '../types.ts'

const STATUS_OPTIONS = [
  { value: 'active', label: 'Activo' },
  { value: 'maintenance', label: 'En mantenimiento' },
  { value: 'retired', label: 'Retirado' },
]

const EMPTY: VehicleInput = { plate: '', brand: '', model: '', status: 'active' }

export function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [form, setForm] = useState<VehicleInput>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([listVehicles(), listDrivers()])
      .then(([page, ds]) => {
        setVehicles(page.results)
        setDrivers(ds)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudieron cargar los vehículos.')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const driverOptions = useMemo(
    () => [
      { value: '', label: '— Sin asignar —' },
      ...drivers.map((d) => ({ value: String(d.id), label: d.name })),
    ],
    [drivers],
  )

  function openCreate() {
    setEditing(null)
    setForm(EMPTY)
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(v: Vehicle) {
    setEditing(v)
    setForm({
      plate: v.plate,
      brand: v.brand,
      model: v.model,
      year: v.year,
      status: v.status,
      assigned_driver: v.assigned_driver,
      notes: v.notes,
    })
    setFormError('')
    setModalOpen(true)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFormError('')
    try {
      if (editing) await updateVehicle(editing.id, form)
      else await createVehicle(form)
      setModalOpen(false)
      load()
    } catch (err) {
      setFormError(asErrorMessage(err, 'No se pudo guardar el vehículo.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(v: Vehicle) {
    if (!window.confirm(`¿Eliminar el vehículo ${v.plate}?`)) return
    try {
      await deleteVehicle(v.id)
      load()
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo eliminar.'))
    }
  }

  return (
    <div>
      <div className="page-head">
        <h2>Vehículos</h2>
        <Button variant="primary" onClick={openCreate}>
          Nuevo vehículo
        </Button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <p>Cargando…</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Matrícula</th>
              <th>Marca</th>
              <th>Modelo</th>
              <th>Estado</th>
              <th>Conductor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vehicles.length === 0 && (
              <tr>
                <td colSpan={6}>No hay vehículos todavía.</td>
              </tr>
            )}
            {vehicles.map((v) => (
              <tr key={v.id}>
                <td>
                  <strong>{v.plate}</strong>
                </td>
                <td>{v.brand}</td>
                <td>{v.model}</td>
                <td>
                  <span className={`badge ${v.status}`}>{v.status_display}</span>
                </td>
                <td>{v.assigned_driver_name || '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Button variant="secondary" size="sm" onClick={() => openEdit(v)}>
                    Editar
                  </Button>{' '}
                  <Button variant="danger" size="sm" onClick={() => handleDelete(v)}>
                    Eliminar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal
        open={modalOpen}
        title={editing ? `Editar ${editing.plate}` : 'Nuevo vehículo'}
        onClose={() => setModalOpen(false)}
      >
        <form className="modal-form" onSubmit={handleSubmit}>
          <TextInputField
            label="Matrícula"
            value={form.plate ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value }))}
            required
          />
          <TextInputField
            label="Marca"
            value={form.brand ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
            required
          />
          <TextInputField
            label="Modelo"
            value={form.model ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            required
          />
          <TextInputField
            label="Año"
            type="number"
            value={form.year ?? ''}
            onChange={(e) =>
              setForm((f) => ({ ...f, year: e.target.value ? Number(e.target.value) : null }))
            }
          />
          <SelectField
            label="Estado"
            options={STATUS_OPTIONS}
            value={form.status ?? 'active'}
            onValueChange={(value) => setForm((f) => ({ ...f, status: value as VehicleStatus }))}
          />
          <SelectField
            label="Conductor asignado"
            options={driverOptions}
            value={form.assigned_driver != null ? String(form.assigned_driver) : ''}
            onValueChange={(value) =>
              setForm((f) => ({ ...f, assigned_driver: value ? Number(value) : null }))
            }
          />
          {formError && <div className="form-error">{formError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
