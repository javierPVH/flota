/**
 * Microcopy (aria-labels, placeholders) de los componentes del design system.
 *
 * Los componentes genéricos necesitan textos ES/EN para accesibilidad. En vez de
 * acoplarlos al bundle de traducciones de cada app (carpeta `traslate/`), la base
 * incluye este diccionario mínimo y reactivo vía `useAppLang()`.
 */
import { useAppLang } from '../i18n/langStore.ts'

const es = {
  button: {
    counterAriaLabel: (count: number) => `Contador: ${count}`,
  },
  tabButton: {
    counterAriaLabel: (count: number) => `Contador: ${count}`,
  },
  actionButtons: {
    editAriaLabel: 'Editar',
    editTitle: 'Editar',
    mergeAriaLabel: 'Fusionar',
    mergeTitle: 'Fusionar',
    deleteAriaLabel: 'Eliminar',
    deleteTitle: 'Eliminar',
  },
  languageToggleButton: {
    ariaLabel: 'Cambiar idioma',
    esLabel: 'ES',
    enLabel: 'EN',
  },
  navigationMenuButton: {
    open: 'Abrir menú',
    close: 'Cerrar menú',
  },
  statusIconButtons: {
    list: 'Lista',
    cloud: 'Nube',
    test: 'Test',
    warning: 'Aviso',
    user: 'Usuario',
    warningBadgeAriaLabel: (count: number) => `Avisos: ${count}`,
  },
  miniToolsButtons: {
    lock: 'Bloquear',
    search: 'Buscar',
    sort: 'Ordenar',
    sortBlocked: 'Orden bloqueado',
    clearLock: 'Quitar bloqueo',
    lockBadgeAriaLabel: (count: number) => `Bloqueados: ${count}`,
  },
  fieldShell: {
    requiredBadge: 'Obligatorio',
    closeWarningAriaLabel: 'Cerrar aviso',
  },
  dateRangeField: {
    startAriaLabel: 'Fecha inicio',
    endAriaLabel: 'Fecha fin',
  },
  dateMiniFilter: {
    startAriaLabel: 'Fecha inicio',
    endAriaLabel: 'Fecha fin',
    last30DaysLabel: 'Últimos 30 días',
  },
  selectField: {
    defaultSelectFlagLabel: '-- Seleccionar --',
    ignoreLabel: '-- Ignorar --',
    createLabel: '+ Crear nuevo',
    defaultValuePrefix: 'Por defecto:',
    searchInputPlaceholder: 'Buscar...',
    showSearchLabel: 'Mostrar búsqueda',
    hideSearchLabel: 'Ocultar búsqueda',
  },
  layout: {
    sectionAriaLabel: 'Sección de contenido',
    footerAriaLabel: 'Pie de página',
    footerSeparator: '|',
    footerContact: 'Contacto',
    footerBrand: '@gs/base',
  },
  tableWithPanel: {
    actionsColumn: 'Acciones',
    createButton: 'Crear',
    optionsToggle: 'Opciones',
    hideOptionsTitle: 'Ocultar opciones',
    showOptionsTitle: 'Mostrar opciones',
    hideOrderColumns: 'Ocultar orden de columnas',
    showAllColumns: 'Mostrar todas las columnas',
    searchPlaceholder: 'Buscar...',
    searchLockTitle: 'Bloquear búsqueda',
    searchClearTitle: 'Limpiar búsqueda',
    periodLabel: 'Periodo',
    dateFrom: 'Desde',
    dateTo: 'Hasta',
    dateSearch: 'Buscar por fecha',
    dateLast30: 'Últimos 30 días',
    clear: 'Limpiar',
    sortMonthsOldToNew: 'Más antiguos primero',
    sortMonthsNewToOld: 'Más recientes primero',
    noRecords: 'No se encontraron registros.',
    noVisibleColumns: 'No hay columnas visibles.',
    monthNoDate: 'Sin fecha',
    monthRecordCount: (count: number) => `${count} registro${count !== 1 ? 's' : ''}`,
    recordsLabel: (visible: number, total: number, from: string, to: string) =>
      `${visible} de ${total} registros (${from} – ${to})`,
    columnMoveUp: 'Subir',
    columnMoveDown: 'Bajar',
    sortAsc: 'Orden ascendente',
    sortDesc: 'Orden descendente',
    sortNone: 'Sin orden',
    rowsPerPage: 'Filas por página',
    paginationSummary: (from: number, to: number, _pageCount: number, filteredCount: number, totalCount: number) =>
      `${from}–${to} de ${filteredCount}${filteredCount !== totalCount ? ` (${totalCount} en total)` : ''}`,
    pageSummary: (current: number, total: number) => `Página ${current} de ${total}`,
    firstPage: 'Primera página',
    previousPage: 'Página anterior',
    nextPage: 'Página siguiente',
    lastPage: 'Última página',
    expandRow: 'Desplegar fila',
    collapseRow: 'Plegar fila',
  },
  modal: {
    close: 'Cerrar',
  },
  catalogEntityCreateForm: {
    submitDefaultLabel: 'Crear',
    closeButton: 'Cerrar',
    createdSuccess: (label: string) => `Creado: ${label}`,
    creatingLabel: 'Creando...',
    reviewError: 'Revisa los campos destacados.',
    createUnknownError: 'Ha ocurrido un error inesperado.',
    createdLabelById: (id: string | number) => `Registro #${id}`,
    genericFieldFallbackLabel: 'Campo',
    requiredField: (label: string) => `${label} es obligatorio.`,
    invalidSelectValue: (label: string) => `${label} tiene un valor no válido.`,
    invalidEmail: 'Dirección de email no válida.',
    invalidUrl: 'URL no válida.',
    invalidNumber: 'Número no válido.',
    invalidDate: 'Fecha no válida.',
  },
}

