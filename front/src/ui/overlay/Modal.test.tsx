// DX4: primeros tests de componente del Modal (semántica UX2).
import { act, fireEvent, render, screen } from '@testing-library/react'
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

  it('mantiene el foco al cambiar onClose y Escape usa el callback más reciente', async () => {
    const firstClose = vi.fn()
    const latestClose = vi.fn()
    const view = (open: boolean, onClose: () => void) => (
      <>
        <button type="button">Abrir</button>
        <Modal open={open} title="t" onClose={onClose}>
          <input aria-label="Nombre" />
        </Modal>
      </>
    )
    const { rerender } = render(view(false, firstClose))
    const trigger = screen.getByRole('button', { name: 'Abrir' })
    trigger.focus()
    rerender(view(true, firstClose))

    // El usuario entra en el campo y un cambio de estado del formulario hace
    // que el padre vuelva a renderizar con una función onClose nueva.
    const input = screen.getByRole('textbox', { name: 'Nombre' })
    input.focus()
    rerender(view(true, latestClose))
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

    expect(input).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(firstClose).not.toHaveBeenCalled()
    expect(latestClose).toHaveBeenCalledTimes(1)
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
