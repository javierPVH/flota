import { useAppLang } from '@flota/ui/i18n'

/**
 * Copia de la vista HSE (prevención/seguridad): cómo se USA la flota, de solo
 * lectura y en tres pestañas —vehículos, lecturas e informe—.
 *
 * Lo que ya tiene dueño no se repite: el semáforo de km es el de
 * `vehicles.kmStale` y las etiquetas de los enumerados las pone `domainLabels`.
 */
const es = {
  title: 'HSE',
  subtitle: 'Cómo se usa la flota: vehículos, lecturas de kilómetros y consumo.',
  readOnly:
    'Aquí se consulta, no se opera. No se ven costes, ni quién lleva cada coche, ni averías, accidentes, mantenimientos o ITV.',
  tabs: {
    vehicles: 'Vehículos',
    reports: 'Informe',
  },
  // La tabla enseña los que ruedan; con esto se alcanzan también los parados,
  // que siguen teniendo histórico aunque ya no circulen.
  includeStopped: 'Incluir los coches parados',
  // Lo que sale al desplegar una fila: lo que se anotó de ese coche, por fecha.
  history: {
    date: 'Fecha',
    km: 'Lectura',
    fuel: 'Consumo medio',
    estimated: 'Estimada',
    empty: 'Este coche no tiene ninguna anotación.',
    // Las dos gráficas que encabezan el histórico.
    kmChart: 'Evolución de los kilómetros',
    fuelChart: 'Evolución del consumo medio',
    notEnough: 'Hacen falta dos anotaciones para dibujar una evolución.',
    tableTitle: 'Anotaciones, una línea por día',
    // El rango: se entra a ver TODO lo que hay y solo después se acota, así
    // que los dos campos nacen vacíos.
    from: 'Desde',
    to: 'Hasta',
    allDates: 'Todo el histórico',
    emptyRange: 'Este coche no tiene anotaciones en estas fechas.',
    // La unidad se dice UNA vez (cabecera de la columna, cifra de la gráfica)
    // y no en cada celda: repetida, deja de leerse y ensancha la columna.
    kmUnit: 'km',
  },
  // Las cuatro cifras de la cabecera, calculadas sobre lo que la pantalla trae.
  stats: {
    vehicles: 'Coches activos',
    vehiclesSub: (total: number) => `${total} en la flota`,
    readings: 'Con lectura este mes',
    readingsSub: (pending: number) =>
      pending === 0 ? 'Ninguno pendiente' : `${pending} sin dar`,
    fuel: 'Con consumo este mes',
    fuelSub: (pending: number) => (pending === 0 ? 'Ninguno pendiente' : `${pending} sin anotar`),
    stale: 'Sin leer hace +30 días',
    staleSub: 'Incluye los que no tienen ninguna lectura',
    staleOk: 'Toda la flota al día',
  },
  // Cada cifra abre SU lista. Las dos de «este mes» enseñan lo que FALTA, que
  // es lo que se viene a mirar aquí: qué coches no están reportando.
  statModal: {
    active: {
      title: (n: number) => `Coches activos (${n})`,
      hint: 'Los que ruedan hoy: el corte de esta pantalla y del informe.',
    },
    noReading: {
      title: (n: number) => `Sin lectura de este mes (${n})`,
      hint: 'Coches activos que todavía no tienen lectura de kilómetros de este mes.',
    },
    noFuel: {
      title: (n: number) => `Sin consumo anotado este mes (${n})`,
      hint: 'Coches activos sin ninguna anotación de consumo medio de este mes.',
    },
    // Esta cifra cuenta los km, pero la misma pregunta vale para el consumo,
    // así que el modal las trae en dos pestañas con su recuento cada una.
    stale: {
      title: 'Sin anotar hace más de 30 días',
      tabs: {
        km: (n: number) => `Kilómetros (${n})`,
        fuel: (n: number) => `Consumo (${n})`,
      },
      hint: {
        km: 'Coches sin lectura de kilómetros desde hace más de 30 días. Incluye los que no tienen ninguna: no saberlo no es estar al día.',
        fuel: 'Coches sin anotar el consumo desde hace más de 30 días. Incluye los que no lo tienen anotado nunca.',
      },
    },
    empty: 'Ningún coche con estos filtros.',
    searchPlaceholder: 'Matrícula, marca o modelo…',
  },
  records: 'Registros',
  searchLabel: 'Buscar',
  searchPlaceholder: {
    vehicles: 'Matrícula, marca o modelo…',
  },
  exportCsv: 'Exportar CSV',
  loading: 'Cargando…',
  loadError: {
    vehicles: 'No se pudieron cargar los vehículos.',
    history: 'No se pudo cargar el histórico de este coche.',
    report: 'No se pudo cargar el informe.',
  },
  empty: {
    vehicles: 'Ningún vehículo con estos filtros.',
  },
  columns: {
    vehicles: {
      plate: 'Matrícula',
      brand: 'Marca',
      model: 'Modelo',
      state: 'Estado',
      start: 'Fecha de inicio',
      plannedEnd: 'Fin previsto',
      lastReadingDate: 'Última lectura',
      lastReading: 'Kilómetros',
      lastFuelDate: 'Último consumo',
      lastFuel: 'Consumo medio',
    },
    // La cabecera de arriba: de qué habla cada tramo de columnas. Las dos
    // fechas de la derecha se leen igual («Última lectura», «Último consumo»)
    // y lo que las distingue es justo esto.
    groups: {
      vehicle: 'Vehículo',
      contract: 'Contrato',
      km: 'Kilometraje',
      fuel: 'Combustible',
    },
  },
  // Pestaña de informe.
  report: {
    title: 'Informe de HSE',
    hint: 'Lo que se ve aquí es exactamente lo que se descarga.',
    // Las tres hojas del documento. El back las titula en castellano (son
    // títulos de hoja, no una traducción), así que el rótulo del chip sale de
    // aquí y aquel queda de reserva.
    sheets: {
      summary: {
        label: 'Resumen',
        description: 'La portada: las cifras de esta pantalla, para abrir el fichero sabiendo qué trae.',
      },
      vehicles: {
        label: 'Vehículos',
        description: 'Un coche activo por fila, con sus fechas de servicio, su última lectura y su último consumo.',
      },
      readings: {
        label: 'Kilometraje',
        description: 'El histórico de lecturas de km de toda la flota, una por fila.',
      },
    },
    // Cada formato se explica junto a SU botón: el aviso del CSV al final de
    // un párrafo largo no lo leía nadie antes de pulsarlo.
    downloads: {
      label: 'Lo que te llevas',
      xlsxName: 'Excel',
      xlsxDetail: (sheets: number) =>
        `Las ${sheets} hojas, con las fechas y las cifras tipadas y autofiltro en la cabecera.`,
      csvName: 'CSV',
      csvDetail: (sheet: string, rows: number) =>
        `Un CSV es una tabla plana: lleva solo «${sheet}» (${rows} filas).`,
      action: 'Descargar',
    },
    coverAria: 'Cifras de la portada',
    emptySheet: 'Esta hoja no tiene filas.',
  },
}

