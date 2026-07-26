import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { Button, LanguageToggleButton, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { useAuth } from '../auth.ts'
import { devLogin, fetchAuthConfig, listDevUsers, login } from '../api.ts'
import { useLang } from '../i18n.tsx'
import type { AuthConfig, DevUser } from '../types.ts'

/**
 * Login de campo (Fase 2): tarjeta única con acento naranja sobre el wallpaper
 * velado — el lado izquierdo del login de gestión, sin el panel de marca (en
 * móvil no cabe). Conserva usuario/clave y el selector de login de desarrollo.
 */
export function LoginPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  // El transporte redirige aquí con ?auth=required cuando la sesión caduca (401).
  const [searchParams] = useSearchParams()
  const sessionExpired = searchParams.get('auth') === 'required'
  const { language, setLanguage, t } = useLang()
  const L = t.login
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
      // El AccessGate decide a dónde va: app, portón de solicitud o 403.
      setUser(await login(username, password))
      navigate('/', { replace: true })
    } catch (err) {
      setError(asErrorMessage(err, L.errorLogin))
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
      setError(asErrorMessage(err, L.errorDev))
    } finally {
      setBusy(false)
    }
  }

  const passwordEnabled = config?.password_enabled ?? true

  return (
    <div className="login-scene">
      <div className="login-card login-card-branded">
        <header className="login-topline">
          <div className="login-brand">
            <span className="login-brand-mark" aria-hidden="true">F</span>
            <span className="login-brand-name">{L.brand}</span>
          </div>
          <LanguageToggleButton activeLanguage={language} onChange={setLanguage} />
        </header>

        <h1 className="login-title">{L.heading}</h1>
        <p className="login-subtitle">{L.subtitle}</p>

        {sessionExpired && (
          <div role="alert" className="form-warn">
            {L.sessionExpired}
          </div>
        )}

        {passwordEnabled && (
          <form className="login-fields" onSubmit={handleSubmit}>
            <TextInputField
              label={L.userLabel}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
            <TextInputField
              label={L.passwordLabel}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button type="submit" className="login-submit" disabled={busy}>
              {busy ? L.submitting : L.submit}
            </button>
          </form>
        )}

        {config?.dev_login_enabled && devUsers.length > 0 && (
          <div className="login-dev">
            <p className="login-dev-title">{L.devTitle}</p>
            <SelectField
              label={L.devUserLabel}
              options={devUsers.map((u) => ({
                value: u.username,
                label: `${u.name} (${u.roles.join(', ') || L.devNoRole})`,
              }))}
              value={devUsername}
              onValueChange={setDevUsername}
            />
            <Button type="button" variant="secondary" fullWidth disabled={busy} onClick={handleDevLogin}>
              {L.devSubmit}
            </Button>
          </div>
        )}

        {error && <div role="alert" className="form-error">{error}</div>}

        <p className="login-security">
          <ShieldCheck size={14} /> {L.security}
        </p>
      </div>
    </div>
  )
}
