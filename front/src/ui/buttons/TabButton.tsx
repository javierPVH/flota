/**
 * [ES] Boton de pestana para navegacion y barras de filtros por estado.
 * [EN] Tab trigger button for navigation and status-filter bars.
 * Supports active/loading states and optional numeric badge.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from '../../styles/_components/buttons/tab-button.module.sass'
import { cx } from '../../utils/cx.ts'
import { useUiCopy } from '../copy.ts'

export type TabButtonVariant = 'default' | 'status'
export type TabButtonTone = 'neutral' | 'success' | 'warning' | 'danger'

export interface TabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  loading?: boolean
  variant?: TabButtonVariant
  tone?: TabButtonTone
  /**
   * [ES] Bandera explicita opcional. Si se omite, el contador se muestra
   * automaticamente cuando existe `counterValue`.
   * [EN] Optional explicit flag. If omitted, counter is shown automatically
   * whenever `counterValue` is provided.
   */
  showCounter?: boolean
  counterValue?: number | (() => number)
  children: ReactNode
}



const variantClass: Record<TabButtonVariant, string> = {
  default: styles.variantDefault,
  status: styles.variantStatus,
}

const toneClass: Record<TabButtonTone, string> = {
  neutral: styles.toneNeutral,
  success: styles.toneSuccess,
  warning: styles.toneWarning,
  danger: styles.toneDanger,
}

export function TabButton({
  active = false,
  loading = false,
  variant = 'default',
  tone = 'neutral',
  showCounter = false,
  counterValue,
  className,
  children,
  type = 'button',
  ...props
}: TabButtonProps) {
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
        styles.tabButton,
        variantClass[variant],
        toneClass[tone],
        active && styles.isActive,
        loading && styles.isLoading,
        shouldShowCounter && styles.withCounter,
        className,
      )}
      {...props}
    >
      <span className={styles.tabLabel}>{children}</span>
      {shouldShowCounter && (
        <span className={styles.counterBadge} aria-label={copy.tabButton.counterAriaLabel(resolvedCounter)}>
          {resolvedCounter}
        </span>
      )}
    </button>
  )
}
