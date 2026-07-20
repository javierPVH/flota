import { type ReactNode } from 'react'
import styles from '../../styles/_components/panels/stat-list.module.sass'
import type { PanelTone } from './Panel'

export type StatTone = PanelTone | 'neutral'

export interface StatItem {
  /** Stable id for React key. */
  key: string
  /** Descriptive text shown on the left. */
  label: ReactNode
  /** Numeric value shown as a badge on the right. */
  value: number
  /** Tone of the badge. Defaults to 'neutral'. */
  tone?: StatTone
}

export interface StatListProps {
  items: StatItem[]
  /** Default tone for items that don't specify their own. */
  defaultTone?: StatTone
  /** Empty-state text when items is empty. */
  emptyLabel?: ReactNode
  className?: string
}

const TONE_CLASS: Record<StatTone, string> = {
  neutral: styles.toneNeutral,
  danger: styles.toneDanger,
  warning: styles.toneWarning,
  info: styles.toneInfo,
  success: styles.toneSuccess,
}

/**
 * Vertical list of "label → number" rows. The numeric value is shown as a colored
 * badge so totals at a glance are easy to scan.
 *
 * Designed to live inside a <Panel /> when reporting impact, counts, etc.
 */
export function StatList({ items, defaultTone = 'neutral', emptyLabel, className }: StatListProps) {
  if (items.length === 0) {
    return <p className={styles.empty}>{emptyLabel ?? '—'}</p>
  }

  return (
    <ul className={[styles.statList, className].filter(Boolean).join(' ')}>
      {items.map((it) => {
        const tone = it.tone ?? defaultTone
        return (
          <li key={it.key} className={styles.statItem}>
            <span className={styles.statLabel}>{it.label}</span>
            <span className={[styles.statValue, TONE_CLASS[tone]].join(' ')}>{it.value}</span>
          </li>
        )
      })}
    </ul>
  )
}
