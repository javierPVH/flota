import { useNavigate } from 'react-router-dom'
import { Button, Panel } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import { useLang } from '../i18n.tsx'

/** Aviso al supervisor sin grupo (M0): su flota la asigna administración (HU-2.7). */
export function SinFlotaPage() {
  const { user, logout } = useAuth()
  const { t } = useLang()
  const navigate = useNavigate()

  return (
    <div className="login-scene">
      <div className="login-card">
        <h1>{t.noFleet.title}</h1>
        <Panel tone="info">
          <p style={{ margin: 0 }}>{t.noFleet.body(user?.first_name || user?.username || '')}</p>
        </Panel>
        <div className="request-actions">
          <Button variant="primary" fullWidth onClick={() => navigate('/', { replace: true })}>
            {t.noFleet.recheck}
          </Button>
          <Button variant="secondary" fullWidth onClick={logout}>
            {t.common.logout}
          </Button>
        </div>
      </div>
    </div>
  )
}
