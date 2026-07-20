/**
 * [ES] Contenedor de campo reutilizable con label opcional y control interno.
 * [EN] Reusable field wrapper with optional label and inner control.
 */
import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react'
import styles from '../../styles/_components/fields/form-fields.module.sass'
import { cx } from '../../utils/cx.ts'
import { useUiCopy } from '../copy.ts'

export type FieldContainerSize =
  | 'fill'
  | 'xl'
  | 'lg'
  | 'md'
  | 'sm'
  | '20'
  | '30'
  | '40'
  | '50'
  | '60'
  | '70'
  | '80'
  | '90'
  | '100'
export type FieldInputHeight = 5 | 10

export interface FieldShellProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode
  size?: FieldContainerSize
  disabled?: boolean
  requiredVisual?: boolean
  warningMessage?: ReactNode
  warningClosable?: boolean
  onWarningClose?: () => void
  children: ReactNode
}

const sizeClass: Record<FieldContainerSize, string> = {
  fill: styles.sizeFill,
  xl: styles.sizeXl,
  lg: styles.sizeLg,
  md: styles.sizeMd,
  sm: styles.sizeSm,
  '20': styles.size20,
  '30': styles.size30,
  '40': styles.size40,
  '50': styles.size50,
  '60': styles.size60,
  '70': styles.size70,
  '80': styles.size80,
  '90': styles.size90,
  '100': styles.size100,
}



export function FieldShell({
  label,
  size = 'fill',
  disabled = false,
  requiredVisual = false,
  warningMessage,
  warningClosable = true,
  onWarningClose,
  className,
  children,
  ...props
}: FieldShellProps) {
  const copy = useUiCopy()
  const hasLabel = label !== undefined && label !== null && label !== ''
  const hasWarning = warningMessage !== undefined && warningMessage !== null && warningMessage !== ''
  const [isWarningVisible, setIsWarningVisible] = useState(hasWarning)

  useEffect(() => {
    setIsWarningVisible(hasWarning)
  }, [hasWarning, warningMessage])

  function handleWarningClose() {
    setIsWarningVisible(false)
    onWarningClose?.()
  }

  return (
    <div
      className={cx(
        styles.fieldShell,
        sizeClass[size],
        (hasLabel || requiredVisual) && styles.hasLabelRow,
        disabled && styles.isDisabled,
        requiredVisual && styles.isRequired,
        hasWarning && styles.hasWarning,
        className,
      )}
      {...props}
    >
      {(hasLabel || requiredVisual) && (
        <span className={styles.fieldLabelRow}>
          {hasLabel && <span className={styles.fieldLabel}>{label}</span>}
          {requiredVisual && (
            <span className={styles.fieldRequiredBadge}>{copy.fieldShell.requiredBadge}</span>
          )}
        </span>
      )}
      {hasWarning && isWarningVisible && (
        <span className={styles.fieldWarningBubble} role="alert">
          <span>{warningMessage}</span>
          {warningClosable && (
            <button
              type="button"
              className={styles.fieldWarningClose}
              aria-label={copy.fieldShell.closeWarningAriaLabel}
              onClick={handleWarningClose}
            >
              &times;
            </button>
          )}
        </span>
      )}
      <div className={styles.fieldControlWrap}>{children}</div>
    </div>
  )
}
