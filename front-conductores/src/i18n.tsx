/**
 * i18n de la app de campo (M9): `createI18n` del DS con diccionarios es/en.
 *
 * Cubre el shell (pestañas, cola offline) y "Mis vehículos"; el resto de
 * páginas sigue en castellano y se traduce incrementalmente añadiendo claves
 * aquí (el diccionario es tipado: si falta una clave en un idioma, no compila).
 */

import { createI18n } from '@flota/ui'

const es = {
  shell: {
    brand: 'Flota',
    tabs: {
      vehicles: 'Vehículos',
      registerKm: 'Registrar km',
      alerts: 'Alertas',
      group: 'Grupo',
    },
    logout: 'Salir',
    navLabel: 'Navegación principal',
    offlinePending: (n: number) =>
      `${n} registro${n === 1 ? '' : 's'} sin enviar — toca para reintentar`,
    offlineSending: 'Enviando pendientes…',
    offlineSent: (n: number) =>
      `${n} registro${n === 1 ? '' : 's'} pendiente${n === 1 ? '' : 's'} enviado${n === 1 ? '' : 's'}.`,
    offlineRejected: (detail: string) => `Rechazados por el servidor: ${detail}`,
  },
  common: {
    loading: 'Cargando…',
  },
  home: {
    myVehicles: 'Mis vehículos',
    myGroup: 'Mi grupo',
    searchPlaceholder: 'Buscar por matrícula o modelo…',
    searchLabel: 'Buscar vehículo',
    empty: 'Sin resultados.',
    km: 'Km',
    pendingReading: 'lectura pendiente',
    nextItv: 'Próx. ITV',
    driver: 'Conductor',
    substitute: '🔁 sustitución',
  },
}

const en: typeof es = {
  shell: {
    brand: 'Fleet',
    tabs: {
      vehicles: 'Vehicles',
      registerKm: 'Log km',
      alerts: 'Alerts',
      group: 'Group',
    },
    logout: 'Log out',
    navLabel: 'Main navigation',
    offlinePending: (n) => `${n} unsent record${n === 1 ? '' : 's'} — tap to retry`,
    offlineSending: 'Sending pending…',
    offlineSent: (n) => `${n} pending record${n === 1 ? '' : 's'} sent.`,
    offlineRejected: (detail) => `Rejected by the server: ${detail}`,
  },
  common: {
    loading: 'Loading…',
  },
  home: {
    myVehicles: 'My vehicles',
    myGroup: 'My group',
    searchPlaceholder: 'Search by plate or model…',
    searchLabel: 'Search vehicle',
    empty: 'No results.',
    km: 'Km',
    pendingReading: 'reading due',
    nextItv: 'Next MOT',
    driver: 'Driver',
    substitute: '🔁 substitute',
  },
}

export const { LanguageProvider, useLang } = createI18n({ es, en })
