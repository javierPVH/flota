// DX4: primeros tests de la tabla unificada (1.654 líneas, 13 usos) — cubren
// el contrato básico y la fila expandible de N4.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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

describe('TableWithPanel', () => {
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
})
