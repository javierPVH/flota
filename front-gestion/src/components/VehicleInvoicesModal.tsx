import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, IconButton, Modal, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang, type AppLanguage } from '@flota/ui/i18n'
import { ExternalLink, Pencil, Trash2 } from 'lucide-react'

import {
  createInvoice,
  deleteInvoice,
  listAll,
  listInvoices,
  updateInvoice,
  type InvoiceInput,
  type InvoiceRow,
} from '../api.ts'
import { todayIso } from '../format.ts'
import { useDeactivateConfirm } from './ConfirmDialog.tsx'
import { useInvoicesCopy } from '../translations/invoices.ts'
import type { Vehicle } from '../types.ts'

const EUR_LOCALE: Record<AppLanguage, string> = { es: 'es-ES', en: 'en-GB' }
const eur = (value: string | number, lang: AppLanguage) =>
  Number(value).toLocaleString(EUR_LOCALE[lang], { style: 'currency', currency: 'EUR' })
const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : '')

interface HeaderForm {
  code: string
  date: string
  amount: string
  drive_url: string
}
const EMPTY_HEADER: HeaderForm = { code: '', date: todayIso(), amount: '', drive_url: '' }

/** Gestión de las facturas de UN vehículo: listado + alta/edición de cabecera.
 * (La refacturación queda oculta de momento.) */
export function VehicleInvoicesModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const t = useInvoicesCopy()
  const lang = useAppLang()
  const deactivateConfirm = useDeactivateConfirm()

  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Vista interna: lista o cabecera (alta/edición) en modal propio.
  const [view, setView] = useState<'list' | 'header'>('list')
  const [editing, setEditing] = useState<InvoiceRow | null>(null)
  const [header, setHeader] = useState<HeaderForm>(EMPTY_HEADER)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    listAll(listInvoices({ vehicle: vehicle.id }))
      .then((rows) => {
        setInvoices(rows)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
      .finally(() => setLoading(false))
  }, [vehicle.id, t.loadError])

  useEffect(load, [load])

  function openHeader(invoice: InvoiceRow | null) {
    setEditing(invoice)
    setHeader(
      invoice
        ? {
            code: invoice.code,
            date: invoice.date ?? '',
            amount: invoice.amount != null ? String(Number(invoice.amount)) : '',
            drive_url: invoice.drive_url,
          }
        : { ...EMPTY_HEADER },
    )
    setFormError('')
    setView('header')
  }

  async function submitHeader(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFormError('')
    const data: InvoiceInput = {
      code: header.code,
      vehicle: vehicle.id,
      date: header.date || null,
      amount: header.amount || null,
      drive_url: header.drive_url,
    }
    try {
      if (editing) await updateInvoice(editing.id, data)
      else await createInvoice(data)
      setView('list')
      load()
    } catch (err) {
      setFormError(asErrorMessage(err, t.saveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(invoice: InvoiceRow) {
    // N7 ("nada se borra"): doble confirmación + desactivación con motivo.
    const reason = await deactivateConfirm(t.deactivateSubject(invoice.code || `#${invoice.id}`))
    if (reason === null) return
    try {
      await deleteInvoice(invoice.id, reason)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.deactivateError))
    }
  }

  const columns: Array<TableWithPanelColumn<InvoiceRow>> = [
    {
      key: 'code',
      label: t.columns.code,
      getValue: (i) => i.code || `#${i.id}`,
      render: (i) => <strong>{i.code || `#${i.id}`}</strong>,
    },
    { key: 'date', label: t.columns.date, isDate: true, getValue: (i) => i.date, render: (i) => i.date ?? '—' },
    {
      key: 'amount',
      label: t.columns.amount,
      align: 'right',
      getValue: (i) => (i.amount != null ? Number(i.amount) : null),
      render: (i) => (i.amount != null ? eur(i.amount, lang) : '—'),
    },
    {
      key: 'pdf',
      label: t.columns.pdf,
      searchable: false,
      sortable: false,
      render: (i) => {
        const href = safeHref(i.drive_url)
        return href ? (
          <a className="doc-open" href={href} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden /> {t.openPdf}
          </a>
        ) : (
          '—'
        )
      },
    },
    {
      key: 'actions',
      label: t.columns.actions,
      align: 'right',
      searchable: false,
      sortable: false,
      render: (i) => (
        <div className="row-actions">
          <IconButton aria-label={t.editAction} title={t.editAction} onClick={() => openHeader(i)}>
            <Pencil size={15} />
          </IconButton>
          <IconButton
            variant="danger"
            aria-label={t.deleteAction}
            title={t.deleteAction}
            onClick={() => handleDelete(i)}
          >
            <Trash2 size={15} />
          </IconButton>
        </div>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.8rem' }}>
        <Button variant="primary" onClick={() => openHeader(null)}>{t.newInvoice}</Button>
      </div>
      {error && <div role="alert" className="form-error">{error}</div>}
      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <TableWithPanel<InvoiceRow>
          rows={invoices}
          columns={columns}
          rowKey={(i) => String(i.id)}
          showControlPanel={false}
          enablePagination
          defaultPageSize={10}
          pageSizeOptions={[10, 25, 50]}
          emptyStateLabel={t.empty(true)}
        />
      )}
      <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
        <Button type="button" variant="secondary" onClick={onClose}>{t.cancel}</Button>
      </div>

      {/* Alta / edición de la cabecera de factura (modal propio). */}
      <Modal
        open={view === 'header'}
        title={editing ? t.headerTitleEdit(editing.code || `#${editing.id}`) : t.headerTitleNew}
        onClose={() => setView('list')}
      >
        <form className="modal-form" onSubmit={submitHeader}>
          <TextInputField
            label={t.codeLabel}
            value={header.code}
            onChange={(e) => setHeader((h) => ({ ...h, code: e.target.value }))}
          />
          {/* Fecha + Importe total en la misma línea. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0.8rem 1rem' }}>
            <TextInputField
              label={t.dateLabel}
              type="date"
              value={header.date}
              onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))}
            />
            <TextInputField
              label={t.amountLabel}
              type="number"
              value={header.amount}
              onChange={(e) => setHeader((h) => ({ ...h, amount: e.target.value }))}
            />
          </div>
          <TextInputField
            label={t.pdfUrlLabel}
            value={header.drive_url}
            placeholder={t.pdfUrlPlaceholder}
            onChange={(e) => setHeader((h) => ({ ...h, drive_url: e.target.value }))}
          />
          {formError && <div role="alert" className="form-error">{formError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setView('list')}>{t.cancel}</Button>
            <Button type="submit" variant="primary" disabled={saving}>{saving ? t.saving : t.save}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
