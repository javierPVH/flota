import { useNavigate } from 'react-router-dom'
import { Button, Panel } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import { useLang } from '../i18n.tsx'
import { useNoFleetCopy } from '../translations/noFleet.ts'

/** Aviso al supervisor sin grupo (M0): su flota la asigna administración (HU-2.7). */
export function SinFlotaPage() {
  const { user, logout } = useAuth()
  const { t } = useLang()
  // R3-36: el copy propio del portón viaja en su chunk, no en el shell.
  const tn = useNoFleetCopy()
  const navigate = useNavigate()

  return (
    <div className="login-scene">
      <div className="login-card">
        <h1>{tn.title}</h1>
        <Panel tone="info">
          <p style={{ margin: 0 }}>{tn.body(user?.first_name || user?.username || '')}</p>
        </Panel>
        <div className="request-actions">
          <Button variant="primary" fullWidth onClick={() => navigate('/', { replace: true })}>
            {tn.recheck}
          </Button>
          <Button variant="secondary" fullWidth onClick={logout}>
            {t.common.logout}
          </Button>
        </div>
      </div>
    </div>
  )
}
