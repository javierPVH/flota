import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { todayIso } from '../format.ts'
import { LanguageProvider } from '../i18n.tsx'
import type { Role, Vehicle } from '../types.ts'
import { RegisterItvModal } from './RegisterItvModal.tsx'

const mocks = vi.hoisted(() => ({
  registerItv: vi.fn(),
  uploadDocument: vi.fn(),
  roles: ['driver'] as Role[],
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  registerItv: mocks.registerItv,
  uploadDocument: mocks.uploadDocument,
}))

vi.mock('../auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.ts')>()),
  useAuth: () => ({ user: { id: 1, username: 'carlos', roles: mocks.roles } }),
}))

const VEHICLE = {
  id: 3,
  plate: '7890NPQ',
  brand: 'Tesla',
  model: 'Model 3',
  state: 'active',
  state_display: 'Activo',
} as Vehicle

function renderModal(nextItvDate?: string | null) {
  const onSaved = vi.fn()
  render(
    <LanguageProvider>
      <RegisterItvModal
        vehicle={VEHICLE}
        nextItvDate={nextItvDate}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    </LanguageProvider>,
  )
  return onSaved
}

/** Fecha ISO a N días de hoy — para afirmar el «· en N días» del aviso.
 * Se compone con las partes LOCALES: `toISOString()` pasa a UTC y en España
 * devolvía el día anterior (misma doctrina E2/E6 que `todayIso`). */
