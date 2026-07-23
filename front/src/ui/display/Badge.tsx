/**
 * [ES] Píldora de estado (etiqueta de color) para tablas, fichas y listados.
 * [EN] Status pill used across tables, detail views and lists.
 * El tono define el color; la variante (soft/solid/outline) el relleno.
 */
import type { ReactNode } from 'react'
import styles from '../../styles/_components/display/badge.module.sass'
import { cx } from '../../utils/cx.ts'

export type BadgeTone = 'neutral' | 'brand' | 'primary' | 'info' | 'success' | 'warning' | 'danger'
export type BadgeVariant = 'soft' | 'solid' | 'outline'
export type BadgeSize = 'sm' | 'md'

export interface BadgeProps {
  /** Color semántico. Por defecto 'neutral'. */
  tone?: BadgeTone
  /** Relleno visual. Por defecto 'soft'. */
  variant?: BadgeVariant
  /** Tamaño. Por defecto 'md'. */
  size?: BadgeSize
  /** Icono opcional a la izquierda (p. ej. de lucide-react). */
  icon?: ReactNode
  children: ReactNode
  className?: string
}

const toneClass: Record<BadgeTone, string> = {
  neutral: styles.toneNeutral,
  brand: styles.toneBrand,
  primary: styles.tonePrimary,
  info: styles.toneInfo,
  success: styles.toneSuccess,
  warning: styles.toneWarning,
  danger: styles.toneDanger,
}

const variantClass: Record<BadgeVariant, string> = {
  soft: styles.soft,
  solid: styles.solid,
  outline: styles.outline,
}

const sizeClass: Record<BadgeSize, string | undefined> = {
  sm: styles.sizeSm,
  md: undefined,
}

export function Badge({
  tone = 'neutral',
  variant = 'soft',
  size = 'md',
  icon,
  children,
  className,
}: BadgeProps) {
  return (
    <span className={cx(styles.badge, toneClass[tone], variantClass[variant], sizeClass[size], className)}>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  )
}
