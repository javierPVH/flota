/**
 * R3-36: copy del reparto de uso (HU-2.5) — el modal es un chunk perezoso y su
 * texto viaja con él (patrón de gestión).
 */
import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: (plate: string) => `Reparto de uso · ${plate}`,
  hint:
    'Base de refacturación: personas y porcentaje. La suma debe ser exactamente 100; al ' +
    'guardar se cierra el reparto vigente.',
  person: 'Persona',
  choose: 'Elige…',
  removePerson: 'Quitar persona',
  addPerson: 'Añadir persona',
  sum: (total: number) => `Suma: ${total}%`,
  since: 'Vigente desde',
  save: 'Guardar reparto',
  saving: 'Guardando…',
  saveError: 'No se pudo guardar el reparto.',
  history: 'Histórico',
}

const en: typeof es = {
  title: (plate) => `Usage split · ${plate}`,
  hint:
    'Rebilling basis: people and percentage. The sum must be exactly 100; saving closes ' +
    'the current split.',
  person: 'Person',
  choose: 'Choose…',
  removePerson: 'Remove person',
  addPerson: 'Add person',
  sum: (total) => `Sum: ${total}%`,
  since: 'Effective from',
  save: 'Save split',
  saving: 'Saving…',
  saveError: 'Could not save the split.',
  history: 'History',
}

const dict = { es, en }

export function useSplitCopy() {
  return dict[useAppLang()]
}
