import { useEffect, useRef, type ReactNode } from 'react'
import styles from '../../styles/_components/layout/base-layout.module.sass'
import { cx } from '../../utils/cx.ts'
import { Footer, type FooterProps } from './Footer.tsx'
import { Section, type BaseSectionConfig } from './Section.tsx'

export interface BaseProps {
  section: BaseSectionConfig
  /**
   * Cabecera de la app. Se inyecta (el Header concreto —logo, navegación,
   * permisos— es específico de cada app y no forma parte de la librería).
   * Con `sidebar`, se pinta como barra superior del contenido.
   */
  header?: ReactNode
  /** Props del pie; omítelo para usar los valores por defecto. */
  footer?: FooterProps
  /**
   * Navegación lateral fija (p. ej. `<SidebarNav>`). Sin ella, el shell es el
   * marco flotante de siempre. En pantallas estrechas (≤760px) pasa a ser un
   * panel deslizable controlado por `drawerOpen`.
   */
  sidebar?: ReactNode
  /** Id del `<aside>`, para el `aria-controls` del botón ☰ de la app. */
  sidebarId?: string
  /** Etiqueta accesible del `<aside>` (texto de la app, por i18n). */
  sidebarLabel?: string
  /** Estado del panel deslizable (solo aplica en pantallas estrechas). */
  drawerOpen?: boolean
  onDrawerOpenChange?: (open: boolean) => void
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Shell de página: cabecera inyectada + sección de contenido + pie.
 * UX4: header y footer viven FUERA de <main> (landmarks correctos);
 * `display: contents` mantiene el layout exactamente igual. */
export function Base({
  section,
  header,
  footer,
  sidebar,
  sidebarId = 'app-sidebar',
  sidebarLabel,
  drawerOpen = false,
  onDrawerOpenChange,
}: BaseProps) {
  const asideRef = useRef<HTMLElement | null>(null)
  const hasSidebar = Boolean(sidebar)
  // El callback suele declararse inline: se guarda el último sin relanzar el
  // efecto (que devolvería el foco al primer enlace en cada render).
  const onDrawerOpenChangeRef = useRef(onDrawerOpenChange)
  useEffect(() => {
    onDrawerOpenChangeRef.current = onDrawerOpenChange
  }, [onDrawerOpenChange])

  // Panel deslizable: foco al primer enlace al abrir, Escape y retorno del foco.
  useEffect(() => {
    if (!hasSidebar || !drawerOpen) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    asideRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDrawerOpenChangeRef.current?.(false)
      if (e.key !== 'Tab' || !asideRef.current) return
      const items = [...asideRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [hasSidebar, drawerOpen])

  if (sidebar) {
    return (
      <div className={cx(styles.page, styles.pageWithSidebar)}>
        <aside
          ref={asideRef}
          id={sidebarId}
          aria-label={sidebarLabel}
          className={cx(styles.sidebar, drawerOpen && styles.sidebarOpen)}
        >
          {sidebar}
        </aside>
        {drawerOpen && (
          <div
            className={styles.drawerBackdrop}
            aria-hidden="true"
            onClick={() => onDrawerOpenChange?.(false)}
          />
        )}
        <div className={styles.shellMain}>
          {header}
          <main className={styles.shellContent}>
            <Section section={section} />
          </main>
          <Footer {...footer} />
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        {header}
        <main style={{ display: 'contents' }}>
          <Section section={section} />
        </main>
        <Footer {...footer} />
      </div>
    </div>
  )
}
