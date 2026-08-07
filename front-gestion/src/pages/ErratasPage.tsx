import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, PageHeader } from '@flota/ui/ui'
import { useAppLang } from '@flota/ui/i18n'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { AlertTriangle } from 'lucide-react'

import {
  listErratas,
  purgeErrata,
  restoreErrata,
  type ErrataGroup,
  type ErrataItem,
} from '../api.ts'
import { useAuth } from '../auth.ts'
import { fmtDate } from '../format.ts'
import { useConfirm } from '../components/ConfirmDialog.tsx'
import { SettingsSubtabs } from '../components/SettingsSubtabs.tsx'
import { TableInfoBar } from '../components/TableInfoBar.tsx'
import { exportCsv } from '../csv.ts'
import { useErratasCopy } from '../translations/erratas.ts'

/**
 * N7 — Espacio de erratas: inventario de registros desactivados por tipo.
 * La administración restaura; SOLO el superusuario (admin del .env) ve y puede
 * usar "Eliminar definitivamente" (el back lo revalida con IsSuperuser).
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

  const load = useCallback(() => {
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

  useEffect(load, [load])

  const group = groups.find((g) => g.type === active) ?? null
  const isSuperuser = Boolean(user?.is_superuser)

  // Búsqueda en cliente sobre los registros del grupo activo (franja de opciones).
  const visibleItems = useMemo(() => {
    const items = group?.items ?? []
    const term = search.trim().toLowerCase()
    if (!term) return items
    return items.filter((item) =>
      `${item.label} ${item.reason} ${item.deactivated_by}`.toLowerCase().includes(term),
    )
  }, [group, search])

  async function handleRestore(item: ErrataItem) {
    if (!group) return
    if (!(await confirm({ message: t.confirmRestore(item.label), tone: 'warning', confirmLabel: t.restore })))
      return
    try {
      await restoreErrata(group.type, item.id)
      setNotice(t.restoreOk(item.label))
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.restoreError))
    }
  }

  async function handlePurge(item: ErrataItem) {
    if (!group) return
    if (
      !(await confirm({
        message: t.confirmPurge(item.label),
        confirmLabel: t.purge,
      }))
    )
      return
    try {
      await purgeErrata(group.type, item.id)
      setNotice(t.purgeOk(item.label))
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.purgeError))
    }
  }

  const columns: Array<TableWithPanelColumn<ErrataItem>> = [
    { key: 'label', label: t.columns.label, getValue: (r) => r.label },
    {
      key: 'deactivated_at',
      label: t.columns.deactivatedAt,
      isDate: true,
      getValue: (r) => r.deactivated_at ?? '',
      render: (r) => fmtDate(r.deactivated_at, lang),
    },
    { key: 'deactivated_by', label: t.columns.deactivatedBy, getValue: (r) => r.deactivated_by, render: (r) => r.deactivated_by || '—' },
    { key: 'reason', label: t.columns.reason, getValue: (r) => r.reason, render: (r) => r.reason || '—' },
    {
      key: '__actions',
      label: t.columns.actions,
      align: 'right' as const,
      sortable: false,
      render: (item) => (
        <div className="row-actions">
          <Button variant="secondary" size="sm" onClick={() => handleRestore(item)}>
            {t.restore}
          </Button>
          {isSuperuser && (
            <Button variant="danger" size="sm" onClick={() => handlePurge(item)}>
              {t.purge}
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
      {notice && <p role="status" className="muted">{notice}</p>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : groups.length === 0 ? (
        <p className="muted">{t.empty}</p>
      ) : (
        <>
          <SettingsSubtabs
            ariaLabel={t.title}
            items={groups.map((g) => ({ key: g.type, label: g.label, badge: g.count }))}
            active={active}
            onChange={setActive}
          />
          {group && (
            <>
              <TableInfoBar
                count={visibleItems.length}
                recordsLabel={t.records}
                searchLabel={t.searchLabel}
                searchPlaceholder={t.searchPlaceholder}
                search={search}
                onSearchChange={setSearch}
                actions={
                  <Button
                    variant="secondary"
                    disabled={visibleItems.length === 0}
                    onClick={() => exportCsv(`erratas-${group.type}`, columns, visibleItems)}
                  >
                    {t.exportCsv}
                  </Button>
                }
              />
              <TableWithPanel<ErrataItem>
                rows={visibleItems}
                columns={columns}
                rowKey={(r) => `${group.type}-${r.id}`}
                enableColumnSort
                showControlPanel={false}
                enablePagination
                defaultPageSize={25}
                pageSizeOptions={[25, 50, 100]}
                emptyStateLabel={t.emptyType}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
