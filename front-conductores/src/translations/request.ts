/**
 * R3-36: copy del portón «Solicita tu vehículo» — módulo por página (patrón de
 * gestión): el chunk perezoso se lleva su texto.
 */
import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: 'Solicita tu vehículo',
  hello: (name: string) => `Hola ${name}: aún no tienes un vehículo asignado.`,
  howTo: 'Abre tu solicitud en Jira: el trámite se sigue allí, no desde esta aplicación.',
  afterApproval:
    'Cuando la aprueben, la administración activará tu acceso. Vuelve a comprobar más tarde.',
  openJira: 'Abrir solicitud en Jira',
  noUrl: 'La dirección de Jira no está configurada. Avisa a la administración.',
  recheck: 'Volver a comprobar',
}

const en: typeof es = {
  title: 'Request your vehicle',
  hello: (name) => `Hi ${name}: you have no vehicle assigned yet.`,
  howTo: 'Open your request in Jira: it is handled there, not in this application.',
  afterApproval: 'Once approved, administration will enable your access. Check again later.',
  openJira: 'Open request in Jira',
  noUrl: 'The Jira address is not configured. Please contact administration.',
  recheck: 'Check again',
}

const dict = { es, en }

export function useRequestCopy() {
  return dict[useAppLang()]
}
