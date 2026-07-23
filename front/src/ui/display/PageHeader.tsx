/**
 * [ES] Cabecera de página: (breadcrumb) + título/subtítulo + acciones.
 * [EN] Page header: (breadcrumb) + title/subtitle + actions on the right.
 * Reemplaza los `.page-head` / `.section-head` sueltos de las apps.
 */
import type { ReactNode } from 'react'
import styles from '../../styles/_components/display/page-header.module.sass'
import { cx } from '../../utils/cx.ts'

export interface PageHeaderStat {
  value: ReactNode
  label: ReactNode
}

export interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /** Migas de pan opcionales (renderiza tu propio <nav>/enlaces). */
  breadcrumb?: ReactNode
  /**
   * Clúster de métricas inline junto al título (separado por una regla vertical),
   * como en la landing de la referencia (p. ej. "2 Espacios · 2 Administras").
   */
  stats?: PageHeaderStat[]
  /** Acciones alineadas a la derecha (botones, toggles…). */
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, breadcrumb, stats, actions, className }: PageHeaderProps) {
  return (
    <header className={cx(styles.header, className)}>
      {breadcrumb && <div className={styles.breadcrumb}>{breadcrumb}</div>}
      <div className={styles.row}>
        <div className={styles.lead}>
          <div className={styles.titles}>
            <h1 className={styles.title}>{title}</h1>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          {stats && stats.length > 0 && (
            <div className={styles.stats}>
              {stats.map((stat, index) => (
                <div key={index} className={styles.stat}>
                  <span className={styles.statValue}>{stat.value}</span>
                  <span className={styles.statLabel}>{stat.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </header>
  )
}
