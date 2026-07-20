import type { ReactNode } from 'react'
import styles from '../../styles/_components/layout/base-layout.module.sass'
import { Footer, type FooterProps } from './Footer.tsx'
import { Section, type BaseSectionConfig } from './Section.tsx'

export interface BaseProps {
  section: BaseSectionConfig
  /**
   * Cabecera de la app. Se inyecta (el Header concreto —logo, navegación,
   * permisos— es específico de cada app y no forma parte de la librería).
   */
  header?: ReactNode
  /** Props del pie; omítelo para usar los valores por defecto. */
  footer?: FooterProps
}

/** Shell de página: cabecera inyectada + sección de contenido + pie. */
export function Base({ section, header, footer }: BaseProps) {
  return (
    <main className={styles.page}>
      <div className={styles.frame}>
        {header}
        <Section section={section} />
        <Footer {...footer} />
      </div>
    </main>
  )
}
