import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Panel, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { useAuth } from '../auth.ts'
import { listMyRequests, submitMyRequest } from '../api.ts'
import type { MyVehicleRequest } from '../types.ts'

const STATUS_TONE: Record<string, 'info' | 'success' | 'warning' | 'danger'> = {
  pending: 'info',
  approved: 'success',
  assigned: 'success',
  rejected: 'danger',
  closed: 'warning',
}

/**
 * Portón de acceso (M0 + Fase A2): el usuario sin vehículo abre un ticket de
 * Jira, registra aquí su clave y sigue el estado de su solicitud. Cuando la
 * administración le concede el coche, "Volver a comprobar" le deja entrar.
 */
export function RequestAccessPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [requests, setRequests] = useState<MyVehicleRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [jiraKey, setJiraKey] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    listMyRequests()
      .then((rows) => {
        setRequests(rows)
        const open = rows.find((r) => r.status === 'pending' || r.status === 'approved')
        if (open) {
          setJiraKey(open.jira_key)
          setNotes(open.notes)
        }
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudo cargar tu solicitud.')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const open = requests.find((r) => r.status === 'pending' || r.status === 'approved')
  const granted = requests.find((r) => r.status === 'assigned')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setOkMsg('')
    setBusy(true)
    try {
      await submitMyRequest({ jira_key: jiraKey.trim(), notes })
      setOkMsg(open ? 'Solicitud actualizada.' : 'Solicitud registrada. Queda pendiente de aprobación.')
      load()
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo guardar la solicitud.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Solicita tu vehículo</h1>
        <p className="sub">
          Hola {user?.first_name || user?.username}: aún no tienes un vehículo asignado.
        </p>

        {loading ? (
          <p>Cargando…</p>
        ) : (
          <>
            {granted && (
              <Panel tone="success">
                <p style={{ margin: 0 }}>
                  🎉 Te han concedido el vehículo <strong>{granted.vehicle_plate}</strong>.
                </p>
              </Panel>
            )}

            {open ? (
              <Panel tone={STATUS_TONE[open.status] ?? 'info'}>
                <p style={{ margin: 0 }}>
                  Tu solicitud está <strong>{open.status_display.toLowerCase()}</strong>
                  {open.jira_key ? (
                    <>
                      {' '}
                      (ticket <strong>{open.jira_key}</strong>)
                    </>
                  ) : (
                    ' — registra la clave de tu ticket para poder seguirla'
                  )}
                  .
                </p>
              </Panel>
            ) : (
              !granted && (
                <Panel tone="info">
                  <p style={{ margin: 0 }}>
                    1. Abre un <strong>ticket en Jira</strong> pidiendo un vehículo (tu manager lo
                    aprueba allí).
                    <br />
                    2. Registra aquí la <strong>clave del ticket</strong> (p. ej. FLT-123) para
                    seguir su estado.
                  </p>
                </Panel>
              )
            )}

            {!granted && (
              <form onSubmit={handleSubmit} className="request-form">
                <TextInputField
                  label="Clave del ticket de Jira"
                  placeholder="FLT-123"
                  value={jiraKey}
                  onChange={(e) => setJiraKey(e.target.value)}
                />
                <TextInputField
                  label="Notas (opcional)"
                  placeholder="p. ej. lo necesito para la obra de Badajoz"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <Button type="submit" variant="primary" fullWidth disabled={busy}>
                  {busy ? 'Guardando…' : open ? 'Actualizar solicitud' : 'Registrar solicitud'}
                </Button>
              </form>
            )}

            {okMsg && <div className="form-ok">{okMsg}</div>}
            {error && <div className="form-error">{error}</div>}

            <div className="request-actions">
              <Button variant="secondary" fullWidth onClick={() => navigate('/', { replace: true })}>
                {granted ? 'Entrar' : 'Volver a comprobar'}
              </Button>
              <Button variant="secondary" fullWidth onClick={logout}>
                Cerrar sesión
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
