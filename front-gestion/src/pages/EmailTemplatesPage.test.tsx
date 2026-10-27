import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EmailTemplatesPage } from './EmailTemplatesPage.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  listEmailTemplates: vi.fn(),
  listEmailSignatures: vi.fn(),
  listEmailLogs: vi.fn(),
  listEmailTemplateDefaults: vi.fn(),
  previewEmailDraft: vi.fn(),
  resendEmailLog: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listEmailTemplates: mocks.listEmailTemplates,
  listEmailSignatures: mocks.listEmailSignatures,
  listEmailLogs: mocks.listEmailLogs,
  listEmailTemplateDefaults: mocks.listEmailTemplateDefaults,
  previewEmailDraft: mocks.previewEmailDraft,
  resendEmailLog: mocks.resendEmailLog,
}))

const page = (rows: unknown[]) => ({ count: rows.length, next: null, previous: null, results: rows })

const ENVIO_VARIOS = {
  id: 1,
  template_key: 'generic',
  recipient: 'sara@flota.dev, marta@flota.dev, flota@ald.example',
  subject: 'Informe mensual de flota',
  status: 'sent',
  status_display: 'Enviado',
  error: '',
  attachment_name: '',
  resent_from: null,
  can_resend: true,
  recipient_role: 'scheduled',
  recipient_role_display: 'Envío programado',
  batch: 'tanda-a',
  created_at: '2026-09-01T10:00:00Z',
}

const ENVIO_ITV = {
  id: 2,
  template_key: 'itv_due',
  recipient: 'carlos@flota.dev',
  subject: 'ITV próxima — 1234KLM',
  status: 'failed',
  status_display: 'Fallido',
  error: 'SMTPRecipientsRefused',
  attachment_name: 'informe.xlsx',
  resent_from: null,
  can_resend: false,
  recipient_role: 'driver',
  recipient_role_display: 'Conductor',
  batch: 'tanda-b',
  created_at: '2026-08-02T10:00:00Z',
}

const PLANTILLA = {
  id: 7,
  key: 'insurance_due',
  subject: 'Renovación de seguro · ',
  subject_en: '',
  body_html: '<p>Hola</p>',
  body_html_en: '',
  signature: null,
  updated_at: '2026-09-01T10:00:00Z',
}

function renderPage() {
  return render(
    <LanguageProvider>
      <EmailTemplatesPage />
    </LanguageProvider>,
  )
}

