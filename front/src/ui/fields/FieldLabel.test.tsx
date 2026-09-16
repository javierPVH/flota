// R5-22: la etiqueta de los campos del DS es un <label htmlFor> asociado al
// control, así que el control tiene nombre accesible sin `aria-label` a mano.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SelectField } from './SelectField.tsx'
import { TextAreaField } from './TextAreaField.tsx'
import { TextInputField } from './TextInputField.tsx'

describe('Campos del DS: etiqueta asociada al control (R5-22)', () => {
  it('TextInputField: getByLabelText encuentra el input, y respeta un id propio', () => {
    render(
      <>
        <TextInputField label="Kilometraje" />
        <TextInputField label="Matrícula" id="plate" />
      </>,
    )
    expect(screen.getByLabelText('Kilometraje')).toBeInstanceOf(HTMLInputElement)
    expect(screen.getByLabelText('Matrícula')).toHaveAttribute('id', 'plate')
  })

  it('TextAreaField y SelectField también', () => {
    render(
      <>
        <TextAreaField label="Observaciones" />
        <SelectField
          label="Tipo"
          required
          options={[{ value: 'a', label: 'A' }]}
          value="a"
          onValueChange={() => {}}
        />
      </>,
    )
    expect(screen.getByLabelText('Observaciones')).toBeInstanceOf(HTMLTextAreaElement)
    expect(screen.getByLabelText('Tipo')).toBeInstanceOf(HTMLSelectElement)
    expect(screen.getByRole('combobox', { name: 'Tipo' })).toBeInTheDocument()
  })
})
