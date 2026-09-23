import { useAppLang } from '@flota/ui/i18n'

const es = {
  /** Título del modal del menú ⋮ → «Programar ITV y mantenimiento». */
  title: (plate: string) => `Programar ITV y mantenimiento · ${plate}`,
  /** Pestañas: una cosa que programar en cada una. */
  tabItv: 'Programar ITV',
  tabMaintenance: 'Programar mantenimiento',

  // --- ITV -------------------------------------------------------------------
  itvIntro:
    'Cada vehículo tiene UNA cita de ITV: si ya la hay, aquí se corrige. El CP preferente es la ubicación desde la que un tercero busca la estación más cercana.',
  itvNone: 'No hay ninguna ITV a la vista. Prográmala aquí o, si ya se ha pasado, regístrala.',
  itvAlreadyDone: '¿Ya se ha pasado?',
  itvScheduledLabel: 'ITV programada',
  itvOverdueLabel: 'ITV vencida',
  itvOrigin: 'Origen de la cita',
  itvFromManual: 'Cita puesta por la gestión.',
  itvFromHistory: 'Sale de la última inspección registrada; al registrar la próxima se recalcula.',
  itvOnlyOne: 'No se puede crear una segunda cita: esta se modifica.',
  itvDate: 'Fecha de la ITV',
  // Distinto del CP del plan de mantenimiento: los dos conviven en el modal.
  itvPostalCode: 'CP preferente para la ITV',
  itvSchedule: 'Programar ITV',
  itvModify: 'Modificar la cita',
  itvSave: 'Guardar la cita',
  itvSaved: (date: string) => `Cita de ITV guardada para el ${date}.`,
  itvDateRequired: 'Indica la fecha de la ITV.',
  itvPostalCodeInvalid: 'El código postal debe tener 5 cifras.',
  itvError: 'No se pudo programar la ITV.',

  /** Registrar la ITV realizada (el mismo formulario que resuelve su alerta). */
  resolveItv: 'Registrar ITV',
  /** Quitar la cita: la ficha se queda sin próxima ITV y queda en su histórico. */
  itvDelete: 'Eliminar la cita',
  itvDeleteTitle: 'Eliminar la cita de ITV',
  itvDeleteMessage: (date: string) =>
    `El vehículo se quedará sin próxima ITV (la cita del ${date} se quita y sus avisos abiertos se cierran). Queda registrado en el histórico de la ficha y se puede volver a programar cuando haga falta.`,
  itvDeleteConfirm: 'Sí, eliminar la cita',
  itvDeleted: 'Cita de ITV eliminada. Queda en el histórico de la ficha.',
  itvDeleteError: 'No se pudo eliminar la cita.',

  // --- Mantenimiento ---------------------------------------------------------
  maintenanceIntro:
    'El vehículo tiene UN mantenimiento programado, y su ciclo sale del catálogo común de programas. El CP preferente es la ubicación desde la que se busca el taller más cercano.',
  maintenanceNone:
    'No hay ningún mantenimiento programado. Prográmalo aquí; si ya se ha hecho una revisión, pon su fecha en «Se cuenta desde» y el ciclo arranca de ahí.',
  maintenanceAlreadyDone: '¿Revisión ya hecha? Pon su fecha en «Se cuenta desde».',
  maintenanceScheduledLabel: 'Mantenimiento programado',
  maintenanceOverdueLabel: 'Mantenimiento vencido',
  /** Un programa solo por km no tiene fecha que enseñar. */
  maintenanceOnlyKm: 'Por kilómetros',
  maintenanceByKm: 'Sin fecha',
  maintenanceNoKmCycle: 'Sin ciclo por km',
  maintenanceProgram: 'Programa',
  maintenanceCycleLabel: 'Ciclo',
  maintenanceNextKm: 'Próximo por km',
  maintenanceFrom: 'Se cuenta desde',
  maintenanceOnlyOne:
    'Solo puede haber un mantenimiento programado a la vez: este se modifica o se resuelve.',
  maintenancePick: 'Programa de mantenimiento',
  maintenancePickPlaceholder: 'Elige un programa del catálogo…',
  maintenanceNewProgram: '+ Nuevo programa',
  maintenanceNoPrograms: 'El catálogo está vacío: crea el primer programa.',
  maintenanceAuto: 'Solo hay un programa en el catálogo: va elegido.',
  maintenanceFromDate: 'Se cuenta desde (fecha)',
  maintenanceFromKm: 'Se cuenta desde (km)',
  maintenanceNextDate: (date: string) => `Próximo mantenimiento: ${date}.`,
  maintenanceNextKmValue: (km: string) => `O al llegar a ${km}, lo que pase antes.`,
  maintenanceSchedule: 'Programar mantenimiento',
  maintenanceModify: 'Modificar el mantenimiento',
  maintenanceSave: 'Guardar el mantenimiento',
  maintenanceSaved: 'Mantenimiento guardado.',
  maintenanceProgramRequired: 'Elige el programa del catálogo.',
  maintenanceError: 'No se pudo programar el mantenimiento.',
  maintenanceLoadError: 'No se pudo cargar el catálogo de programas.',
  /** Registrar el mantenimiento realizado (reancla el ciclo). */
  resolveMaintenance: 'Ya se pasó la revisión',
  /** Retirar el mantenimiento programado: queda en el histórico de la ficha. */
  maintenanceDelete: 'Eliminar el mantenimiento',
  maintenanceDeleteTitle: 'Eliminar el mantenimiento programado',
  maintenanceDeleteMessage: (name: string) =>
    `El vehículo se quedará sin mantenimiento programado («${name}» se retira y sus avisos abiertos se cierran). Queda registrado en el histórico de la ficha y se puede volver a programar cuando haga falta.`,
  maintenanceDeleteConfirm: 'Sí, eliminar el mantenimiento',
  maintenanceDeleted: 'Mantenimiento programado eliminado. Queda en el histórico de la ficha.',
  maintenanceDeleteError: 'No se pudo eliminar el mantenimiento programado.',
  maintenanceDeleteReason: 'Retirado desde «Programar ITV y mantenimiento».',

  // --- Catálogo de programas (su propio modal) -------------------------------
  programNewTitle: 'Nuevo programa de mantenimiento',
  programEditTitle: (name: string) => `Programa «${name}»`,
  programInfoShared:
    'Un programa vale para TODA la flota: se define aquí una vez y cualquier vehículo se programa con él.',
  programInfoCycles:
    'Puedes indicar kilómetros, meses o los dos. Los kilómetros mandan: si el coche llega al límite de km antes que al de meses, toca mantenimiento igual.',
  programInfoCopy:
    'Al programarlo en un vehículo, el ciclo se copia: cambiar el programa no mueve lo que ya está programado.',
  programName: 'Nombre del programa',
  programNamePlaceholder: 'P. ej. «Revisión general»',
  programEveryKm: 'Cada (km)',
  programEveryMonths: 'Cada (meses)',
  programCycleHint: 'Indica al menos uno de los dos: sin ciclo, el programa no vence nunca.',
  programCycleRequired: 'Indica al menos un ciclo: por km o por meses.',
  programNotes: 'Notas',
  programSave: 'Guardar el programa',
  programError: 'No se pudo guardar el programa.',

  // --- Histórico -------------------------------------------------------------
  historyItv: 'Últimas ITV realizadas',
  historyMaintenance: 'Últimos mantenimientos realizados',
  historyItvEmpty: 'Todavía no hay ninguna ITV registrada.',
  historyMaintenanceEmpty: 'Todavía no hay ningún mantenimiento registrado.',
  historyNote: (n: number) => `las ${n} últimas`,
  historyLoading: 'Cargando el histórico…',

  noPostalCode: 'Sin CP preferente',
  cancel: 'Cancelar',
  saving: 'Guardando…',
  close: 'Cerrar',
}

