import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchVehicleSummaries, listVehicles } from '../api.ts'
import { useAuth } from '../auth.ts'
import { VehicleCardList } from '../components/VehicleCards.tsx'
import { pendingThisMonth } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'

// Orden canónico de los grupos por estado (los que existan en la flota).
// El resto de estados —baja, no activo…— van detrás, en orden de aparición.
const STATE_ORDER = ['active', 'maintenance', 'itv', 'broken', 'accidente']

/**
 * Flota a cargo (HU-2.8): la lista del grupo del supervisor, separada por
 * grupos de ESTADO seleccionables (Todos · Activos · Taller…).
 * Su coche propio vive en "Mi vehículo" (`/`); la proyección de km y las
 * incidencias del grupo siguen en `/grupo`, que ya tiene su icono en el
 * bottom-nav — aquí no se duplica el acceso.
 */
export function FleetPage() {
  const { user } = useAuth()
  const { t } = useLang()
  const isSupervisor = user?.roles.includes('supervisor') ?? false

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [summaries, setSummaries] = useState<Record<number, VehicleSummary>>({})
  const [tab, setTab] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Solo los coches que SUPERVISA: los roles se suman, así que sin el filtro
  // un supervisor que además es admin vería aquí toda la flota (y uno que
  // además conduce, su propio coche). Este espacio es su grupo; su coche vive
  // en "Mi vehículo".
  const supervisorId = user?.id ?? null

  // Reutilizable: la carga inicial y el refresco tras guardar algo desde los
  // modales de tarjeta (actualización de km/mantenimiento/partes).
  const load = useCallback(() => {
    if (supervisorId === null) return
    Promise.all([
      listVehicles({ supervisor: supervisorId }),
      fetchVehicleSummaries().catch(() => [] as VehicleSummary[]),
    ])
      .then(([page, loaded]) => {
        setVehicles(page.results)
        setSummaries(Object.fromEntries(loaded.map((s) => [s.vehicle, s])))
      })
      .catch((err) => setError(asErrorMessage(err, t.home.loadError)))
      .finally(() => setLoading(false))
  }, [t, supervisorId])

  useEffect(() => {
    if (isSupervisor) load()
  }, [isSupervisor, load])

  // Búsqueda en cliente sobre el grupo entero; el selector corta después.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return vehicles
    return vehicles.filter((v) => `${v.plate} ${v.brand} ${v.model}`.toLowerCase().includes(q))
  }, [vehicles, query])

  // Grupos por estado. La etiqueta sale del `state_display` del
  // back (lista cerrada); solo se ofrecen los estados con algún coche.
  const groups = useMemo(() => {
    const byState = new Map<string, { label: string; count: number }>()
    searched.forEach((v) => {
      const entry = byState.get(v.state)
      if (entry) entry.count += 1
      else byState.set(v.state, { label: v.state_display || '—', count: 1 })
    })
    return [...byState.entries()]
      .map(([state, { label, count }]) => ({ state, label, count }))
      .sort((a, b) => {
        const ai = STATE_ORDER.indexOf(a.state)
        const bi = STATE_ORDER.indexOf(b.state)
        return (ai === -1 ? STATE_ORDER.length : ai) - (bi === -1 ? STATE_ORDER.length : bi)
      })
  }, [searched])

  // Si la búsqueda deja sin coches al estado activo, su opción desaparece:
  // el corte vuelve a "Todos" en vez de quedarse en una lista vacía sin salida.
  const activeTab = groups.some((g) => g.state === tab) ? tab : ''
  const visible = useMemo(
    () => (activeTab ? searched.filter((v) => v.state === activeTab) : searched),
    [searched, activeTab],
  )

  if (!isSupervisor) return <Navigate to="/" replace />
  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>
  if (error) return <div role="alert" className="form-error">{error}</div>

  const pending = vehicles.filter((v) => {
    const s = summaries[v.id]
    return s && pendingThisMonth(s)
  }).length

  return (
    <div>
      <PageHeader
        title={t.fleet.title}
        stats={[
          { value: vehicles.length, label: t.home.statVehicles },
          { value: pending, label: t.home.statPending },
        ]}
      />

      <div className="fleet-toolbar">
        <input
          type="search"
          className="card-search"
          placeholder={t.home.searchPlaceholder}
          aria-label={t.home.searchLabel}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {/* "Todos" siempre; el resto se recalcula con los resultados de búsqueda. */}
        <select
          className="fleet-state-select"
          aria-label={t.fleet.tabsLabel}
          value={activeTab}
          onChange={(e) => setTab(e.target.value)}
        >
          <option value="">{t.fleet.tabAll} ({searched.length})</option>
          {groups.map((g) => (
            <option key={g.state} value={g.state}>{g.label} ({g.count})</option>
          ))}
        </select>
      </div>

      {visible.length === 0 && <p className="empty-note">{t.home.empty}</p>}

      {/* El `lookup` es el grupo entero: la pareja de sustitución se resuelve
          aunque el filtro o la búsqueda dejen fuera a uno de los dos. */}
      <VehicleCardList
        vehicles={visible}
        lookup={vehicles}
        summaries={summaries}
        isSupervisor
        onRefresh={load}
      />
    </div>
  )
}
