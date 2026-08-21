// DX4: primeros tests de la tabla unificada (1.654 líneas, 13 usos) — cubren
// el contrato básico y la fila expandible de N4.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TableWithPanel, type TableWithPanelColumn } from './TableWithPanel.tsx'

interface Row {
  id: number
  plate: string
  km: number
}

const ROWS: Row[] = [
  { id: 1, plate: '1111AAA', km: 1000 },
  { id: 2, plate: '2222BBB', km: 2000 },
]

const COLUMNS: Array<TableWithPanelColumn<Row>> = [
  { key: 'plate', label: 'Matrícula', getValue: (r) => r.plate },
  { key: 'km', label: 'Km', getValue: (r) => r.km },
]

const MANY: Row[] = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  plate: `${String(i + 1).padStart(4, '0')}AAA`,
  km: (i + 1) * 100,
}))

describe('TableWithPanel', () => {
  it('pagina: 25 por página y la segunda muestra el resto', () => {
    render(
      <TableWithPanel<Row>
        rows={MANY}
        columns={COLUMNS}
        rowKey={(r) => String(r.id)}
        enablePagination
        defaultPageSize={25}
      />,
    )
    expect(screen.getByText('0001AAA')).toBeInTheDocument()
    expect(screen.queryByText('0030AAA')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))
    expect(screen.getByText('0030AAA')).toBeInTheDocument()
    expect(screen.queryByText('0001AAA')).not.toBeInTheDocument()
  })

  it('pinta cabeceras con scope=col y las filas', () => {
    render(<TableWithPanel<Row> rows={ROWS} columns={COLUMNS} rowKey={(r) => String(r.id)} />)
    const headers = screen.getAllByRole('columnheader')
    expect(headers.length).toBeGreaterThanOrEqual(2)
    headers.forEach((th) => expect(th).toHaveAttribute('scope', 'col'))
    expect(screen.getByText('1111AAA')).toBeInTheDocument()
    expect(screen.getByText('2222BBB')).toBeInTheDocument()
  })

  it('muestra el estado vacío', () => {
    render(
      <TableWithPanel<Row>
        rows={[]}
        columns={COLUMNS}
        rowKey={(r) => String(r.id)}
        emptyStateLabel="Nada que ver"
      />,
    )
    expect(screen.getByText('Nada que ver')).toBeInTheDocument()
  })

  it('M15: con `columnOrder` controlado respeta el orden del consumidor', () => {
    const { rerender } = render(
      <TableWithPanel<Row>
        rows={ROWS}
        columns={COLUMNS}
        rowKey={(r) => String(r.id)}
        columnOrder={['plate', 'km']}
      />,
    )
    const headerText = () => screen.getAllByRole('columnheader').map((th) => th.textContent?.trim())
    expect(headerText()).toEqual(['Matrícula', 'Km'])
    // Sin remontar (misma instancia): el nuevo orden se aplica igualmente.
    rerender(
      <TableWithPanel<Row>
        rows={ROWS}
        columns={COLUMNS}
        rowKey={(r) => String(r.id)}
        columnOrder={['km', 'plate']}
      />,
    )
    expect(headerText()).toEqual(['Km', 'Matrícula'])
  })

  it('M15: `hiddenColumns` controlado oculta y NO guarda estado propio', () => {
    const onHiddenColumnsChange = vi.fn()
    render(
      <TableWithPanel<Row>
        rows={ROWS}
        columns={COLUMNS}
        rowKey={(r) => String(r.id)}
        hiddenColumns={['km']}
        onHiddenColumnsChange={onHiddenColumnsChange}
        showControlPanel
        showColumnsToggle
      />,
    )
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent?.trim())).toEqual([
      'Matrícula',
    ])
    // Al marcar la casilla, la tabla AVISA en vez de cambiarlo por su cuenta.
    fireEvent.click(screen.getByRole('button', { name: 'Opciones' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar orden de columnas' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Km' }))
    expect(onHiddenColumnsChange).toHaveBeenCalledWith([])
    // Sigue oculta: manda la prop, no un estado interno.
    expect(screen.getAllByRole('columnheader')).toHaveLength(1)
  })

  it('N4: la fila expandible despliega su contenido y lo mantiene montado', async () => {
    render(
      <TableWithPanel<Row>
        rows={ROWS}
        columns={COLUMNS}
        rowKey={(r) => String(r.id)}
        renderExpandedRow={(r) => <div data-testid={`hist-${r.id}`}>Histórico {r.plate}</div>}
      />,
    )
    // Un expansor por fila, cerrado.
    const toggles = screen.getAllByRole('button', { name: 'Desplegar fila' })
    expect(toggles).toHaveLength(2)
    expect(screen.queryByTestId('hist-1')).not.toBeInTheDocument()

    fireEvent.click(toggles[0])
    // La apertura llega tras el doble requestAnimationFrame (animación 0fr→1fr).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Plegar fila' })).toBeInTheDocument()
    })
    expect(screen.getByTestId('hist-1')).toBeInTheDocument()

    // Plegar NO desmonta (las cargas perezosas conservan estado).
    fireEvent.click(screen.getByRole('button', { name: 'Plegar fila' }))
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Desplegar fila' })).toHaveLength(2)
    })
    expect(screen.getByTestId('hist-1')).toBeInTheDocument()
  })

  it('agrupa en dos niveles plegables (año → mes) con filas a todo el ancho', () => {
    interface DatedRow {
      id: number
      plate: string
      closed: string
    }
    const rows: DatedRow[] = [
      { id: 1, plate: 'AGO26', closed: '2026-08-21' },
      { id: 2, plate: 'JUL26', closed: '2026-07-03' },
      { id: 3, plate: 'DIC25', closed: '2025-12-30' },
    ]
    const columns: Array<TableWithPanelColumn<DatedRow>> = [
      { key: 'plate', label: 'Matrícula', getValue: (r) => r.plate },
      { key: 'closed', label: 'Cierre', isDate: true, getValue: (r) => r.closed },
    ]
    render(
      <TableWithPanel<DatedRow>
        rows={rows}
        columns={columns}
        rowKey={(r) => String(r.id)}
        groupRowsByYearMonth
        monthSortDateColumnKey="closed"
      />,
    )

    // Un separador por año y otro por mes, lo más reciente arriba.
    const dividers = [...document.querySelectorAll('tbody button[aria-expanded]')]
    const titleOf = (divider: Element) => divider.querySelectorAll('span')[0]?.textContent
    expect(dividers.map(titleOf)).toEqual(['2026', 'Agosto', 'Julio', '2025', 'Diciembre'])
    // El año suma las filas de sus meses.
    expect(dividers[0].textContent).toContain('2 registros')
    expect(dividers[1].textContent).toContain('1 registro')
    // Cada separador ocupa todas las columnas.
    dividers.forEach((divider) => {
      expect(divider.closest('td')?.getAttribute('colspan')).toBe('2')
    })

    // Plegar el mes esconde solo sus filas.
    fireEvent.click(dividers[1])
    expect(screen.queryByText('AGO26')).not.toBeInTheDocument()
    expect(screen.getByText('JUL26')).toBeInTheDocument()

    // Plegar el año esconde sus meses (y con ellos sus filas).
    fireEvent.click(dividers[0])
    expect(screen.queryByText('Julio')).not.toBeInTheDocument()
    expect(screen.queryByText('JUL26')).not.toBeInTheDocument()
    // El otro año no se entera.
    expect(screen.getByText('DIC25')).toBeInTheDocument()
  })
})
