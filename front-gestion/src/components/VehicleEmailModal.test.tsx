import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VehicleEmailModal } from './VehicleEmailModal.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  fetchVehicleEmailActivity: vi.fn(),
  listEmailTemplateDefaults: vi.fn(),
  listEmailTemplates: vi.fn(),
  listIncidents: vi.fn(),
  listKmReadingsAll: vi.fn(),
  notifyVehicle: vi.fn(),
  noticePreviewVehicle: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
  fetchVehicleEmailActivity: mocks.fetchVehicleEmailActivity,
  listEmailTemplateDefaults: mocks.listEmailTemplateDefaults,
  listEmailTemplates: mocks.listEmailTemplates,
  listIncidents: mocks.listIncidents,
  listKmReadingsAll: mocks.listKmReadingsAll,
  notifyVehicle: mocks.notifyVehicle,
  noticePreviewVehicle: mocks.noticePreviewVehicle,
}))

const VEHICLE = {
  id: 21,
  plate: '2026JHF',
  brand: 'Seat',
  model: 'Leon',
  state: 'active',
  state_display: 'Activo',
  driver_name: 'Víctor Cabrera',
  supervisor_name: '',
  next_itv_date: null,
  insurance_expiry_date: null,
} as unknown as Vehicle

const PLANTILLA = {
  id: 3,
  key: 'state_notice',
  key_display: 'Comunicado de estado',
  subject: 'Estado de {{matricula}}',
  body_html: '<p>Hola {{conductor}}: el coche {{matricula}} cambia de estado.</p>',
  subject_en: '',
  body_html_en: '',
  has_en: false,
  signature: null,
  signature_name: '',
  is_active: true,
  updated_at: '2026-09-01T10:00:00Z',
}

const GENERICA = {
  key: 'state_notice',
  key_display: 'Comunicado de estado',
  subject: 'Comunicado · {{matricula}}',
  body_html: '<p>Genérica: {{matricula}} cambia de estado.</p>',
  subject_en: 'Notice · {{matricula}}',
  body_html_en: '<p>Generic: {{matricula}} changes state.</p>',
}

/** Abre el modal con un tipo ya elegido (como desde una alerta); sin
 * `initialKind`, como desde la ficha, el desplegable arranca sin tipo. */
function abrir(initialKind: 'state_notice' | '' = 'state_notice') {
  render(
    <LanguageProvider>
      <VehicleEmailModal vehicle={VEHICLE} initialKind={initialKind} onClose={vi.fn()} onDone={vi.fn()} />
    </LanguageProvider>,
  )
}

/** Va al paso «Contenido» (el asistente se recorre con «Siguiente»). */
async function irAContenido() {
  await userEvent.click(await screen.findByRole('button', { name: 'Siguiente' }))
}

