import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Panel, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { useAuth } from '../auth.ts'
import { listMyRequests, submitMyRequest } from '../api.ts'
import { useLang } from '../i18n.tsx'
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
  const { t } = useLang()
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
      .catch((err) => setError(asErrorMessage(err, t.request.loadError)))
      .finally(() => setLoading(false))
  }, [t])

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
      setOkMsg(open ? t.request.updated : t.request.registered)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.request.saveError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-scene">
      <div className="login-card">
        <h1>{t.request.title}</h1>
        <p className="sub">{t.request.hello(user?.first_name || user?.username || '')}</p>

        {loading ? (
          <p role="status" className="gate-checking">{t.common.loading}</p>
        ) : (
          <>
            {granted && (
              <Panel tone="success">
                <p style={{ margin: 0 }}>
                  🎉 {t.request.granted} <strong>{granted.vehicle_plate}</strong>.
                </p>
              </Panel>
            )}

            {open ? (
              <Panel tone={STATUS_TONE[open.status] ?? 'info'}>
                <p style={{ margin: 0 }}>
                  {t.request.statusIs} <strong>{open.status_display.toLowerCase()}</strong>
                  {open.jira_key ? (
                    <>
                      {' '}
                      ({t.request.ticketWord} <strong>{open.jira_key}</strong>)
                    </>
                  ) : (
                    <> {t.request.registerHint}</>
                  )}
                  .
                </p>
              </Panel>
            ) : (
              !granted && (
                <Panel tone="info">
                  <p style={{ margin: 0 }}>
                    {t.request.howTo1}
                    <br />
                    {t.request.howTo2}
                  </p>
                </Panel>
              )
            )}

            {!granted && (
              <form onSubmit={handleSubmit} className="request-form">
                <TextInputField
                  label={t.request.jiraLabel}
                  placeholder="FLT-123"
                  value={jiraKey}
                  onChange={(e) => setJiraKey(e.target.value)}
                />
                <TextInputField
                  label={t.request.notesLabel}
                  placeholder={t.request.notesPlaceholder}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <Button type="submit" variant="primary" fullWidth disabled={busy}>
                  {busy ? t.request.saving : open ? t.request.update : t.request.register}
                </Button>
              </form>
            )}

            {okMsg && <div role="status" className="form-ok">{okMsg}</div>}
            {error && <div role="alert" className="form-error">{error}</div>}

            <div className="request-actions">
              <Button variant="secondary" fullWidth onClick={() => navigate('/', { replace: true })}>
                {granted ? t.request.enter : t.request.recheck}
              </Button>
              <Button variant="secondary" fullWidth onClick={logout}>
                {t.common.logout}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
