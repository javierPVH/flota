import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge, PageHeader } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
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
import { useUserDetailCopy } from '../translations/userDetail.ts'
import type { AssignmentRow, ManagedUser, Vehicle } from '../types.ts'

/** Detalle de un usuario: qué vehículos ha tenido (HU-2.6) y, si es
 * supervisor, su grupo (HU-2.7). */
export function UserDetailPage() {
  const t = useUserDetailCopy()
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
          title: t.assignmentOf(plate(a.vehicle)),
          sub: t.statuses[a.status] ?? a.status,
          kind: 'event',
        },
      ]
      if (a.end_date) {
        items.push({
          key: `f${a.id}`,
          date: a.end_date,
          title: t.assignmentEndOf(plate(a.vehicle)),
          kind: 'audit',
        })
      }
      return items
    })
  }, [history, plateById, t])

  useEffect(() => {
    if (!userId) return
    fetchManagedUser(userId)
      .then(setUser)
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
    listAssignments({ driver: userId })
      .then((page) =>
        setHistory([...page.results].sort((a, b) => (a.start_date < b.start_date ? 1 : -1))),
      )
      .catch(() => setHistory([]))
    // Una sola carga de vehículos (O3): da el mapa de matrículas Y el grupo.
    listVehicles({ include_baja: 1 })
      .then((page) => setVehicles(page.results))
      .catch(() => setVehicles([]))
  }, [userId, t])

  if (error) return <div role="alert" className="form-error">{error}</div>
  if (!user) return <p className="loading-state" role="status">{t.loading}</p>

  const fullName = `${user.first_name} ${user.last_name}`.trim() || user.username

  // Histórico de vehículos con el estilo unificado (TableWithPanel).
  const historyColumns: Array<TableWithPanelColumn<AssignmentRow>> = [
    {
      key: 'vehicle',
      label: t.columns.vehicle,
      getValue: (a) => plateOf(a.vehicle),
      render: (a) => (
        <Link to={`/vehiculos/${a.vehicle}`} className="cell-link">
          <strong>{plateOf(a.vehicle)}</strong>
        </Link>
      ),
    },
    {
      key: 'period',
      label: t.columns.period,
      getValue: (a) => a.start_date,
      render: (a) => `${a.start_date} → ${a.end_date ?? '…'}`,
    },
    {
      key: 'status',
      label: t.columns.status,
      getValue: (a) => t.statuses[a.status] ?? a.status,
      render: (a) => (
        <Badge tone={assignmentStatusTone(a.status)}>{t.statuses[a.status] ?? a.status}</Badge>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        breadcrumb={<Link to="/conductores">{t.breadcrumb}</Link>}
        title={fullName}
        subtitle={
          `${user.username}` +
          (user.license_type ? t.licenseSuffix(user.license_type) : '') +
          (user.fuel_card ? t.fuelCardSuffix : '')
        }
      />

      <AccordionTools accordion={accordion} />

      <div className="detail-grid">
        <CollapsibleCard id="history" accordion={accordion} title={t.historyTitle}>
          {isAdmin && <TimelineChart items={timelineItems} onSelectDay={setTimelineDay} />}
          {history.length === 0 ? (
            <p className="muted">{t.noAssignments}</p>
          ) : (
            <TableWithPanel<AssignmentRow>
              rows={history}
              columns={historyColumns}
              rowKey={(a) => String(a.id)}
              enablePagination
              defaultPageSize={25}
              pageSizeOptions={[25, 50, 100]}
            />
          )}
        </CollapsibleCard>

        {user.roles.includes('supervisor') && (
          <CollapsibleCard id="group" accordion={accordion} title={t.groupTitle}>
            {group.length === 0 ? (
              <p className="muted">{t.groupEmpty}</p>
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
