import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, PageHeader } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchManagedUser, listAssignments, listVehicles } from '../api.ts'
import { assignmentStatusTone } from '../format.ts'
import type { AssignmentRow, ManagedUser, Vehicle } from '../types.ts'

const STATUS_LABEL: Record<string, string> = {
  proposed: 'Propuesta',
  accepted: 'Vigente',
  rejected: 'Rechazada',
  finished: 'Finalizada',
}

/** Detalle de un usuario: qué vehículos ha tenido (HU-2.6) y, si es
 * supervisor, su grupo (HU-2.7). */
export function UserDetailPage() {
  const { id } = useParams()
  const userId = Number(id)

  const [user, setUser] = useState<ManagedUser | null>(null)
  const [history, setHistory] = useState<AssignmentRow[]>([])
  const [group, setGroup] = useState<Vehicle[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!userId) return
    fetchManagedUser(userId)
      .then((u) => {
        setUser(u)
        if (u.roles.includes('supervisor')) {
          // El grupo del supervisor: vehículos con supervisor = él/ella.
          listVehicles({ include_baja: 1 })
            .then((page) => setGroup(page.results.filter((v) => v.supervisor === userId)))
            .catch(() => setGroup([]))
        }
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudo cargar el usuario.')))
    listAssignments({ driver: userId })
      .then((page) =>
        setHistory([...page.results].sort((a, b) => (a.start_date < b.start_date ? 1 : -1))),
      )
      .catch(() => setHistory([]))
    listVehicles({ include_baja: 1 })
      .then((page) => setVehicles(page.results))
      .catch(() => setVehicles([]))
  }, [userId])

  if (error) return <div className="form-error">{error}</div>
  if (!user) return <p>Cargando…</p>

  const plateOf = (vid: number) => vehicles.find((v) => v.id === vid)?.plate ?? `#${vid}`
  const fullName = `${user.first_name} ${user.last_name}`.trim() || user.username

  return (
    <div>
      <PageHeader
        breadcrumb={<Link to="/conductores">← Conductores y usuarios</Link>}
        title={fullName}
        subtitle={
          `${user.username}` +
          (user.license_type ? ` · Permiso ${user.license_type}` : '') +
          (user.fuel_card ? ' · ⛽ tarjeta de combustible' : '')
        }
      />

      <div className="detail-grid">
        <section className="card">
          <h3>Vehículos que ha tenido</h3>
          {history.length === 0 ? (
            <p className="muted">Sin asignaciones registradas.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Vehículo</th>
                  <th>Periodo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {history.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/vehiculos/${a.vehicle}`}>
                        <strong>{plateOf(a.vehicle)}</strong>
                      </Link>
                    </td>
                    <td>
                      {a.start_date} → {a.end_date ?? '…'}
                    </td>
                    <td>
                      <Badge tone={assignmentStatusTone(a.status)}>
                        {STATUS_LABEL[a.status] ?? a.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {user.roles.includes('supervisor') && (
          <section className="card">
            <h3>Su grupo como supervisor</h3>
            {group.length === 0 ? (
              <p className="muted">
                No tiene vehículos a su cargo. El grupo se compone asignándole como supervisor en
                la edición de cada vehículo.
              </p>
            ) : (
              <ul className="usage-list">
                {group.map((v) => (
                  <li key={v.id}>
                    <Link to={`/vehiculos/${v.id}`}>
                      <strong>{v.plate}</strong>
                    </Link>{' '}
                    — {v.brand} {v.model} ({v.state_display || '—'})
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
