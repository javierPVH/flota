import { useAppLang } from '@flota/ui/i18n'

const es = {
  breadcrumb: '← Conductores y usuarios',
  loading: 'Cargando…',
  loadError: 'No se pudo cargar el usuario.',
  licenseSuffix: (type: string) => ` · Permiso ${type}`,
  fuelCardSuffix: ' · ⛽ tarjeta de combustible',
  historyTitle: 'Vehículos que ha tenido',
  noAssignments: 'Sin asignaciones registradas.',
  groupTitle: 'Su grupo como supervisor',
  groupEmpty:
    'No tiene vehículos a su cargo. El grupo se compone asignándole como supervisor en la edición de cada vehículo.',
  assignmentOf: (plate: string) => `Asignación de ${plate}`,
  assignmentEndOf: (plate: string) => `Fin de asignación de ${plate}`,
  columns: {
    vehicle: 'Vehículo',
    period: 'Periodo',
    status: 'Estado',
  },
  statuses: {
    proposed: 'Propuesta',
    accepted: 'Vigente',
    rejected: 'Rechazada',
    finished: 'Finalizada',
  } as Record<string, string>,
}

const en: typeof es = {
  breadcrumb: '← Drivers and users',
  loading: 'Loading…',
  loadError: 'Could not load the user.',
  licenseSuffix: (type) => ` · License ${type}`,
  fuelCardSuffix: ' · ⛽ fuel card',
  historyTitle: 'Vehicles they have had',
  noAssignments: 'No assignments on record.',
  groupTitle: 'Their group as supervisor',
  groupEmpty:
    'No vehicles under their charge. The group is built by setting them as supervisor when editing each vehicle.',
  assignmentOf: (plate) => `Assignment of ${plate}`,
  assignmentEndOf: (plate) => `End of assignment of ${plate}`,
  columns: {
    vehicle: 'Vehicle',
    period: 'Period',
    status: 'Status',
  },
  statuses: {
    proposed: 'Proposed',
    accepted: 'Active',
    rejected: 'Rejected',
    finished: 'Finished',
  },
}

const dict = { es, en }

/** Copia de la página en el idioma activo (UX1). */
export function useUserDetailCopy() {
  return dict[useAppLang()]
}
