import { PageHeader } from '@flota/ui/ui'
import { Download } from 'lucide-react'

import { reportUrl, type ReportFormat, type ReportKind } from '../api.ts'
import { useReportsCopy } from '../translations/reports.ts'

const REPORT_KINDS: ReportKind[] = ['fleet', 'alerts', 'costs']

const FORMATS: ReportFormat[] = ['xlsx', 'csv']

/** Descarga de informes (Épica 10). Acotado por rol: el supervisor exporta
 * solo su grupo (lo aplica el back). */
export function ReportsPage() {
  const t = useReportsCopy()
  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <div className="reports-grid">
        {REPORT_KINDS.map((kind) => (
          <section className="card" key={kind}>
            <h3>{t.reports[kind].title}</h3>
            <p className="muted">{t.reports[kind].description}</p>
            <div className="report-actions">
              {FORMATS.map((fmt) => (
                <a key={fmt} className="report-download" href={reportUrl(kind, fmt)} download>
                  <Download size={14} aria-hidden /> {fmt.toUpperCase()}
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
