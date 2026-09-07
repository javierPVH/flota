/**
 * R3-36: copy del portón «Aún no tienes flota» — módulo por página (patrón de
 * gestión): el chunk perezoso se lleva su texto.
 */
import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: 'Aún no tienes flota',
  body: (name: string) =>
    `Hola ${name}: eres supervisor pero no tienes vehículos asignados a tu grupo todavía. ` +
    'La administración compone tu flota desde el front de gestión; contacta con ella si ' +
    'crees que es un error.',
  recheck: 'Volver a comprobar',
}

const en: typeof es = {
  title: 'No fleet yet',
  body: (name) =>
    `Hi ${name}: you are a supervisor but have no vehicles assigned to your group yet. ` +
    'Administration builds your fleet from the management front; contact them if you ' +
    'think this is a mistake.',
  recheck: 'Check again',
}

const dict = { es, en }

export function useNoFleetCopy() {
  return dict[useAppLang()]
}
