/**
 * Copia de la bandeja de **correcciones de lecturas** de `/solicitudes`: las
 * peticiones de corregir la última lectura de km o el último consumo que abre
 * el campo, donde esas anotaciones no se editan. Módulo propio —y no un bloque
 * más de `requests.ts`— porque lo leen la pestaña y la página que la monta.
 */
import { useAppLang } from '@flota/ui/i18n'

const es = {
  tab: 'Corregir km o consumo',
  help: 'Las abre el campo desde el formulario de km o de consumo, donde la última anotación no se edita. Aprobarla ',
  helpStrong: 'escribe la fecha y la cifra en esa anotación',
  helpRest:
    '; mientras espera, la app de campo enseña las dos: la original y la pendiente de cambio. Si entre tanto se registra una anotación posterior, la corrección se anula sola (sale entre las rechazadas, como «Anulada»).',
  statusDone: 'Aprobadas',
  empty: 'Sin correcciones con estos filtros.',
  loadError: 'No se pudieron cargar las correcciones.',
  csvName: 'correcciones-lecturas',
  kind: { km: 'Lectura de km', fuel: 'Consumo' },
  status: { pending: 'Pendiente', done: 'Aprobada', rejected: 'Denegada', cancelled: 'Anulada' },
  fields: { reading_date: 'Fecha', km_reading: 'Odómetro (km)', avg_consumption: 'Consumo medio' },
  columns: {
    vehicle: 'Vehículo',
    kind: 'Qué se corrige',
    changes: 'Original → corrección',
    requested: 'Pedida',
    note: 'Nota',
    status: 'Estado',
    resolved: 'Resuelta',
    actions: 'Acciones',
  },
  change: (label: string, current: string, proposed: string) =>
    `${label}: ${current || '—'} → ${proposed || '—'}`,
  noNote: 'Sin nota',
  manage: 'Gestionar…',
  modalTitle: (plate: string) => `Corregir una anotación · ${plate}`,
  asked: (who: string, when: string) => `Pedida por ${who} el ${when}.`,
  kindLabel: 'Anotación',
  changesLabel: 'Original → corrección pedida',
  noteLabel: 'Nota para administración',
  decision: 'Qué se hace con la corrección',
  optDone: 'Aprobarla',
  optDoneHint:
    'Se escriben la fecha y la cifra pedidas en la anotación, con su rastro en la auditoría. Si ya no cabe (el odómetro retrocedería frente a otra lectura), se dice y no se toca nada.',
  optReject: 'Denegarla',
  optRejectHint: 'La anotación se queda como está. La nota explica por qué.',
  goToVehicle: 'Abrir la ficha del coche',
  note: 'Observaciones (opcional)',
  submit: 'Resolver',
  submitting: 'Resolviendo…',
  okDone: (plate: string) => `Corrección de ${plate} aprobada.`,
  okReject: (plate: string) => `Corrección de ${plate} denegada.`,
  error: 'No se pudo resolver la corrección.',
}

type Copy = typeof es

const en: Copy = {
  tab: 'Fix mileage or consumption',
  help: 'The field opens them from the mileage or consumption form, where the last entry cannot be edited. Approving one ',
  helpStrong: 'writes the date and the figure into that entry',
  helpRest:
    '; meanwhile the field app shows both: the original and the pending change. If a later entry is registered in between, the correction cancels itself (it shows among the rejected ones, as “Cancelled”).',
  statusDone: 'Approved',
  empty: 'No corrections with these filters.',
  loadError: 'The corrections could not be loaded.',
  csvName: 'reading-corrections',
  kind: { km: 'Mileage reading', fuel: 'Consumption' },
  status: { pending: 'Pending', done: 'Approved', rejected: 'Denied', cancelled: 'Cancelled' },
  fields: { reading_date: 'Date', km_reading: 'Odometer (km)', avg_consumption: 'Average consumption' },
  columns: {
    vehicle: 'Vehicle',
    kind: 'What is fixed',
    changes: 'Original → correction',
    requested: 'Requested',
    note: 'Note',
    status: 'Status',
    resolved: 'Resolved',
    actions: 'Actions',
  },
  change: (label: string, current: string, proposed: string) =>
    `${label}: ${current || '—'} → ${proposed || '—'}`,
  noNote: 'No note',
  manage: 'Manage…',
  modalTitle: (plate: string) => `Fix an entry · ${plate}`,
  asked: (who: string, when: string) => `Requested by ${who} on ${when}.`,
  kindLabel: 'Entry',
  changesLabel: 'Original → requested correction',
  noteLabel: 'Note for administration',
  decision: 'What to do with the correction',
  optDone: 'Approve it',
  optDoneHint:
    'The requested date and figure are written into the entry, with their audit trail. If it no longer fits (the odometer would go backwards against another reading), it says so and nothing is touched.',
  optReject: 'Deny it',
  optRejectHint: 'The entry stays as it is. The note explains why.',
  goToVehicle: 'Open the vehicle record',
  note: 'Remarks (optional)',
  submit: 'Resolve',
  submitting: 'Resolving…',
  okDone: (plate: string) => `Correction for ${plate} approved.`,
  okReject: (plate: string) => `Correction for ${plate} denied.`,
  error: 'The correction could not be resolved.',
}

const dict = { es, en }

export function useReadingRequestsCopy(): Copy {
  return dict[useAppLang()]
}
