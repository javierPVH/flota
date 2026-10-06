/**
 * El **último paso** de un cierre: lo que se va a guardar, escrito.
 *
 * Los pasos anteriores se rellenan de pie, en el taller o en el arcén, y al
 * llegar al botón que cierra la incidencia no quedaba ni rastro de lo tecleado
 * tres panes atrás: para saber si el kilometraje era el bueno o si faltaba el
 * expediente había que volver hacia atrás y perder el sitio. Aquí se repasa de
 * un vistazo, con las mismas etiquetas con las que se preguntó, y lo que se
 * dejó en blanco **lo dice** en vez de desaparecer —un hueco no se ve, y el
 * coste o el CP que faltan son justo lo que hay que volver a poner—.
 *
 * Es solo un repaso: aquí **no se rellena nada**. Cada cosa se ha preguntado
 * en su paso —las notas y la factura también—, y esta última pantalla se lee
 * de arriba abajo antes de aceptar.
 */
import { fmtDate, fmtKm } from '../../format.ts'
import { useLang } from '../../i18n.tsx'
import { useResolveCopy } from '../../translations/resolve.ts'
import type { ResolutionCommon } from './useResolutionCommon.ts'

export interface SummaryRow {
  label: string
  /** Vacío = no se rellenó, y la fila lo dice. */
  value?: string | null
}

/** Los comunes que entran en el repaso: los pinta quien los haya preguntado
 * (la fecha va siempre, que es lo único obligatorio de un cierre). */
type SummaryField = 'km' | 'cost' | 'postalCode' | 'proof'

export function ResolveSummary({
  common,
  show = {},
  extra = [],
}: {
  common: ResolutionCommon
  /** Qué campos del taller entraron en el recorrido de ESTE flujo. */
  show?: Partial<Record<SummaryField, boolean>>
  /** Las filas propias del tipo (las ruedas montadas, el expediente…), entre
   * la fecha y lo del taller: el mismo orden en que se preguntaron. */
  extra?: SummaryRow[]
}) {
  const { language } = useLang()
  const c = useResolveCopy().common
  const { values, downtime } = common

  const fecha = values.date
    ? `${fmtDate(values.date, language)}${downtime !== null ? ` · ${c.downtime(downtime)}` : ''}`
    : ''
  const rows: SummaryRow[] = [
    { label: c.date, value: fecha },
    ...extra,
    ...(show.km ? [{ label: c.km, value: values.km ? fmtKm(Number(values.km), language) : '' }] : []),
    ...(show.cost ? [{ label: c.cost, value: values.cost.trim() }] : []),
    ...(show.postalCode ? [{ label: c.postalCode, value: values.postalCode.trim() }] : []),
    { label: c.observations, value: values.observations.trim() },
    ...(show.proof
      ? [{ label: c.summaryProof, value: values.proof ? values.proof.name : '' }]
      : []),
  ]

  return (
    <>
      <h3 className="resolve-summary-title">{c.summaryTitle}</h3>
      <ul className="resolve-summary">
        {rows.map((row) => (
          <li key={row.label}>
            <span className="resolve-summary-label">{row.label}</span>
            <span className="resolve-summary-value">
              {row.value ? row.value : <em className="resolve-summary-empty">{c.summaryEmpty}</em>}
            </span>
          </li>
        ))}
      </ul>
      <p className="update-hint">{c.summaryHint}</p>
    </>
  )
}