const en: typeof es = {
  title: (plate) => `Schedule MOT and maintenance · ${plate}`,
  tabItv: 'Schedule MOT',
  tabMaintenance: 'Schedule maintenance',

  itvIntro:
    'Each vehicle has ONE MOT booking: if there already is one, this changes it. The preferred postcode is the location a third party uses to find the nearest station.',
  itvNone: 'There is no MOT in sight. Schedule it here or, if it has already been done, register it.',
  itvAlreadyDone: 'Already done?',
  itvScheduledLabel: 'MOT scheduled',
  itvOverdueLabel: 'MOT overdue',
  itvOrigin: 'Where the booking comes from',
  itvFromManual: 'Booked by the fleet team.',
  itvFromHistory: 'Derived from the last recorded inspection; the next one recalculates it.',
  itvOnlyOne: 'A second booking cannot be created: this one is changed.',
  itvDate: 'MOT date',
  itvPostalCode: 'Preferred postcode for the MOT',
  itvSchedule: 'Schedule MOT',
  itvModify: 'Change the booking',
  itvSave: 'Save the booking',
  itvSaved: (date) => `MOT booking saved for ${date}.`,
  itvDateRequired: 'Enter the MOT date.',
  itvPostalCodeInvalid: 'The postcode must have 5 digits.',
  itvError: 'The MOT could not be scheduled.',

  resolveItv: 'Register MOT',
  itvDelete: 'Remove the booking',
  itvDeleteTitle: 'Remove the MOT booking',
  itvDeleteMessage: (date) =>
    `The vehicle will have no upcoming MOT (the booking of ${date} is removed and its open alerts are closed). It is recorded in the vehicle history and can be scheduled again whenever needed.`,
  itvDeleteConfirm: 'Yes, remove the booking',
  itvDeleted: 'MOT booking removed. It is recorded in the vehicle history.',
  itvDeleteError: 'The booking could not be removed.',

  maintenanceIntro:
    'A vehicle has ONE scheduled maintenance, and its cycle comes from the shared programme catalogue. The preferred postcode is the location used to find the nearest workshop.',
  maintenanceNone:
    'There is no scheduled maintenance. Schedule it here; if a service has already been done, enter its date in "Counted from" and the cycle starts there.',
  maintenanceAlreadyDone: 'Already serviced? Enter its date in "Counted from".',
  maintenanceScheduledLabel: 'Maintenance scheduled',
  maintenanceOverdueLabel: 'Maintenance overdue',
  maintenanceOnlyKm: 'By mileage',
  maintenanceByKm: 'No date',
  maintenanceNoKmCycle: 'No mileage cycle',
  maintenanceProgram: 'Programme',
  maintenanceCycleLabel: 'Cycle',
  maintenanceNextKm: 'Next by mileage',
  maintenanceFrom: 'Counted from',
  maintenanceOnlyOne:
    'Only one maintenance can be scheduled at a time: this one is changed or resolved.',
  maintenancePick: 'Maintenance programme',
  maintenancePickPlaceholder: 'Pick a programme from the catalogue…',
  maintenanceNewProgram: '+ New programme',
  maintenanceNoPrograms: 'The catalogue is empty: create the first programme.',
  maintenanceAuto: 'There is only one programme in the catalogue: it is already picked.',
  maintenanceFromDate: 'Counted from (date)',
  maintenanceFromKm: 'Counted from (km)',
  maintenanceNextDate: (date) => `Next maintenance: ${date}.`,
  maintenanceNextKmValue: (km) => `Or on reaching ${km}, whichever comes first.`,
  maintenanceSchedule: 'Schedule maintenance',
  maintenanceModify: 'Change the maintenance',
  maintenanceSave: 'Save the maintenance',
  maintenanceSaved: 'Maintenance saved.',
  maintenanceProgramRequired: 'Pick a programme from the catalogue.',
  maintenanceError: 'The maintenance could not be scheduled.',
  maintenanceLoadError: 'The programme catalogue could not be loaded.',
  resolveMaintenance: 'Service already done',
  maintenanceDelete: 'Remove the maintenance',
  maintenanceDeleteTitle: 'Remove the scheduled maintenance',
  maintenanceDeleteMessage: (name) =>
    `The vehicle will have no scheduled maintenance ("${name}" is withdrawn and its open alerts are closed). It is recorded in the vehicle history and can be scheduled again whenever needed.`,
  maintenanceDeleteConfirm: 'Yes, remove the maintenance',
  maintenanceDeleted: 'Scheduled maintenance removed. It is recorded in the vehicle history.',
  maintenanceDeleteError: 'The scheduled maintenance could not be removed.',
  maintenanceDeleteReason: 'Withdrawn from "Schedule MOT and maintenance".',

  programNewTitle: 'New maintenance programme',
  programEditTitle: (name) => `Programme “${name}”`,
  programInfoShared:
    'A programme applies to the WHOLE fleet: define it once here and any vehicle can be scheduled with it.',
  programInfoCycles:
    'You can set kilometres, months or both. Kilometres win: if the vehicle hits the mileage limit before the months are up, the service is due anyway.',
  programInfoCopy:
    'When a vehicle is scheduled, the cycle is copied: changing the programme does not move what is already scheduled.',
  programName: 'Programme name',
  programNamePlaceholder: 'E.g. “General service”',
  programEveryKm: 'Every (km)',
  programEveryMonths: 'Every (months)',
  programCycleHint: 'Set at least one of the two: with no cycle the programme never falls due.',
  programCycleRequired: 'Set at least one cycle: by km or by months.',
  programNotes: 'Notes',
  programSave: 'Save the programme',
  programError: 'The programme could not be saved.',

  historyItv: 'Last MOTs done',
  historyMaintenance: 'Last services done',
  historyItvEmpty: 'No MOT recorded yet.',
  historyMaintenanceEmpty: 'No service recorded yet.',
  historyNote: (n) => `last ${n}`,
  historyLoading: 'Loading history…',

  noPostalCode: 'No preferred postcode',
  cancel: 'Cancel',
  saving: 'Saving…',
  close: 'Close',
}

const dict = { es, en }

/** Copia del modal «Programar ITV y mantenimiento» en el idioma activo. */
export function useScheduleCopy() {
  return dict[useAppLang()]
}
