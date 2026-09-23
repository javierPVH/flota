import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Car, ShieldCheck } from 'lucide-react'
import { Button, LanguageToggleButton, Modal } from '@flota/ui/ui'

import { startSamlLogin } from '../api.ts'
import { useLang } from '../i18n.tsx'
import { parseDeniedReason, useSsoCopy } from '../translations/sso.ts'
import type { AuthConfig } from '../types.ts'

/**
 * Entrada por **SSO corporativo** (SAML contra Google Workspace). En producción
 * es la única puerta de la PWA: un botón que navega al back
 * (`/api/v1/auth/saml/login/`), que manda a Google y vuelve con la sesión
 * puesta; el `AccessGate` decide después a dónde va.
 *
 * Quién entra lo decide el back: **solo un correo ya dado de alta y activo**.
 * Si no lo está, el ACS no abre sesión y devuelve aquí con `?saml=no_user`, y
 * esta página enseña el **modal** que manda a abrir el Jira de solicitud de
 * vehículo. Sin sesión no hay ninguna vista accesible (`RequireAuth`).
 */
export function SsoLoginPage({ config }: { config: AuthConfig }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { language, setLanguage, t } = useLang()
  const L = t.login
  const S = useSsoCopy()
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState(() => parseDeniedReason(searchParams.get('saml')))
  const sessionExpired =
    searchParams.get('auth') === 'required' || searchParams.get('expired') === '1'
  const loginUrl = config.saml_enabled ? config.saml_login_url : ''

  // Volver con «atrás» desde Google restaura la página desde la caché del
  // navegador con el botón aún en «Abriendo…»: se rearma.
  useEffect(() => {
    const rearmar = () => setBusy(false)
    window.addEventListener('pageshow', rearmar)
    return () => window.removeEventListener('pageshow', rearmar)
  }, [])

  function entrar() {
    setBusy(true)
    startSamlLogin(loginUrl, '/')
  }

  function cerrarModal() {
    setReason(null)
    // Se limpia la URL para que un «recargar» no vuelva a abrir el aviso.
    navigate('/login', { replace: true })
  }

  const denied = reason ? S.denied[reason] : null

  return (
    <div className="login-scene">
      <div className="login-card login-card-branded">
        <header className="login-topline">
          <div className="login-brand">
            {/* Un coche, no la inicial: es lo que dice de qué va esto sin
                leer nada, y es la misma marca del icono de la pestaña y del
                de instalar. */}
            <span className="login-brand-mark" aria-hidden="true">
              <Car size={22} strokeWidth={2.4} />
            </span>
            <span className="login-brand-name">{L.brand}</span>
          </div>
          <LanguageToggleButton activeLanguage={language} onChange={setLanguage} />
        </header>

        <h1 className="login-title">{L.heading}</h1>
        <p className="login-subtitle">{S.subtitle}</p>

        {sessionExpired && (
          <div role="alert" className="form-warn">
            {L.sessionExpired}
          </div>
        )}

        {loginUrl ? (
          <div className="login-fields">
            <button type="button" className="login-submit" disabled={busy} onClick={entrar}>
              {busy ? S.redirecting : S.button}
            </button>
            {/* Lo primero que verá tras pulsar es el selector de cuentas de
                Google (lo antepone el back): que no le pille de sorpresa. */}
            <p className="login-security">{S.chooser}</p>
          </div>
        ) : (
          <div role="alert" className="form-warn">
            {S.unavailable}
          </div>
        )}

        <p className="login-security">
          <ShieldCheck size={14} /> {S.security}
        </p>
        <p className="login-security">{S.noSlo}</p>
      </div>

      {denied && (
        <Modal
          open
          title={denied.title}
          onClose={cerrarModal}
          footer={
            <Button variant="secondary" fullWidth onClick={cerrarModal}>
              {S.close}
            </Button>
          }
        >
          <p>{denied.body}</p>
          {reason === 'no_user' &&
            (config.jira_request_url ? (
              // Sale de la aplicación: pestaña nueva y `noopener` para que la
              // página de destino no pueda tocar esta.
              <a
                className="jira-link"
                href={config.jira_request_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {S.openJira}
              </a>
            ) : (
              <div role="alert" className="form-error">
                {S.noUrl}
              </div>
            ))}
        </Modal>
      )}
    </div>
  )
}
