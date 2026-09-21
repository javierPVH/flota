import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('RegisterItvModal: la próxima ITV es opcional', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
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

    // Una ITV desfavorable no deja próxima cita, así que no se pregunta por
    // ella (antes salía en gris: una pregunta que no se puede responder).
    expect(screen.getByLabelText('Próxima ITV')).toBeInTheDocument()
    await userEvent.click(failed)
    expect(screen.queryByLabelText('Próxima ITV')).not.toBeInTheDocument()
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

  it('«Calcular» propone la próxima por la EDAD del coche, y solo con fecha de ITV', async () => {
    // Turismo de 6 años: bienal. La propuesta se puede corregir — manda el
    // informe —, y por eso el campo sigue siendo editable y dice de dónde sale.
    render(
      <LanguageProvider>
        <RegisterItvModal
          vehicle={{ ...VEHICLE, type: 'car', registration_date: '2020-03-10' } as Vehicle}
          onClose={vi.fn()}
        />
      </LanguageProvider>,
    )

    const calcular = screen.getByRole('button', { name: 'Calcular' })
    expect(calcular).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Fecha de la ITV'), { target: { value: '2026-09-15' } })
    expect(calcular).toBeEnabled()
    await userEvent.click(calcular)

    expect(screen.getByLabelText('Próxima ITV')).toHaveValue('2028-09-15')
    expect(screen.getByText(/Propuesta: 2 años desde la fecha de la ITV/)).toBeInTheDocument()
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

  it('con próxima fecha, se envía tal cual', async () => {
    renderModal()

    await userEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    fireEvent.change(screen.getByLabelText('Próxima ITV'), {
      target: { value: '2027-09-01' },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Registrar ITV' }))

    await waitFor(() =>
      expect(mocks.registerItv).toHaveBeenCalledWith({
        vehicle: 3,
        event_date: todayIso(),
        itv: { result: 'done', next_due: '2027-09-01' },
        client_ref: expect.any(String),
      }),
    )
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

  it('R3-32: la próxima ITV igual a la inspección se corta en cliente', async () => {
    // El back exige próxima ESTRICTAMENTE posterior; sin el espejo, offline
    // era pérdida (se encolaba y el flush lo descartaba con el 400).
    const onSaved = renderModal()

    await userEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    // El input ya no ofrece la fecha de la inspección: `min` = día siguiente
    // (el navegador corta el submit nativo por rangeUnderflow).
    const nextDue = screen.getByLabelText('Próxima ITV') as HTMLInputElement
    expect(nextDue.min > todayIso()).toBe(true)

    fireEvent.change(nextDue, { target: { value: todayIso() } })
    // `fireEvent.submit` esquiva la validación nativa: prueba el ESPEJO del
    // handler (navegadores/flujos que no la apliquen).
    fireEvent.submit(document.querySelector('form') as HTMLFormElement)

    expect(
      await screen.findByText('La próxima ITV debe ser posterior a la fecha de la inspección.'),
    ).toBeInTheDocument()
    expect(mocks.registerItv).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })
})