describe('EmailTemplatesPage (plantillas de correo)', () => {
  beforeEach(() => {
    document.documentElement.lang = 'es'
    mocks.listEmailTemplates.mockResolvedValue(page([PLANTILLA]))
    mocks.listEmailSignatures.mockResolvedValue(page([]))
    mocks.listEmailLogs.mockResolvedValue(page([ENVIO_VARIOS, ENVIO_ITV]))
    mocks.previewEmailDraft.mockReset()
    mocks.previewEmailDraft.mockResolvedValue({
      subject: 'Asunto de prueba',
      body_html: '<p>Hola</p>',
      document_html: '<html><body><p>Hola</p></body></html>',
    })
    mocks.listEmailTemplateDefaults.mockResolvedValue([
      {
        key: 'itv_due',
        key_display: 'ITV',
        subject: 'ITV próxima · {{matricula}}',
        body_html: '<p>La ITV vence</p>',
        subject_en: 'Upcoming test',
        body_html_en: '<p>Test due</p>',
      },
    ])
  })

  it('pestañas en dos niveles: el grupo arriba y, debajo, sus pestañas con la versión en uso', async () => {
    renderPage()
    // De salida, el grupo «Trazas» con su única pestaña: no hay fila de chips.
    expect(await screen.findByRole('tab', { name: /Trazas/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: /Seguro/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Plantillas por tipo de correo/ }))
    const seguro = await screen.findByRole('tab', { name: /Seguro/ })
    expect(seguro).toHaveTextContent('personalizada')
    expect(screen.getByRole('tab', { name: /ITV/ })).toHaveTextContent('genérica')
    // Configuración tiene dos: recordatorio y aspecto.
    await userEvent.click(screen.getByRole('tab', { name: /Configuración/ }))
    expect(await screen.findByRole('tab', { name: /Recordatorio de km/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Aspecto del correo/ })).toBeInTheDocument()
  })

  it('un tipo sin personalizar abre el editor con su genérica y guarda como personalizada', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: /Plantillas por tipo de correo/ }))
    await userEvent.click(await screen.findByRole('tab', { name: /ITV/ }))
    expect(await screen.findByDisplayValue('ITV próxima · {{matricula}}')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Cuerpo/ })).toHaveTextContent('La ITV vence')
    expect(screen.getByRole('button', { name: 'Guardar como personalizada' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Volver a la genérica' })).not.toBeInTheDocument()
    // La personalizada, en cambio, ofrece volver a la genérica.
    await userEvent.click(screen.getByRole('tab', { name: /Seguro/ }))
    expect(await screen.findByRole('button', { name: 'Volver a la genérica' })).toBeInTheDocument()
  })

  it('un envío a varios: la celda enseña uno y el modal, todos', async () => {
    renderPage()
    // La pestaña de salida es «Últimos envíos».
    expect(await screen.findByText('sara@flota.dev')).toBeInTheDocument()
    // Los otros dos no ocupan la celda: se cuentan en su botón.
    expect(screen.queryByText('flota@ald.example')).toBeNull()
    const verTodos = screen.getByRole('button', { name: /Ver todos los destinatarios/ })
    expect(verTodos).toHaveTextContent('+2')

    await userEvent.click(verTodos)
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText(/3 destinatarios/)).toBeInTheDocument()
    expect(within(dialogo).getByText('flota@ald.example')).toBeInTheDocument()
  })

  it('busca varios a la vez y saca el destinatario buscado el primero, en verde', async () => {
    const { container } = renderPage()
    await screen.findByText('sara@flota.dev')

    // Un destinatario del medio de la lista: pasa al frente y se marca.
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'marta')
    await waitFor(() => expect(screen.getByText('marta@flota.dev')).toBeInTheDocument())
    expect(container.querySelector('.rcpt-main')).toHaveClass('rcpt-hit')
    expect(screen.queryByText('carlos@flota.dev')).toBeNull()

    // Varios términos a la vez (y uno de ellos, del tipo, no del destinatario).
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Buscar' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'marta, ITV')
    await waitFor(() => expect(screen.getByText('carlos@flota.dev')).toBeInTheDocument())
    expect(screen.getByText('marta@flota.dev')).toBeInTheDocument()
  })

  it('ordena por fecha y agrupa por fecha de envío y por estado', async () => {
    renderPage()
    await screen.findByText('sara@flota.dev')

    const titulos = () =>
      [...document.querySelectorAll('tbody button[aria-expanded]')].map(
        (d) => d.querySelectorAll('span')[0]?.textContent,
      )

    // Por estado: un bloque por cada uno, en un nivel.
    await userEvent.click(screen.getByLabelText('Agrupar por estado'))
    expect(titulos()).toEqual(['Enviado', 'Fallido'])

    // Y con la fecha también marcada, el estado (el primero) queda fuera.
    await userEvent.click(screen.getByLabelText('Agrupar por fecha de envío'))
    expect(titulos()).toEqual([
      'Enviado',
      'septiembre de 2026',
      'Fallido',
      'agosto de 2026',
    ])

    // El botón invierte el orden por fecha (de salida, lo más reciente).
    expect(screen.getByRole('button', { name: /Antes lo más reciente/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Antes lo más reciente/ }))
    expect(screen.getByRole('button', { name: /Antes lo más antiguo/ })).toBeInTheDocument()
  })

  it('enseña qué variables hay y las pega en el asunto donde está el cursor', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: /Plantillas por tipo de correo/ }))
    await userEvent.click(await screen.findByRole('tab', { name: /Seguro/ }))

    // Cada variable dice qué es, además de cómo se escribe.
    const chip = await screen.findByRole('button', { name: /Matrícula/ })
    expect(chip).toHaveTextContent('{{matricula}}')
    expect(chip).toHaveAttribute('title', expect.stringContaining('matrícula del vehículo'))
    expect(screen.getByRole('button', { name: /Fecha de vencimiento/ })).toBeInTheDocument()

    // Con el cursor en el asunto, la variable cae ahí (antes solo iba al cuerpo).
    const asunto = screen.getByDisplayValue(/Renovación de seguro/)
    await userEvent.click(asunto)
    await userEvent.click(chip)
    await waitFor(() =>
      expect(screen.getByDisplayValue(/Renovación de seguro · \{\{matricula\}\}/)).toBeInTheDocument(),
    )
  })

  it('el editor lleva al lado la vista previa de lo que se escribe, sin guardar', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: /Plantillas por tipo de correo/ }))
    await userEvent.click(await screen.findByRole('tab', { name: /Seguro/ }))
    // La primera, con lo que hay; tras teclear en el asunto, con el borrador.
    await waitFor(() => expect(mocks.previewEmailDraft).toHaveBeenCalled())
    expect(mocks.previewEmailDraft.mock.calls[0][0]).toEqual({ id: 7 })
    const asunto = screen.getByDisplayValue(/Renovación de seguro/)
    await userEvent.type(asunto, 'X')
    await waitFor(() => {
      const ultima = mocks.previewEmailDraft.mock.calls.at(-1)?.[1] as FormData
      expect(ultima.get('subject')).toMatch(/X$/)
    })
    expect(await screen.findByTitle('Previsualización')).toHaveAttribute(
      'srcdoc',
      expect.stringContaining('<p>Hola</p>'),
    )
  })

  it('«Reenviar» manda el mismo correo otra vez y la traza gana una fila', async () => {
    const reenvio = { ...ENVIO_VARIOS, id: 9, resent_from: 1, created_at: '2026-09-02T10:00:00Z' }
    mocks.resendEmailLog.mockResolvedValue(reenvio)
    mocks.listEmailLogs
      .mockResolvedValueOnce(page([ENVIO_VARIOS, ENVIO_ITV]))
      .mockResolvedValueOnce(page([reenvio, ENVIO_VARIOS, ENVIO_ITV]))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    const boton = await screen.findByRole('button', { name: 'Reenviar: Informe mensual de flota' })
    // El que llevaba adjunto no se puede reenviar, y dice por qué.
    const apagado = screen.getByRole('button', { name: 'Reenviar: ITV próxima — 1234KLM' })
    expect(apagado).toBeDisabled()
    expect(apagado).toHaveAttribute('title', expect.stringContaining('adjunto'))

    await userEvent.click(boton)
    await waitFor(() => expect(mocks.resendEmailLog).toHaveBeenCalledWith(1))
    expect(await screen.findByText(/Correo reenviado a/)).toBeInTheDocument()
    // La fila nueva sale marcada como reenvío.
    expect(await screen.findByText('reenvío')).toBeInTheDocument()
  })

  it('«Ver motivo» abre el detalle del envío fallido con su error', async () => {
    renderPage()
    // Solo los que no salieron tienen motivo que leer.
    expect(await screen.findByRole('button', { name: 'Ver motivo: ITV próxima — 1234KLM' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver motivo: Informe mensual de flota' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Ver motivo: ITV próxima — 1234KLM' }))
    const modal = await screen.findByRole('dialog')
    expect(within(modal).getByText('SMTPRecipientsRefused')).toBeInTheDocument()
    expect(within(modal).getByText('carlos@flota.dev')).toBeInTheDocument()
    expect(within(modal).getByText('informe.xlsx')).toBeInTheDocument()
    // Con adjunto no se ofrece reenviar desde el detalle.
    expect(within(modal).queryByRole('button', { name: /Reenviar/ })).not.toBeInTheDocument()
  })

  it('la traza dice a quién fue cada correo y se lee agrupada por envío', async () => {
    renderPage()
    expect(await screen.findByText('Conductor')).toBeInTheDocument()
    expect(screen.getByText('Envío programado')).toBeInTheDocument()
    // Un grupo por tanda, rotulado con su momento y su asunto, el más
    // reciente primero.
    const grupos = screen.getAllByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} · /)
    expect(grupos).toHaveLength(2)
    expect(grupos[0]).toHaveTextContent('Informe mensual de flota')
    expect(grupos[1]).toHaveTextContent('ITV próxima — 1234KLM')
    // Quitar el agrupado deja la tabla plana.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Agrupar por envío' }))
    expect(screen.queryByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} · /)).not.toBeInTheDocument()
  })
})
