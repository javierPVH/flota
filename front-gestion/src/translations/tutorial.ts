/**
 * Copia de la Ayuda (tutorial de administración), es/en.
 *
 * Regla: los rótulos que el usuario tiene que BUSCAR en pantalla (botones,
 * pestañas, títulos) no se escriben aquí: se toman de la copia de su pantalla
 * (`ui.vehicles.exportCsv`, `ui.app.home.title`…). Si un botón se renombra, el
 * tutorial cambia solo; si la clave desaparece, no compila.
 *
 * La estructura (qué capítulos hay, recorridos, rutas) está en
 * `tutorial/chapters.ts`; aquí, solo cómo se cuenta en cada idioma.
 */
import { useAppLang } from '@flota/ui/i18n'

import { useLang } from '../i18n.tsx'
import type { ChapterId, GroupId } from '../tutorial/chapters.ts'
import { useVehiclesCopy } from './vehicles.ts'

/** Copias de la app que cita el tutorial. */
interface Ui {
  app: ReturnType<typeof useLang>['t']
  vehicles: ReturnType<typeof useVehiclesCopy>
}

export interface TutorialSection {
  title: string
  steps: string[]
  note?: string
  /** Captura de la sección (nombre del fichero, sin `.webp`). */
  shot?: string
}

export interface TutorialWalkStep {
  /** Rótulo corto de la pestaña del recorrido. */
  tab: string
  title: string
  steps: string[]
  shot?: string
}

export interface ChapterCopy {
  title: string
  /** Una frase: para qué sirve la pantalla. */
  lead: string
  sections?: TutorialSection[]
  walk?: TutorialWalkStep[]
  /** «¿Qué quieres hacer?»: `step` es la pestaña del recorrido (desde 1). */
  quick?: Array<{ label: string; step: number }>
  /** Texto alternativo de cada captura del capítulo. */
  shots?: Record<string, string>
  faq?: Array<{ q: string; a: string }>
}

export interface TutorialCopy {
  ui: {
    title: string
    subtitle: string
    indexLabel: string
    search: string
    searchPlaceholder: string
    results: (n: number) => string
    noResults: (q: string) => string
    coverTitle: string
    coverText: string
    startHere: string
    chaptersCount: (n: number) => string
    openScreen: string
    quickTitle: string
    walkLabel: string
    stepOf: (i: number, n: number) => string
    back: string
    next: string
    prevChapter: string
    nextChapter: string
    faqTitle: string
    pending: string
    shotPending: string
    zoom: string
  }
  groups: Record<GroupId, string>
  audience: { superuser: string; hse: string }
  chapters: Record<ChapterId, ChapterCopy>
}

