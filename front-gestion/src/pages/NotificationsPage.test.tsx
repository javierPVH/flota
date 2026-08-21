import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationsPage } from './NotificationsPage.tsx'
import { ConfirmProvider } from '../components/ConfirmDialog.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { FlotaUser } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listNotificationSchedules: vi.fn(),
  listVehicles: vi.fn(),
  createNotificationSchedule: vi.fn(),
  useAuth: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listNotificationSchedules: mocks.listNotificationSchedules,
  listVehicles: mocks.listVehicles,
  createNotificationSchedule: mocks.createNotificationSchedule,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: mocks.useAuth,
}))

const vacio = { count: 0, next: null, previous: null, results: [] }

// Los campos del DS pintan su etiqueta como <span> (no como <label>), así que
// aquí se localizan por el placeholder, que es estable y visible.
const DESTINATARIOS = 'persona@empresa.com, otra@empresa.com'
const NOMBRE = 'p. ej. Informe de flota de los lunes'

function renderPage() {
  return render(
    <LanguageProvider>
      <ConfirmProvider>
        <NotificationsPage />
      </ConfirmProvider>
    </LanguageProvider>,
  )
}

/** Abre «Nuevo envío» y devuelve el diálogo. */
async function abrirModal() {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Nuevo envío' }))
  return { user, dialog: screen.getByRole('dialog') }
}

describe('NotificationsPage (envíos programados)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listNotificationSchedules.mockResolvedValue(vacio)
    mocks.listVehicles.mockResolvedValue(vacio)
    mocks.createNotificationSchedule.mockResolvedValue({ id: 1 })
    mocks.useAuth.mockReturnValue({
      user: { id: 1, username: 'admin', email: 'admin@flota.dev', roles: ['admin'] } as FlotaUser,
    })
  })

  it('el formulario se lee en cuatro bloques, en el orden en que se decide', async () => {
    const { dialog } = await abrirModal()
    const bloques = within(dialog)
      .getAllByRole('group')
      .map((f) => f.querySelector('legend')?.textContent)
    expect(bloques).toEqual(['Qué se envía', 'Cuándo se envía', 'A quién se envía', 'Cómo se llama'])
  })

  it('prellena el correo del usuario activo, pero se puede cambiar por otro', async () => {
    const { user, dialog } = await abrirModal()
    const destinatarios = within(dialog).getByPlaceholderText(DESTINATARIOS)
    expect(destinatarios).toHaveValue('admin@flota.dev')

    // Quitarlo y poner otras dos direcciones: el envío irá SOLO a esas.
    await user.clear(destinatarios)
    await user.type(destinatarios, 'jefe@empresa.com, taller@empresa.com')
    await user.type(within(dialog).getByPlaceholderText(NOMBRE), 'Resumen de los lunes')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    expect(mocks.createNotificationSchedule).toHaveBeenCalledTimes(1)
    const enviado = mocks.createNotificationSchedule.mock.calls[0][0]
    expect(enviado.extra_recipients).toBe('jefe@empresa.com, taller@empresa.com')
    expect(enviado.name).toBe('Resumen de los lunes')
  })

  it('no ofrece elegir formato: los informes van en CSV', async () => {
    const { dialog } = await abrirModal()
    // El desplegable ofrecía «Excel (.xlsx)» y «CSV»; ya no hay elección.
    expect(within(dialog).queryByText(/excel/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/xlsx/i)).not.toBeInTheDocument()
    // Y con el resumen no hay adjunto, así que ni se menciona el formato.
    expect(within(dialog).queryByText(/CSV/)).not.toBeInTheDocument()
  })

  it('el pie resume lo elegido y cuenta los destinatarios', async () => {
    const { user, dialog } = await abrirModal()
    expect(within(dialog).getByText(/a 1 destinatario/)).toBeInTheDocument()

    await user.type(within(dialog).getByPlaceholderText(DESTINATARIOS), ', jefe@empresa.com')
    const resumen = within(dialog).getByText(/a 2 destinatarios/)
    expect(resumen).toHaveTextContent('Resumen de la flota')
    expect(resumen).toHaveTextContent('cada día a las 08:00')
  })

  it('sin ninguna dirección lo dice en el resumen', async () => {
    const { user, dialog } = await abrirModal()
    await user.clear(within(dialog).getByPlaceholderText(DESTINATARIOS))
    expect(within(dialog).getByText(/todavía sin destinatarios/)).toBeInTheDocument()
  })
})
