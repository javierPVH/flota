import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, PageHeader, SelectField } from '@flota/ui/ui'
import { useAppLang } from '@flota/ui/i18n'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import { AlertTriangle, CheckCircle2, Info, RotateCcw, Trash2, X } from 'lucide-react'

import {
  listAll,
  listErrataItems,
  listErratas,
  purgeErrata,
  restoreErrata,
  type CascadeLine,
  type ErrataGroup,
  type ErrataItem,
} from '../api.ts'
import { useAuth } from '../auth.ts'
import { fmtDate } from '../format.ts'
import { useConfirm } from '../components/ConfirmDialog.tsx'
import { TableInfoBar } from '../components/TableInfoBar.tsx'
import { exportCsv } from '../csv.ts'
import { useErratasCopy } from '../translations/erratas.ts'

/** M5: filas por página que se piden al servidor. */
const PAGE_SIZE = 50

/**
 * N7 — Espacio de erratas: inventario de registros desactivados por tipo.
 * La administración restaura; SOLO el superusuario (admin del .env) ve y puede
 * usar "Eliminar definitivamente" (el back lo revalida con IsSuperuser).
 *
 * M5: el índice solo trae recuentos y los registros se piden **tipo a tipo**,
 * paginados y buscados en servidor. Antes la página cargaba de golpe todos los
 * registros desactivados de los veintiún tipos (con un `__str__` por fila que
 * toca relaciones), así que abrir Ajustes recorría el histórico de la flota
 * entera para pintar unas pestañas con un número.
 */
