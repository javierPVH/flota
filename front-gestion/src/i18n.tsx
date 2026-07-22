/**
 * i18n de la app de gestión (G12): `createI18n` del DS con diccionarios es/en.
 *
 * Cubre el shell y la Vista general; el resto de páginas sigue en castellano y
 * se traduce incrementalmente añadiendo claves aquí (el diccionario es tipado:
 * si falta una clave en un idioma, no compila).
 */

import { createI18n } from '@flota/ui'

const es = {
  shell: {
    brand: 'Flota · Gestión',
    nav: {
      panel: 'Panel',
      vehicles: 'Vehículos',
      drivers: 'Conductores',
      proposals: 'Propuestas',
      mileage: 'Kilometraje',
      alerts: 'Alertas',
      requests: 'Solicitudes',
      invoices: 'Facturas',
      catalogs: 'Catálogos',
      incidents: 'Incidencias',
      reports: 'Informes',
    },
    logout: 'Salir',
    roles: { admin: 'Administración', supervisor: 'Supervisión', driver: 'Conductor' } as Record<
      string,
      string
    >,
    shortcutsHint: 'Atajos: "/" busca · "n" nuevo vehículo',
  },
  common: {
    loading: 'Cargando…',
  },
  home: {
    title: 'Vista general',
    addVehicle: '+ Añadir vehículo',
    kpiVehicles: 'Vehículos',
    kpiVehiclesSub: (active: number, shop: number) => `${active} activos · ${shop} en taller`,
    kpiUse: 'Personal / obra',
    kpiUseSub: (personal: number, works: number) => `${personal}% personal · ${works}% obra`,
    kpiCost: 'Coste mensual',
    kpiCostSub: (invoiced: string) => `Facturado: ${invoiced}`,
    kpiCostTrend: (invoiced: string, trend: string) =>
      `Facturado ${invoiced} (${trend}% vs mes anterior)`,
    kpiItv: 'ITV próximas (30 días)',
    kpiItvOverdue: (n: number) => `${n} vencidas`,
    kpiItvOk: 'Ninguna vencida',
    alertsTitle: 'Alertas que requieren atención',
    alertsOpen: (n: number) => `${n} abiertas`,
    seeAll: 'Ver todas →',
    searchPlaceholder: 'Buscar matrícula, marca o conductor…',
    searchLabel: 'Buscar vehículos',
    showRetired: 'Mostrar bajas',
    chips: {
      all: 'Todos',
      personal: 'Uso personal',
      works: 'Uso obra',
      project: 'Proyecto',
      active: 'Activos',
      shop: 'En taller',
      'no-driver': 'Sin conductor',
      itv: 'ITV próxima',
    } as Record<string, string>,
    thPlate: 'Matrícula',
    thVehicle: 'Vehículo',
    thUse: 'Uso',
    thState: 'Estado',
    thDriver: 'Conductor',
    thItv: 'Próx. ITV',
    empty: 'Ningún vehículo con estos filtros.',
    pager: (page: number, total: number, count: number) =>
      `Página ${page} de ${total} · ${count} vehículos`,
    prev: '← Anterior',
    next: 'Siguiente →',
  },
}

const en: typeof es = {
  shell: {
    brand: 'Fleet · Management',
    nav: {
      panel: 'Overview',
      vehicles: 'Vehicles',
      drivers: 'Drivers',
      proposals: 'Proposals',
      mileage: 'Mileage',
      alerts: 'Alerts',
      requests: 'Requests',
      invoices: 'Invoices',
      catalogs: 'Catalogs',
      incidents: 'Incidents',
      reports: 'Reports',
    },
    logout: 'Log out',
    roles: { admin: 'Admin', supervisor: 'Supervisor', driver: 'Driver' },
    shortcutsHint: 'Shortcuts: "/" search · "n" new vehicle',
  },
  common: {
    loading: 'Loading…',
  },
  home: {
    title: 'Overview',
    addVehicle: '+ Add vehicle',
    kpiVehicles: 'Vehicles',
    kpiVehiclesSub: (active, shop) => `${active} active · ${shop} in shop`,
    kpiUse: 'Personal / work',
    kpiUseSub: (personal, works) => `${personal}% personal · ${works}% work`,
    kpiCost: 'Monthly cost',
    kpiCostSub: (invoiced) => `Invoiced: ${invoiced}`,
    kpiCostTrend: (invoiced, trend) => `Invoiced ${invoiced} (${trend}% vs last month)`,
    kpiItv: 'MOT due (30 days)',
    kpiItvOverdue: (n) => `${n} overdue`,
    kpiItvOk: 'None overdue',
    alertsTitle: 'Alerts that need attention',
    alertsOpen: (n) => `${n} open`,
    seeAll: 'See all →',
    searchPlaceholder: 'Search plate, brand or driver…',
    searchLabel: 'Search vehicles',
    showRetired: 'Show retired',
    chips: {
      all: 'All',
      personal: 'Personal use',
      works: 'Work use',
      project: 'Project',
      active: 'Active',
      shop: 'In shop',
      'no-driver': 'No driver',
      itv: 'MOT due soon',
    },
    thPlate: 'Plate',
    thVehicle: 'Vehicle',
    thUse: 'Use',
    thState: 'State',
    thDriver: 'Driver',
    thItv: 'Next MOT',
    empty: 'No vehicles match these filters.',
    pager: (page, total, count) => `Page ${page} of ${total} · ${count} vehicles`,
    prev: '← Previous',
    next: 'Next →',
  },
}

export const { LanguageProvider, useLang } = createI18n({ es, en })
