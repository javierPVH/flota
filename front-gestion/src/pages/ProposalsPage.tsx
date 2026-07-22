import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { acceptAssignment, listAssignments, listVehicles, rejectAssignment } from '../api.ts'
import type { AssignmentRow, Vehicle } from '../types.ts'

/** Bandeja de propuestas de fechas (HU-2.4): confirmar (pasa a oficial y
 * cierra la vigente) o rechazar (sin alterar nada). */
export function ProposalsPage() {
  const [proposals, setProposals] = useState<AssignmentRow[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    listAssignments({ status: 'proposed' })
      .then((page) => {
        setProposals(page.results)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudieron cargar las propuestas.')))
      .finally(() => setLoading(false))
    listVehicles({ include_baja: 1 })
      .then((page) => setVehicles(page.results))
      .catch(() => setVehicles([]))
  }, [])

  useEffect(load, [load])

  const plateOf = (id: number) => vehicles.find((v) => v.id === id)?.plate ?? `#${id}`

  async function decide(proposal: AssignmentRow, accept: boolean) {
    setBusyId(proposal.id)
    setNotice('')
    setError('')
    try {
      if (accept) {
        await acceptAssignment(proposal.id)
        setNotice(
          `Propuesta de ${proposal.driver_name} sobre ${plateOf(proposal.vehicle)} confirmada: ` +
            'la asignación anterior queda cerrada y el cambio registrado como evento.',
        )
      } else {
        await rejectAssignment(proposal.id)
        setNotice(
          `Propuesta de ${proposal.driver_name} sobre ${plateOf(proposal.vehicle)} rechazada; ` +
            'la asignación vigente no cambia.',
        )
      }
      load()
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo procesar la propuesta.'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="page-head">
        <h2>Propuestas de fechas</h2>
        <span className="muted">{proposals.length} pendientes</span>
      </div>

      {notice && <div className="notice-ok">{notice}</div>}
      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <p>Cargando…</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Vehículo</th>
              <th>Conductor</th>
              <th>Inicio propuesto</th>
              <th>Fin propuesto</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {proposals.length === 0 && (
              <tr>
                <td colSpan={5}>No hay propuestas pendientes. 🎉</td>
              </tr>
            )}
            {proposals.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/vehiculos/${p.vehicle}`}>
                    <strong>{plateOf(p.vehicle)}</strong>
                  </Link>
                </td>
                <td>{p.driver_name}</td>
                <td>{p.start_date}</td>
                <td>{p.end_date ?? '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busyId === p.id}
                    onClick={() => decide(p, true)}
                  >
                    Confirmar
                  </Button>{' '}
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busyId === p.id}
                    onClick={() => decide(p, false)}
                  >
                    Rechazar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
