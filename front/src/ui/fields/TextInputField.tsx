/**
 * [ES] Campo de texto reutilizable con contenedor y label opcional.
 * [EN] Reusable text field with wrapper and optional label.
 */
import type {
  ChangeEventHandler,
  FocusEventHandler,
  InputHTMLAttributes,
  MouseEventHandler,
  ReactNode,
} from 'react'
import { FieldShell, type FieldContainerSize, type FieldInputHeight } from './FieldShell'
import { syncOverflowTitle } from './overflow-title'
import styles from '../../styles/_components/fields/form-fields.module.sass'
import { cx } from '../../utils/cx.ts'

export interface TextInputFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode
  containerSize?: FieldContainerSize
  containerClassName?: string
  inputHeight?: FieldInputHeight
  requiredVisual?: boolean
  warningMessage?: ReactNode
  warningClosable?: boolean
  onWarningClose?: () => void
}


const heightClass: Record<FieldInputHeight, string> = {
  5: styles.inputPad5,
  10: styles.inputPad10,
}

export function TextInputField({
  label,
  containerSize = 'fill',
  containerClassName,
  inputHeight = 10,
  requiredVisual = false,
  warningMessage,
  warningClosable = true,
  onWarningClose,
  className,
  disabled = false,
  type = 'text',
  title,
  onChange,
  onFocus,
  onMouseEnter,
  ...props
}: TextInputFieldProps) {
  const syncTitle = (input: HTMLInputElement) => {
    if (!title) {
      const text = input.value || input.placeholder || ''
      syncOverflowTitle(input, text)
    }
  }

  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    syncTitle(event.currentTarget)
    onChange?.(event)
  }

  const handleFocus: FocusEventHandler<HTMLInputElement> = (event) => {
    syncTitle(event.currentTarget)
    onFocus?.(event)
  }

  const handleMouseEnter: MouseEventHandler<HTMLInputElement> = (event) => {
    syncTitle(event.currentTarget)
    onMouseEnter?.(event)
  }

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
      <input
        type={type}
        disabled={disabled}
        className={cx(styles.fieldInput, heightClass[inputHeight], className)}
        onChange={handleChange}
        onFocus={handleFocus}
        onMouseEnter={handleMouseEnter}
        title={title}
        {...props}
      />
    </FieldShell>
  )
}
