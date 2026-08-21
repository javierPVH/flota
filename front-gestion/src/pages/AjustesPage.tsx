import { useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '@flota/ui/ui'

import { useAjustesCopy } from '../translations/ajustes.ts'
import { CatalogsPage } from './CatalogsPage.tsx'
import { ErratasPage } from './ErratasPage.tsx'
import { EmailTemplatesPage } from './EmailTemplatesPage.tsx'
import { NotificationsPage } from './NotificationsPage.tsx'

const TAB_KEYS = ['catalogos', 'borrado', 'plantillas', 'notificaciones'] as const
type TabKey = (typeof TAB_KEYS)[number]

/**
 * Ajustes: agrupa bajo un solo icono los maestros de administración —
 * Catálogos, Borrado definitivo, Plantillas de correo y Facturas— con una barra
 * de pestañas al estilo de Vehículos. Cada pestaña renderiza su página en modo
 * embebido (sin su propia cabecera). La pestaña vive en la URL (/ajustes/:tab).
 */
export function AjustesPage() {
  const t = useAjustesCopy()
  const navigate = useNavigate()
  const { tab } = useParams()
  const active: TabKey = (TAB_KEYS as readonly string[]).includes(tab ?? '')
    ? (tab as TabKey)
    : 'catalogos'

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'catalogos', label: t.tabs.catalogs },
    { key: 'borrado', label: t.tabs.deletions },
    { key: 'plantillas', label: t.tabs.templates },
    { key: 'notificaciones', label: t.tabs.notifications },
  ]

  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />

      {/* Pestañas principales (mismo patrón que Vehículos). */}
      <div className="veh-tabs settings-tabs" role="tablist" aria-label={t.title}>
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active === item.key}
            className={`veh-tab${active === item.key ? ' is-active' : ''}`}
            onClick={() => navigate(`/ajustes/${item.key}`)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* La sub-página (con sus propias sub-pestañas) encaja bajo las de arriba. */}
      <div className="settings-body">
        {active === 'catalogos' && <CatalogsPage embedded />}
        {active === 'borrado' && <ErratasPage embedded />}
        {active === 'plantillas' && <EmailTemplatesPage embedded />}
        {active === 'notificaciones' && <NotificationsPage embedded />}
      </div>
    </div>
  )
}