const es = ({ app, vehicles: v }: Ui): TutorialCopy => {
  const nav = app.shell.nav
  const home = app.home
  return {
    ui: {
      title: app.shell.nav.help,
      subtitle: 'Cómo se usa la app de gestión, pantalla a pantalla',
      indexLabel: 'Capítulos de la ayuda',
      search: 'Buscar en la ayuda',
      searchPlaceholder: 'Por ejemplo: exportar, sustitución, ITV…',
      results: (n) => (n === 1 ? '1 resultado' : `${n} resultados`),
      noResults: (q) => `Nada coincide con «${q}».`,
      coverTitle: 'Bienvenida a la ayuda',
      coverText:
        'Cada capítulo explica una pantalla o una tarea de la app de gestión. Elige uno en el índice o busca lo que necesitas.',
      startHere: 'Empieza por aquí',
      chaptersCount: (n) => (n === 1 ? '1 capítulo' : `${n} capítulos`),
      openScreen: 'Abrir esta pantalla',
      quickTitle: '¿Qué quieres hacer?',
      walkLabel: 'Recorrido paso a paso',
      stepOf: (i, n) => `Paso ${i} de ${n}`,
      back: 'Atrás',
      next: 'Continuar',
      prevChapter: 'Anterior',
      nextChapter: 'Siguiente',
      faqTitle: 'Dudas frecuentes',
      pending: 'Este capítulo está en preparación: de momento, solo su resumen.',
      shotPending: 'Captura pendiente',
      zoom: 'Ampliar la captura',
    },
    groups: {
      start: 'Primeros pasos',
      fleet: 'La flota',
      events: 'Lo que pasa',
      papers: 'Papeles y personas',
      admin: 'Administración',
      other: 'Otros',
    },
    audience: { superuser: 'Solo superusuario', hse: 'Necesita el rol HSE' },
    chapters: {
      entrar: {
        title: 'Entrar y moverse por la app',
        lead: 'Cómo entrar, qué hay en la cabecera y cómo llegar a cada pantalla sin perder tiempo.',
        sections: [
          {
            title: 'Entrar',
            steps: [
              `En «${app.login.heading}», escribe tu «${app.login.userLabel}» y tu «${app.login.passwordLabel}».`,
              `Pulsa «${app.login.submit}».`,
            ],
            shot: 'login',
          },
          {
            title: 'La cabecera',
            steps: [
              `La campana («${app.shell.notifications}») enseña las últimas alertas e incidencias, en las pestañas «${app.shell.bell.alerts}» y «${app.shell.bell.incidents}».`,
              'La llave con un número sale cuando hay solicitudes sin decidir: te lleva a la primera bandeja con algo pendiente.',
              `El botón «${app.shell.hse.button}» abre la vista HSE. Solo sale si tienes ese rol.`,
            ],
            shot: 'cabecera',
          },
          {
            title: 'El menú',
            steps: [
              `Pulsa «${app.shell.menu}» para ver todas las pantallas, agrupadas en «${app.shell.navGroups.general}», «${app.shell.navGroups.fleet}», «${app.shell.navGroups.tracking}» y «${app.shell.navGroups.admin}».`,
              `Al final del menú puedes cambiar de idioma («${app.shell.language}») y «${app.shell.logout}».`,
            ],
            shot: 'menu',
          },
          {
            title: app.shortcuts.title,
            steps: [
              '«/» te lleva al buscador de la pantalla en la que estás.',
              `«n» abre «${app.shortcuts.newVehicle}».`,
              `«?» abre la lista de atajos.`,
              `Pulsa «g» y luego una letra para saltar a una pantalla: «g v» ${nav.vehicles}, «g a» ${nav.alerts}, «g y» ${nav.help}… La lista completa está en «?».`,
            ],
            note: 'Los atajos no funcionan mientras escribes en un campo.',
            shot: 'atajos',
          },
        ],
        shots: {
          login: 'La pantalla de inicio de sesión',
          cabecera: 'La cabecera con la campana, la llave de solicitudes y el menú',
          menu: 'El menú abierto con sus grupos',
          atajos: 'La lista de atajos de teclado',
        },
      },
      panel: {
        title: home.title,
        lead: 'El resumen de la flota: las cifras, lo que vence pronto y lo que está pendiente.',
        sections: [
          {
            title: 'Las cifras',
            steps: [
              `La cabecera cuenta «${home.statVehicles}», «${home.statAlerts}» e «${home.statIncidents}».`,
              `Debajo hay seis indicadores: «${home.kpiVehicles}», «${home.kpiUse}», «${home.kpiCost}», «${home.kpiItv}», «${home.kpiInsurance}» y «${home.kpiMaintenance}».`,
              'Pulsa cualquiera para abrir su ventana con el detalle y las acciones de cada coche.',
            ],
            shot: 'panel-indicadores',
          },
          {
            title: 'Lo pendiente',
            steps: [
              `«${home.alertsTitle}» e «${home.incidentsTitle}» reúnen lo que hay que atender.`,
              'Las chapas de cada tira filtran por tipo.',
              'Pulsa una tira para abrir la lista completa y resolver desde ahí.',
            ],
            shot: 'panel-pendientes',
          },
          {
            title: 'Buscar en la flota',
            steps: [
              `Las pestañas «${home.tabs.fleet}», «${home.tabs.substitute}», «${home.tabs.supervisors}» y «${home.tabs.drivers}» cambian lo que enseña la tabla.`,
              `Abre «${home.toolsToggle}» para buscar, filtrar y «${home.exportCsv}».`,
            ],
            shot: 'panel',
          },
          {
            title: 'Altas rápidas',
            steps: [
              `«${home.addVehicle}» y «${home.addDriver}» te llevan a su pantalla.`,
              `Antes te avisan («${home.addConfirmTitle}»): pulsa «${home.addConfirmGo}» para seguir.`,
            ],
          },
        ],
        shots: {
          'panel-indicadores': 'Los seis indicadores de la vista general',
          'panel-pendientes': 'Las tiras de alertas e incidencias pendientes',
          panel: 'La tabla de la vista general con sus pestañas',
        },
      },
      vehiculos: {
        title: v.title,
        lead: 'El inventario de la flota: encontrar un coche, sacar listados y actuar sobre él sin abrir su ficha.',
        quick: [
          { label: 'Encontrar un coche', step: 1 },
          { label: 'Ver lo que está a punto de vencer', step: 2 },
          { label: 'Sacar un listado', step: 3 },
          { label: 'Hacer algo con un coche', step: 4 },
        ],
        walk: [
          {
            tab: 'Buscar',
            title: 'Encontrar un coche',
            steps: [
              `Elige «${v.tabFleet}» o «${v.tabSubstitute}». El número de cada pestaña es cuántos hay.`,
              `Abre «${v.toolsToggle}» y escribe en «${v.lblSearch}» la matrícula, la marca o el modelo.`,
              `Para afinar, usa «${v.lblState}», «${v.lblSupervisor}», «${v.lblDriver}» o «${v.lblCreated}».`,
              `Con «${v.stateHasSubstitute}» ves los coches que ahora mismo tienen uno de sustitución.`,
            ],
            shot: 'vehiculos-filtros',
          },
          {
            tab: 'Vencimientos',
            title: 'Ver lo que está a punto de vencer',
            steps: [
              `Marca uno o varios cortes: «${v.dueItv}», «${v.dueInsurance}», «${v.dueMaint}» o «${v.kmOver}».`,
              'Si marcas varios, salen los coches que cumplen cualquiera de ellos.',
              `«${v.clearFilters}» lo deja todo como al entrar.`,
            ],
            shot: 'vehiculos-cortes',
          },
          {
            tab: 'Listados',
            title: 'Sacar un listado',
            steps: [
              'Deja en la tabla solo lo que quieras: filtros, cortes y columnas.',
              `Pulsa «${v.exportCsv}». Se exporta lo que estás viendo, no toda la flota.`,
            ],
            shot: 'vehiculos',
          },
          {
            tab: 'Acciones',
            title: 'Hacer algo con un coche',
            steps: [
              'Pulsa los tres puntos ⋮ al final de su fila.',
              'Desde ahí: correo, conductor, facturas, kilómetros, estado, accidente, ITV y mantenimiento, editar o dar de baja.',
              `«${v.deactivate}» no borra el coche: conserva su histórico, sus facturas y sus documentos, y se puede reactivar en Ajustes.`,
            ],
            shot: 'vehiculos-menu',
          },
        ],
        shots: {
          vehiculos: 'La lista de vehículos con sus dos pestañas',
          'vehiculos-filtros': 'El panel de búsqueda y filtros abierto',
          'vehiculos-cortes': 'Los cortes de vencimientos marcados',
          'vehiculos-menu': 'El menú de acciones de un coche',
        },
        faq: [
          {
            q: '¿Por qué no encuentro un coche que he dado de baja?',
            a: `Las bajas no salen por defecto: marca «${v.showBajas}».`,
          },
        ],
      },
      ficha: {
        title: 'La ficha del vehículo',
        lead: 'Todo sobre un coche en una página: indicadores, contrato, facturas, documentos y su histórico de cambios.',
      },
      alta: {
        title: 'Alta y edición de un vehículo',
        lead: 'Dar de alta un coche de flota o de sustitución, y cambiar sus datos con el candado de los datos sensibles.',
      },
      importar: {
        title: 'Importar en bloque',
        lead: 'Dar de alta o actualizar muchos vehículos o personas de una vez, desde un Excel o un CSV.',
      },
      estado: {
        title: 'Cambiar el estado y el coche de sustitución',
        lead: 'Parar un coche por avería, mantenimiento o neumáticos, y darle un coche de sustitución mientras tanto.',
      },
      'itv-mantenimiento': {
        title: 'Programar ITV y mantenimiento',
        lead: 'La cita de la ITV y el programa de mantenimiento de cada coche.',
      },
      kilometraje: {
        title: nav.mileage,
        lead: 'Las lecturas de kilómetros, las que faltan este mes y la proyección a fin de contrato o de año.',
      },
      incidencias: {
        title: nav.incidents,
        lead: 'Averías, mantenimientos puntuales y peticiones de la flota.',
      },
      resolver: {
        title: 'Resolver alertas e incidencias',
        lead: 'Un solo botón «Resolver» abre el formulario que toca para cada alerta o incidencia.',
      },
      accidentes: {
        title: nav.accidents,
        lead: 'Comunicar un accidente con el parte guiado y seguirlo hasta cerrarlo.',
      },
      alertas: {
        title: nav.alerts,
        lead: 'Los vencimientos y avisos de la flota: agruparlos, ordenarlos y resolverlos.',
      },
      solicitudes: {
        title: nav.requests,
        lead: 'Lo que piden conductores y supervisores, en seis bandejas, para concederlo o rechazarlo.',
      },
      documentos: {
        title: nav.documents,
        lead: 'Quién puede leer cada tipo de documento, y el listado de los papeles de la flota y de las personas.',
      },
      usuarios: {
        title: nav.drivers,
        lead: 'Las personas de la app: sus roles, los coches que han tenido y sus documentos personales.',
      },
      correo: {
        title: 'Enviar correo',
        lead: 'El asistente para mandar un correo sobre un coche: tipo, contenido, destinatarios y vista previa.',
      },
      informes: {
        title: 'Informes y facturas',
        lead: 'Descargar los datos de vehículos y personas, y llevar las facturas.',
      },
      ajustes: {
        title: nav.settings,
        lead: 'Los catálogos, el borrado definitivo y las plantillas de correo.',
      },
      hse: {
        title: 'Vista HSE',
        lead: 'La vista de solo lectura para prevención: los coches, sus lecturas y su informe.',
      },
      preguntas: {
        title: 'Preguntas frecuentes',
        lead: 'Las dudas que llegan con más frecuencia.',
      },
    },
  }
}

