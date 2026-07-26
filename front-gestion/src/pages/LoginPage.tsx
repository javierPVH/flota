import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, LanguageToggleButton, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { Check, ShieldCheck } from 'lucide-react'

import { useAuth } from '../auth.ts'
import { useLang } from '../i18n.tsx'
import logoUrl from '../assets/img/gransolar-logo.png'
import { devLogin, fetchAuthConfig, listDevUsers, login } from '../api.ts'
import type { AuthConfig, DevUser } from '../types.ts'

export function LoginPage() {
  const { setUser } = useAuth()
  const { language, setLanguage, t } = useLang()
  const navigate = useNavigate()
  // El transporte redirige aquí con ?auth=required cuando la sesión caduca (401).
  const [searchParams] = useSearchParams()
  const sessionExpired = searchParams.get('auth') === 'required'
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Selector de DESARROLLO (solo si el back lo anuncia — DEBUG+FLEET_SEED_DATA).
  const [devUsers, setDevUsers] = useState<DevUser[]>([])
  const [devUsername, setDevUsername] = useState('')

  const L = t.login

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
      <div className="login-panel">
        <section className="login-form">
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

          <ul className="login-features">
            {L.features.map((feature) => (
              <li key={feature}>
                <span className="login-check" aria-hidden="true">
                  <Check size={13} />
                </span>
                {feature}
              </li>
            ))}
          </ul>

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
        </section>

        <aside className="login-brandpanel">
          <span className="login-pill">{L.panelPill}</span>
          <div className="login-brandbody">
            <img className="login-logo-img" src={logoUrl} alt="Gransolar Group" />
            <h2 className="login-panel-title">{L.panelHeading}</h2>
            <p className="login-panel-text">{L.panelText}</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
