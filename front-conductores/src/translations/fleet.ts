/**
 * R3-36: copy de «Flota a cargo» — patrón de gestión: el módulo lo importa la
 * propia página perezosa y su texto viaja en SU chunk, no en el bundle inicial.
 */
import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: 'Flota a cargo',
  tabsLabel: 'Grupos de la flota',
  tabAll: 'Todos',
}

const en: typeof es = {
  title: 'Fleet in my care',
  tabsLabel: 'Fleet groups',
  tabAll: 'All',
}

const dict = { es, en }

export function useFleetCopy() {
  return dict[useAppLang()]
}
