import type { ReactNode } from 'react'
import styles from '../../styles/_components/panels/dashboard.module.sass'
import { cx } from '../../utils/cx.ts'

export type StatAccent =
  | 'primary'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'navy'
  | 'teal'

const accentClass: Record<StatAccent, string> = {
  primary: styles.accentPrimary,
  info: styles.accentInfo,
  success: styles.accentSuccess,
  warning: styles.accentWarning,
  danger: styles.accentDanger,
  navy: styles.accentNavy,
  teal: styles.accentTeal,
}

export interface StatCardProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  accent?: StatAccent
  icon?: ReactNode
  /**
   * Con `onClick`, la tarjeta ES un botón: la cifra lleva a la lista que
   * cuenta, que es lo que uno quiere al leer un número que no cuadra. Sin él
   * se queda como estaba —un dato— y no cambia nada de lo que ya la usa.
   *
   * Se renderiza como `<button>` y no como un `<div onClick>` para que llegue
   * también por teclado: el número de una tarjeta no puede ser una puerta que
   * solo abre el ratón.
   */
  onClick?: () => void
  /** Tarjeta más baja para filas de muchos KPI. */
  compact?: boolean
}


export function StatCard({
  label,
  value,
  sub,
  accent = 'primary',
  icon,
  onClick,
  compact = false,
}: StatCardProps) {
  // Las dos variantes —pulsable y compacta— son independientes y se suman:
  // una fila de muchos KPI también puede llevar a su lista.
  const clase = cx(styles.statCard, accentClass[accent], compact && styles.statCardCompact)
  const body = (
    <>
      {icon && <span className={styles.statIcon}>{icon}</span>}
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {sub !== undefined && <span className={styles.statSub}>{sub}</span>}
    </>
  )
  if (onClick) {
    return (
      <button type="button" className={cx(clase, styles.statClickable)} onClick={onClick}>
        {body}
      </button>
    )
  }
  return <div className={clase}>{body}</div>
}
