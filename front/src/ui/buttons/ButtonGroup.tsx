/**
 * [ES] Contenedor horizontal para agrupar botones.
 * [EN] Horizontal layout wrapper for Button components.
 * Can enforce equal widths for direct button children.
 */
import type { HTMLAttributes, ReactNode } from 'react'
import styles from '../../styles/_components/buttons/buttons.module.sass'
import { cx } from '../../utils/cx.ts'

export interface ButtonGroupProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * [ES] Si es true, todos los botones hijos directos comparten ancho (funciona con 2 o 3).
   * [EN] If true, all direct child buttons share the same width (works for 2 or 3 buttons).
   */
  equalWidth?: boolean
  children: ReactNode
}


export function ButtonGroup({
  equalWidth = false,
  className,
  children,
  ...props
}: ButtonGroupProps) {
  return (
    <div
      className={cx(
        styles.buttonGroup,
        equalWidth && styles.buttonGroupEqual,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
