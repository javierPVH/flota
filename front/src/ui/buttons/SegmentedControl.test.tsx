import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SegmentedControl } from './SegmentedControl.tsx'

const OPTIONS = [
  { value: 'vehicle', label: 'Mi vehículo' },
  { value: 'fleet', label: 'Flota' },
  { value: 'profile', label: 'Mi perfil', disabled: true },
] as const

describe('SegmentedControl', () => {
  it('es un radiogroup con una sola opción marcada y en el orden de tabulación', () => {
    render(<SegmentedControl ariaLabel="Vista" options={OPTIONS} value="fleet" onChange={vi.fn()} />)
    expect(screen.getByRole('radiogroup', { name: 'Vista' })).toBeInTheDocument()
    const fleet = screen.getByRole('radio', { name: 'Flota' })
    expect(fleet).toHaveAttribute('aria-checked', 'true')
    expect(fleet).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Mi vehículo' })).toHaveAttribute('tabindex', '-1')
  })

  it('las flechas cambian de opción y se saltan las desactivadas', () => {
    const onChange = vi.fn()
    render(<SegmentedControl ariaLabel="Vista" options={OPTIONS} value="fleet" onChange={onChange} />)
    // Desde «Flota», a la derecha está «Mi perfil» (desactivada): vuelve a la primera.
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Flota' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('vehicle')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Flota' }), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('vehicle')
  })

  it('al pulsar, avisa con el valor', () => {
    const onChange = vi.fn()
    render(<SegmentedControl ariaLabel="Vista" options={OPTIONS} value="fleet" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Mi vehículo' }))
    expect(onChange).toHaveBeenCalledWith('vehicle')
  })
})
