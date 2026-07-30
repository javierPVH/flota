// DX4: primeros tests de componente del Modal (semántica UX2).
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Modal } from './Modal.tsx'

function renderModal(onClose = vi.fn()) {
  render(
    <Modal open title="Título del diálogo" onClose={onClose}>
      <button type="button">Acción</button>
    </Modal>,
  )
  return onClose
}

describe('Modal (UX2)', () => {
  it('expone role=dialog con aria-modal y aria-labelledby hacia el título', () => {
    renderModal()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy!)).toHaveTextContent('Título del diálogo')
  })

  it('cierra con Escape y con el botón de cerrar', () => {
    const onClose = renderModal()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('bloquea el scroll del fondo mientras está abierto y lo restaura al cerrar', () => {
    const { unmount } = render(
      <Modal open title="t" onClose={() => {}}>
        contenido
      </Modal>,
    )
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('cerrado no monta el diálogo', () => {
    render(
      <Modal open={false} title="t" onClose={() => {}}>
        contenido
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
