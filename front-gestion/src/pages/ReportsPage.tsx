import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { listAll, listDocuments, listVehicles } from '../api.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useReportsCopy } from '../translations/reports.ts'
import { DocumentsReport } from '../components/DocumentsReport.tsx'
import { DownloadsTab } from '../components/DownloadsTab.tsx'
import { SettingsSubtabs, type SettingsSubtabItem } from '../components/SettingsSubtabs.tsx'
import { InvoicesPage } from './InvoicesPage.tsx'
import type { FlotaDocument, Vehicle } from '../types.ts'

// Tipos de documento (elementos de subida): sub-pestañas del informe de documentos.
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

const MAIN_TABS = ['descargas', 'facturas', 'documentos'] as const
type MainTab = (typeof MAIN_TABS)[number]

/**
 * Informes (Épica 10): centro de Descargas + consulta de Facturas y Documentos.
 *
 * Los nueve tipos de documento eran antes pestañas principales, al mismo nivel
 * que «Descargas» y «Facturas», y la barra se partía en tres líneas mezclando
 * dos jerarquías. Ahora arriba solo hay tres destinos, y el tipo es un segundo
 * nivel dentro de Documentos —con «Todos» y el recuento de cada uno— sobre un
 * único listado cargado una sola vez.
 */
export function ReportsPage() {
  const t = useReportsCopy()
  const docCopy = usePanelsCopy().documents
  const [searchParams] = useSearchParams()

  // La URL admite el nombre de la pestaña y, por compatibilidad con enlaces
  // antiguos, también un tipo de documento suelto (?tab=insurance).
  const requested = searchParams.get('tab') ?? ''
  const requestedDocType = (DOC_TYPES as readonly string[]).includes(requested) ? requested : ''
  const [tab, setTab] = useState<MainTab>(() => {
    if (requestedDocType) return 'documentos'
    return (MAIN_TABS as readonly string[]).includes(requested) ? (requested as MainTab) : 'descargas'
  })
  const [docType, setDocType] = useState<string>(requestedDocType)

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [docs, setDocs] = useState<FlotaDocument[]>([])
  const [docsLoaded, setDocsLoaded] = useState(false)
  const [docsError, setDocsError] = useState('')

  // Vehículos: matrícula por id para la columna "Vehículo" y filtro por vehículo.
  useEffect(() => {
    listAll(listVehicles({ include_baja: 1 }))
      .then(setVehicles)
      .catch(() => {})
  }, [])

  // Documentos: una sola petición para TODOS los tipos, al entrar en la
  // pestaña. Cambiar de tipo pasa a ser un filtro en cliente —instantáneo— y
  // permite enseñar el recuento real en cada sub-pestaña.
  useEffect(() => {
    if (tab !== 'documentos' || docsLoaded) return
    let alive = true
    listAll(listDocuments({}))
      .then((rows) => {
        if (!alive) return
        setDocs(rows)
        setDocsError('')
        setDocsLoaded(true)
      })
      .catch((err) => {
        if (alive) setDocsError(asErrorMessage(err, t.docs.loadError))
      })
    return () => {
      alive = false
    }
  }, [tab, docsLoaded, t.docs.loadError])

  // «Cargando» se deduce del propio estado en vez de guardarse aparte: así el
  // efecto no llama a setState en el render que lo dispara.
  const docsLoading = tab === 'documentos' && !docsLoaded && !docsError

  const plateById = useMemo(() => new Map(vehicles.map((v) => [v.id, v.plate])), [vehicles])

  const countByType = useMemo(() => {
    const counts = new Map<string, number>()
    for (const doc of docs) counts.set(doc.type, (counts.get(doc.type) ?? 0) + 1)
    return counts
  }, [docs])

  const docItems: SettingsSubtabItem[] = [
    { key: '', label: t.docs.allTypes, badge: docs.length },
    ...DOC_TYPES.map((dt) => ({
      key: dt,
      label: docCopy.typeOptions[dt],
      badge: countByType.get(dt) ?? 0,
    })),
  ]

  const tabs: Array<{ key: MainTab; label: string }> = [
    { key: 'descargas', label: t.tabs.downloads },
    { key: 'facturas', label: t.tabs.invoices },
    { key: 'documentos', label: t.tabs.documents },
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
        {tab === 'descargas' && <DownloadsTab onManageInvoices={() => setTab('facturas')} />}
        {tab === 'facturas' && <InvoicesPage embedded />}
        {tab === 'documentos' && (
          <>
            <p className="reports-hint">{t.docs.hint}</p>
            <SettingsSubtabs
              items={docItems}
              active={docType}
              onChange={setDocType}
              ariaLabel={t.tabs.documents}
            />
            <DocumentsReport
              type={docType}
              docs={docs}
              loading={docsLoading}
              error={docsError}
              vehicleLabel={t.vehicleColumn}
              plateById={plateById}
              vehicles={vehicles}
            />
          </>
        )}
      </div>
    </div>
  )
}
