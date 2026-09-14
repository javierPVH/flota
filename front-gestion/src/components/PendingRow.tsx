import type { ReactNode } from 'react'
import { CheckCircle2, Mail } from 'lucide-react'

import { fmtDate } from '../format.ts'
import { useLang } from '../i18n.tsx'

/**
 * Una fila de la tarjeta, siempre en el mismo orden de lectura: **fecha,
 * (matrícula,) título y descripción**; la matrícula solo cuando la lista no es
 * de un coche (la del panel, que es de toda la flota); las píldoras (plazo, estado) van al final, alineadas
 * a la derecha. Con `onResolve` el ✓ es el botón de cerrarla; sin él (ya
 * cerrada) queda como marca. Con `onEmail`, cierra la fila por la derecha el
 * sobre que avisa al responsable (N10) — solo donde tiene sentido: algo abierto.
 */
export function PendingRow({
  plate,
  date,
  title,
  description,
  badges,
  onResolve,
  onEmail,
  resolveLabel,
  closedLabel,
  emailLabel,
}: {
  /** De qué coche es la fila. Sin ella (lista de un vehículo), no se pinta. */
  plate?: string
  date: string | null
  title: string
  description: string
  badges?: ReactNode
  onResolve?: () => void
  onEmail?: () => void
  resolveLabel: string
  closedLabel: string
  emailLabel: string
}) {
  const { language } = useLang()
  // Nombre accesible de los dos botones: en la lista de la flota, primero la
  // matrícula (es lo que identifica la fila); en la de un coche, sobra.
  const dequien = plate ? `${plate} · ${title}` : title
  return (
    <div className="mng-alert">
      {onResolve ? (
        <button
          type="button"
          className="mng-alert-resolve"
          onClick={onResolve}
          title={resolveLabel}
          aria-label={`${resolveLabel} · ${dequien}`}
        >
          <CheckCircle2 size={18} aria-hidden />
        </button>
      ) : (
        <span className="mng-alert-done" title={closedLabel} aria-label={closedLabel} role="img">
          <CheckCircle2 size={18} aria-hidden />
        </span>
      )}
      <div className="mng-alert-body pending-row" title={description}>
        <span className="pending-date">{fmtDate(date, language)}</span>
        {plate && <span className="pending-plate">{plate}</span>}
        <strong>{title}</strong>
        <span className="mng-grow mng-truncate">{description}</span>
        {badges}
      </div>
      {onEmail && (
        <button
          type="button"
          className="mng-alert-email"
          onClick={onEmail}
          title={emailLabel}
          aria-label={`${emailLabel} · ${dequien}`}
        >
          <Mail size={17} aria-hidden />
        </button>
      )}
    </div>
  )
}
