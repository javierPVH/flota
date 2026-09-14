import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EmailTemplatesPage } from './EmailTemplatesPage.tsx'
import { LanguageProvider } from '../i18n.tsx'

const mocks = vi.hoisted(() => ({
  listEmailTemplates: vi.fn(),
  listEmailSignatures: vi.fn(),
  listEmailLogs: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  listEmailTemplates: mocks.listEmailTemplates,
  listEmailSignatures: mocks.listEmailSignatures,
  listEmailLogs: mocks.listEmailLogs,
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
})
