import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: 'Vehículos',
  subtitle: 'Inventario de la flota.',
  exportCsv: 'Exportar CSV',
  newVehicle: 'Nuevo vehículo',
  loading: 'Cargando…',
  empty: 'No hay vehículos todavía.',
  loadError: 'No se pudieron cargar los vehículos.',
  deleteError: 'No se pudo eliminar.',
  confirmDelete: (plate: string) => `¿Eliminar el vehículo ${plate}?`,
  edit: 'Editar',
  delete: 'Eliminar',
  columns: {
    plate: 'Matrícula',
    vehicle: 'Vehículo',
    state: 'Estado',
    supervisor: 'Supervisor',
    nextItv: 'Próx. ITV',
    actions: 'Acciones',
  },
}

const en: typeof es = {
  title: 'Vehicles',
  subtitle: 'Fleet inventory.',
  exportCsv: 'Export CSV',
  newVehicle: 'New vehicle',
  loading: 'Loading…',
  empty: 'No vehicles yet.',
  loadError: 'Could not load vehicles.',
  deleteError: 'Could not delete.',
  confirmDelete: (plate) => `Delete vehicle ${plate}?`,
  edit: 'Edit',
  delete: 'Delete',
  columns: {
    plate: 'Plate',
    vehicle: 'Vehicle',
    state: 'Status',
    supervisor: 'Supervisor',
    nextItv: 'Next MOT',
    actions: 'Actions',
  },
}

const dict = { es, en }

/** Copia de la página en el idioma activo (UX1). */
export function useVehiclesCopy() {
  return dict[useAppLang()]
}
