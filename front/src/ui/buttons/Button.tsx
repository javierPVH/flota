/**
 * [ES] Boton de texto generico para formularios, tablas y dialogos.
 * [EN] Generic text button used across forms, tables and dialogs.
 * Supports visual variants, sizes and an optional numeric badge.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from '../../styles/_components/buttons/buttons.module.sass'
import { cx } from '../../utils/cx.ts'
import { useUiCopy } from '../copy.ts'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'navy'
  | 'warning'
  | 'danger'
  | 'success'
  | 'default'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  /**
   * [ES] Bandera explicita opcional. Si se omite, el contador se muestra
   * automaticamente cuando existe `counterValue`.
   * [EN] Optional explicit flag. If omitted, counter is shown automatically
   * whenever `counterValue` is provided.
   */
  showCounter?: boolean
  counterValue?: number | (() => number)
  /** Cuando es true, elimina la sombra del botón. */
  flat?: boolean
  children: ReactNode
}

const variantClass: Record<ButtonVariant, string> = {
  primary: styles.buttonPrimary,
  secondary: styles.buttonSecondary,
  navy: styles.buttonNavy,
  warning: styles.buttonWarning,
  danger: styles.buttonDanger,
  success: styles.buttonSuccess,
  default: styles.buttonDefault,
}

const sizeClass: Record<ButtonSize, string> = {
  xs: styles.sizeXs,
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
}



export function Button({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  showCounter = false,
  counterValue,
  flat = false,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const copy = useUiCopy()
  const hasCounterValue =
    typeof counterValue === 'function' || counterValue !== undefined
  const shouldShowCounter = showCounter || hasCounterValue

  const resolvedCounter =
    typeof counterValue === 'function'
      ? counterValue()
      : counterValue ?? 0

  return (
    <button
      type={type}
      className={cx(
        styles.button,
        variantClass[variant],
        sizeClass[size],
        shouldShowCounter && styles.withCounter,
        fullWidth && styles.fullWidth,
        flat && styles.flat,
        className,
      )}
      {...props}
    >
      <span className={styles.buttonLabel}>{children}</span>
      {shouldShowCounter && (
        <span className={styles.counterBadge} aria-label={copy.button.counterAriaLabel(resolvedCounter)}>
          {resolvedCounter}
        </span>
      )}
    </button>
  )
}
