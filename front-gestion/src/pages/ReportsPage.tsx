import { Panel } from '@flota/ui/ui'
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
      <div className="page-head">
        <h2>Informes</h2>
      </div>
      <div className="reports-grid">
        {REPORTS.map((report) => (
          <Panel key={report.kind}>
            <h3>{report.title}</h3>
            <p className="muted">{report.description}</p>
            <div className="report-actions">
              {FORMATS.map((fmt) => (
                <a key={fmt} className="report-download" href={reportUrl(report.kind, fmt)} download>
                  <Download size={14} aria-hidden /> {fmt.toUpperCase()}
                </a>
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  )
}
