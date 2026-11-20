import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, CircleHelp, CirclePlay, X } from 'lucide-react'

import { useLang } from '../i18n.tsx'
import { readSeen } from '../tutorial/progress.ts'

/**
 * Accesos a la Ayuda desde fuera de ella (plan §6): el login, «Mi perfil» y
 * la bienvenida de la primera vez. El botón «?» de la cabecera vive en Layout.
 */

/** Login (las tres pantallas de entrada): la ayuda es pública, se abre sin sesión. */
export function LoginHelpLink() {
  const { t } = useLang()
  return (
    <Link to="/ayuda/entrar" state={{ from: '/login' }} className="login-help">
      <CircleHelp size={16} aria-hidden="true" />
      {t.help.loginLink}
    </Link>
  )
}

/** «Mi perfil»: una fila más, con lo que se encuentra en la ayuda. */
export function ProfileHelpLink() {
  const { t } = useLang()
  return (
    <Link to="/ayuda" state={{ from: '/perfil' }} className="card help-row">
      <span className="help-row-icon" aria-hidden="true">
        <CircleHelp size={20} />
      </span>
      <span className="help-row-text">
        <strong>{t.help.profileLink}</strong>
        <span className="doc-sub">{t.help.profileHint}</span>
      </span>
      <ChevronRight size={18} aria-hidden="true" />
    </Link>
  )
}

const welcomeKey = (userId: number) => `flota.campo.ayuda.bienvenida.${userId}`

function welcomeDone(userId: number): boolean {
  try {
    return localStorage.getItem(welcomeKey(userId)) === '1' || readSeen().size > 0
  } catch {
    // Sin almacenamiento no se puede recordar el «Ahora no»: mejor no insistir.
    return true
  }
}

/**
 * La primera vez que alguien entra, una tarjeta pequeña (no un modal: no tapa
 * lo urgente) con el vídeo y la ayuda. Se recuerda por usuario en este
 * dispositivo, y no sale a quien ya ha abierto algún capítulo.
 */
export function HelpWelcome({ userId }: { userId: number }) {
  const { t } = useLang()
  const [hidden, setHidden] = useState(() => welcomeDone(userId))
  if (hidden) return null

  function dismiss() {
    try {
      localStorage.setItem(welcomeKey(userId), '1')
    } catch {
      /* no se recuerda: vuelve a salir la próxima vez */
    }
    setHidden(true)
  }

  return (
    <section className="card help-welcome" aria-labelledby="help-welcome-title">
      <div className="help-welcome-head">
        <CircleHelp size={20} aria-hidden="true" />
        <strong id="help-welcome-title">{t.help.welcomeTitle}</strong>
        <button type="button" className="help-welcome-close" onClick={dismiss} aria-label={t.help.welcomeDismiss}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <p className="doc-sub">{t.help.welcomeText}</p>
      <div className="help-welcome-actions">
        <Link to="/ayuda/video" state={{ from: '/' }} className="help-welcome-btn is-primary" onClick={dismiss}>
          <CirclePlay size={16} aria-hidden="true" /> {t.help.welcomeVideo}
        </Link>
        <Link to="/ayuda" state={{ from: '/' }} className="help-welcome-btn" onClick={dismiss}>
          {t.help.welcomeHelp}
        </Link>
      </div>
    </section>
  )
}
