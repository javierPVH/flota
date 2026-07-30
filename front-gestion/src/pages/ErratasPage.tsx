import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, PageHeader, TabButton } from '@flota/ui/ui'
import { useAppLang } from '@flota/ui/i18n'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'

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
import { exportCsv } from '../csv.ts'
import { useErratasCopy } from '../translations/erratas.ts'

/**
 * N7 — Espacio de erratas: inventario de registros desactivados por tipo.
 * La administración restaura; SOLO el superusuario (admin del .env) ve y puede
 * usar "Eliminar definitivamente" (el back lo revalida con IsSuperuser).
 */
export function ErratasPage() {
  const t = useErratasCopy()
  const { user } = useAuth()
  const lang = useAppLang()
  const confirm = useConfirm()
  const [groups, setGroups] = useState<ErrataGroup[]>([])
  const [active, setActive] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
      <PageHeader title={t.title} subtitle={t.subtitle} />

      {error && <div role="alert" className="form-error">{error}</div>}
      {notice && <p role="status" className="muted">{notice}</p>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : groups.length === 0 ? (
        <p className="muted">{t.empty}</p>
      ) : (
        <>
          <div className="chips-row catalog-tabs">
            {groups.map((g) => (
              <TabButton key={g.type} active={active === g.type} onClick={() => setActive(g.type)}>
                {g.label} <Badge tone="neutral">{g.count}</Badge>
              </TabButton>
            ))}
          </div>
          {group && (
            <div className="list-tools">
              <Button
                variant="secondary"
                disabled={group.items.length === 0}
                onClick={() => exportCsv(`erratas-${group.type}`, columns, group.items)}
              >
                {t.exportCsv}
              </Button>
            </div>
          )}
          {group && (
            <TableWithPanel<ErrataItem>
              rows={group.items}
              columns={columns}
              rowKey={(r) => `${group.type}-${r.id}`}
              enableColumnSort
              enablePagination
              defaultPageSize={25}
              pageSizeOptions={[25, 50, 100]}
              emptyStateLabel={t.emptyType}
            />
          )}
        </>
      )}
    </div>
  )
}
