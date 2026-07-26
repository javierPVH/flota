import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, PageHeader } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchManagedUser, listAssignments, listVehicles } from '../api.ts'
import { useAuth } from '../auth.ts'
import {
  AccordionTools,
  CollapsibleCard,
  useAccordion,
} from '../components/CollapsibleCard.tsx'
import {
  TimelineChart,
  TimelineDayModal,
  type TimelineChartItem,
  type TimelineDay,
} from '../components/TimelineChart.tsx'
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
  // `user` es el usuario CONSULTADO; el de la sesión es `me` (para el gate admin).
  const { user: me } = useAuth()
  const isAdmin = me?.roles.includes('admin') ?? false
  const { id } = useParams()
  const userId = Number(id)

  const [user, setUser] = useState<ManagedUser | null>(null)
  const [history, setHistory] = useState<AssignmentRow[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [error, setError] = useState('')

  // Acordeón de secciones (mejora): desplegadas por defecto.
  const accordion = useAccordion(['history', 'group'])

  // O4: matrículas por Map (antes `find()` por celda) + grupo derivado (O3).
  const plateById = useMemo(() => new Map(vehicles.map((v) => [v.id, v.plate])), [vehicles])
  const plateOf = (vid: number) => plateById.get(vid) ?? `#${vid}`
  const group = useMemo(
    () => vehicles.filter((v) => v.supervisor === userId),
    [vehicles, userId],
  )

  // Línea temporal de cambios (solo admin): inicios y fines de asignación.
  const [timelineDay, setTimelineDay] = useState<TimelineDay | null>(null)
  const timelineItems = useMemo<TimelineChartItem[]>(() => {
    const plate = (vid: number) => plateById.get(vid) ?? `#${vid}`
    return history.flatMap((a) => {
      const items: TimelineChartItem[] = [
        {
          key: `s${a.id}`,
          date: a.start_date,
          title: `Asignación de ${plate(a.vehicle)}`,
          sub: STATUS_LABEL[a.status] ?? a.status,
          kind: 'event',
        },
      ]
      if (a.end_date) {
        items.push({
          key: `f${a.id}`,
          date: a.end_date,
          title: `Fin de asignación de ${plate(a.vehicle)}`,
          kind: 'audit',
        })
      }
      return items
    })
  }, [history, plateById])

  useEffect(() => {
    if (!userId) return
    fetchManagedUser(userId)
      .then(setUser)
      .catch((err) => setError(asErrorMessage(err, 'No se pudo cargar el usuario.')))
    listAssignments({ driver: userId })
      .then((page) =>
        setHistory([...page.results].sort((a, b) => (a.start_date < b.start_date ? 1 : -1))),
      )
      .catch(() => setHistory([]))
    // Una sola carga de vehículos (O3): da el mapa de matrículas Y el grupo.
    listVehicles({ include_baja: 1 })
      .then((page) => setVehicles(page.results))
      .catch(() => setVehicles([]))
  }, [userId])

  if (error) return <div role="alert" className="form-error">{error}</div>
  if (!user) return <p className="loading-state" role="status">Cargando…</p>

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

      <AccordionTools accordion={accordion} />

      <div className="detail-grid">
        <CollapsibleCard id="history" accordion={accordion} title="Vehículos que ha tenido">
          {isAdmin && <TimelineChart items={timelineItems} onSelectDay={setTimelineDay} />}
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
        </CollapsibleCard>

        {user.roles.includes('supervisor') && (
          <CollapsibleCard id="group" accordion={accordion} title="Su grupo como supervisor">
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
          </CollapsibleCard>
        )}
      </div>

      <TimelineDayModal day={timelineDay} onClose={() => setTimelineDay(null)} />
    </div>
  )
}
