/**
 * [ES] Boton compacto solo-icono para acciones de fila y toolbars.
 * [EN] Compact icon-only button for row actions and toolbars.
 * Provides tone variants and three fixed sizes.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from '../../styles/_components/buttons/icon-button.module.sass'
import { cx } from '../../utils/cx.ts'

export type IconButtonVariant = 'default' | 'warning' | 'danger'
export type IconButtonSize = 'xs' | 'sm' | 'md'

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant
  size?: IconButtonSize
  children: ReactNode
}

const variantClass: Record<IconButtonVariant, string> = {
  default: styles.variantDefault,
  warning: styles.variantWarning,
  danger: styles.variantDanger,
}

const sizeClass: Record<IconButtonSize, string> = {
  xs: styles.sizeXs,
  sm: styles.sizeSm,
  md: styles.sizeMd,
}


export function IconButton({
  variant = 'default',
  size = 'md',
  className,
  children,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        styles.iconButton,
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
