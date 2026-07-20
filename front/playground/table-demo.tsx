import { TableWithPanel } from '@/ui/table/index.ts'
import type { TableWithPanelColumn } from '@/ui/table/index.ts'

interface Row {
  id: string
  name: string
  date: string
  amount: number
}

const rows: Row[] = [
  { id: '1', name: 'Vuelo Madrid–Berlín', date: '2026-01-12', amount: 240.5 },
  { id: '2', name: 'Hotel Berlín (3 noches)', date: '2026-01-12', amount: 410 },
  { id: '3', name: 'Taxi aeropuerto', date: '2026-02-03', amount: 32.9 },
  { id: '4', name: 'Comida cliente', date: '2026-02-18', amount: 88.2 },
  { id: '5', name: 'Tren Berlín–Múnich', date: '2026-03-01', amount: 120 },
  { id: '6', name: 'Dietas marzo', date: '2026-03-22', amount: 300 },
]

const columns: Array<TableWithPanelColumn<Row>> = [
  { key: 'name', label: 'Concepto', searchable: true, sortable: true, expandable: true },
  { key: 'date', label: 'Fecha', isDate: true, sortable: true, align: 'center' },
  {
    key: 'amount',
    label: 'Importe',
    sortable: true,
    align: 'right',
    getValue: (r) => r.amount,
    render: (r) => `${r.amount.toFixed(2)} €`,
  },
]

export function TableDemo() {
  return (
    <TableWithPanel
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      showMonthSortButtons
      monthSortDateColumnKey="date"
      enableColumnSort
      enablePagination
      defaultPageSize={5}
      pageSizeOptions={[5, 10]}
    />
  )
}
