/**
 * [ES] Navegación lateral para el shell `<Base sidebar>`: grupos con título y
 * enlaces con icono. El enlace activo lo marca `NavLink` (aria-current="page").
 * Los textos llegan siempre de la app (i18n); la librería no trae literales.
 * [EN] Sidebar navigation for `<Base sidebar>`.
 */
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import styles from '../../styles/_components/nav/sidebar-nav.module.sass'
import { cx } from '../../utils/cx.ts'

export interface SidebarNavProps {
  /** Etiqueta accesible del <nav>. */
  ariaLabel: string
  /** Bloque de marca (logo + nombre de la app) arriba. */
  brand?: ReactNode
  /** Zona inferior (idioma, salir…). */
  footer?: ReactNode
  children: ReactNode
  className?: string
}

export function SidebarNav({ ariaLabel, brand, footer, children, className }: SidebarNavProps) {
  return (
    <div className={cx(styles.sidebarNav, className)}>
      {brand && <div className={styles.brand}>{brand}</div>}
      <nav aria-label={ariaLabel} className={styles.nav}>
        {children}
      </nav>
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  )
}

export interface SidebarNavGroupProps {
  title?: ReactNode
  children: ReactNode
}

export function SidebarNavGroup({ title, children }: SidebarNavGroupProps) {
  return (
    <div className={styles.group} role="group" aria-label={typeof title === 'string' ? title : undefined}>
      {title && <p className={styles.groupTitle}>{title}</p>}
      <ul className={styles.list}>{children}</ul>
    </div>
  )
}

export interface SidebarNavItemProps {
  to: string
  icon?: ReactNode
  /** Contador opcional (pendientes, alertas). */
  count?: number
  /** Coincidencia exacta de ruta (para "/"). */
  end?: boolean
  /** Tono de peligro (p. ej. "Salir" si se pinta como enlace). */
  danger?: boolean
  onClick?: () => void
  children: ReactNode
}

export function SidebarNavItem({ to, icon, count, end, danger, onClick, children }: SidebarNavItemProps) {
  return (
    <li>
      <NavLink
        to={to}
        end={end}
        onClick={onClick}
        className={({ isActive }) => cx(styles.item, isActive && styles.itemActive, danger && styles.itemDanger)}
      >
        {icon && (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        )}
        <span className={styles.label}>{children}</span>
        {count !== undefined && count > 0 && <span className={styles.count}>{count}</span>}
      </NavLink>
    </li>
  )
}

export interface SidebarNavButtonProps {
  icon?: ReactNode
  danger?: boolean
  onClick: () => void
  children: ReactNode
}

/** Acción de la barra lateral que no navega (p. ej. cerrar sesión). */
export function SidebarNavButton({ icon, danger, onClick, children }: SidebarNavButtonProps) {
  return (
    <button type="button" onClick={onClick} className={cx(styles.item, danger && styles.itemDanger)}>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={styles.label}>{children}</span>
    </button>
  )
}
