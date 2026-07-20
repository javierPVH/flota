import type { ReactNode } from 'react'
import styles from '../../styles/_components/layout/base-layout.module.sass'
import { cx } from '../../utils/cx.ts'
import { useUiCopy } from '../copy.ts'

export type BaseSectionConfig = {
  group?: string
  title?: string
  subtitle?: string
  description?: string
  disableScroll?: boolean
  content?: ReactNode
}

type SectionProps = {
  section: BaseSectionConfig
}

export function Section({ section }: SectionProps) {
  const copy = useUiCopy()
  const subtitle = section.subtitle ?? section.description
  const hasHeadingContent = Boolean(section.title || subtitle)

  return (
    <section
      className={cx(styles.section, section.disableScroll && styles.sectionNoScroll)}
      aria-label={copy.layout.sectionAriaLabel}
    >
      <div className={cx(styles.sectionInner, section.disableScroll && styles.sectionInnerFill)}>
        {hasHeadingContent ? (
          <div className={styles.sectionHeading}>
            {section.title ? <h1 className={styles.sectionTitle}>{section.title}</h1> : null}
            {subtitle ? <p className={styles.sectionSubtitle}>{subtitle}</p> : null}
          </div>
        ) : null}
        <div className={styles.sectionContent}>{section.content}</div>
      </div>
    </section>
  )
}
