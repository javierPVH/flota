import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, PageHeader, TabButton } from '@flota/ui/ui'
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
import { useLang } from '../i18n.tsx'

/**
 * N7 — Espacio de erratas: inventario de registros desactivados por tipo.
 * La administración restaura; SOLO el superusuario (admin del .env) ve y puede
 * usar "Eliminar definitivamente" (el back lo revalida con IsSuperuser).
 */
export function ErratasPage() {
  const { user } = useAuth()
  const { language } = useLang()
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
      .catch((err) => setError(asErrorMessage(err, 'No se pudo cargar el espacio de erratas.')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const group = groups.find((g) => g.type === active) ?? null
  const isSuperuser = Boolean(user?.is_superuser)

  async function handleRestore(item: ErrataItem) {
    if (!group) return
    if (!(await confirm({ message: `¿Restaurar "${item.label}"?`, tone: 'warning', confirmLabel: 'Restaurar' })))
      return
    try {
      await restoreErrata(group.type, item.id)
      setNotice(`Restaurado: ${item.label}`)
      load()
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo restaurar.'))
    }
  }

  async function handlePurge(item: ErrataItem) {
    if (!group) return
    if (
      !(await confirm({
        message: `¿Eliminar DEFINITIVAMENTE "${item.label}"? Esta acción no se puede deshacer y queda auditada.`,
        confirmLabel: 'Eliminar definitivamente',
      }))
    )
      return
    try {
      await purgeErrata(group.type, item.id)
      setNotice(`Eliminado definitivamente: ${item.label}`)
      load()
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo eliminar.'))
    }
  }

  const columns: Array<TableWithPanelColumn<ErrataItem>> = [
    { key: 'label', label: 'Registro', getValue: (r) => r.label },
    {
      key: 'deactivated_at',
      label: 'Desactivado el',
      isDate: true,
      getValue: (r) => r.deactivated_at ?? '',
      render: (r) => fmtDate(r.deactivated_at, language),
    },
    { key: 'deactivated_by', label: 'Por', getValue: (r) => r.deactivated_by, render: (r) => r.deactivated_by || '—' },
    { key: 'reason', label: 'Motivo', getValue: (r) => r.reason, render: (r) => r.reason || '—' },
    {
      key: '__actions',
      label: 'Acciones',
      align: 'right' as const,
      sortable: false,
      render: (item) => (
        <div className="row-actions">
          <Button variant="secondary" size="sm" onClick={() => handleRestore(item)}>
            Restaurar
          </Button>
          {isSuperuser && (
            <Button variant="danger" size="sm" onClick={() => handlePurge(item)}>
              Eliminar definitivamente
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Espacio de erratas"
        subtitle="Registros desactivados: restaurables por la administración; el borrado definitivo es exclusivo del superusuario."
      />

      {error && <div role="alert" className="form-error">{error}</div>}
      {notice && <p role="status" className="muted">{notice}</p>}

      {loading ? (
        <p className="loading-state" role="status">Cargando…</p>
      ) : groups.length === 0 ? (
        <p className="muted">No hay erratas: ningún registro desactivado. ✓</p>
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
            <TableWithPanel<ErrataItem>
              rows={group.items}
              columns={columns}
              rowKey={(r) => `${group.type}-${r.id}`}
              enableColumnSort
              enablePagination
              defaultPageSize={25}
              pageSizeOptions={[25, 50, 100]}
              emptyStateLabel="Sin erratas de este tipo."
            />
          )}
        </>
      )}
    </div>
  )
}
