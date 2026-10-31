import type { DriverActionMode, DriverDeleteMode, DriverDocumentRead } from '../api.ts'
import type { DocumentAccessOverrides, FlotaDocument } from '../types.ts'

/**
 * Lo elegido en los cinco mandos del ajuste de un documento y su ida y
 * vuelta al back. Va aparte de `AccessOverrideRows` para que ese fichero
 * exporte solo el componente.
 */
/** Valor del mando de la supervisión; `''` = según el tipo. */
export type Pick3 = 'yes' | 'no'
const toPick = (v: boolean | null | undefined): '' | Pick3 =>
  v == null ? '' : v ? 'yes' : 'no'

/** Lo elegido en los cinco mandos; `''` en cualquiera = según el tipo. */
export interface AccessPick {
  supervisor: '' | Pick3
  list: '' | DriverDocumentRead
  view: '' | DriverActionMode
  download: '' | DriverActionMode
  remove: '' | DriverDeleteMode
}

/** Todo «según el tipo»: lo que vale para un documento recién subido. */
export const EMPTY_PICK: AccessPick = { supervisor: '', list: '', view: '', download: '', remove: '' }

/** Los mandos como los tiene hoy ese documento. */
export function pickFromDoc(doc: FlotaDocument): AccessPick {
  return {
    supervisor: toPick(doc.supervisor_read_override),
    list: doc.driver_read_override ?? '',
    view: doc.driver_view_override ?? '',
    download: doc.driver_download_override ?? '',
    remove: doc.driver_delete_override ?? '',
  }
}

/** Lo que viaja al back: nulo donde sigue mandando el tipo. */
export function overridesFromPick(pick: AccessPick): DocumentAccessOverrides {
  return {
    supervisor_read_override: pick.supervisor === '' ? null : pick.supervisor === 'yes',
    driver_read_override: pick.list || null,
    driver_view_override: pick.view || null,
    driver_download_override: pick.download || null,
    driver_delete_override: pick.remove || null,
  }
}
