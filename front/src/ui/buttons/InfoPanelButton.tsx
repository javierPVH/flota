/**
 * [ES] Boton tipo panel con icono/imagen, titulo y subtitulo.
 * [EN] Panel-like button with icon/image, title and subtitle.
 * Used for prominent navigation entries in admin-style screens.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from '../../styles/_components/buttons/info-panel-button.module.sass'
import { cx } from '../../utils/cx.ts'

export type InfoPanelIconTone =
  | 'navy'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'orange'
  | 'green'
  | 'slate'
  | 'navHome'
  | 'navConfig'
  | 'navUsers'
  | 'navEmployees'
  | 'navCostCenters'
  | 'navExpenses'
  | 'navReports'
  | 'navSystem'

export type InfoPanelIconStyle = 'default' | 'nav'

export interface InfoPanelButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  imageSrc?: string
  imageAlt?: string
  icon?: ReactNode
  iconTone?: InfoPanelIconTone
  iconStyle?: InfoPanelIconStyle
  title: ReactNode
  subtitle: ReactNode
}


const toneClass: Record<InfoPanelIconTone, string> = {
  navy: styles.toneNavy,
  teal: styles.toneTeal,
  blue: styles.toneBlue,
  purple: styles.tonePurple,
  orange: styles.toneOrange,
  green: styles.toneGreen,
  slate: styles.toneSlate,
  navHome: styles.toneNavHome,
  navConfig: styles.toneNavConfig,
  navUsers: styles.toneNavUsers,
  navEmployees: styles.toneNavEmployees,
  navCostCenters: styles.toneNavCostCenters,
  navExpenses: styles.toneNavExpenses,
  navReports: styles.toneNavReports,
  navSystem: styles.toneNavSystem,
}

const iconStyleClass: Record<InfoPanelIconStyle, string> = {
  default: styles.iconWrapDefault,
  nav: styles.iconWrapNav,
}

export function InfoPanelButton({
  imageSrc,
  imageAlt = '',
  icon,
  iconTone = 'navy',
  iconStyle = 'default',
  title,
  subtitle,
  className,
  type = 'button',
  ...props
}: InfoPanelButtonProps) {
  const hasIcon = icon !== undefined && icon !== null

  return (
    <button
      type={type}
      className={cx(styles.infoPanelButton, className)}
      {...props}
    >
      <span
        className={cx(
          styles.visualWrap,
          hasIcon ? styles.iconWrap : styles.imageWrap,
          hasIcon && iconStyleClass[iconStyle],
          hasIcon && toneClass[iconTone],
        )}
        aria-hidden="true"
      >
        {hasIcon ? (
          <span className={styles.icon}>{icon}</span>
        ) : (
          <img className={styles.image} src={imageSrc} alt={imageAlt} />
        )}
      </span>
      <span className={styles.copyWrap}>
        <span className={styles.title}>{title}</span>
        <span className={styles.subtitle}>{subtitle}</span>
      </span>
    </button>
  )
}
