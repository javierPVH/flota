/**
 * [ES] Panel reutilizable para formularios de creacion.
 * [EN] Reusable panel for create forms.
 */
import { useEffect, useState, type ReactNode } from 'react'
import styles from '../styles/_components/forms/catalog-create-form.module.sass'
import { cx } from '../utils/cx.ts'


export interface CreateFormPanelProps {
  title: string
  children: ReactNode
  className?: string
  bodyClassName?: string
  asAccordion?: boolean
  defaultOpen?: boolean
}

export function CreateFormPanel({
  title,
  children,
  className,
  bodyClassName,
  asAccordion = false,
  defaultOpen = true,
}: CreateFormPanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  useEffect(() => {
    setIsOpen(defaultOpen)
  }, [defaultOpen])

  if (asAccordion) {
    return (
      <section className={cx(styles.formPanel, styles.formPanelAccordion, className)}>
        <details
          className={styles.formPanelDetails}
          open={isOpen}
          onToggle={(event) => setIsOpen(event.currentTarget.open)}
        >
          <summary className={styles.formPanelSummary}>
            <span className={styles.formPanelSummaryTitleWrap}>
              <h4 className={styles.formPanelTitle}>{title}</h4>
            </span>
            <span className={styles.formPanelChevron} aria-hidden="true" />
          </summary>
          <hr className={styles.formPanelDivider} />
          <div className={cx(styles.formPanelBody, bodyClassName)}>
            {children}
          </div>
        </details>
      </section>
    )
  }

  return (
    <section className={cx(styles.formPanel, className)}>
      <h4 className={styles.formPanelTitle}>{title}</h4>
      <hr className={styles.formPanelDivider} />
      <div className={cx(styles.formPanelBody, bodyClassName)}>
        {children}
      </div>
    </section>
  )
}
