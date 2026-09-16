import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VehicleEmailModal } from './VehicleEmailModal.tsx'
import { LanguageProvider } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

const mocks = vi.hoisted(() => ({
  listEmailTemplates: vi.fn(),
  listIncidents: vi.fn(),
  listKmReadingsAll: vi.fn(),
  notifyVehicle: vi.fn(),
  noticePreviewVehicle: vi.fn(),
}))

vi.mock('../api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api.ts')>()),
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

function abrir() {
  render(
    <LanguageProvider>
      <VehicleEmailModal vehicle={VEHICLE} onClose={vi.fn()} onDone={vi.fn()} />
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
    mocks.listIncidents.mockResolvedValue({ count: 0, next: null, previous: null, results: [] })
    mocks.listKmReadingsAll.mockResolvedValue([])
    mocks.noticePreviewVehicle.mockResolvedValue({
      subject: 'Estado de 2026JHF',
      body_html: '<p>vista previa</p>',
      has_template: true,
      has_en: false,
    })
    mocks.notifyVehicle.mockResolvedValue({ sent: ['a@flota.dev'], skipped: [] })
  })

  it('con plantilla, la caja trae su texto y lo retocado es lo que se envía', async () => {
    abrir()
    await irAContenido()
    const caja = await screen.findByLabelText('Contenido del correo')
    await waitFor(() => expect(caja).toHaveValue(PLANTILLA.body_html))

    // Se retoca aquí mismo: no hay que ir a Ajustes a tocar la plantilla.
    await userEvent.clear(caja)
    await userEvent.type(caja, 'Buenos días, ')
    // Y el marcador se pega donde está el cursor.
    await userEvent.click(screen.getByRole('button', { name: /Matrícula/ }))
    expect(caja).toHaveValue('Buenos días, {{matricula}}')

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

  it('sin plantilla, la caja es el mensaje libre de siempre', async () => {
    abrir()
    await irAContenido()
    await userEvent.click(screen.getByRole('switch', { name: /Usar la plantilla/i }))
    expect(screen.queryByLabelText('Contenido del correo')).toBeNull()
    expect(screen.getByLabelText(/Mensaje adicional/)).toBeInTheDocument()
  })
})
