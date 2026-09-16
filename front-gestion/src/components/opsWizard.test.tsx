// R5-45: el asistente por pasos (`useAsistente`) con su barra y sus paneles.
// Es lo que comparten «Nuevo estado», «Enviar correo» y el parte de accidente,
// así que se prueba a solas con un formulario mínimo de tres pasos.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useAsistente, type Paso } from './opsWizard.ts'
import { OpsSection, OpsSteps } from './OpsSteps.tsx'

type Key = 'uno' | 'dos' | 'tres'

function Harness({
  dosApagado = false,
  reglas,
  onSubmit = vi.fn(),
}: {
  dosApagado?: boolean
  reglas?: (paso: Key) => string
  onSubmit?: (event: React.FormEvent) => void
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState('')
  const pasos: Array<Paso<Key>> = [
    { key: 'uno', label: 'Primero', off: false },
    { key: 'dos', label: 'Segundo', off: dosApagado },
    { key: 'tres', label: 'Tercero', off: false },
  ]
  const { paso, pasoPrevio, pasoSiguiente, setPaso, avanzar, alInvalido } = useAsistente<Key>({
    pasos,
    formRef,
    reglas,
    onError: setError,
  })
  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(event)
      }}
      onInvalidCapture={alInvalido}
    >
      <OpsSteps pasos={pasos} activo={paso} label="Pasos" bloqueado="No aplica" />
      <OpsSection tone="uno" hidden={paso !== 'uno'}>
        <label>
          Nombre <input name="nombre" required />
        </label>
      </OpsSection>
      <OpsSection tone="dos" hidden={paso !== 'dos'}>
        <label>
          Nota <input name="nota" />
        </label>
      </OpsSection>
      <OpsSection tone="tres" hidden={paso !== 'tres'}>
        <label>
          Fecha <input name="fecha" required />
        </label>
      </OpsSection>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={!pasoPrevio} onClick={() => pasoPrevio && setPaso(pasoPrevio.key)}>
        Anterior
      </button>
      <button type="button" disabled={!pasoSiguiente} onClick={avanzar}>
        Siguiente
      </button>
      <button type="submit">Guardar</button>
    </form>
  )
}

const activo = () => screen.getByRole('tab', { selected: true }).textContent

describe('useAsistente + OpsSteps/OpsSection (asistente por pasos)', () => {
  it('«Siguiente» exige los obligatorios del paso que se deja y «Anterior» vuelve', async () => {
    render(<Harness />)
    expect(activo()).toContain('Primero')
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()

    // Con «Nombre» vacío no se pasa: el paso sigue siendo el primero.
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(activo()).toContain('Primero')

    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana')
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(activo()).toContain('Segundo')
    // Los paneles siguen montados: lo escrito no se pierde al cambiar de paso.
    // (`getByLabelText` no filtra lo oculto, a diferencia de `getByRole`.)
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ana')
    expect(screen.getByLabelText('Nombre').closest('section')).toHaveAttribute('hidden')

    // El segundo no tiene obligatorios: deja pasar sin más.
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(activo()).toContain('Tercero')
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    expect(activo()).toContain('Segundo')
  })

  it('un paso apagado ni se pisa ni se cuenta, y si el activo se apaga se vuelve al primero', async () => {
    const { rerender } = render(<Harness />)
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana')
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(activo()).toContain('Segundo')

    // Cambia lo elegido y el segundo deja de aplicar: no se puede quedar ahí.
    rerender(<Harness dosApagado />)
    expect(activo()).toContain('Primero')
    const apagado = screen.getByRole('tab', { name: /Segundo/ })
    expect(apagado).toHaveAttribute('aria-disabled', 'true')
    expect(apagado).toHaveAttribute('title', 'No aplica')

    // Y «Siguiente» lo salta: del primero al tercero.
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(activo()).toContain('Tercero')
  })

  it('las reglas propias del paso bloquean el avance y se cuentan en el aviso', async () => {
    render(<Harness reglas={(paso) => (paso === 'uno' ? 'Falta elegir algo' : '')} />)
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana')
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Falta elegir algo')
    expect(activo()).toContain('Primero')
  })

  it('un obligatorio vacío en un paso que no se ve salta a ese paso al enviar', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('Nombre'), 'Ana')
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(activo()).toContain('Tercero')
    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    expect(activo()).toContain('Primero')

    // Enviar desde el primero con «Fecha» (tercer paso) vacía: el navegador
    // bloquea el envío y el asistente salta al paso del campo que falla.
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(activo()).toContain('Tercero')
  })
})
