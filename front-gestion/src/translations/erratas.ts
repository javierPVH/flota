import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: 'Espacio de erratas',
  subtitle:
    'Registros desactivados: restaurables por la administración; el borrado definitivo es exclusivo del superusuario.',
  loading: 'Cargando…',
  empty: 'No hay erratas: ningún registro desactivado. ✓',
  emptyType: 'Sin erratas de este tipo.',
  loadError: 'No se pudo cargar el espacio de erratas.',
  restoreError: 'No se pudo restaurar.',
  purgeError: 'No se pudo eliminar.',
  confirmRestore: (label: string) => `¿Restaurar "${label}"?`,
  restoreOk: (label: string) => `Restaurado: ${label}`,
  confirmPurge: (label: string) =>
    `¿Eliminar DEFINITIVAMENTE "${label}"? Esta acción no se puede deshacer y queda auditada.`,
  purgeOk: (label: string) => `Eliminado definitivamente: ${label}`,
  // A3: el borrado definitivo arrastra en cascada (purgar un usuario se
  // lleva sus asignaciones; un vehículo, su histórico). Se enseña antes.
  cascadeIntro: 'Se eliminarán además:',
  cascadeNone: 'No arrastra ningún otro registro.',
  restore: 'Restaurar',
  purge: 'Eliminar definitivamente',
  exportCsv: 'Exportar CSV',
  // M5: la tabla solo tiene la página en curso; exportar pide el resto.
  exporting: 'Exportando…',
  prevPage: 'Anterior',
  nextPage: 'Siguiente',
  pageOf: (page: number, total: number) => `Página ${page} de ${total}`,
  records: 'Registros',
  searchLabel: 'Buscar',
  searchPlaceholder: 'Registro, motivo o persona…',
  summary: (records: number, types: number) =>
    `${records} registro${records === 1 ? '' : 's'} desactivado${records === 1 ? '' : 's'} en ${types} tipo${types === 1 ? '' : 's'}`,
  dismiss: 'Cerrar el aviso',
  typeLabel: 'Tipo de registro',
  typeSearchPlaceholder: 'Buscar un tipo…',
  /** Panel informativo: qué guarda la tabla seleccionada. Claves = tipos del
   * registro de erratas del back (`fleet/erratas.py`). */
  typeInfo: {
    'km-readings': 'Lecturas del cuentakilómetros registradas por conductores o por gestión.',
    contracts: 'Contratos de renting del vehículo: cuotas, kilometraje contratado y vigencia.',
    assignments: 'Asignaciones de conductor a vehículo, con su periodo y su estado.',
    'vehicle-usages': 'Repartos de uso de un vehículo entre varios conductores (porcentajes).',
    'vehicle-links': 'Vínculos entre un coche principal y su sustituto durante avería o taller.',
    'vehicle-requests': 'Solicitudes de vehículo hechas por los usuarios (se aprueban en Jira).',
    documents:
      'Documentos del coche (permiso de circulación, ficha técnica, seguro…) o personales del usuario (permiso de conducir).',
    incidents: 'Incidencias y partes: averías, neumáticos, accidentes y mantenimiento.',
    'fuel-consumptions': 'Consumos mensuales de combustible por vehículo (litros e importe).',
    'maintenance-plans': 'Planes de mantenimiento preventivo (cada X km o cada X meses).',
    invoices: 'Facturas del vehículo, con su importe y su PDF en Drive.',
    'invoice-allocations': 'Líneas de reparto de una factura entre proyectos o CECOs.',
    brands: 'Catálogo de marcas de vehículo.',
    'vehicle-models': 'Catálogo de modelos, cada uno ligado a su marca.',
    companies: 'Catálogo de sociedades del grupo.',
    rentings: 'Catálogo de proveedores de renting.',
    projects: 'Catálogo de proyectos a los que se imputan costes.',
    peps: 'Catálogo de PEP / centros de coste (CECO).',
    'business-units': 'Catálogo de unidades de negocio.',
    countries: 'Catálogo de países.',
    'fuel-types': 'Catálogo de tipos de combustible.',
    sites: 'Catálogo de sedes.',
    workshops: 'Catálogo de talleres y estaciones de ITV (dónde se cita el vehículo).',
    'email-templates': 'Plantillas de los correos que envía la aplicación.',
    'email-signatures': 'Firmas reutilizables para los correos.',
    vehicles:
      'Vehículos dados de baja de la flota. Restaurar los devuelve al servicio; purgarlos arrastra TODO su histórico (contratos, lecturas, documentos, facturas…).',
    users:
      'Usuarios desactivados. Restaurar reactiva su acceso; purgarlos arrastra sus asignaciones y el resto de sus registros.',
  } as Record<string, string>,
  typeInfoFallback: 'Registros desactivados de este tipo.',
  alertTitle: 'Qué es el borrado definitivo',
  alertBody:
    'Aquí se listan los registros desactivados (no eliminados). La administración puede restaurarlos; solo el superusuario puede eliminarlos definitivamente. El borrado definitivo es irreversible y queda auditado.',
  columns: {
    label: 'Registro',
    deactivatedAt: 'Desactivado el',
    deactivatedBy: 'Por',
    reason: 'Motivo',
    actions: 'Acciones',
  },
}

