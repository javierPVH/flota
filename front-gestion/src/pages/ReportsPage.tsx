import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@flota/ui/ui'

import { listAll, listVehicles } from '../api.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useReportsCopy } from '../translations/reports.ts'
import { DocumentsReport } from '../components/DocumentsReport.tsx'
import { DownloadsTab } from '../components/DownloadsTab.tsx'
import { InvoicesPage } from './InvoicesPage.tsx'
import type { Vehicle } from '../types.ts'

// Tipos de documento (elementos de subida) — un informe de consulta por cada uno.
const DOC_TYPES = [
  'registration_certificate',
  'technical_datasheet',
  'insurance',
  'contract',
  'delivery_report',
  'return_report',
  'accident_report',
  'damage_photos',
  'other',
] as const

/** Informes (Épica 10): centro de Descargas (exportación de todo, con filtros y
 * previsualización) + pestañas de consulta por factura y por tipo de documento. */
export function ReportsPage() {
  const t = useReportsCopy()
  const docCopy = usePanelsCopy().documents
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<string>(searchParams.get('tab') ?? 'descargas')
  const [vehicles, setVehicles] = useState<Vehicle[]>([])

  // Vehículos: matrícula por id para la columna "Vehículo" y filtro por vehículo.
  useEffect(() => {
    listAll(listVehicles({ include_baja: 1 }))
      .then(setVehicles)
      .catch(() => {})
  }, [])
  const plateById = useMemo(() => new Map(vehicles.map((v) => [v.id, v.plate])), [vehicles])

  const tabs: Array<{ key: string; label: string }> = [
    { key: 'descargas', label: t.tabs.downloads },
    { key: 'facturas', label: t.tabs.invoices },
    ...DOC_TYPES.map((dt) => ({ key: dt, label: docCopy.typeOptions[dt] })),
  ]

  const isDocType = (DOC_TYPES as readonly string[]).includes(tab)

  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />

      {/* Pestañas (mismo patrón que Ajustes/Vehículos). */}
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
        {tab === 'descargas' && <DownloadsTab onManageInvoices={() => setTab('facturas')} />}
        {tab === 'facturas' && <InvoicesPage embedded />}
        {isDocType && (
          <DocumentsReport
            type={tab}
            vehicleLabel={t.vehicleColumn}
            plateById={plateById}
            vehicles={vehicles}
          />
        )}
      </div>
    </div>
  )
}
