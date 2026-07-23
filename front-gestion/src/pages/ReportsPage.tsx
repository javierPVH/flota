import { PageHeader } from '@flota/ui/ui'
import { Download } from 'lucide-react'

import { reportUrl, type ReportFormat, type ReportKind } from '../api.ts'

const REPORTS: Array<{ kind: ReportKind; title: string; description: string }> = [
  {
    kind: 'fleet',
    title: 'Flota',
    description:
      'Inventario completo: matrícula, marca/modelo, estado, uso, conductor, supervisor, próxima ITV…',
  },
  {
    kind: 'alerts',
    title: 'Alertas',
    description: 'Alertas con tipo, nivel, estado, vehículo y fechas — para seguimiento y auditoría.',
  },
  {
    kind: 'costs',
    title: 'Costes',
    description: 'Cuotas y facturación por vehículo, para conciliar con contabilidad.',
  },
]

const FORMATS: ReportFormat[] = ['xlsx', 'csv']

/** Descarga de informes (Épica 10). Acotado por rol: el supervisor exporta
 * solo su grupo (lo aplica el back). */
export function ReportsPage() {
  return (
    <div>
      <PageHeader
        title="Informes"
        subtitle="Descarga de inventario, alertas y costes en Excel o CSV."
      />
      <div className="reports-grid">
        {REPORTS.map((report) => (
          <section className="card" key={report.kind}>
            <h3>{report.title}</h3>
            <p className="muted">{report.description}</p>
            <div className="report-actions">
              {FORMATS.map((fmt) => (
                <a key={fmt} className="report-download" href={reportUrl(report.kind, fmt)} download>
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
