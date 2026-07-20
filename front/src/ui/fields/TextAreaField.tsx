/**
 * [ES] Campo textarea reutilizable con contenedor y label opcional.
 * [EN] Reusable textarea field with wrapper and optional label.
 */
import type { ReactNode, TextareaHTMLAttributes } from 'react'
import { FieldShell, type FieldContainerSize } from './FieldShell'
import styles from '../../styles/_components/fields/form-fields.module.sass'
import { cx } from '../../utils/cx.ts'

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode
  containerSize?: FieldContainerSize
  containerClassName?: string
  requiredVisual?: boolean
  warningMessage?: ReactNode
  warningClosable?: boolean
  onWarningClose?: () => void
}


export function TextAreaField({
  label,
  containerSize = 'fill',
  containerClassName,
  requiredVisual = false,
  warningMessage,
  warningClosable = true,
  onWarningClose,
  className,
  disabled = false,
  rows = 4,
  ...props
}: TextAreaFieldProps) {
  return (
    <FieldShell
      label={label}
      size={containerSize}
      disabled={disabled}
      requiredVisual={requiredVisual}
      warningMessage={warningMessage}
      warningClosable={warningClosable}
      onWarningClose={onWarningClose}
      className={containerClassName}
    >
      <textarea
        rows={rows}
        disabled={disabled}
        className={cx(styles.fieldTextarea, className)}
        {...props}
      />
    </FieldShell>
  )
}
