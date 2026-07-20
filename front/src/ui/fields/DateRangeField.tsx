/**
 * [ES] Campo combinado de rango de fechas (inicio y fin) con un solo contenedor.
 * [EN] Combined date-range field (start and end) under one wrapper.
 */
import {
  useState,
  type ChangeEventHandler,
  type FocusEventHandler,
  type MouseEventHandler,
  type ReactNode,
} from 'react'
import { FieldShell, type FieldContainerSize, type FieldInputHeight } from './FieldShell'
import { syncOverflowTitle } from './overflow-title'
import styles from '../../styles/_components/fields/form-fields.module.sass'
import { useUiCopy } from '../copy.ts'

export interface DateRangeValue {
  startDate: string
  endDate: string
}

export interface DateRangeFieldProps {
  label?: ReactNode
  containerSize?: FieldContainerSize
  containerClassName?: string
  inputHeight?: FieldInputHeight
  warningMessage?: ReactNode
  warningClosable?: boolean
  onWarningClose?: () => void
  disabled?: boolean
  startName?: string
  endName?: string
  startAriaLabel?: string
  endAriaLabel?: string
  startDefaultValue?: string
  endDefaultValue?: string
  onRangeChange?: (value: DateRangeValue) => void
}

const heightClass: Record<FieldInputHeight, string> = {
  5: styles.inputPad5,
  10: styles.inputPad10,
}


export function DateRangeField({
  label,
  containerSize = 'fill',
  containerClassName,
  inputHeight = 10,
  warningMessage,
  warningClosable = true,
  onWarningClose,
  disabled = false,
  startName,
  endName,
  startAriaLabel = '',
  endAriaLabel = '',
  startDefaultValue = '',
  endDefaultValue = '',
  onRangeChange,
}: DateRangeFieldProps) {
  const copy = useUiCopy()
  const [startDate, setStartDate] = useState(startDefaultValue)
  const [endDate, setEndDate] = useState(endDefaultValue)

  const handleStartChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    const nextStartDate = event.target.value
    setStartDate(nextStartDate)
    onRangeChange?.({ startDate: nextStartDate, endDate })
  }

  const handleEndChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    const nextEndDate = event.target.value
    setEndDate(nextEndDate)
    onRangeChange?.({ startDate, endDate: nextEndDate })
  }

  const handleDateHover: MouseEventHandler<HTMLInputElement> = (event) => {
    syncOverflowTitle(event.currentTarget, event.currentTarget.value)
  }

  const handleDateFocus: FocusEventHandler<HTMLInputElement> = (event) => {
    syncOverflowTitle(event.currentTarget, event.currentTarget.value)
  }

  return (
    <FieldShell
      label={label}
      size={containerSize}
      disabled={disabled}
      warningMessage={warningMessage}
      warningClosable={warningClosable}
      onWarningClose={onWarningClose}
      className={containerClassName}
    >
      <div className={styles.dateRange}>
        <div className={styles.dateInputWrap}>
          <input
            type="date"
            name={startName}
            aria-label={startAriaLabel || copy.dateRangeField.startAriaLabel}
            className={`${styles.dateInput} ${heightClass[inputHeight]}`}
            disabled={disabled}
            value={startDate}
            onChange={handleStartChange}
            onFocus={handleDateFocus}
            onMouseEnter={handleDateHover}
          />
        </div>
        <span className={styles.rangeArrow} aria-hidden="true">
          {'->'}
        </span>
        <div className={styles.dateInputWrap}>
          <input
            type="date"
            name={endName}
            aria-label={endAriaLabel || copy.dateRangeField.endAriaLabel}
            className={`${styles.dateInput} ${heightClass[inputHeight]}`}
            disabled={disabled}
            value={endDate}
            onChange={handleEndChange}
            onFocus={handleDateFocus}
            onMouseEnter={handleDateHover}
          />
        </div>
      </div>
    </FieldShell>
  )
}
