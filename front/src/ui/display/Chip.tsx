/**
 * [ES] Chip de filtro interactivo (toggle). Activo = teal corporativo.
 * [EN] Interactive filter chip (toggle). Active = corporate teal.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from '../../styles/_components/display/chip.module.sass'
import { cx } from '../../utils/cx.ts'

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Estado seleccionado. */
  active?: boolean
  /** Icono opcional a la izquierda. */
  icon?: ReactNode
  /** Contador opcional a la derecha (p. ej. nº de resultados del filtro). */
  count?: number
  children: ReactNode
}

export function Chip({
  active = false,
  icon,
  count,
  className,
  children,
  type = 'button',
  ...props
}: ChipProps) {
  return (
    <button
      type={type}
      className={cx(styles.chip, active && styles.chipActive, className)}
      aria-pressed={active}
      {...props}
    >
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  )
}
