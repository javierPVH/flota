import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EmailSettingsPanel } from './EmailSettingsPanel.tsx'

const mocks = vi.hoisted(() => ({
  getEmailSettings: vi.fn(),
  updateEmailSettings: vi.fn(),
  previewEmailTemplate: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  getEmailSettings: mocks.getEmailSettings,
  updateEmailSettings: mocks.updateEmailSettings,
  previewEmailTemplate: mocks.previewEmailTemplate,
}))

const AJUSTES = {
  km_remind_from_day: 20,
  km_remind_until_day: 5,
  km_remind_emails: 2,
  km_remind_dates: ['2026-10-20', '2026-11-05'],
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

describe('EmailSettingsPanel — recordatorio de km', () => {
  beforeEach(() => {
    mocks.getEmailSettings.mockReset()
    mocks.updateEmailSettings.mockReset()
    mocks.previewEmailTemplate.mockReset()
  })

  it('enseña el calendario del mes y la vista previa del correo entero', async () => {
    mocks.getEmailSettings.mockResolvedValue(AJUSTES)
    mocks.previewEmailTemplate.mockResolvedValue({
      subject: 'Falta tu lectura · 1234KLM',
      body_html: '<p>Hola</p>',
      document_html: '<html><body><p>Hola</p></body></html>',
    })
    render(
      <EmailSettingsPanel
        section="reminder"
        templates={[PLANTILLA_KM as never]}
        onEditTemplate={() => undefined}
      />,
    )
    expect(await screen.findByDisplayValue('20')).toBeInTheDocument()
    // `fmtDate` pinta «20 oct 2026»; se busca por el contenido del <li>.
    const fechas = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(fechas).toHaveLength(2)
    expect(fechas[0]).toMatch(/20 .*2026/)
    expect(fechas[1]).toMatch(/5 .*2026/)
    await waitFor(() => expect(mocks.previewEmailTemplate).toHaveBeenCalledWith(7, 'es'))
    const frame = await screen.findByTitle('Así es el correo que recibirá')
    expect(frame).toHaveAttribute('srcdoc', expect.stringContaining('<p>Hola</p>'))
  })

  it('guarda los tres parámetros en multipart y repinta el calendario que devuelve el back', async () => {
    mocks.getEmailSettings.mockResolvedValue(AJUSTES)
    mocks.previewEmailTemplate.mockResolvedValue({ subject: 'x', body_html: '', document_html: '' })
    mocks.updateEmailSettings.mockResolvedValue({
      ...AJUSTES,
      km_remind_emails: 3,
      km_remind_dates: ['2026-10-20', '2026-10-28', '2026-11-05'],
      updated_at: '2026-10-26T11:00:00Z',
    })
    const user = userEvent.setup()
    render(
      <EmailSettingsPanel
        section="reminder"
        templates={[PLANTILLA_KM as never]}
        onEditTemplate={() => undefined}
      />,
    )
    const correos = await screen.findByLabelText('Correos por ventana')
    await user.clear(correos)
    await user.type(correos, '3')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.updateEmailSettings).toHaveBeenCalled())
    const form = mocks.updateEmailSettings.mock.calls[0][0] as FormData
    expect(form.get('km_remind_emails')).toBe('3')
    expect(form.get('km_remind_from_day')).toBe('20')
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
  })

  it('sin plantilla de km avisa de que saldrá la genérica', async () => {
    mocks.getEmailSettings.mockResolvedValue(AJUSTES)
    render(<EmailSettingsPanel section="reminder" templates={[]} onEditTemplate={() => undefined} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay plantilla')
    expect(mocks.previewEmailTemplate).not.toHaveBeenCalled()
  })
})
