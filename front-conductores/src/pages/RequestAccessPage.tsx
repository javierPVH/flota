import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Panel } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import { fetchAuthConfig } from '../api.ts'
import { useLang } from '../i18n.tsx'

/**
 * Portón de acceso: el usuario que todavía no forma parte de la aplicación.
 *
 * Aquí solo se le enlaza a Jira para que abra su solicitud. **Jira no se
 * gestiona desde la aplicación**: no se registra la clave del ticket ni se
 * sigue su estado. Cuando la solicitud se aprueba allí, es la administración
 * quien activa al usuario a mano en la aplicación de admin; con «Volver a
 * comprobar» el usuario reintenta la entrada.
 *
 * La dirección la publica GET /auth/config/ (`FLEET_JIRA_REQUEST_URL`), para
 * poder cambiarla sin reconstruir la PWA. Si no está configurada, se explica
 * el trámite sin pintar un enlace roto.
 */
export function RequestAccessPage() {
  const { user, logout } = useAuth()
  const { t } = useLang()
  const navigate = useNavigate()
  const [jiraUrl, setJiraUrl] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    fetchAuthConfig({ signal: controller.signal })
      .then((cfg) => setJiraUrl(cfg.jira_request_url || ''))
      // Sin URL no hay nada que reintentar: se cae al aviso de «no configurada»,
      // que ya dice a quién avisar. No merece un error en rojo.
      .catch(() => setJiraUrl(''))
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="login-scene">
      <div className="login-card">
        <h1>{t.request.title}</h1>
        <p className="sub">{t.request.hello(user?.first_name || user?.username || '')}</p>

        {loading ? (
          <p role="status" className="gate-checking">
            {t.common.loading}
          </p>
        ) : (
          <>
            <Panel tone="info">
              <p style={{ margin: 0 }}>
                {t.request.howTo}
                <br />
                {t.request.afterApproval}
              </p>
            </Panel>

            {jiraUrl ? (
              // Sale de la aplicación: pestaña nueva y `noopener` para que la
              // página de destino no pueda tocar esta.
              <a
                className="jira-link"
                href={jiraUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.request.openJira}
              </a>
            ) : (
              <div role="alert" className="form-error">
                {t.request.noUrl}
              </div>
            )}

            <div className="request-actions">
              <Button
                variant="secondary"
                fullWidth
                onClick={() => navigate('/', { replace: true })}
              >
                {t.request.recheck}
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
