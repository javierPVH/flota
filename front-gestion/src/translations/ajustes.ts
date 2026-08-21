import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: 'Ajustes',
  subtitle: 'Catálogos, borrado definitivo, plantillas de correo y facturas',
  tabs: {
    catalogs: 'Catálogos',
    deletions: 'Borrado definitivo',
    templates: 'Plantillas de correo',
    notifications: 'Notificaciones',
    invoices: 'Facturas',
  },
}

const en: typeof es = {
  title: 'Settings',
  subtitle: 'Catalogs, permanent deletion, email templates and invoices',
  tabs: {
    catalogs: 'Catalogs',
    deletions: 'Permanent deletion',
    templates: 'Email templates',
    notifications: 'Notifications',
    invoices: 'Invoices',
  },
}

const dict = { es, en }

/** Copia de la página de Ajustes en el idioma activo (UX1). */
export function useAjustesCopy() {
  return dict[useAppLang()]
}
