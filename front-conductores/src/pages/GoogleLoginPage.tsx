import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { LanguageToggleButton } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { useAuth } from '../auth.ts'
import { fetchAuthConfig, googleLogin } from '../api.ts'
import { useLang } from '../i18n.tsx'
import type { AuthConfig } from '../types.ts'

/** El botón de Google lo pinta la propia librería de Google (GIS). */
const GIS_SRC = 'https://accounts.google.com/gsi/client'

type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string
        callback: (response: { credential?: string }) => void
      }) => void
      renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentity
  }
}

/** Carga la librería de Google una sola vez, aunque se monte dos veces. */
function cargarGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  const puesto = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)
  const script = puesto ?? document.createElement('script')
  const espera = new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => resolve())
    script.addEventListener('error', () => reject(new Error('gis')))
  })
  if (!puesto) {
    script.src = GIS_SRC
    script.async = true
    document.head.appendChild(script)
  }
  return espera
}

/**
 * Login **solo con Google** de la app de campo.
 *
 * Conductores sale a internet, así que la identidad la pone Google y no hay
 * usuario/clave que adivinar ni selector de desarrollo. Entrar por aquí es
 * además lo que **habilita subir documentos a Drive** (el back marca
 * `last_google_login` y el archivador exige esa marca).
 *
 * Está **sin activar**: la ruta sigue pintando `LoginPage` hasta que se
 * encienda el interruptor de `App.tsx`.
 */
export function GoogleLoginPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sessionExpired = searchParams.get('auth') === 'required'
  const { language, setLanguage, t } = useLang()
  const L = t.login
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const boton = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    fetchAuthConfig()
      .then((cfg) => alive && setConfig(cfg))
      .catch(() => alive && setConfig(null))
    return () => {
      alive = false
    }
  }, [])

  const clientId = config?.google_enabled ? config.google_client_id : ''
  useEffect(() => {
    if (!clientId) return
    let alive = true
    cargarGis()
      .then(() => {
        const id = window.google?.accounts?.id
        if (!alive || !id || !boton.current) return
        id.initialize({
          client_id: clientId,
          callback: async ({ credential }) => {
            if (!credential) return
            setBusy(true)
            setError('')
            try {
              // El AccessGate decide a dónde va: app, portón o 403.
              setUser(await googleLogin(credential))
              navigate('/', { replace: true })
            } catch (err) {
              setError(asErrorMessage(err, L.errorGoogle))
            } finally {
              setBusy(false)
            }
          },
        })
        id.renderButton(boton.current, { theme: 'outline', size: 'large', width: 280 })
      })
      .catch(() => alive && setError(L.errorGoogleScript))
    return () => {
      alive = false
    }
  }, [clientId, L.errorGoogle, L.errorGoogleScript, navigate, setUser])

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
        <p className="login-subtitle">{L.googleSubtitle}</p>

        {sessionExpired && (
          <div role="alert" className="form-warn">
            {L.sessionExpired}
          </div>
        )}

        {config && !clientId ? (
          <div role="alert" className="form-warn">
            {L.googleUnavailable}
          </div>
        ) : (
          <div className="login-google">
            <div ref={boton} />
            {busy && <p className="update-hint">{L.submitting}</p>}
          </div>
        )}

        {error && <div role="alert" className="form-error">{error}</div>}

        <p className="login-security">
          <ShieldCheck size={14} /> {L.googleSecurity}
        </p>
      </div>
    </div>
  )
}