describe('VehicleEmailModal (contenido editable)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.lang = 'es'
    mocks.listEmailTemplates.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [PLANTILLA],
    })
    mocks.listEmailTemplateDefaults.mockResolvedValue([GENERICA])
    mocks.listIncidents.mockResolvedValue({ count: 0, next: null, previous: null, results: [] })
    mocks.listKmReadingsAll.mockResolvedValue([])
    mocks.fetchVehicleEmailActivity.mockResolvedValue({ sent: [], pending: [], alerts: [] })
    mocks.noticePreviewVehicle.mockResolvedValue({
      subject: 'Estado de 2026JHF',
      body_html: '<p>vista previa</p>',
      document_html: '<html><body><div class="caja"><p>vista previa</p></div></body></html>',
      has_template: true,
      has_en: false,
    })
    mocks.notifyVehicle.mockResolvedValue({ sent: [{ role: 'driver', email: 'a@flota.dev' }], skipped: [] })
  })

  it('al abrir evalúa los avisos con correo, lo enviado y lo que está en cola, y manda de un toque', async () => {
    mocks.fetchVehicleEmailActivity.mockResolvedValue({
      sent: [
        {
          id: 1, created_at: '2026-10-20T09:00:00Z', template_key: 'itv_due', template_display: 'ITV próxima / vencida (aviso de ITV)',
          recipient: 'a@flota.dev', recipient_role: 'driver', recipient_role_display: 'Conductor', subject: 'ITV',
          alert: 5, alert_type: 'itv_due', status: 'sent', status_display: 'Enviado', manual: false, attempts: null,
        },
      ],
      pending: [
        {
          id: 2, created_at: '2026-10-27T09:00:00Z', template_key: 'km_reading_pending', template_display: 'Lectura de km pendiente (al conductor)',
          recipient: 'a@flota.dev', recipient_role: 'driver', recipient_role_display: 'Conductor', subject: 'Lectura',
          alert: 6, alert_type: 'km_reading_pending', status: 'pending', status_display: 'Pendiente', manual: false, attempts: 0,
        },
      ],
      alerts: [
        { id: 5, type: 'itv_due', type_display: 'ITV próxima', level: 'warning', level_display: 'Aviso', message: 'ITV en 10 días', due_date: '2026-11-07', last_sent_at: '2026-10-20T09:00:00Z', sent_count: 1, pending: false },
        { id: 6, type: 'km_reading_pending', type_display: 'Lectura de km pendiente', level: 'info', level_display: 'Informativa', message: 'Lectura pendiente', due_date: null, last_sent_at: null, sent_count: 0, pending: true },
      ],
    })
    abrir()
    // Los avisos abiertos, con su plantilla y en qué va su correo.
    const itv = (await screen.findByText(/ITV en 10 días/)).closest('li') as HTMLElement
    expect(itv).toHaveTextContent('Aviso de ITV')
    expect(itv).toHaveTextContent(/Correo enviado el/)
    const km = screen.getByText(/Lectura pendiente/).closest('li') as HTMLElement
    expect(km).toHaveTextContent('En cola por enviar')
    // Lo que está en cola y lo ya mandado, dicho con su origen.
    expect(screen.getByText('Automatizaciones pendientes de enviar')).toBeInTheDocument()
    expect(screen.getByText('Automático')).toBeInTheDocument()
    // El botón rápido del aviso: su plantilla, al conductor, ligado al aviso.
    await userEvent.click(within(itv).getByRole('button', { name: 'Enviar correo' }))
    await waitFor(() =>
      expect(mocks.notifyVehicle).toHaveBeenCalledWith(21, {
        template_key: 'itv_due',
        lang: 'es',
        to_driver: true,
        alert: 5,
      }),
    )
    expect(await screen.findByText(/a@flota.dev/)).toBeInTheDocument()
  })

  it('desde la ficha arranca sin tipo: el botón rápido va apagado y «Siguiente» lo pide', async () => {
    abrir('')
    const tipo = await screen.findByRole('combobox', { name: 'Tipo de correo' })
    expect(tipo).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Enviar ahora este correo' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(mocks.notifyVehicle).not.toHaveBeenCalled()
    // Sigue en el primer paso: el desplegable se sigue viendo.
    expect(screen.getByRole('combobox', { name: 'Tipo de correo' })).toBeVisible()
    await userEvent.selectOptions(tipo, 'itv_due')
    expect(screen.getByRole('button', { name: 'Enviar ahora este correo' })).toBeEnabled()
  })

  it('los avisos van por urgencia, con su nivel, y «Enviar todos» manda uno por aviso', async () => {
    mocks.fetchVehicleEmailActivity.mockResolvedValue({
      sent: [],
      pending: [],
      alerts: [
        { id: 6, type: 'km_reading_pending', type_display: 'Lectura', level: 'info', level_display: 'Informativa', message: 'Lectura pendiente', due_date: null, last_sent_at: null, sent_count: 0, pending: false },
        { id: 5, type: 'itv_due', type_display: 'ITV', level: 'critical', level_display: 'Crítica', message: 'ITV vencida', due_date: '2026-10-01', last_sent_at: null, sent_count: 0, pending: false },
      ],
    })
    abrir()
    const filas = await screen.findAllByRole('listitem')
    // La crítica primero, con su color.
    expect(filas[0]).toHaveTextContent('ITV vencida')
    expect(filas[0]).toHaveClass('tone-danger')
    expect(filas[0]).toHaveTextContent('Crítica')
    expect(filas[1]).toHaveClass('tone-info')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar todos (2)' }))
    await waitFor(() => expect(mocks.notifyVehicle).toHaveBeenCalledTimes(2))
    expect(mocks.notifyVehicle).toHaveBeenNthCalledWith(1, 21, { template_key: 'itv_due', lang: 'es', to_driver: true, alert: 5 })
    expect(mocks.notifyVehicle).toHaveBeenNthCalledWith(2, 21, { template_key: 'km_reading_pending', lang: 'es', to_driver: true, alert: 6 })
  })

  it('sin conductor (multiusuario), el botón rápido de lo reclamado va al supervisor', async () => {
    render(
      <LanguageProvider>
        <VehicleEmailModal
          vehicle={{ ...VEHICLE, driver_name: '', supervisor_name: 'Sara' } as Vehicle}
          initialKind="km_reading_pending"
          onClose={vi.fn()}
          onDone={vi.fn()}
        />
      </LanguageProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar ahora este correo' }))
    await waitFor(() =>
      expect(mocks.notifyVehicle).toHaveBeenCalledWith(21, {
        template_key: 'km_reading_pending',
        lang: 'es',
        to_supervisor: true,
      }),
    )
  })

  it('«Enviar todos» que falla a medias enseña el acuse de lo que salió y lo que faltó', async () => {
    mocks.fetchVehicleEmailActivity.mockResolvedValue({
      sent: [],
      pending: [],
      alerts: [
        { id: 5, type: 'itv_due', type_display: 'ITV', level: 'critical', level_display: 'Crítica', message: 'ITV vencida', due_date: '2026-10-01', last_sent_at: null, sent_count: 0, pending: false },
        { id: 6, type: 'km_reading_pending', type_display: 'Lectura', level: 'info', level_display: 'Informativa', message: 'Lectura pendiente', due_date: null, last_sent_at: null, sent_count: 0, pending: false },
      ],
    })
    mocks.notifyVehicle
      .mockResolvedValueOnce({ sent: [{ role: 'driver', email: 'v@flota.dev' }], skipped: [] })
      .mockRejectedValueOnce(new Error('SMTP caído'))
    abrir()
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar todos (2)' }))
    // El acuse del primero, y debajo lo que faltó.
    expect(await screen.findByRole('status')).toHaveTextContent('1 destinatario')
    expect(screen.getByRole('alert')).toHaveTextContent('Se enviaron 1 de 2')
  })

  it('el botón rápido del tipo elegido manda con sus destinatarios habituales', async () => {
    abrir()
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar ahora este correo' }))
    await waitFor(() =>
      expect(mocks.notifyVehicle).toHaveBeenCalledWith(21, {
        template_key: 'state_notice',
        lang: 'es',
        to_driver: true,
      }),
    )
  })

  it('con plantilla, la caja trae su texto y lo retocado es lo que se envía', async () => {
    abrir()
    await irAContenido()
    const caja = await screen.findByLabelText('Contenido del correo')
    // Maquetado, no el HTML en crudo: la caja es un editor con su barra.
    await waitFor(() => expect(caja.innerHTML).toBe(PLANTILLA.body_html))
    expect(caja).toHaveTextContent('Hola {{conductor}}: el coche {{matricula}} cambia de estado.')
    expect(screen.getByRole('toolbar', { name: 'Formato del texto' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Negrita' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Subrayado' })).toBeInTheDocument()
    expect(screen.getByText('Versión personalizada')).toBeInTheDocument()

    // Se retoca aquí mismo: no hay que ir a Ajustes a tocar la plantilla.
    await userEvent.clear(caja)
    await userEvent.type(caja, 'Buenos días, ')
    // Y el marcador se pega donde está el cursor.
    await userEvent.click(screen.getByRole('button', { name: /Matrícula/ }))
    expect(caja).toHaveTextContent('Buenos días, {{matricula}}')

    // La vista previa se pide ya con el cuerpo retocado.
    await waitFor(() =>
      expect(mocks.noticePreviewVehicle).toHaveBeenCalledWith(
        21,
        expect.objectContaining({ body: 'Buenos días, {{matricula}}' }),
      ),
    )

    // Destinatarios y envío: el cuerpo viaja con el resto.
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /conductor/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    await waitFor(() => expect(mocks.notifyVehicle).toHaveBeenCalled())
    expect(mocks.notifyVehicle.mock.calls[0][1]).toMatchObject({
      body: 'Buenos días, {{matricula}}',
      template_key: 'state_notice',
    })
  })

  it('sin tocar nada no se manda cuerpo: manda la plantilla', async () => {
    abrir()
    await irAContenido()
    await screen.findByLabelText('Contenido del correo')
    await waitFor(() => expect(mocks.noticePreviewVehicle).toHaveBeenCalled())
    const ultima = mocks.noticePreviewVehicle.mock.calls.at(-1)?.[1]
    expect(ultima).not.toHaveProperty('body')
  })

  it('sin personalizada, la caja trae la genérica del tipo y lo dice', async () => {
    mocks.listEmailTemplates.mockResolvedValue({ count: 0, next: null, previous: null, results: [] })
    abrir()
    await irAContenido()
    const caja = await screen.findByLabelText('Contenido del correo')
    await waitFor(() => expect(caja.innerHTML).toBe(GENERICA.body_html))
    expect(screen.getByText(/Versión genérica/)).toBeInTheDocument()
    // En inglés, su versión inglesa.
    await userEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(caja.innerHTML).toBe(GENERICA.body_html_en)
  })

  it('sin plantilla, la caja es el mensaje libre de siempre', async () => {
    abrir()
    await irAContenido()
    await userEvent.click(screen.getByRole('switch', { name: /Usar la plantilla/i }))
    expect(screen.queryByLabelText('Contenido del correo')).toBeNull()
    expect(screen.getByLabelText(/Mensaje adicional/)).toBeInTheDocument()
  })

  it('la vista previa es el correo entero con la caja corporativa, y el acuse lista a quién llegó', async () => {
    mocks.notifyVehicle.mockResolvedValue({
      sent: [{ role: 'driver', email: 'a@flota.dev' }],
      skipped: [{ role: 'supervisor', reason: 'sin email' }],
    })
    abrir()
    await irAContenido()
    await screen.findByLabelText('Contenido del correo')
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /conductor/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    const frame = await screen.findByTitle('Vista previa')
    expect(frame).toHaveAttribute('srcdoc', expect.stringContaining('class="caja"'))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    expect(await screen.findByText('Correo enviado a 1 destinatario(s).')).toBeInTheDocument()
    expect(screen.getByText('a@flota.dev', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Sin enviar')).toBeInTheDocument()
    expect(screen.getByText('sin email')).toBeInTheDocument()
  })
})
