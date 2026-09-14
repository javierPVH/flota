import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { FileField } from './FileField'

/** Envoltura con estado, como lo usan las apps: el padre guarda el archivo. */
function Host({ onFiles }: { onFiles?: (files: File[]) => void }) {
  const [file, setFile] = useState<File | null>(null)
  return (
    <FileField
      label="Justificante"
      accept=".pdf"
      value={file}
      onFiles={(files) => {
        setFile(files[0] ?? null)
        onFiles?.(files)
      }}
    />
  )
}

describe('FileField (selector de archivo con aspecto del DS)', () => {
  it('se ve un botón propio, no el «Seleccionar archivo» del sistema', () => {
    render(<Host />)
    // El input nativo sigue ahí (invisible sobre el botón) y es localizable por
    // su etiqueta: los formularios lo buscan así.
    const input = screen.getByLabelText('Justificante')
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', '.pdf')
    // Y el aspecto es el del DS: botón con texto propio + estado vacío.
    expect(screen.getByText('Elegir archivo…')).toBeInTheDocument()
    expect(screen.getByText('Sin archivo elegido')).toBeInTheDocument()
  })

  it('elegir un archivo enseña su nombre y se puede quitar', async () => {
    const onFiles = vi.fn()
    render(<Host onFiles={onFiles} />)

    const file = new File(['x'], 'factura.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText('Justificante'), file)
    expect(onFiles).toHaveBeenCalledWith([file])
    expect(screen.getByText('factura.pdf')).toBeInTheDocument()
    expect(screen.queryByText('Sin archivo elegido')).not.toBeInTheDocument()

    // Quitarlo devuelve la lista vacía y el estado inicial.
    await userEvent.click(screen.getByRole('button', { name: 'Quitar el archivo' }))
    expect(onFiles).toHaveBeenLastCalledWith([])
    expect(screen.getByText('Sin archivo elegido')).toBeInTheDocument()
  })

  it('con varios archivos enseña el recuento', () => {
    const files = [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')]
    render(<FileField label="Fotos" multiple value={files} onFiles={vi.fn()} />)
    expect(screen.getByText('2 archivos elegidos')).toBeInTheDocument()
    expect(screen.getByLabelText('Fotos')).toHaveAttribute('multiple')
  })
})
