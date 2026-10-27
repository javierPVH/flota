import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EmailSettingsPanel } from './EmailSettingsPanel.tsx'

const mocks = vi.hoisted(() => ({
  getEmailSettings: vi.fn(),
  updateEmailSettings: vi.fn(),
  previewEmailTemplate: vi.fn(),
  previewDefaultEmailTemplate: vi.fn(),
  previewEmailDraft: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  getEmailSettings: mocks.getEmailSettings,
  updateEmailSettings: mocks.updateEmailSettings,
  previewEmailTemplate: mocks.previewEmailTemplate,
  previewDefaultEmailTemplate: mocks.previewDefaultEmailTemplate,
  previewEmailDraft: mocks.previewEmailDraft,
}))

const AJUSTES = {
  km_remind_enabled: true,
  km_remind_by: 'window' as const,
  km_remind_days: '',
  km_remind_from_day: 20,
  km_remind_until_day: 5,
  km_remind_mode: 'count' as const,
  km_remind_emails: 2,
  km_remind_max_emails: 14,
  km_remind_dates: ['2026-10-20', '2026-11-05'],
  km_window_start: 0,
  km_remind_to_driver: true,
  km_remind_to_supervisor: false,
  km_remind_admin_ids: [],
  admin_options: [
    { id: 1, name: 'Ana Admin', email: 'ana@flota.dev' },
    { id: 2, name: 'Berta Jefa', email: 'berta@flota.dev' },
  ],
  layout_enabled: true,
  brand_name: 'Gestión de flota',
  brand_color: '#009491',
  footer_text: 'Pie',
  logo_data_url: 'data:image/png;base64,AAAA',
  has_custom_logo: false,
  updated_at: '2026-10-26T10:00:00Z',
}

const PLANTILLA_KM = {
  id: 7,
  key: 'km_reading_pending',
  key_display: 'Lectura de km pendiente (al conductor)',
  subject: 'Falta tu lectura · {{matricula}}',
  body_html: '<p>Hola</p>',
  subject_en: '',
  body_html_en: '',
  has_en: false,
  signature: null,
  signature_name: '',
  is_active: true,
  updated_at: '2026-10-01T00:00:00Z',
}

const GENERICA_KM = {
  key: 'km_reading_pending',
  key_display: 'Lectura de km pendiente (al conductor)',
  subject: 'Falta tu lectura de km de {{periodo}}',
  body_html: '<p>Genérica</p>',
  subject_en: 'Missing reading',
  body_html_en: '<p>Generic</p>',
}

const PREVIEW = { subject: 'x', body_html: '', document_html: '<html><body><p>Hola</p></body></html>' }

/** Las fechas del desplegable «Fechas» del panel gris. */
const fechas = () =>
  within(document.querySelector('.es-dates') as HTMLElement).queryAllByRole('listitem').map((li) => li.textContent)

