import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@flota/ui/ui'

import { useLang } from '../i18n.tsx'
import type { FlotaDocument } from '../types.ts'
import { DocumentList } from './DocumentList.tsx'
import { PersonalDocumentsPanel, usePersonalDocuments } from './PersonalDocuments.tsx'

type Tab = 'vehicle' | 'driver'

const TABS: Tab[] = ['vehicle', 'driver']

/**
 * Toda la documentación en una tarjeta con DOS PESTAÑAS: la del coche (permiso
 * de circulación, ficha técnica, seguro…) y la del conductor (permiso de
 * conducir…).
 *
 * Antes eran dos acordeones seguidos, «Documentos» y «Mis documentos», y no se
 * entendía la diferencia. Es la del titular, que en `Document` es un vehículo
 * O una persona: los del coche se quedan con la matrícula cuando lo devuelves,
 * los del conductor se van contigo. Las pestañas dicen eso sin explicarlo.
 */
export function DocumentsTabsCard({ documents }: { documents: FlotaDocument[] }) {
  const { t } = useLang()
  const copy = t.docs
  const [tab, setTab] = useState<Tab>('vehicle')
  const personal = usePersonalDocuments()

  const counts: Record<Tab, number> = {
    vehicle: documents.length,
    driver: personal.documents?.length ?? 0,
  }

  return (
    <details className="card alert-group">
      <summary className="alert-group-head">
        <ChevronRight size={16} aria-hidden className="alert-group-chev" />
        <div className="alert-group-info">
          <div className="alert-group-title">
            <strong>{copy.title}</strong>
            <Badge tone="info" size="sm">
              {counts.vehicle + counts.driver}
            </Badge>
          </div>
        </div>
      </summary>
      <div className="alert-group-body">
        <div className="doc-tabs" role="tablist" aria-label={copy.title}>
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`doc-tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`doc-panel-${key}`}
              className={`doc-tab${tab === key ? ' is-active' : ''}`}
              onClick={() => setTab(key)}
            >
              {copy.tabs[key]}
              <Badge tone="info" size="sm">
                {counts[key]}
              </Badge>
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`doc-panel-${tab}`} aria-labelledby={`doc-tab-${tab}`}>
          {tab === 'vehicle' ? (
            <>
              <p className="doc-sub">{copy.vehicleHint}</p>
              <DocumentList documents={documents} />
            </>
          ) : (
            <PersonalDocumentsPanel {...personal} />
          )}
        </div>
      </div>
    </details>
  )
}
