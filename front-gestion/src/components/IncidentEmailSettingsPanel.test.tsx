import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '../i18n.tsx'
import { IncidentEmailSettingsPanel } from './IncidentEmailSettingsPanel.tsx'

const mocks = vi.hoisted(() => ({ getEmailSettings: vi.fn(), updateIncidentEmailSettings: vi.fn() }))
vi.mock('../api.ts', () => mocks)
beforeEach(() => {
  document.documentElement.lang = 'es'
  mocks.updateIncidentEmailSettings.mockResolvedValue({})
  mocks.getEmailSettings.mockResolvedValue({
    incident_notice_enabled: false, incident_notice_to_driver: false,
    incident_notice_to_supervisor: true, incident_notice_admin_ids: [],
    accident_notice_enabled: false, accident_notice_to_driver: false,
    accident_notice_to_supervisor: true, accident_notice_admin_ids: [],
    corporate_email_domains: ['gransolar.com'],
    admin_options: [{ id: 7, name: 'Admin', email: 'admin@example.com' }],
  })
})
it.each(['incident', 'accident'] as const)('saves independent recipients and opens the %s template', async kind => {
  const edit = vi.fn()
  render(<LanguageProvider><IncidentEmailSettingsPanel kind={kind} onEditTemplate={edit} /></LanguageProvider>)
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Activar avisos por correo' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Supervisor' }))
  expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox', { name: /Admin/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(mocks.updateIncidentEmailSettings).toHaveBeenLastCalledWith({
    [`${kind}_notice_extra_recipients`]: '',
    [`${kind}_notice_enabled`]: true, [`${kind}_notice_to_driver`]: false,
    [`${kind}_notice_to_supervisor`]: false, [`${kind}_notice_admin_ids`]: [7],
  })
  await userEvent.click(screen.getByRole('button', { name: 'Editar plantilla del correo' }))
  expect(edit).toHaveBeenCalledWith(`${kind}_notice`)
})

it('rejects external email and allows corporate custom-only recipients', async () => {
  render(<LanguageProvider><IncidentEmailSettingsPanel kind="incident" onEditTemplate={vi.fn()} /></LanguageProvider>)
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Activar avisos por correo' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Supervisor' }))
  const field = screen.getByRole('textbox', { name: 'Correos personalizados' })
  await userEvent.type(field, 'team@gmail.com')
  expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  expect(field).toHaveAttribute('aria-invalid', 'true')
  await userEvent.clear(field)
  await userEvent.type(field, 'team@gransolar.com')
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(mocks.updateIncidentEmailSettings).toHaveBeenLastCalledWith(expect.objectContaining({ incident_notice_extra_recipients: 'team@gransolar.com', incident_notice_to_supervisor: false }))
})
