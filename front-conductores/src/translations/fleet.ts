/**
 * R3-36: copy de «Flota a cargo» — patrón de gestión: el módulo lo importa la
 * propia página perezosa y su texto viaja en SU chunk, no en el bundle inicial.
 *
 * Incluye el de «A tu cargo», que vivía en el diccionario del shell cuando ese
 * bloque estaba en «Mi perfil»: ahora se lee aquí, así que su texto viaja con
 * esta página.
 */
import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: 'Flota a cargo',
  tabsLabel: 'Grupos de la flota',
  tabAll: 'Todos',
  /** Los dos cortes que no son un estado (van arriba, con «Activo»). */
  tabStopped: 'No activos',
  tabSubstituted: 'Con coche de sustitución',
  /** Las cifras de quien supervisa: una tarjeta plegable con dos bloques —lo
   * que tiene a su cargo y lo que hay que atender—. */
  overview: {
    title: 'A tu cargo',
    pendingTitle: 'Alertas e incidencias',
    hint: 'Toca una cifra para ver la lista.',
    vehicles: 'Coches',
    drivers: 'Conductores',
    alerts: 'Alertas',
    incidents: 'Incidencias',
    accidents: 'Accidentes',
    loadError: 'No se pudo cargar tu resumen.',
    /** Lo abierto es lo que se cuenta: es lo que hay que atender. */
    openOnly: 'abiertas',
    emptyVehicles: 'No supervisas ningún coche ahora mismo.',
    emptyDrivers: 'Ninguno de tus coches tiene conductor asignado.',
    emptyAlerts: 'Sin alertas abiertas.',
    emptyIncidents: 'Sin incidencias abiertas.',
    emptyAccidents: 'Sin accidentes abiertos.',
    noDriver: 'Sin conductor',
    driverOf: (plate: string) => `Lleva ${plate}`,
    resolve: 'Resolver',
    resolved: (what: string) => `${what} resuelta.`,
  },
}

const en: typeof es = {
  title: 'Fleet in my care',
  tabsLabel: 'Fleet groups',
  tabAll: 'All',
  tabStopped: 'Not active',
  tabSubstituted: 'With a replacement vehicle',
  overview: {
    title: 'In your charge',
    pendingTitle: 'Alerts and incidents',
    hint: 'Tap a figure to see the list.',
    vehicles: 'Vehicles',
    drivers: 'Drivers',
    alerts: 'Alerts',
    incidents: 'Incidents',
    accidents: 'Accidents',
    loadError: 'Your summary could not be loaded.',
    openOnly: 'open',
    emptyVehicles: 'You supervise no vehicles right now.',
    emptyDrivers: 'None of your vehicles has a driver assigned.',
    emptyAlerts: 'No open alerts.',
    emptyIncidents: 'No open incidents.',
    emptyAccidents: 'No open accidents.',
    noDriver: 'No driver',
    driverOf: (plate) => `Drives ${plate}`,
    resolve: 'Resolve',
    resolved: (what) => `${what} resolved.`,
  },
}

const dict = { es, en }

export function useFleetCopy() {
  return dict[useAppLang()]
}
