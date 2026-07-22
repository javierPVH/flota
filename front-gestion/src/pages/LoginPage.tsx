import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { useAuth } from '../auth.ts'
import { devLogin, fetchAuthConfig, listDevUsers, login } from '../api.ts'
import type { AuthConfig, DevUser } from '../types.ts'

export function LoginPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Selector de DESARROLLO (solo si el back lo anuncia — DEBUG+FLEET_SEED_DATA).
  const [devUsers, setDevUsers] = useState<DevUser[]>([])
  const [devUsername, setDevUsername] = useState('')

  useEffect(() => {
    let alive = true
    fetchAuthConfig()
      .then((cfg) => {
        if (!alive) return
        setConfig(cfg)
        if (cfg.dev_login_enabled) {
          listDevUsers()
            .then((users) => {
              if (!alive) return
              setDevUsers(users)
              setDevUsername(users[0]?.username ?? '')
            })
            .catch(() => {})
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      // El AdminGate decide: un no-admin verá la pantalla 403, no un bucle.
      setUser(await login(username, password))
      navigate('/', { replace: true })
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo iniciar sesión.'))
    } finally {
      setBusy(false)
    }
  }

  async function handleDevLogin() {
    if (!devUsername) return
    setError('')
    setBusy(true)
    try {
      setUser(await devLogin(devUsername))
      navigate('/', { replace: true })
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo entrar como usuario de prueba.'))
    } finally {
      setBusy(false)
    }
  }

  const passwordEnabled = config?.password_enabled ?? true

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Flota · Gestión</h1>
        <p className="sub">Acceso restringido (VPN) — solo administración.</p>
        {passwordEnabled && (
          <>
            <TextInputField
              label="Usuario o email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
            <TextInputField
              label="Contraseña"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <Button type="submit" variant="primary" fullWidth disabled={busy}>
              {busy ? 'Entrando…' : 'Entrar'}
            </Button>
          </>
        )}

        {config?.dev_login_enabled && devUsers.length > 0 && (
          <div className="dev-login">
            <p className="sub">🧪 Desarrollo: entra como usuario de prueba</p>
            <SelectField
              label="Usuario de prueba"
              options={devUsers.map((u) => ({
                value: u.username,
                label: `${u.name} (${u.roles.join(', ') || 'sin rol'})`,
              }))}
              value={devUsername}
              onValueChange={setDevUsername}
            />
            <Button type="button" variant="secondary" fullWidth disabled={busy} onClick={handleDevLogin}>
              Entrar sin contraseña
            </Button>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}
      </form>
    </div>
  )
}
