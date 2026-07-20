import styles from '../../styles/_components/layout/base-layout.module.sass'
import { useUiCopy } from '../copy.ts'

export interface FooterProps {
  /** Marca del copyright (por defecto, la del microcopy). Sustituible por app. */
  brand?: string
  /** Texto de contacto (por defecto, el del microcopy). */
  contact?: string
}

export function Footer({ brand, contact }: FooterProps = {}) {
  const copy = useUiCopy()
  const currentYear = new Date().getFullYear()
  const brandText = brand ?? copy.layout.footerBrand
  const contactText = contact ?? copy.layout.footerContact

  return (
    <footer className={styles.footer} aria-label={copy.layout.footerAriaLabel}>
      <div className={styles.footerContent}>
        <span className={styles.footerCopy}>{`© ${currentYear} ${brandText}`}</span>
        <span className={styles.footerSep} aria-hidden="true">
          {copy.layout.footerSeparator}
        </span>
        <span className={styles.footerContact}>{contactText}</span>
      </div>
    </footer>
  )
}
