import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: 'Propuestas de fechas',
  subtitle: (n: number) => `${n} propuesta(s) pendiente(s) de decidir.`,
  exportCsv: 'Exportar CSV',
  loading: 'Cargando…',
  empty: 'No hay propuestas pendientes. 🎉',
  loadError: 'No se pudieron cargar las propuestas.',
  processError: 'No se pudo procesar la propuesta.',
  accepted: (driver: string, plate: string) =>
    `Propuesta de ${driver} sobre ${plate} confirmada: ` +
    'la asignación anterior queda cerrada y el cambio registrado como evento.',
  rejected: (driver: string, plate: string) =>
    `Propuesta de ${driver} sobre ${plate} rechazada; ` +
    'la asignación vigente no cambia.',
  confirm: 'Confirmar',
  reject: 'Rechazar',
  columns: {
    vehicle: 'Vehículo',
    driver: 'Conductor',
    proposedStart: 'Inicio propuesto',
    proposedEnd: 'Fin propuesto',
    actions: 'Acciones',
  },
}

const en: typeof es = {
  title: 'Date proposals',
  subtitle: (n) => `${n} proposal(s) awaiting a decision.`,
  exportCsv: 'Export CSV',
  loading: 'Loading…',
  empty: 'No pending proposals. 🎉',
  loadError: 'Could not load proposals.',
  processError: 'Could not process the proposal.',
  accepted: (driver, plate) =>
    `Proposal from ${driver} for ${plate} confirmed: ` +
    'the previous assignment is closed and the change logged as an event.',
  rejected: (driver, plate) =>
    `Proposal from ${driver} for ${plate} rejected; ` +
    'the current assignment is unchanged.',
  confirm: 'Confirm',
  reject: 'Reject',
  columns: {
    vehicle: 'Vehicle',
    driver: 'Driver',
    proposedStart: 'Proposed start',
    proposedEnd: 'Proposed end',
    actions: 'Actions',
  },
}

const dict = { es, en }

/** Copia de la página en el idioma activo (UX1). */
export function useProposalsCopy() {
  return dict[useAppLang()]
}
