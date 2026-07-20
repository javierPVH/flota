import type { HTMLAttributes } from 'react'
import { CircleUserRound } from 'lucide-react'
import { Button } from './Button'
import { LanguageToggleButton, type LanguageToggleValue } from './LanguageToggleButton'
import styles from '../../styles/_components/buttons/user-menu-panel.module.sass'
import { cx } from '../../utils/cx.ts'

export interface UserMenuPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  profileLabel: string
  profileSubtitle?: string
  languageLabel: string
  logoutLabel: string
  signingOutLabel: string
  activeLanguage: LanguageToggleValue
  isSigningOut?: boolean
  onLanguageChange: (next: LanguageToggleValue) => void
  onLogout: () => void
}


export function UserMenuPanel({
  profileLabel,
  profileSubtitle = '',
  languageLabel,
  logoutLabel,
  signingOutLabel,
  activeLanguage,
  isSigningOut = false,
  onLanguageChange,
  onLogout,
  className,
  ...props
}: UserMenuPanelProps) {
  return (
    <div className={cx(styles.panel, className)} {...props}>
      <section className={styles.profileCard} aria-label={profileLabel}>
        <span className={styles.profileIconWrap} aria-hidden="true">
          <CircleUserRound className={styles.profileIcon} />
        </span>
        <span className={styles.profileCopy}>
          <span className={styles.profileTitle}>{profileLabel}</span>
          {profileSubtitle ? <span className={styles.profileSubtitle}>{profileSubtitle}</span> : null}
        </span>
      </section>

      <hr className={styles.divider} />

      <section className={styles.languageSection} aria-label={languageLabel}>
        <p className={styles.sectionLabel}>{languageLabel}</p>
        <div className={styles.languageToggleWrap}>
          <LanguageToggleButton
            className={styles.languageToggle}
            activeLanguage={activeLanguage}
            toggleOnSameOptionClick={false}
            onChange={onLanguageChange}
          />
        </div>
      </section>

      <hr className={styles.divider} />

      <Button
        variant="danger"
        size="md"
        fullWidth
        className={styles.logoutButton}
        onClick={onLogout}
        disabled={isSigningOut}
      >
        {isSigningOut ? signingOutLabel : logoutLabel}
      </Button>
    </div>
  )
}