function inDays(days: number): string {
  const date = new Date(`${todayIso()}T00:00:00`)
  date.setDate(date.getDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

describe('RegisterItvModal: registrar la ITV que se ha pasado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    // `clearAllMocks` no devuelve el rol: se fija aquí para que un caso no se
    // lleve el del anterior.
    mocks.roles = ['driver']
    mocks.registerItv.mockResolvedValue({ id: 1 })
    mocks.uploadDocument.mockResolvedValue({ id: 50 })
  })

  it('dice de qué cita es el registro y que la fecha no ata', () => {
    renderModal(inDays(12))

    const notice = document.querySelector('.itv-notice') as HTMLElement
    expect(notice).toHaveTextContent(/Próx\. ITV .+ · en 12 días/)
    expect(notice).toHaveTextContent('Se puede registrar antes o después de esa fecha.')
  })

  it('lo que cambia el resultado se lee en las DOS opciones, antes de elegir', async () => {
    // Estaba en un desplegable —había que abrirlo para saber que existía la
    // otra— y su consecuencia, arriba del todo; ahora va pegada a cada opción.
    renderModal(inDays(12))

    const favourable = screen.getByRole('radio', { name: /Favorable/ }) as HTMLInputElement
    const failed = screen.getByRole('radio', { name: /Desfavorable/ }) as HTMLInputElement
    expect(favourable).toBeChecked()
    expect(favourable.closest('label')).toHaveTextContent('Cierra los avisos de ITV del vehículo.')
    expect(failed.closest('label')).toHaveTextContent('La cita sigue pendiente: los avisos no se cierran.')

    // Elegir es lo único que hace: el formulario no cambia de forma.
    await userEvent.click(failed)
    expect(failed).toBeChecked()
  })

  it('la fecha nace VACÍA y «Hoy» es el atajo, no lo predeterminado', async () => {
    // Con «hoy» puesto de salida, una ITV pasada el viernes anterior se
    // registraba con la fecha de hoy sin que nadie lo notara.
    renderModal()

    const date = screen.getByLabelText('Fecha de la ITV') as HTMLInputElement
    expect(date.value).toBe('')
    await userEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    expect(date.value).toBe(todayIso())
  })

  it('un coche demasiado nuevo avisa de que aún no le toca la ITV', () => {
    // Turismo matriculado hace un año: la primera ITV es a los 4.
    render(
      <LanguageProvider>
        <RegisterItvModal
          vehicle={{ ...VEHICLE, type: 'car', registration_date: inDays(-365) } as Vehicle}
          onClose={vi.fn()}
        />
      </LanguageProvider>,
    )

    const aviso = document.querySelector('.itv-notice-early') as HTMLElement
    expect(aviso).toHaveTextContent('Todavía no le toca la ITV')
    expect(aviso).toHaveTextContent(/Se matriculó hace menos de 4 años/)
    // Y a quién hay que decírselo si aun así hace falta: la cita la programa
    // la gestión, no el campo.
    expect(aviso).toHaveTextContent(/díselo a administración/)

    // Es informativo y no apaga nada: si hay una ITV que registrar, se registra.
    expect(screen.getByLabelText('Fecha de la ITV')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Registrar ITV' })).toBeEnabled()
  })

  it('no son cuatro años para todos: a la furgoneta de tres ya le tocaba', () => {
    // La primera de una furgoneta es a los 2: darle los 4 del turismo la
    // mandaría a rodar un año sin ITV.
    render(
      <LanguageProvider>
        <RegisterItvModal
          vehicle={{ ...VEHICLE, type: 'van', registration_date: inDays(-365 * 3) } as Vehicle}
          onClose={vi.fn()}
        />
      </LanguageProvider>,
    )
    expect(document.querySelector('.itv-notice-early')).toBeNull()
  })

  it('sin fecha de matriculación no se afirma nada', () => {
    renderModal(inDays(12))
    expect(document.querySelector('.itv-notice-early')).toBeNull()
  })

  it('la próxima ITV no se pone desde campo: la programa la gestión', async () => {
    // Aquí se registra lo que ha pasado, no lo que vendrá —y con la cita
    // cumplida el coche se queda sin ninguna hasta que la gestión ponga la
    // siguiente, que es lo que devuelve el botón de ITV al nav de campo—.
    renderModal(inDays(12))

    expect(screen.queryByLabelText('Próxima ITV')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Calcular' })).toBeNull()

    // Y el registro viaja SIEMPRE sin ella.
    await userEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    await userEvent.click(screen.getByRole('button', { name: 'Registrar ITV' }))
    await waitFor(() =>
      expect(mocks.registerItv).toHaveBeenCalledWith({
        vehicle: 3,
        event_date: todayIso(),
        itv: { result: 'done', next_due: null },
        client_ref: expect.any(String),
      }),
    )
  })

  it('con la cita vencida lo dice en pasado (y sin cita, lo dice y no la inventa)', () => {
    const { unmount } = render(
      <LanguageProvider>
        <RegisterItvModal vehicle={VEHICLE} nextItvDate={inDays(-3)} onClose={vi.fn()} />
      </LanguageProvider>,
    )
    expect(document.querySelector('.itv-notice')).toHaveTextContent(/venció hace 3 días/)
    unmount()

    renderModal(null)
    const notice = document.querySelector('.itv-notice') as HTMLElement
    expect(notice).not.toHaveTextContent('Próx. ITV')
    expect(notice).not.toHaveTextContent('esa fecha')
    expect(notice).toHaveTextContent('Este vehículo no tiene próxima ITV registrada.')
  })

  it('favorable SIN próxima fecha se registra (la fecha del informe puede venir después)', async () => {
    const onSaved = renderModal()

    await userEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    await userEvent.click(screen.getByRole('button', { name: 'Registrar ITV' }))

    await waitFor(() =>
      expect(mocks.registerItv).toHaveBeenCalledWith({
        vehicle: 3,
        event_date: todayIso(),
        itv: { result: 'done', next_due: null },
        client_ref: expect.any(String),
      }),
    )
    expect(onSaved).toHaveBeenCalled()
  })

  it('el informe se sube colgado del registro de ESA ITV', async () => {
    const onSaved = renderModal()

    await userEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    const file = new File(['pdf'], 'informe-itv.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText(/Informe de la ITV/), file)
    // La caja dice qué se ha elegido, como el resto de adjuntos de la app.
    expect(screen.getByText('informe-itv.pdf')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Registrar ITV' }))

    await waitFor(() => expect(mocks.uploadDocument).toHaveBeenCalled())
    const [payload, sent] = mocks.uploadDocument.mock.calls[0]
    // Un «Informe de ITV» EXIGE vínculo: va al registro recién creado.
    expect(payload).toEqual({
      vehicle: 3,
      event: 1,
      type: 'itv_report',
      client_ref: expect.any(String),
    })
    expect(sent.name).toBe('informe-itv.pdf')
    expect(onSaved).toHaveBeenCalledWith(expect.stringContaining('ITV registrada'))
  })

  it('si el informe no sube, la ITV queda registrada igual y se dice', async () => {
    const onSaved = renderModal()
    // Error del SERVIDOR (no de red): no se encola, se avisa.
    mocks.uploadDocument.mockRejectedValue(new Error('type: no válido'))

    await userEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    await userEvent.upload(
      screen.getByLabelText(/Informe de la ITV/),
      new File(['pdf'], 'informe-itv.pdf', { type: 'application/pdf' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Registrar ITV' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(mocks.registerItv).toHaveBeenCalled()
    expect(onSaved.mock.calls[0][0]).toContain('El informe no se pudo subir')
  })

})
