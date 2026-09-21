import { useEffect, useState } from 'react'

import { fetchAuthConfig } from '../api.ts'
import { useLang } from '../i18n.tsx'
import { GoogleLoginPage } from '../pages/GoogleLoginPage.tsx'
import { LoginPage } from '../pages/LoginPage.tsx'
import { SsoLoginPage } from '../pages/SsoLoginPage.tsx'
import type { AuthConfig } from '../types.ts'

/** Conductores puede entrar SOLO con Google (OIDC). La vista está hecha
 * (`GoogleLoginPage`) pero **sin activar**: en producción manda el SSO por
 * SAML, que el back anuncia en `/auth/config/`. Mismo patrón que
 * `SHOW_OPEN_TAB` en gestión: el código sigue, la interfaz no. */
const SOLO_GOOGLE = false

/**
 * Qué login se pinta lo dice el back (`GET /auth/config/`): con
 * `saml_enabled` la PWA entra **solo** por el SSO corporativo; si no, la
 * pantalla de siempre (usuario/clave + selector de desarrollo) o la de Google.
 * Si la configuración no se puede leer (sin red al arrancar), se cae a la de
 * siempre: es la que sabe explicar qué pasa.
 */
export function LoginSwitch() {
  const { t } = useLang()
  const [config, setConfig] = useState<AuthConfig | null | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    fetchAuthConfig({ signal: controller.signal })
      .then(setConfig)
      .catch(() => {
        if (!controller.signal.aborted) setConfig(null)
      })
    return () => controller.abort()
  }, [])

  if (config === undefined) {
    return (
      <p role="status" className="gate-checking">
        {t.common.loading}
      </p>
    )
  }
  if (config?.saml_enabled) return <SsoLoginPage config={config} />
  return SOLO_GOOGLE ? <GoogleLoginPage /> : <LoginPage />
}