const en: typeof es = {
  title: 'HSE',
  subtitle: 'How the fleet is used: vehicles, mileage readings and consumption.',
  readOnly:
    'This is for consulting, not operating. No costs, no drivers, and no breakdowns, accidents, maintenance or roadworthiness tests.',
  tabs: {
    vehicles: 'Vehicles',
    reports: 'Report',
  },
  includeStopped: 'Include stopped vehicles',
  history: {
    date: 'Date',
    km: 'Reading',
    fuel: 'Average consumption',
    estimated: 'Estimated',
    empty: 'This vehicle has no entries.',
    kmChart: 'Mileage over time',
    fuelChart: 'Average consumption over time',
    notEnough: 'Two entries are needed to draw a trend.',
    tableTitle: 'Entries, one line per day',
    from: 'From',
    to: 'To',
    allDates: 'All entries',
    emptyRange: 'This vehicle has no entries in this date range.',
    kmUnit: 'km',
  },
  stats: {
    vehicles: 'Active vehicles',
    vehiclesSub: (total) => `${total} in the fleet`,
    readings: 'With a reading this month',
    readingsSub: (pending) => (pending === 0 ? 'None pending' : `${pending} missing`),
    fuel: 'With consumption this month',
    fuelSub: (pending) => (pending === 0 ? 'None pending' : `${pending} missing`),
    stale: 'Unread for 30+ days',
    staleSub: 'Includes those with no reading at all',
    staleOk: 'Whole fleet up to date',
  },
  statModal: {
    active: {
      title: (n) => `Active vehicles (${n})`,
      hint: 'The ones on the road today: the scope of this screen and of the report.',
    },
    noReading: {
      title: (n) => `Without a reading this month (${n})`,
      hint: 'Active vehicles with no mileage reading for this month yet.',
    },
    noFuel: {
      title: (n) => `Without consumption this month (${n})`,
      hint: 'Active vehicles with no average-consumption entry for this month.',
    },
    stale: {
      title: 'Not logged for more than 30 days',
      tabs: {
        km: (n) => `Mileage (${n})`,
        fuel: (n) => `Consumption (${n})`,
      },
      hint: {
        km: 'Vehicles with no mileage reading for more than 30 days. Includes those with none at all: not knowing is not being up to date.',
        fuel: 'Vehicles with no consumption entry for more than 30 days. Includes those that have never had one.',
      },
    },
    empty: 'No vehicle matches these filters.',
    searchPlaceholder: 'Plate, make or model…',
  },
  records: 'Records',
  searchLabel: 'Search',
  searchPlaceholder: {
    vehicles: 'Plate, make or model…',
  },
  exportCsv: 'Export CSV',
  loading: 'Loading…',
  loadError: {
    vehicles: 'Could not load the vehicles.',
    history: 'Could not load this vehicle’s history.',
    report: 'Could not load the report.',
  },
  empty: {
    vehicles: 'No vehicle matches these filters.',
  },
  columns: {
    vehicles: {
      plate: 'Plate',
      brand: 'Make',
      model: 'Model',
      state: 'Status',
      start: 'Start date',
      plannedEnd: 'Planned end',
      lastReadingDate: 'Last reading',
      lastReading: 'Mileage',
      lastFuelDate: 'Last consumption',
      lastFuel: 'Average consumption',
    },
    groups: {
      vehicle: 'Vehicle',
      contract: 'Contract',
      km: 'Mileage',
      fuel: 'Fuel',
    },
  },
  report: {
    title: 'HSE report',
    hint: 'What you see here is exactly what you download.',
    sheets: {
      summary: {
        label: 'Summary',
        description: 'The cover: the figures of this screen, so you open the file knowing what it carries.',
      },
      vehicles: {
        label: 'Vehicles',
        description: 'One active vehicle per row, with its service dates, its last reading and its last consumption.',
      },
      readings: {
        label: 'Mileage',
        description: 'The mileage reading history for the whole fleet, one per row.',
      },
    },
    downloads: {
      label: 'What you get',
      xlsxName: 'Excel',
      xlsxDetail: (sheets) =>
        `All ${sheets} sheets, with typed dates and figures and an autofilter on the header row.`,
      csvName: 'CSV',
      csvDetail: (sheet, rows) => `A CSV is a flat table: it carries only “${sheet}” (${rows} rows).`,
      action: 'Download',
    },
    coverAria: 'Cover figures',
    emptySheet: 'This sheet has no rows.',
  },
}

const dict = { es, en }

/** Copia de la vista HSE en el idioma activo (UX1). */
export function useHseCopy() {
  return dict[useAppLang()]
}
