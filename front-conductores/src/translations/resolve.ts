/**
 * Copy de **solucionar una incidencia** en la app de campo, un formulario por
 * tipo (`components/resolve/`).
 *
 * Espejo del de gestión (`front-gestion/src/translations/resolve.ts`) en lo que
 * se pregunta, porque lo que se cierra es lo mismo y el back es el mismo: si
 * aquí se llamara distinto, el mismo dato se leería con dos nombres según por
 * dónde se cerró. Lo que NO viaja es lo que en campo no se decide: el taller
 * del catálogo y la vuelta a Activo, que son de administración.
 */
import { useAppLang } from '@flota/ui/i18n'

const es = {
  /** Título del modal: dice qué se está cerrando, no «Resolver» a secas. */
  title: (what: string, plate: string) => (plate ? `${what} · ${plate}` : what),
  titleOf: {
    breakdown: 'Solucionar avería',
    tires: 'Solucionar neumáticos',
    accident: 'Solucionar accidente',
    maintenance: 'Solucionar mantenimiento',
    general: 'Cerrar petición',
  },
  common: {
    date: 'Fecha de la solución',
    km: 'Kilometraje',
    kmHint: 'Vacío = se deja la última lectura conocida.',
    // El coche no rueda en el taller: sale con los km con los que entró, y
    // tecleados en un móvil se equivocan.
    loadKm: (km: string) => `Cargar los del coche (${km})`,
    loadKmHint: 'En el taller no hace kilómetros: si no ha rodado, esta lectura vale.',
    cost: 'Coste (€)',
    postalCode: 'CP del taller',
    observations: 'Observaciones',
    proof: 'Factura del taller (foto o PDF)',
    proofHint: 'Opcional: queda colgada de esta incidencia.',
    proofChange: 'Toca para cambiarla',
    downtime: (days: number) => (days === 1 ? '1 día parado' : `${days} días parado`),
    cancel: 'Cancelar',
    submit: 'Cerrar incidencia',
    submitting: 'Guardando…',
    required: 'Obligatorio',
    error: 'No se pudo cerrar la incidencia.',
    proofQueued: 'La factura se subirá al recuperar cobertura.',
    proofFailed: 'La factura no se pudo subir; súbela desde Documentos.',
  },
  breakdown: {
    intro: 'Lo que se hizo para arreglarlo, con lo que costó.',
  },
  /** Petición general: puede no ir del coche, así que lo del taller solo se
   * pregunta si lo hubo. */
  general: {
    intro: 'Cómo se resolvió. Si no hubo taller, basta con la fecha y las observaciones.',
    workshop: '¿Requirió pasar por el taller?',
    workshopHint: 'Al marcarlo se piden los kilómetros, el coste, el CP y la factura.',
  },
  maintenance: {
    intro:
      'Mantenimiento puntual: se cierra con lo que se hizo. El programado se marca en su ' +
      'pestaña, que es la que reancla el ciclo.',
  },
  tires: {
    intro: 'Qué se montó. Lo que el parte ya decía viene puesto.',
    size: 'Medida',
    brand: 'Marca',
    quantity: 'Cantidad',
    positions: 'Ruedas montadas',
    front_left: 'Delantera izquierda',
    front_right: 'Delantera derecha',
    rear_left: 'Trasera izquierda',
    rear_right: 'Trasera derecha',
  },
  accident: {
    intro: 'Cómo quedó el siniestro: el expediente y quién asume el coste.',
    claimRef: 'Expediente del siniestro',
    liability: 'Quién asume el coste',
    liabilityNone: 'Sin determinar',
    liabilityOwn: 'Nuestro seguro',
    liabilityThirdParty: 'El tercero',
    liabilityDeductible: 'Franquicia',
    deductibleAmount: 'Importe de la franquicia (€)',
  },
}

const en: typeof es = {
  title: (what, plate) => (plate ? `${what} · ${plate}` : what),
  titleOf: {
    breakdown: 'Resolve breakdown',
    tires: 'Resolve tyres',
    accident: 'Resolve accident',
    maintenance: 'Resolve maintenance',
    general: 'Close request',
  },
  common: {
    date: 'Resolution date',
    km: 'Odometer',
    kmHint: 'Empty = the last known reading is kept.',
    loadKm: (km) => `Load the car's own (${km})`,
    loadKmHint: 'A car in the workshop covers no distance: if it has not moved, this reading holds.',
    cost: 'Cost (€)',
    postalCode: 'Workshop post code',
    observations: 'Notes',
    proof: 'Workshop invoice (photo or PDF)',
    proofHint: 'Optional: it is filed under this incident.',
    proofChange: 'Tap to change it',
    downtime: (days) => (days === 1 ? '1 day off the road' : `${days} days off the road`),
    cancel: 'Cancel',
    submit: 'Close incident',
    submitting: 'Saving…',
    required: 'Required',
    error: 'The incident could not be closed.',
    proofQueued: 'The invoice will upload when you are back online.',
    proofFailed: 'The invoice could not be uploaded; upload it from Documents.',
  },
  breakdown: {
    intro: 'What was done to fix it, and what it cost.',
  },
  general: {
    intro: 'How it was resolved. If there was no workshop, the date and the notes are enough.',
    workshop: 'Did it have to go to the workshop?',
    workshopHint: 'Ticking it asks for the odometer, the cost, the postcode and the invoice.',
  },
  maintenance: {
    intro:
      'One-off maintenance: closed with what was done. Scheduled maintenance is marked on its ' +
      'own tab, which is what re-anchors the cycle.',
  },
  tires: {
    intro: 'What was fitted. Whatever the report already said comes prefilled.',
    size: 'Size',
    brand: 'Brand',
    quantity: 'Quantity',
    positions: 'Wheels fitted',
    front_left: 'Front left',
    front_right: 'Front right',
    rear_left: 'Rear left',
    rear_right: 'Rear right',
  },
  accident: {
    intro: 'How the claim ended: the reference and who bears the cost.',
    claimRef: 'Claim reference',
    liability: 'Who bears the cost',
    liabilityNone: 'Undetermined',
    liabilityOwn: 'Our insurer',
    liabilityThirdParty: 'The third party',
    liabilityDeductible: 'Deductible',
    deductibleAmount: 'Deductible amount (€)',
  },
}

const dict = { es, en }

export function useResolveCopy() {
  return dict[useAppLang()]
}
