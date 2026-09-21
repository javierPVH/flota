import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'
import { AccidentModal } from './AccidentModal.tsx'

const mocks = vi.hoisted(() => ({
  createIncident: vi.fn(),
  uploadDocument: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  createIncident: mocks.createIncident,
  uploadDocument: mocks.uploadDocument,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'sara', roles: ['supervisor'] } }),
}))

const VEHICLE = {
  id: 7,
  plate: '1234KLM',
  brand: 'Peugeot',
  model: 'Partner',
  state: 'active',
  state_display: 'Activo',
  updated_at: '2026-08-20T10:00:00Z',
} as Vehicle

function abrir() {
  const onSaved = vi.fn()
  render(
    <LanguageProvider>
      <AccidentModal vehicle={VEHICLE} onClose={vi.fn()} onSaved={onSaved} />
    </LanguageProvider>,
  )
  return { onSaved, user: userEvent.setup() }
}

/** Primer paso: lo obligatorio de «Dónde y cuándo». */
async function rellenarDondeYCuando(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: 'Calle' }), 'Gran Vía')
  await user.type(screen.getByRole('textbox', { name: 'Código postal' }), '28013')
  await user.type(screen.getByRole('textbox', { name: 'Localidad' }), 'Madrid')
  await user.type(screen.getByRole('textbox', { name: 'Provincia' }), 'Madrid')
  fireEvent.change(screen.getByLabelText('Fecha y hora'), { target: { value: '2026-08-25T10:30' } })
  await user.type(screen.getByRole('textbox', { name: 'Teléfono' }), '600123123')
}

// Los tres casos recorren el parte ENTERO tecleando paso a paso, y con la
// suite en paralelo rozan los 5 s por defecto: caían por tiempo, no por el
// código (y el `type` de un caso que expira se cuela en el campo del
// siguiente, que era la letra revuelta que aparecía). El tiempo se da al
// `describe` para no tener que recordarlo caso a caso.
describe('AccidentModal del supervisor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.createIncident.mockResolvedValue({ id: 91, vehicle: 7 })
  })

  it('usa el parte guiado que materializa los mismos modelos que Gestión', async () => {
    const { onSaved, user } = abrir()

    // Cuatro pasos, como en el modal de incidencia: en una sola pantalla eran
    // treinta campos, y esto se rellena a pie de carretera.
    await rellenarDondeYCuando(user)
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    await user.type(screen.getByRole('textbox', { name: 'Descripción de los daños' }), 'Golpe frontal')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    // Cada implicado se rellena en SU modal y vuelve a la lista.
    await user.click(screen.getAllByRole('button', { name: /Añadir/ })[0])
    const ficha = await screen.findByRole('dialog', { name: 'Tercero implicado' })
    await user.type(within(ficha).getByRole('textbox', { name: 'Nombre y apellidos' }), 'Ana Tercera')
    await user.type(within(ficha).getByRole('textbox', { name: 'Matrícula' }), '9999ZZZ')
    await user.click(within(ficha).getByRole('button', { name: 'Guardar' }))

    // En la lista, con lo justo para reconocerlo y sus dos acciones.
    expect(await screen.findByText('Ana Tercera')).toBeInTheDocument()
    expect(screen.getByText('9999ZZZ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Modificar Ana Tercera' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar a Ana Tercera' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    // El archivo del parte vive en el último paso, que es el que comunica.
    const fileInput = screen.getByLabelText('Archivo del parte (opcional)')
    expect(fileInput.closest('label')).toHaveClass('photo-attach')

    await user.click(screen.getByRole('button', { name: 'Comunicar accidente' }))

    expect(mocks.createIncident).toHaveBeenCalledWith(expect.objectContaining({
      vehicle: 7,
      type: 'accident',
      date: '2026-08-25',
      description: 'Golpe frontal',
      details: expect.objectContaining({
        report_version: 1,
        damage_description: 'Golpe frontal',
        third_parties: [expect.objectContaining({ full_name: 'Ana Tercera', plate: '9999ZZZ' })],
        injured_people: [],
      }),
    }))
    expect(await screen.findByText('Accidente comunicado correctamente.')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('la lista de implicados se modifica y se quita, y cancelar no la toca', async () => {
    const { user } = abrir()
    await rellenarDondeYCuando(user)
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await user.type(screen.getByRole('textbox', { name: 'Descripción de los daños' }), 'Golpe')
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    // Un lesionado: solo pide el nombre, y hasta tenerlo no se puede guardar.
    await user.click(screen.getAllByRole('button', { name: /Añadir/ })[1])
    const ficha = await screen.findByRole('dialog', { name: 'Lesionado' })
    expect(within(ficha).getByRole('button', { name: 'Guardar' })).toBeDisabled()
    await user.type(within(ficha).getByRole('textbox', { name: 'Nombre y apellidos' }), 'Luis Pasajero')
    await user.selectOptions(within(ficha).getByLabelText('Plaza ocupada'), 'passenger')
    await user.click(within(ficha).getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Luis Pasajero')).toBeInTheDocument()
    expect(screen.getByText('Ocupante')).toBeInTheDocument()

    // Modificar abre la MISMA ficha con lo guardado; cancelar no la cambia.
    await user.click(screen.getByRole('button', { name: 'Modificar Luis Pasajero' }))
    const edicion = await screen.findByRole('dialog', { name: 'Lesionado' })
    const nombre = within(edicion).getByRole('textbox', { name: 'Nombre y apellidos' })
    expect(nombre).toHaveValue('Luis Pasajero')
    await user.clear(nombre)
    await user.type(nombre, 'Otro nombre')
    await user.click(within(edicion).getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByText('Luis Pasajero')).toBeInTheDocument()

    // Y ahora de verdad: se modifica en el sitio, sin duplicar la fila.
    await user.click(screen.getByRole('button', { name: 'Modificar Luis Pasajero' }))
    const otra = await screen.findByRole('dialog', { name: 'Lesionado' })
    await user.clear(within(otra).getByRole('textbox', { name: 'Nombre y apellidos' }))
    await user.type(within(otra).getByRole('textbox', { name: 'Nombre y apellidos' }), 'Luisa Pasajera')
    await user.click(within(otra).getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Luisa Pasajera')).toBeInTheDocument()
    expect(screen.queryByText('Luis Pasajero')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Quitar a Luisa Pasajera' }))
    expect(screen.getByText('Sin lesionados.')).toBeInTheDocument()
  })

  it('no deja pasar de paso sin lo obligatorio, y «Atrás» no pierde lo escrito', async () => {
    const { user } = abrir()

    // Sin dirección ni fecha no se avanza (los pasos que no se ven no están
    // montados, así que la validación va a mano y no por el navegador).
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    await rellenarDondeYCuando(user)
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Continuar' }))

    // Los daños también son obligatorios; implicados y atestado, no.
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Descripción de los daños' }), 'Golpe')
    await user.click(screen.getByRole('button', { name: 'Atrás' }))
    expect(screen.getByRole('textbox', { name: 'Calle' })).toHaveValue('Gran Vía')

    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    // Solo el último paso comunica.
    expect(screen.getByRole('button', { name: 'Comunicar accidente' })).toBeInTheDocument()
    expect(mocks.createIncident).not.toHaveBeenCalled()
  })
}, 30000)
