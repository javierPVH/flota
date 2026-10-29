import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@flota/ui/ui'

import { ALL_DOCUMENT_TYPES } from '../documentRules.ts'
import { useReportsCopy } from '../translations/reports.ts'
import { DownloadsTab } from '../components/DownloadsTab.tsx'
import { InvoicesPage } from './InvoicesPage.tsx'

const MAIN_TABS = ['descargas', 'facturas'] as const
type MainTab = (typeof MAIN_TABS)[number]

/**
 * Informes (Épica 10): centro de Descargas + consulta de Facturas.
 *
 * Los documentos tuvieron aquí su pestaña (y antes, una por tipo), pero no
 * son un informe: se consultan y se dan de alta, así que viven en su propia
 * pantalla (`/documentos`, `DocumentsPage`). Los enlaces antiguos
 * —`?tab=documentos` y `?tab=<tipo de documento>`— se redirigen allí.
 */
export function ReportsPage() {
  const t = useReportsCopy()
  const [searchParams] = useSearchParams()

  // La URL admite el nombre de la pestaña.
  const requested = searchParams.get('tab') ?? ''
  const [tab, setTab] = useState<MainTab>(() =>
    (MAIN_TABS as readonly string[]).includes(requested) ? (requested as MainTab) : 'descargas',
  )

  if (requested === 'documentos' || (ALL_DOCUMENT_TYPES as readonly string[]).includes(requested)) {
    const to = requested === 'documentos' ? '/documentos' : `/documentos?tipo=${requested}`
    return <Navigate to={to} replace />
  }

  const tabs: Array<{ key: MainTab; label: string }> = [
    { key: 'descargas', label: t.tabs.downloads },
    { key: 'facturas', label: t.tabs.invoices },
  ]

  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />

      {/* Pestañas principales (mismo patrón que Ajustes/Vehículos). */}
      <div className="veh-tabs settings-tabs" role="tablist" aria-label={t.title}>
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`veh-tab${tab === item.key ? ' is-active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="settings-body">
        {tab === 'descargas' && <DownloadsTab />}
        {tab === 'facturas' && <InvoicesPage embedded />}
      </div>
    </div>
  )
}