describe('EmailSettingsPanel — recordatorio de km', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 26, 12) })
    mocks.getEmailSettings.mockReset()
    mocks.updateEmailSettings.mockReset()
    mocks.previewEmailTemplate.mockReset()
    mocks.previewDefaultEmailTemplate.mockReset()
    mocks.previewEmailDraft.mockReset()
    mocks.previewEmailTemplate.mockResolvedValue(PREVIEW)
    mocks.previewEmailDraft.mockResolvedValue(PREVIEW)
    mocks.previewDefaultEmailTemplate.mockResolvedValue(PREVIEW)
  })

  it('enseña el calendario del mes, la plantilla personalizada en uso y su vista previa', async () => {
    mocks.getEmailSettings.mockResolvedValue(AJUSTES)
    render(
      <EmailSettingsPanel
        section="reminder"
        templates={[PLANTILLA_KM as never]}
        defaults={[GENERICA_KM]}
        onEditTemplate={() => undefined}
      />,
    )
    expect(await screen.findByDisplayValue('20')).toBeInTheDocument()
    // Resumen y lista de fechas (`fmtDate` pinta «20 oct 2026»).
    expect(screen.getByText(/2 correos entre el 20 .* y el 5 /)).toBeInTheDocument()
    expect(fechas()).toHaveLength(2)
    // Los dos meses del plazo, con el día de correo marcado en cada uno.
    const calendarios = screen.getAllByRole('table')
    expect(calendarios).toHaveLength(2)
    expect(within(calendarios[0]).getByText('20')).toHaveClass('is-email')
    expect(within(calendarios[0]).getByText('25')).toHaveClass('is-window')
    expect(within(calendarios[1]).getByText('5')).toHaveClass('is-email')
    // La vista previa vive en su propia vista y no se pide hasta entrar en ella.
    expect(mocks.previewEmailTemplate).not.toHaveBeenCalled()
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByRole('tab', { name: 'Correo que recibirá el conductor' }),
    )
    // La plantilla en uso es la personalizada y se previsualiza ella.
    expect(await screen.findByText('Personalizada')).toBeInTheDocument()
    await waitFor(() => expect(mocks.previewEmailTemplate).toHaveBeenCalledWith(7, 'es'))
    expect(mocks.previewDefaultEmailTemplate).not.toHaveBeenCalled()
    const frame = await screen.findByTitle('Correo que recibirá el conductor')
    expect(frame).toHaveAttribute('srcdoc', expect.stringContaining('<p>Hola</p>'))
  })

  it('el calendario se recalcula al teclear, sin guardar, y la cadencia cambia los días', async () => {
    mocks.getEmailSettings.mockResolvedValue(AJUSTES)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <EmailSettingsPanel
        section="reminder"
        templates={[]}
        defaults={[GENERICA_KM]}
        onEditTemplate={() => undefined}
      />,
    )
    const correos = await screen.findByLabelText('Correos por ventana')
    await user.clear(correos)
    await user.type(correos, '3')
    expect(fechas()).toHaveLength(3)
    expect(screen.getByText(/3 correos entre/)).toBeInTheDocument()
    // Días pares: del 20 al 5 son 20, 22, 24, 26, 28, 30, 2 y 4.
    await user.click(screen.getByRole('radio', { name: /Los días pares/ }))
    expect(fechas()).toHaveLength(8)
    // Todos los días: 12 de octubre + 5 de noviembre.
    await user.click(screen.getByRole('radio', { name: /Todos los días/ }))
    expect(fechas()).toHaveLength(17)
    expect(mocks.updateEmailSettings).not.toHaveBeenCalled()
  })

  it('no deja pedir más correos que días tiene el plazo', async () => {
    mocks.getEmailSettings.mockResolvedValue(AJUSTES)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <EmailSettingsPanel section="reminder" templates={[]} defaults={[GENERICA_KM]} onEditTemplate={() => undefined} />,
    )
    const correos = await screen.findByLabelText('Correos por ventana')
    expect(screen.getByText(/Como mucho 14/)).toBeInTheDocument()
    await user.clear(correos)
    await user.type(correos, '20')
    expect(screen.getByText(/No caben más de 14/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    // Ampliar el plazo sube el tope.
    const desde = screen.getByLabelText('Desde el día')
    await user.clear(desde)
    await user.type(desde, '5')
    expect(screen.getByText(/Como mucho 29/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  })

  it('guarda plazo, cadencia y número en multipart', async () => {
    mocks.getEmailSettings.mockResolvedValue(AJUSTES)
    mocks.updateEmailSettings.mockResolvedValue({ ...AJUSTES, km_remind_mode: 'odd', updated_at: '2026-10-26T11:00:00Z' })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <EmailSettingsPanel section="reminder" templates={[]} defaults={[GENERICA_KM]} onEditTemplate={() => undefined} />,
    )
    await user.click(await screen.findByRole('radio', { name: /Los días impares/ }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.updateEmailSettings).toHaveBeenCalled())
    const form = mocks.updateEmailSettings.mock.calls[0][0] as FormData
    expect(form.get('km_remind_mode')).toBe('odd')
    expect(form.get('km_remind_from_day')).toBe('20')
    expect(form.get('km_remind_emails')).toBe('2')
    // Por plazo la lista de días no viaja.
    expect(form.get('km_remind_by')).toBe('window')
    expect(form.get('km_remind_days')).toBeNull()
  })

  it('sin plantilla personalizada enseña la genérica en uso y ofrece personalizarla', async () => {
    mocks.getEmailSettings.mockResolvedValue(AJUSTES)
    const onEdit = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<EmailSettingsPanel section="reminder" templates={[]} defaults={[GENERICA_KM]} onEditTemplate={onEdit} />)
    await user.click(await screen.findByRole('tab', { name: 'Correo que recibirá el conductor' }))
    expect(await screen.findByText('Genérica')).toBeInTheDocument()
    await waitFor(() => expect(mocks.previewDefaultEmailTemplate).toHaveBeenCalledWith('km_reading_pending', 'es'))
    expect(mocks.previewEmailTemplate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Personalizar el correo' }))
    expect(onEdit).toHaveBeenCalledWith('km_reading_pending')
  })

  it('en «Aspecto» la vista previa se pide con lo tecleado, sin guardar', async () => {
    mocks.getEmailSettings.mockResolvedValue(AJUSTES)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <EmailSettingsPanel section="layout" templates={[]} defaults={[GENERICA_KM]} onEditTemplate={() => undefined} />,
    )
    const nombre = await screen.findByLabelText('Nombre que encabeza y firma el correo')
    // La primera vista previa, con lo guardado, tras el respiro de 400 ms.
    await waitFor(() => expect(mocks.previewEmailDraft).toHaveBeenCalled())
    const primera = mocks.previewEmailDraft.mock.calls[0]
    expect(primera[0]).toEqual({ key: 'km_reading_pending' })
    expect((primera[1] as FormData).get('brand_name')).toBe('Gestión de flota')
    // Teclear el nombre vuelve a pedirla con el nombre nuevo y sin guardar nada.
    await user.clear(nombre)
    await user.type(nombre, 'Flota GS')
    await waitFor(() => {
      const ultima = mocks.previewEmailDraft.mock.calls.at(-1)?.[1] as FormData
      expect(ultima.get('brand_name')).toBe('Flota GS')
    })
    expect(mocks.updateEmailSettings).not.toHaveBeenCalled()
    expect(await screen.findByTitle('Vista previa')).toHaveAttribute('srcdoc', expect.stringContaining('<p>Hola</p>'))
  })

  it('el interruptor apaga el recordatorio y viaja al guardar', async () => {
    mocks.getEmailSettings.mockResolvedValue(AJUSTES)
    mocks.updateEmailSettings.mockResolvedValue({ ...AJUSTES, km_remind_enabled: false })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <EmailSettingsPanel section="reminder" templates={[]} defaults={[GENERICA_KM]} onEditTemplate={() => undefined} />,
    )
    const check = await screen.findByRole('checkbox', { name: /Recordatorio activo/ })
    expect(check).toBeChecked()
    await user.click(check)
    expect(screen.getByText(/El recordatorio está apagado/)).toBeInTheDocument()
    expect(screen.getByLabelText('Desde el día')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.updateEmailSettings).toHaveBeenCalled())
    const form = mocks.updateEmailSettings.mock.calls[0][0] as FormData
    expect(form.get('km_remind_enabled')).toBe('false')
  })

  it('con días concretos, un correo cada día de la lista y la cadencia apagada', async () => {
    mocks.getEmailSettings.mockResolvedValue(AJUSTES)
    mocks.updateEmailSettings.mockResolvedValue({ ...AJUSTES, km_remind_by: 'days', km_remind_days: '5, 20, 28' })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <EmailSettingsPanel section="reminder" templates={[]} defaults={[GENERICA_KM]} onEditTemplate={() => undefined} />,
    )
    await screen.findByLabelText('Desde el día')
    await user.click(screen.getByRole('radio', { name: 'Días concretos' }))
    // El plazo se va, llega la caja de días y la cadencia queda apagada.
    expect(screen.queryByLabelText('Desde el día')).not.toBeInTheDocument()
    const dias = screen.getByLabelText('Días en que sale el correo')
    expect(screen.getByRole('radio', { name: /Todos los días/ })).toBeDisabled()
    expect(screen.getByText(/no hay cadencia/)).toBeInTheDocument()
    // Vacía no se puede guardar, y dice por qué; y sin lista no hay calendario.
    expect(screen.getByText(/Escribe al menos un día \(/)).toBeInTheDocument()
    expect(screen.getByText('Escribe al menos un día para ver el calendario.')).toBeInTheDocument()
    expect(fechas()).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    // Un punto como separador se vuelve coma; una letra no entra.
    await user.type(dias, '5.20;28x')
    expect(dias).toHaveValue('5,20,28')
    await user.clear(dias)
    await user.type(dias, '5, 20, 28')
    // El calendario sigue la lista: tres correos del mismo mes, y un solo mes.
    expect(fechas()).toHaveLength(3)
    expect(screen.getByText(/3 correos entre el 5 .* y el 28 /)).toBeInTheDocument()
    const calendarios = screen.getAllByRole('table')
    expect(calendarios).toHaveLength(1)
    expect(within(calendarios[0]).getByText('20')).toHaveClass('is-email')
    expect(within(calendarios[0]).getByText('21')).toHaveClass('is-window')
    // Un día menor que el anterior no vale, y dice cuál.
    await user.type(dias, ', 3')
    expect(screen.getByText('El 3 no puede ir después del 28: escribe los días de menor a mayor.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    // Mientras tanto el calendario sigue con la última lista que valía.
    expect(fechas()).toHaveLength(3)
    expect(screen.getByText(/3 correos entre el 5 /)).toBeInTheDocument()
    await user.type(dias, '{backspace}{backspace}{backspace}')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.updateEmailSettings).toHaveBeenCalled())
    const form = mocks.updateEmailSettings.mock.calls[0][0] as FormData
    expect(form.get('km_remind_by')).toBe('days')
    expect(form.get('km_remind_days')).toBe('5, 20, 28')
  })

  it('el calendario dice qué día de la lista no tiene el mes, y si no sale ninguno', async () => {
    // Noviembre: 30 días.
    vi.setSystemTime(new Date(2026, 10, 26, 12))
    mocks.getEmailSettings.mockResolvedValue({ ...AJUSTES, km_remind_by: 'days', km_remind_days: '15, 31' })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <EmailSettingsPanel section="reminder" templates={[]} defaults={[GENERICA_KM]} onEditTemplate={() => undefined} />,
    )
    const dias = await screen.findByLabelText('Días en que sale el correo')
    expect(fechas()).toHaveLength(1)
    expect(screen.getByText('Noviembre no tiene el día 31: ese día no sale correo.')).toBeInTheDocument()
    // Solo el 31: en noviembre no sale nada, y se dice.
    await user.clear(dias)
    await user.type(dias, '31')
    expect(screen.getByText(/Noviembre no tiene ninguno de esos días/)).toBeInTheDocument()
    expect(screen.queryByText(/no sale correo\./)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  })

  it('avisa si se recuerda antes de que el conductor pueda registrar', async () => {
    mocks.getEmailSettings.mockResolvedValue({
      ...AJUSTES,
      km_window_start: 23,
      km_remind_by: 'days',
      km_remind_days: '5, 20, 28',
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <EmailSettingsPanel section="reminder" templates={[]} defaults={[GENERICA_KM]} onEditTemplate={() => undefined} />,
    )
    const dias = await screen.findByLabelText('Días en que sale el correo')
    expect(screen.getByText(/se abre el día 23 de cada mes/)).toBeInTheDocument()
    await user.clear(dias)
    await user.type(dias, '25, 28')
    expect(screen.queryByText(/se abre el día 23/)).not.toBeInTheDocument()
    // Por plazo también: «desde el día 20» es antes del 23.
    await user.click(screen.getByRole('radio', { name: 'Plazo de reclamación' }))
    expect(screen.getByText(/se abre el día 23 de cada mes/)).toBeInTheDocument()
  })

  it('se elige a quién va el recordatorio y viaja al guardar', async () => {
    mocks.getEmailSettings.mockResolvedValue(AJUSTES)
    mocks.updateEmailSettings.mockResolvedValue({ ...AJUSTES, km_remind_admin_ids: [2] })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <EmailSettingsPanel section="reminder" templates={[]} defaults={[GENERICA_KM]} onEditTemplate={() => undefined} />,
    )
    const conductor = await screen.findByRole('checkbox', { name: /Al conductor del coche/ })
    expect(conductor).toBeChecked()
    // Sin nadie no se puede guardar, y se dice.
    await user.click(conductor)
    expect(screen.getByText(/Elige al menos un destinatario/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Al supervisor del coche/ }))
    await user.click(screen.getByRole('checkbox', { name: /Berta Jefa/ }))
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.updateEmailSettings).toHaveBeenCalled())
    const form = mocks.updateEmailSettings.mock.calls[0][0] as FormData
    expect(form.get('km_remind_to_driver')).toBe('false')
    expect(form.get('km_remind_to_supervisor')).toBe('true')
    expect(form.get('km_remind_admins')).toBe('2')
  })
})
