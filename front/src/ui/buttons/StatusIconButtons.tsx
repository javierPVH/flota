/**
 * [ES] Grupo circular de iconos de estado/accion para contexto de lista, nube, warning, test y usuario.
 * [EN] Circular status-action icon group for list/cloud/warning/test/user contexts.
 * Icons can be shown together or independently with per-action handlers.
 */
import type { HTMLAttributes } from 'react'
import { CircleUserRound, CloudUpload, FlaskConical, List, TriangleAlert } from 'lucide-react'
import styles from '../../styles/_components/buttons/status-icon-buttons.module.sass'
import { cx } from '../../utils/cx.ts'
import { useUiCopy } from '../copy.ts'

export type StatusIconButtonKey = 'list' | 'cloud' | 'warning' | 'test' | 'user'

export interface StatusIconButtonsProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  active?: StatusIconButtonKey | null
  warningCount?: number
  disabled?: boolean
  showList?: boolean
  showCloud?: boolean
  showWarning?: boolean
  showTest?: boolean
  showUser?: boolean
  onListClick?: () => void
  onCloudClick?: () => void
  onWarningClick?: () => void
  onTestClick?: () => void
  onUserClick?: () => void
}



export function StatusIconButtons({
  active = 'list',
  warningCount = 0,
  disabled = false,
  showList = true,
  showCloud = true,
  showWarning = true,
  showTest = false,
  showUser = true,
  onListClick,
  onCloudClick,
  onWarningClick,
  onTestClick,
  onUserClick,
  className,
  ...props
}: StatusIconButtonsProps) {
  const copy = useUiCopy()
  return (
    <div className={cx(styles.statusIconButtons, className)} {...props}>
      {showList && (
        <button
          type="button"
          className={cx(
            styles.iconButton,
            styles.variantList,
            active === 'list' && styles.isActive,
          )}
          aria-label={copy.statusIconButtons.list}
          title={copy.statusIconButtons.list}
          disabled={disabled}
          onClick={onListClick}
        >
          <List className={styles.icon} />
        </button>
      )}

      {showCloud && (
        <button
          type="button"
          className={cx(
            styles.iconButton,
            styles.variantCloud,
            active === 'cloud' && styles.isActive,
          )}
          aria-label={copy.statusIconButtons.cloud}
          title={copy.statusIconButtons.cloud}
          disabled={disabled}
          onClick={onCloudClick}
        >
          <CloudUpload className={styles.icon} />
        </button>
      )}

      {showTest && (
        <button
          type="button"
          className={cx(
            styles.iconButton,
            styles.variantTest,
            active === 'test' && styles.isActive,
          )}
          aria-label={copy.statusIconButtons.test}
          title={copy.statusIconButtons.test}
          disabled={disabled}
          onClick={onTestClick}
        >
          <FlaskConical className={styles.icon} />
        </button>
      )}

      {showWarning && (
        <button
          type="button"
          className={cx(
            styles.iconButton,
            styles.variantWarning,
            active === 'warning' && styles.isActive,
          )}
          aria-label={copy.statusIconButtons.warning}
          title={copy.statusIconButtons.warning}
          disabled={disabled}
          onClick={onWarningClick}
        >
          <TriangleAlert className={styles.icon} />
          {warningCount > 0 && (
            <span className={styles.badge} aria-label={copy.statusIconButtons.warningBadgeAriaLabel(warningCount)}>
              {warningCount}
            </span>
          )}
        </button>
      )}

      {showUser && (
        <button
          type="button"
          className={cx(
            styles.iconButton,
            styles.variantUser,
            active === 'user' && styles.isActive,
          )}
          aria-label={copy.statusIconButtons.user}
          title={copy.statusIconButtons.user}
          disabled={disabled}
          onClick={onUserClick}
        >
          <CircleUserRound className={styles.icon} />
        </button>
      )}
    </div>
  )
}