export function ErratasPage({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useErratasCopy()
  const { user } = useAuth()
  const lang = useAppLang()
  const confirm = useConfirm()
  const [groups, setGroups] = useState<ErrataGroup[]>([])
  const [active, setActive] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('') // búsqueda con debounce ya aplicado
  const [items, setItems] = useState<ErrataItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  // M14: la carga en vuelo se aborta al cambiar de tipo, de página o al salir.
  const inFlight = useRef<AbortController | null>(null)

  const loadIndex = useCallback(() => {
    setLoading(true)
    listErratas()
      .then((result) => {
        setGroups(result)
        setActive((current) =>
          result.some((g) => g.type === current) ? current : (result[0]?.type ?? ''),
        )
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(loadIndex, [loadIndex])

  // Debounce del buscador: una petición por pausa de tecleo, no por tecla.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const loadItems = useCallback(() => {
    if (!active) {
      setItems([])
      setTotal(0)
      return
    }
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setItemsLoading(true)
    listErrataItems(
      { type: active, search: query || undefined, page, page_size: PAGE_SIZE },
      { signal: controller.signal },
    )
      .then((result) => {
        setItems(result.results)
        setTotal(result.count)
        setError('')
      })
      .catch((err) => {
        if (isAbortError(err)) return
        setItems([])
        setError(asErrorMessage(err, t.loadError))
      })
      .finally(() => {
        if (!controller.signal.aborted) setItemsLoading(false)
      })
  }, [active, page, query, t])

  useEffect(loadItems, [loadItems])
  useEffect(() => () => inFlight.current?.abort(), [])

  const group = groups.find((g) => g.type === active) ?? null
  const isSuperuser = Boolean(user?.is_superuser)
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const totalRecords = groups.reduce((acc, g) => acc + g.count, 0)
  const typesWithRecords = groups.filter((g) => g.count > 0).length

  /** Tras restaurar o purgar: recuentos e items al día (puede vaciar la página). */
  function reload() {
    loadIndex()
    if (page > 1 && items.length === 1) setPage(page - 1)
    else loadItems()
  }

  function switchType(type: string) {
    setActive(type)
    setPage(1)
    setSearch('')
    setQuery('')
    setNotice('')
  }

  async function handleRestore(item: ErrataItem) {
    if (!group) return
    if (!(await confirm({ message: t.confirmRestore(item.label), tone: 'warning', confirmLabel: t.restore })))
      return
    try {
      await restoreErrata(group.type, item.id)
      setNotice(t.restoreOk(item.label))
      reload()
    } catch (err) {
      setError(asErrorMessage(err, t.restoreError))
    }
  }

  async function handlePurge(item: ErrataItem) {
    if (!group) return
    // A3: primero se pide el informe de impacto (el back no borra sin `confirm`),
    // y lo que arrastra la cascada se enseña en la confirmación. Purgar un
    // usuario se lleva sus asignaciones; un vehículo, su histórico completo.
    let cascade: CascadeLine[] = []
    try {
      const preview = await purgeErrata(group.type, item.id)
      if (preview.purged) {
        setNotice(t.purgeOk(item.label))
        reload()
        return
      }
      cascade = preview.cascade ?? []
    } catch (err) {
      setError(asErrorMessage(err, t.purgeError))
      return
    }
    const detail = cascade.length
      ? `${t.cascadeIntro}\n${cascade.map((l) => `· ${l.count} ${l.label}`).join('\n')}`
      : t.cascadeNone
    if (
      !(await confirm({
        message: `${t.confirmPurge(item.label)}\n\n${detail}`,
        confirmLabel: t.purge,
      }))
    )
      return
    try {
      await purgeErrata(group.type, item.id, true)
      setNotice(t.purgeOk(item.label))
      reload()
    } catch (err) {
      setError(asErrorMessage(err, t.purgeError))
    }
  }

  /**
   * Exportar: la tabla solo tiene la página en curso, así que la exportación
   * pide TODAS las páginas del tipo (con el mismo filtro) antes de generar el
   * CSV. Es una acción explícita del usuario, no una carga de la pantalla.
   */
  async function handleExport() {
    if (!group) return
    setExporting(true)
    try {
      const rows = await listAll(
        listErrataItems({ type: group.type, search: query || undefined, page_size: 500 }),
      )
      exportCsv(`erratas-${group.type}`, columns, rows)
    } catch (err) {
      setError(asErrorMessage(err, t.loadError))
    } finally {
      setExporting(false)
    }
  }

  const columns: Array<TableWithPanelColumn<ErrataItem>> = [
    {
      key: 'label',
      label: t.columns.label,
      getValue: (r) => r.label,
      render: (r) => <strong>{r.label}</strong>,
    },
    {
      key: 'deactivated_at',
      label: t.columns.deactivatedAt,
      isDate: true,
      getValue: (r) => r.deactivated_at ?? '',
      render: (r) => fmtDate(r.deactivated_at, lang),
    },
    { key: 'deactivated_by', label: t.columns.deactivatedBy, getValue: (r) => r.deactivated_by, render: (r) => r.deactivated_by || '—' },
    {
      key: 'reason',
      label: t.columns.reason,
      getValue: (r) => r.reason,
      render: (r) => (r.reason ? <span className="muted">{r.reason}</span> : '—'),
    },
    {
      key: '__actions',
      label: t.columns.actions,
      align: 'right' as const,
      sortable: false,
      render: (item) => (
        <div className="row-actions">
          <Button variant="secondary" size="sm" onClick={() => handleRestore(item)}>
            <RotateCcw size={14} aria-hidden /> {t.restore}
          </Button>
          {isSuperuser && (
            <Button variant="danger" size="sm" onClick={() => handlePurge(item)}>
              <Trash2 size={14} aria-hidden /> {t.purge}
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      {!embedded && <PageHeader title={t.title} subtitle={t.subtitle} />}

      {/* Aviso informativo: qué es el borrado definitivo y qué implica. */}
      <div className="alert-note tone-warning" role="note">
        <AlertTriangle size={18} aria-hidden />
        <div>
          <strong>{t.alertTitle}</strong>
          <p>{t.alertBody}</p>
        </div>
      </div>

      {error && <div role="alert" className="form-error">{error}</div>}
      {notice && (
        <div role="status" className="form-success">
          <CheckCircle2 size={16} aria-hidden /> {notice}
          <button
            type="button"
            className="form-success-close"
            aria-label={t.dismiss}
            onClick={() => setNotice('')}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : groups.length === 0 ? (
        <p className="muted">{t.empty}</p>
      ) : (
        <>
          {/* Selector de tipo (cada línea con su recuento) + panel informativo
              de la tabla elegida: 26 sub-pestañas eran tres filas de ruido. */}
          <div className="errata-picker">
            <div className="filter-field errata-picker-select">
              <label>{t.typeLabel}</label>
              <SelectField
                aria-label={t.typeLabel}
                containerClassName="role-filter"
                required
                enableSearchFilter
                searchInputPlaceholder={t.typeSearchPlaceholder}
                options={groups.map((g) => ({
                  value: g.type,
                  label: `${g.label} (${g.count})`,
                }))}
                value={active}
                onValueChange={switchType}
              />
              <span className="muted errata-summary-line">
                {t.summary(totalRecords, typesWithRecords)}
              </span>
            </div>
            {group && (
              <aside className="errata-info" aria-live="polite">
                <div className="errata-info-head">
                  <Info size={15} aria-hidden />
                  <strong>{group.label}</strong>
                  <span className="settings-subtab-badge">{group.count}</span>
                </div>
                <p>{t.typeInfo[group.type] ?? t.typeInfoFallback}</p>
              </aside>
            )}
          </div>
          {group && (
            <>
              <TableInfoBar
                count={total}
                recordsLabel={t.records}
                searchLabel={t.searchLabel}
                searchPlaceholder={t.searchPlaceholder}
                search={search}
                onSearchChange={setSearch}
                actions={
                  <Button
                    variant="secondary"
                    disabled={total === 0 || exporting}
                    onClick={handleExport}
                  >
                    {exporting ? t.exporting : t.exportCsv}
                  </Button>
                }
              />
              <TableWithPanel<ErrataItem>
                rows={items}
                columns={columns}
                rowKey={(r) => `${group.type}-${r.id}`}
                enableColumnSort
                showControlPanel={false}
                emptyStateLabel={itemsLoading ? t.loading : t.emptyType}
              />
              {/* M5: la paginación es del servidor — la tabla solo tiene esta página. */}
              {pageCount > 1 && (
                <div className="errata-pager">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page <= 1 || itemsLoading}
                    onClick={() => setPage((n) => Math.max(1, n - 1))}
                  >
                    {t.prevPage}
                  </Button>
                  <span className="muted">{t.pageOf(page, pageCount)}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page >= pageCount || itemsLoading}
                    onClick={() => setPage((n) => Math.min(pageCount, n + 1))}
                  >
                    {t.nextPage}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
