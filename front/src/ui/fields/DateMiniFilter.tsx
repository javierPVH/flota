import type { ReactNode } from 'react'
import { MiniToolsButtons } from '../buttons'
import styles from '../../styles/_components/fields/date-mini-filter.module.sass'
import { cx } from '../../utils/cx.ts'
import { useUiCopy } from '../copy.ts'

export interface DateMiniFilterProps {
  label?: ReactNode
  fromLabel?: string
  toLabel?: string
  startDate: string
  endDate: string
  disabled?: boolean
  showLast30Days?: boolean
  last30DaysLabel?: string
  className?: string
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
  onApply?: () => void
  onClear?: () => void
  onApplyLast30Days?: () => void
}


export function DateMiniFilter({
  label,
  fromLabel,
  toLabel,
  startDate,
  endDate,
  disabled = false,
  showLast30Days = true,
  last30DaysLabel,
  className,
  onStartDateChange,
  onEndDateChange,
  onApply,
  onClear,
  onApplyLast30Days,
}: DateMiniFilterProps) {
  const copy = useUiCopy()

  return (
    <div className={cx(styles.dateMiniFilterBlock, className)}>
      {label ? <span className={styles.dateMiniFilterLabel}>{label}</span> : null}
      <div className={styles.dateMiniFilterWrap}>
        <div className={styles.dateMiniInputBlock}>
          {fromLabel ? <span className={styles.dateMiniInlineLabel}>{fromLabel}</span> : null}
          <input
            type="date"
            value={startDate}
            disabled={disabled}
            onChange={(event) => onStartDateChange(event.target.value)}
            className={styles.dateMiniField}
            aria-label={fromLabel || copy.dateMiniFilter.startAriaLabel}
          />
        </div>
        <div className={styles.dateMiniInputBlock}>
          {toLabel ? <span className={styles.dateMiniInlineLabel}>{toLabel}</span> : null}
          <input
            type="date"
            value={endDate}
            disabled={disabled}
            onChange={(event) => onEndDateChange(event.target.value)}
            className={styles.dateMiniField}
            aria-label={toLabel || copy.dateMiniFilter.endAriaLabel}
          />
        </div>
        <span className={styles.dateMiniTools}>
          <MiniToolsButtons
            size="xs"
            showLock={false}
            showSearch
            showDelete
            showSort={false}
            onSearch={onApply}
            onDelete={onClear}
            className={styles.dateMiniToolsButtons}
          />
        </span>
        {showLast30Days ? (
          <button
            type="button"
            className={styles.dateMiniPreset}
            disabled={disabled}
            onClick={onApplyLast30Days}
          >
            {last30DaysLabel || copy.dateMiniFilter.last30DaysLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}
