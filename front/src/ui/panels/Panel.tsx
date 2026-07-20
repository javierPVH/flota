import { type ReactNode } from 'react'
import { AlertTriangle, AlertCircle, Info, CheckCircle2 } from 'lucide-react'
import styles from '../../styles/_components/panels/panel.module.sass'

export type PanelTone = 'danger' | 'warning' | 'info' | 'success'
export type PanelSize = 'sm' | 'md' | 'lg'

export interface PanelProps {
  /** Visual tone — controls colors and the default icon. */
  tone?: PanelTone
  /** Size variant. Defaults to 'md'. */
  size?: PanelSize
  /** Optional title shown in the header (next to the icon). */
  title?: ReactNode
  /** Override the default icon for the tone. Pass `null` to hide. */
  icon?: ReactNode | null
  /** Body content. */
  children?: ReactNode
  /** Extra class for the root element. */
  className?: string
}

const TONE_CLASS: Record<PanelTone, string> = {
  danger: styles.toneDanger,
  warning: styles.toneWarning,
  info: styles.toneInfo,
  success: styles.toneSuccess,
}

const SIZE_CLASS: Record<PanelSize, string | undefined> = {
  sm: styles.sizeSm,
  md: undefined,
  lg: styles.sizeLg,
}

function defaultIconFor(tone: PanelTone): ReactNode {
  const props = { size: 16, 'aria-hidden': true } as const
  switch (tone) {
    case 'danger': return <AlertTriangle {...props} />
    case 'warning': return <AlertCircle {...props} />
    case 'info': return <Info {...props} />
    case 'success': return <CheckCircle2 {...props} />
  }
}

/**
 * Visual container for status messages (danger / warning / info / success).
 * Used as a building block in confirmation modals, notices, etc.
 */
export function Panel({
  tone = 'info',
  size = 'md',
  title,
  icon,
  children,
  className,
}: PanelProps) {
  const resolvedIcon = icon === undefined ? defaultIconFor(tone) : icon
  const classes = [styles.panel, TONE_CLASS[tone], SIZE_CLASS[size], className]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={classes} role={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}>
      {(title || resolvedIcon) && (
        <header className={styles.panelHeader}>
          {resolvedIcon !== null && <span className={styles.panelIcon}>{resolvedIcon}</span>}
          {title && <span>{title}</span>}
        </header>
      )}
      {children !== undefined && children !== null && (
        <div className={styles.panelBody}>{children}</div>
      )}
    </section>
  )
}
