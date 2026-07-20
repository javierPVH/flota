/**
 * [ES] Boton de navegacion tipo hamburguesa (solo icono).
 * [EN] Hamburger navigation button (icon-only).
 */
import type { ButtonHTMLAttributes } from 'react'
import { Menu } from 'lucide-react'
import styles from '../../styles/_components/buttons/navigation-menu-button.module.sass'
import { cx } from '../../utils/cx.ts'
import { useUiCopy } from '../copy.ts'

export type NavigationMenuButtonSize = 'sm' | 'md'

export interface NavigationMenuButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  isOpen?: boolean
  size?: NavigationMenuButtonSize
  ariaLabel?: string
  openLabel?: string
  closeLabel?: string
}

const sizeClass: Record<NavigationMenuButtonSize, string> = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
}



export function NavigationMenuButton({
  isOpen = false,
  size = 'md',
  ariaLabel,
  openLabel,
  closeLabel,
  className,
  type = 'button',
  ...props
}: NavigationMenuButtonProps) {
  const copy = useUiCopy()
  const resolvedOpenLabel = openLabel ?? copy.navigationMenuButton.open
  const resolvedCloseLabel = closeLabel ?? copy.navigationMenuButton.close
  const resolvedAriaLabel = ariaLabel ?? (isOpen ? resolvedCloseLabel : resolvedOpenLabel)

  return (
    <button
      type={type}
      className={cx(
        styles.button,
        sizeClass[size],
        isOpen && styles.isOpen,
        className,
      )}
      aria-label={resolvedAriaLabel}
      title={resolvedAriaLabel}
      {...props}
    >
      <Menu className={styles.icon} />
    </button>
  )
}