const en: typeof es = {
  button: {
    counterAriaLabel: (count: number) => `Counter: ${count}`,
  },
  tabButton: {
    counterAriaLabel: (count: number) => `Counter: ${count}`,
  },
  actionButtons: {
    editAriaLabel: 'Edit',
    editTitle: 'Edit',
    mergeAriaLabel: 'Merge',
    mergeTitle: 'Merge',
    deleteAriaLabel: 'Delete',
    deleteTitle: 'Delete',
  },
  languageToggleButton: {
    ariaLabel: 'Change language',
    esLabel: 'ES',
    enLabel: 'EN',
  },
  navigationMenuButton: {
    open: 'Open menu',
    close: 'Close menu',
  },
  statusIconButtons: {
    list: 'List',
    cloud: 'Cloud',
    test: 'Test',
    warning: 'Warning',
    user: 'User',
    warningBadgeAriaLabel: (count: number) => `Warnings: ${count}`,
  },
  miniToolsButtons: {
    lock: 'Lock',
    search: 'Search',
    sort: 'Sort',
    sortBlocked: 'Sort blocked',
    clearLock: 'Clear lock',
    lockBadgeAriaLabel: (count: number) => `Locked: ${count}`,
  },
  fieldShell: {
    requiredBadge: 'Required',
    closeWarningAriaLabel: 'Close warning',
  },
  dateRangeField: {
    startAriaLabel: 'Start date',
    endAriaLabel: 'End date',
  },
  dateMiniFilter: {
    startAriaLabel: 'Start date',
    endAriaLabel: 'End date',
    last30DaysLabel: 'Last 30 days',
  },
  selectField: {
    defaultSelectFlagLabel: '-- Select --',
    ignoreLabel: '-- Ignore --',
    createLabel: '+ Create new',
    defaultValuePrefix: 'Default:',
    searchInputPlaceholder: 'Search...',
    showSearchLabel: 'Show search',
    hideSearchLabel: 'Hide search',
  },
  layout: {
    sectionAriaLabel: 'Content section',
    footerAriaLabel: 'Main footer',
    footerSeparator: '|',
    footerContact: 'Contact',
    footerBrand: '@gs/base',
  },
  tableWithPanel: {
    actionsColumn: 'Actions',
    createButton: 'Create',
    optionsToggle: 'Options',
    hideOptionsTitle: 'Hide options',
    showOptionsTitle: 'Show options',
    hideOrderColumns: 'Hide column order',
    showAllColumns: 'Show all columns',
    searchPlaceholder: 'Search...',
    searchLockTitle: 'Lock search',
    searchClearTitle: 'Clear search',
    periodLabel: 'Period',
    dateFrom: 'From',
    dateTo: 'To',
    dateSearch: 'Search by date',
    dateLast30: 'Last 30 days',
    clear: 'Clear',
    sortMonthsOldToNew: 'Oldest first',
    sortMonthsNewToOld: 'Newest first',
    noRecords: 'No records found.',
    noVisibleColumns: 'No visible columns.',
    monthNoDate: 'No date',
    monthRecordCount: (count: number) => `${count} record${count !== 1 ? 's' : ''}`,
    recordsLabel: (visible: number, total: number, from: string, to: string) =>
      `${visible} of ${total} records (${from} – ${to})`,
    columnMoveUp: 'Move up',
    columnMoveDown: 'Move down',
    sortAsc: 'Sort ascending',
    sortDesc: 'Sort descending',
    sortNone: 'No sort',
    rowsPerPage: 'Rows per page',
    paginationSummary: (from: number, to: number, _pageCount: number, filteredCount: number, totalCount: number) =>
      `${from}–${to} of ${filteredCount}${filteredCount !== totalCount ? ` (${totalCount} total)` : ''}`,
    pageSummary: (current: number, total: number) => `Page ${current} of ${total}`,
    firstPage: 'First page',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    lastPage: 'Last page',
    expandRow: 'Expand row',
    collapseRow: 'Collapse row',
  },
  modal: {
    close: 'Close',
  },
  catalogEntityCreateForm: {
    submitDefaultLabel: 'Create',
    closeButton: 'Close',
    createdSuccess: (label: string) => `Created: ${label}`,
    creatingLabel: 'Creating...',
    reviewError: 'Please review the highlighted fields.',
    createUnknownError: 'An unexpected error occurred.',
    createdLabelById: (id: string | number) => `Record #${id}`,
    genericFieldFallbackLabel: 'Field',
    requiredField: (label: string) => `${label} is required.`,
    invalidSelectValue: (label: string) => `${label} has an invalid value.`,
    invalidEmail: 'Invalid email address.',
    invalidUrl: 'Invalid URL.',
    invalidNumber: 'Invalid number.',
    invalidDate: 'Invalid date.',
  },
}

export type UiCopy = typeof es

export function getUiCopy(lang: 'es' | 'en'): UiCopy {
  return lang === 'en' ? en : es
}

/** Microcopy del idioma activo, reactivo al cambio de idioma. */
export function useUiCopy(): UiCopy {
  return getUiCopy(useAppLang())
}
