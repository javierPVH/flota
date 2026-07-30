import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: 'Informes',
  subtitle: 'Descarga de inventario, alertas y costes en Excel o CSV.',
  reports: {
    fleet: {
      title: 'Flota',
      description:
        'Inventario completo: matrícula, marca/modelo, estado, uso, conductor, supervisor, próxima ITV…',
    },
    alerts: {
      title: 'Alertas',
      description:
        'Alertas con tipo, nivel, estado, vehículo y fechas — para seguimiento y auditoría.',
    },
    costs: {
      title: 'Costes',
      description: 'Cuotas y facturación por vehículo, para conciliar con contabilidad.',
    },
  },
}

const en: typeof es = {
  title: 'Reports',
  subtitle: 'Download inventory, alerts and costs as Excel or CSV.',
  reports: {
    fleet: {
      title: 'Fleet',
      description:
        'Full inventory: plate, make/model, status, use, driver, supervisor, next MOT…',
    },
    alerts: {
      title: 'Alerts',
      description:
        'Alerts with type, level, status, vehicle and dates — for follow-up and audit.',
    },
    costs: {
      title: 'Costs',
      description: 'Fees and billing per vehicle, to reconcile with accounting.',
    },
  },
}

const dict = { es, en }

/** Copia de la página en el idioma activo (UX1). */
export function useReportsCopy() {
  return dict[useAppLang()]
}
