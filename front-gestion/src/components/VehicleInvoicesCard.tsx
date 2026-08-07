import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Modal } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang } from '@flota/ui/i18n'
import { ExternalLink } from 'lucide-react'

import { listAll, listInvoices, type InvoiceRow } from '../api.ts'
import { fmtEur } from '../format.ts'
import { useVehicleDetailCopy } from '../translations/vehicleDetail.ts'
import { CollapsibleCard, type AccordionState } from './CollapsibleCard.tsx'
import { VehicleInvoicesModal } from './VehicleInvoicesModal.tsx'
import type { Vehicle } from '../types.ts'

const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : '')

/** Tarjeta "Facturas" de la ficha (junto a Datos técnicos y Contrato): resumen
 * (nº + total) y las últimas facturas, con acceso a la gestión completa. */
export function VehicleInvoicesCard({
  vehicle,
  accordion,
}: {
  vehicle: Vehicle
  accordion: AccordionState
}) {
  const t = useVehicleDetailCopy()
  const lang = useAppLang()
  const eur = (value: string | number) => fmtEur(value, lang)

  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [error, setError] = useState('')
  const [manage, setManage] = useState(false)

  const load = useCallback(() => {
    listAll(listInvoices({ vehicle: vehicle.id }))
      .then((rows) => {
        setInvoices(rows)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, '')))
  }, [vehicle.id])

  useEffect(load, [load])

  const total = useMemo(
    () => invoices.reduce((acc, i) => acc + (i.amount != null ? Number(i.amount) : 0), 0),
    [invoices],
  )

  return (
    <CollapsibleCard
      id="invoices"
      accordion={accordion}
      title={t.invoicesTitle}
      actions={
        accordion.isOpen('invoices') ? (
          <Button variant="secondary" size="sm" onClick={() => setManage(true)}>
            {t.manageInvoices}
          </Button>
        ) : (
          // Resumen al colapsar: nº de facturas · total.
          <span className="acc-summary">
            {invoices.length}
            {invoices.length ? ` · ${eur(total)}` : ''}
          </span>
        )
      }
    >
      {error && <div role="alert" className="form-error">{error}</div>}

      {invoices.length === 0 ? (
        <p className="muted">{t.noInvoices}</p>
      ) : (
        <>
          <div className="invoice-summary">
            <div className="invoice-summary-tile">
              <span>{t.invoiceCount}</span>
              <strong>{invoices.length}</strong>
            </div>
            <div className="invoice-summary-tile">
              <span>{t.invoiceTotal}</span>
              <strong>{eur(total)}</strong>
            </div>
          </div>
          <ul className="invoice-mini-list">
            {invoices.slice(0, 5).map((i) => {
              const href = safeHref(i.drive_url)
              return (
                <li key={i.id}>
                  <span className="inv-code">{i.code || `#${i.id}`}</span>
                  <span className="inv-date muted">{i.date ?? '—'}</span>
                  <span className="inv-amount">{i.amount != null ? eur(i.amount) : '—'}</span>
                  {href ? (
                    <a className="inv-pdf" href={href} target="_blank" rel="noreferrer">
                      <ExternalLink size={13} aria-hidden /> {t.invoiceOpenPdf}
                    </a>
                  ) : (
                    <span className="inv-pdf muted">—</span>
                  )}
                </li>
              )
            })}
          </ul>
          {invoices.length > 5 && (
            <p className="muted invoice-more">{t.invoicesMore(invoices.length - 5)}</p>
          )}
        </>
      )}

      {/* Gestión completa (alta/edición/baja) en el modal existente. */}
      <Modal
        open={manage}
        title={t.invoicesModalTitle(vehicle.plate)}
        onClose={() => {
          setManage(false)
          load()
        }}
        xl
        height="88dvh"
      >
        {manage && (
          <VehicleInvoicesModal
            vehicle={vehicle}
            onClose={() => {
              setManage(false)
              load()
            }}
          />
        )}
      </Modal>
    </CollapsibleCard>
  )
}