const en = ({ app, vehicles: v }: Ui): TutorialCopy => {
  const nav = app.shell.nav
  const home = app.home
  return {
    ui: {
      title: app.shell.nav.help,
      subtitle: 'How to use the management app, screen by screen',
      indexLabel: 'Help chapters',
      search: 'Search the help',
      searchPlaceholder: 'For example: export, replacement, inspection…',
      results: (n) => (n === 1 ? '1 result' : `${n} results`),
      noResults: (q) => `Nothing matches “${q}”.`,
      coverTitle: 'Welcome to the help',
      coverText:
        'Each chapter explains one screen or one task of the management app. Pick one from the index or search for what you need.',
      startHere: 'Start here',
      chaptersCount: (n) => (n === 1 ? '1 chapter' : `${n} chapters`),
      openScreen: 'Open this screen',
      quickTitle: 'What do you want to do?',
      walkLabel: 'Step-by-step walkthrough',
      stepOf: (i, n) => `Step ${i} of ${n}`,
      back: 'Back',
      next: 'Continue',
      prevChapter: 'Previous',
      nextChapter: 'Next',
      faqTitle: 'Frequent questions',
      pending: 'This chapter is being written: for now, only its summary.',
      shotPending: 'Screenshot pending',
      zoom: 'Enlarge the screenshot',
    },
    groups: {
      start: 'First steps',
      fleet: 'The fleet',
      events: 'What happens',
      papers: 'Papers and people',
      admin: 'Administration',
      other: 'Other',
    },
    audience: { superuser: 'Superuser only', hse: 'Requires the HSE role' },
    chapters: {
      entrar: {
        title: 'Signing in and finding your way',
        lead: 'How to sign in, what the header holds and how to reach each screen quickly.',
        sections: [
          {
            title: 'Signing in',
            steps: [
              `On “${app.login.heading}”, type your “${app.login.userLabel}” and your “${app.login.passwordLabel}”.`,
              `Press “${app.login.submit}”.`,
            ],
            shot: 'login',
          },
          {
            title: 'The header',
            steps: [
              `The bell (“${app.shell.notifications}”) shows the latest alerts and incidents, in the “${app.shell.bell.alerts}” and “${app.shell.bell.incidents}” tabs.`,
              'The key with a number appears when there are requests waiting for a decision: it takes you to the first tray with something pending.',
              `The “${app.shell.hse.button}” button opens the HSE view. It only appears if you have that role.`,
            ],
            shot: 'cabecera',
          },
          {
            title: 'The menu',
            steps: [
              `Press “${app.shell.menu}” to see every screen, grouped into “${app.shell.navGroups.general}”, “${app.shell.navGroups.fleet}”, “${app.shell.navGroups.tracking}” and “${app.shell.navGroups.admin}”.`,
              `At the bottom of the menu you can change the language (“${app.shell.language}”) and “${app.shell.logout}”.`,
            ],
            shot: 'menu',
          },
          {
            title: app.shortcuts.title,
            steps: [
              '“/” takes you to the search box of the screen you are on.',
              `“n” opens “${app.shortcuts.newVehicle}”.`,
              '“?” opens the shortcut list.',
              `Press “g” and then a letter to jump to a screen: “g v” ${nav.vehicles}, “g a” ${nav.alerts}, “g y” ${nav.help}… The full list is under “?”.`,
            ],
            note: 'Shortcuts do not work while you are typing in a field.',
            shot: 'atajos',
          },
        ],
        shots: {
          login: 'The sign-in screen',
          cabecera: 'The header with the bell, the requests key and the menu',
          menu: 'The open menu with its groups',
          atajos: 'The keyboard shortcut list',
        },
      },
      panel: {
        title: home.title,
        lead: 'The fleet at a glance: the figures, what is about to expire and what is pending.',
        sections: [
          {
            title: 'The figures',
            steps: [
              `The header counts “${home.statVehicles}”, “${home.statAlerts}” and “${home.statIncidents}”.`,
              `Below there are six indicators: “${home.kpiVehicles}”, “${home.kpiUse}”, “${home.kpiCost}”, “${home.kpiItv}”, “${home.kpiInsurance}” and “${home.kpiMaintenance}”.`,
              'Press any of them to open its window with the details and the actions for each car.',
            ],
            shot: 'panel-indicadores',
          },
          {
            title: 'What is pending',
            steps: [
              `“${home.alertsTitle}” and “${home.incidentsTitle}” gather what needs attention.`,
              'The chips on each strip filter by type.',
              'Press a strip to open the full list and resolve from there.',
            ],
            shot: 'panel-pendientes',
          },
          {
            title: 'Searching the fleet',
            steps: [
              `The “${home.tabs.fleet}”, “${home.tabs.substitute}”, “${home.tabs.supervisors}” and “${home.tabs.drivers}” tabs change what the table shows.`,
              `Open “${home.toolsToggle}” to search, filter and “${home.exportCsv}”.`,
            ],
            shot: 'panel',
          },
          {
            title: 'Quick additions',
            steps: [
              `“${home.addVehicle}” and “${home.addDriver}” take you to their screen.`,
              `You are warned first (“${home.addConfirmTitle}”): press “${home.addConfirmGo}” to go on.`,
            ],
          },
        ],
        shots: {
          'panel-indicadores': 'The six indicators of the overview',
          'panel-pendientes': 'The strips of pending alerts and incidents',
          panel: 'The overview table with its tabs',
        },
      },
      vehiculos: {
        title: v.title,
        lead: 'The fleet inventory: find a car, export lists and act on it without opening its page.',
        quick: [
          { label: 'Find a car', step: 1 },
          { label: 'See what is about to expire', step: 2 },
          { label: 'Export a list', step: 3 },
          { label: 'Do something with a car', step: 4 },
        ],
        walk: [
          {
            tab: 'Search',
            title: 'Find a car',
            steps: [
              `Choose “${v.tabFleet}” or “${v.tabSubstitute}”. The number on each tab is how many there are.`,
              `Open “${v.toolsToggle}” and type the plate, make or model in “${v.lblSearch}”.`,
              `To narrow it down, use “${v.lblState}”, “${v.lblSupervisor}”, “${v.lblDriver}” or “${v.lblCreated}”.`,
              `“${v.stateHasSubstitute}” shows the cars that currently have a replacement.`,
            ],
            shot: 'vehiculos-filtros',
          },
          {
            tab: 'Due dates',
            title: 'See what is about to expire',
            steps: [
              `Tick one or more cuts: “${v.dueItv}”, “${v.dueInsurance}”, “${v.dueMaint}” or “${v.kmOver}”.`,
              'If you tick several, you get the cars that match any of them.',
              `“${v.clearFilters}” puts everything back as it was.`,
            ],
            shot: 'vehiculos-cortes',
          },
          {
            tab: 'Lists',
            title: 'Export a list',
            steps: [
              'Leave in the table only what you want: filters, cuts and columns.',
              `Press “${v.exportCsv}”. What you see is exported, not the whole fleet.`,
            ],
            shot: 'vehiculos',
          },
          {
            tab: 'Actions',
            title: 'Do something with a car',
            steps: [
              'Press the three dots ⋮ at the end of its row.',
              'From there: email, driver, invoices, mileage, status, accident, inspection and maintenance, edit or retire.',
              `“${v.deactivate}” does not delete the car: it keeps its history, invoices and documents, and it can be reactivated in Settings.`,
            ],
            shot: 'vehiculos-menu',
          },
        ],
        shots: {
          vehiculos: 'The vehicle list with its two tabs',
          'vehiculos-filtros': 'The search and filter panel, open',
          'vehiculos-cortes': 'The due-date cuts, ticked',
          'vehiculos-menu': 'The actions menu of a car',
        },
        faq: [
          {
            q: 'Why can’t I find a car I retired?',
            a: `Retired cars are hidden by default: tick “${v.showBajas}”.`,
          },
        ],
      },
      ficha: {
        title: 'The vehicle page',
        lead: 'Everything about a car on one page: indicators, contract, invoices, documents and its change history.',
      },
      alta: {
        title: 'Adding and editing a vehicle',
        lead: 'Add a fleet or replacement car, and change its data with the lock on sensitive fields.',
      },
      importar: {
        title: 'Bulk import',
        lead: 'Add or update many vehicles or people at once, from an Excel or CSV file.',
      },
      estado: {
        title: 'Changing the status and the replacement car',
        lead: 'Take a car off the road for a breakdown, maintenance or tyres, and give it a replacement meanwhile.',
      },
      'itv-mantenimiento': {
        title: 'Scheduling inspections and maintenance',
        lead: 'The inspection appointment and the maintenance programme of each car.',
      },
      kilometraje: {
        title: nav.mileage,
        lead: 'Mileage readings, the ones missing this month and the projection to the end of the contract or year.',
      },
      incidencias: {
        title: nav.incidents,
        lead: 'Breakdowns, one-off maintenance and requests across the fleet.',
      },
      resolver: {
        title: 'Resolving alerts and incidents',
        lead: 'A single “Resolve” button opens the right form for each alert or incident.',
      },
      accidentes: {
        title: nav.accidents,
        lead: 'Report an accident with the guided form and follow it until it is closed.',
      },
      alertas: {
        title: nav.alerts,
        lead: 'The fleet due dates and warnings: group them, sort them and resolve them.',
      },
      solicitudes: {
        title: nav.requests,
        lead: 'What drivers and supervisors ask for, in six trays, to grant or reject it.',
      },
      documentos: {
        title: nav.documents,
        lead: 'Who can read each document type, and the list of fleet and personal papers.',
      },
      usuarios: {
        title: nav.drivers,
        lead: 'The people in the app: their roles, the cars they have had and their personal documents.',
      },
      correo: {
        title: 'Sending email',
        lead: 'The wizard to send an email about a car: type, content, recipients and preview.',
      },
      informes: {
        title: 'Reports and invoices',
        lead: 'Download vehicle and people data, and keep track of invoices.',
      },
      ajustes: {
        title: nav.settings,
        lead: 'Catalogs, permanent deletion and email templates.',
      },
      hse: {
        title: 'HSE view',
        lead: 'The read-only view for health and safety: the cars, their readings and their report.',
      },
      preguntas: {
        title: 'Frequent questions',
        lead: 'The questions that come up most often.',
      },
    },
  }
}

const dict = { es, en }

/** Copia de la Ayuda en el idioma activo. Llama a las copias de las pantallas
 * que cita (siempre todas y en el mismo orden: son hooks). */
export function useTutorialCopy(): TutorialCopy {
  const lang = useAppLang()
  const { t } = useLang()
  const vehicles = useVehiclesCopy()
  return dict[lang]({ app: t, vehicles })
}
