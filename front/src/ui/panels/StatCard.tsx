import type { ReactNode } from 'react'
import styles from '../../styles/_components/panels/dashboard.module.sass'

export type StatAccent =
  | 'primary'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'navy'
  | 'teal'

const accentClass: Record<StatAccent, string> = {
  primary: styles.accentPrimary,
  info: styles.accentInfo,
  success: styles.accentSuccess,
  warning: styles.accentWarning,
  danger: styles.accentDanger,
  navy: styles.accentNavy,
  teal: styles.accentTeal,
}

export interface StatCardProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  accent?: StatAccent
  icon?: ReactNode
}

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function StatCard({ label, value, sub, accent = 'primary', icon }: StatCardProps) {
  return (
    <div className={cx(styles.statCard, accentClass[accent])}>
      {icon && <span className={styles.statIcon}>{icon}</span>}
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {sub !== undefined && <span className={styles.statSub}>{sub}</span>}
    </div>
  )
}
