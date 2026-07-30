import { useAppLang } from '@flota/ui/i18n'

const es = {
  title: 'Espacio de erratas',
  subtitle:
    'Registros desactivados: restaurables por la administración; el borrado definitivo es exclusivo del superusuario.',
  loading: 'Cargando…',
  empty: 'No hay erratas: ningún registro desactivado. ✓',
  emptyType: 'Sin erratas de este tipo.',
  loadError: 'No se pudo cargar el espacio de erratas.',
  restoreError: 'No se pudo restaurar.',
  purgeError: 'No se pudo eliminar.',
  confirmRestore: (label: string) => `¿Restaurar "${label}"?`,
  restoreOk: (label: string) => `Restaurado: ${label}`,
  confirmPurge: (label: string) =>
    `¿Eliminar DEFINITIVAMENTE "${label}"? Esta acción no se puede deshacer y queda auditada.`,
  purgeOk: (label: string) => `Eliminado definitivamente: ${label}`,
  restore: 'Restaurar',
  purge: 'Eliminar definitivamente',
  exportCsv: 'Exportar CSV',
  columns: {
    label: 'Registro',
    deactivatedAt: 'Desactivado el',
    deactivatedBy: 'Por',
    reason: 'Motivo',
    actions: 'Acciones',
  },
}

const en: typeof es = {
  title: 'Errata space',
  subtitle:
    'Deactivated records: admins can restore them; permanent deletion is superuser-only.',
  loading: 'Loading…',
  empty: 'No errata: no deactivated records. ✓',
  emptyType: 'No errata of this type.',
  loadError: 'Could not load the errata space.',
  restoreError: 'Could not restore.',
  purgeError: 'Could not delete.',
  confirmRestore: (label) => `Restore "${label}"?`,
  restoreOk: (label) => `Restored: ${label}`,
  confirmPurge: (label) =>
    `PERMANENTLY delete "${label}"? This action cannot be undone and is audited.`,
  purgeOk: (label) => `Permanently deleted: ${label}`,
  restore: 'Restore',
  purge: 'Delete permanently',
  exportCsv: 'Export CSV',
  columns: {
    label: 'Record',
    deactivatedAt: 'Deactivated on',
    deactivatedBy: 'By',
    reason: 'Reason',
    actions: 'Actions',
  },
}

const dict = { es, en }

/** Copia de la página en el idioma activo (UX1). */
export function useErratasCopy() {
  return dict[useAppLang()]
}