const en: typeof es = {
  title: 'Errata space',
  subtitle:
    'Deactivated records: admins can restore them; permanent deletion is superuser-only.',
  loading: 'Loading…',
  empty: 'No errata: no deactivated records. ✓',
  emptyType: 'No errata of this type.',
  loadError: 'Could not load the errata space.',
  restoreError: 'Could not restore.',
  purgeError: 'Could not delete.',
  confirmRestore: (label) => `Restore "${label}"?`,
  restoreOk: (label) => `Restored: ${label}`,
  confirmPurge: (label) =>
    `PERMANENTLY delete "${label}"? This action cannot be undone and is audited.`,
  purgeOk: (label) => `Permanently deleted: ${label}`,
  cascadeIntro: 'This will also delete:',
  cascadeNone: 'No other records are affected.',
  restore: 'Restore',
  purge: 'Delete permanently',
  exportCsv: 'Export CSV',
  exporting: 'Exporting…',
  prevPage: 'Previous',
  nextPage: 'Next',
  pageOf: (page, total) => `Page ${page} of ${total}`,
  records: 'Records',
  searchLabel: 'Search',
  searchPlaceholder: 'Record, reason or person…',
  summary: (records, types) =>
    `${records} deactivated record${records === 1 ? '' : 's'} across ${types} type${types === 1 ? '' : 's'}`,
  dismiss: 'Dismiss',
  typeLabel: 'Record type',
  typeSearchPlaceholder: 'Search a type…',
  typeInfo: {
    'km-readings': 'Odometer readings logged by drivers or by management.',
    contracts: 'Vehicle renting contracts: fees, contracted mileage and validity.',
    assignments: 'Driver-to-vehicle assignments, with their period and status.',
    'vehicle-usages': 'Usage splits of a vehicle across several drivers (percentages).',
    'vehicle-links': 'Links between a main car and its substitute during breakdown or workshop.',
    'vehicle-requests': 'Vehicle requests made by users (approved in Jira).',
    documents:
      'Car documents (registration certificate, datasheet, insurance…) or personal user documents (driving licence).',
    incidents: 'Incidents and reports: breakdowns, tires, accidents and maintenance.',
    'fuel-consumptions': 'Monthly fuel consumption per vehicle (litres and amount).',
    'maintenance-plans': 'Preventive maintenance plans (every X km or X months).',
    invoices: 'Vehicle invoices, with their amount and their PDF in Drive.',
    'invoice-allocations': 'Allocation lines of an invoice across projects or CECOs.',
    brands: 'Vehicle brand catalogue.',
    'vehicle-models': 'Model catalogue, each tied to its brand.',
    companies: 'Group company catalogue.',
    rentings: 'Renting provider catalogue.',
    projects: 'Catalogue of projects costs are allocated to.',
    peps: 'PEP / cost centre (CECO) catalogue.',
    'business-units': 'Business unit catalogue.',
    countries: 'Country catalogue.',
    'fuel-types': 'Fuel type catalogue.',
    sites: 'Site catalogue.',
    workshops: 'Catalogue of workshops and MOT stations (where the vehicle is booked).',
    'email-templates': 'Templates for the emails the application sends.',
    'email-signatures': 'Reusable signatures for emails.',
    vehicles:
      'Vehicles retired from the fleet. Restoring puts them back in service; purging drags their ENTIRE history (contracts, readings, documents, invoices…).',
    users:
      'Deactivated users. Restoring re-enables their access; purging drags their assignments and the rest of their records.',
  },
  typeInfoFallback: 'Deactivated records of this type.',
  alertTitle: 'What permanent deletion means',
  alertBody:
    'These are deactivated (not deleted) records. Admins can restore them; only the superuser can delete them permanently. Permanent deletion is irreversible and audited.',
  columns: {
    label: 'Record',
    deactivatedAt: 'Deactivated on',
    deactivatedBy: 'By',
    reason: 'Reason',
    actions: 'Actions',
  },
}

const dict = { es, en }

/** Copia de la página en el idioma activo (UX1). */
export function useErratasCopy() {
  return dict[useAppLang()]
}
