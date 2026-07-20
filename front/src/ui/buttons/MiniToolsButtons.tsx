/**
 * [ES] Control compacto de herramientas que combina bloqueo, busqueda, borrado y ordenacion.
 * [EN] Compact tools control combining lock, search, delete and sort actions.
 * Supports coordination across instances through lock and sort scopes.
 */
import { useEffect, useId, useRef, useState, type HTMLAttributes } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Lock, Search, Trash2 } from 'lucide-react'
import { IconButton } from './IconButton'
import type { IconButtonSize } from './IconButton'
import styles from '../../styles/_components/buttons/mini-tools-buttons.module.sass'
import { cx } from '../../utils/cx.ts'
import { useUiCopy } from '../copy.ts'

export type MiniSortState = 'neutral' | 'desc' | 'asc'

type LockRegistryEntry = {
  relatedGroup?: string
  progressionEnabled: boolean
  hasDeleteButton: boolean
  lockDeleteOnly: boolean
  order: number
}

const lockRegistry = new Map<string, LockRegistryEntry>()
const lockListeners = new Set<() => void>()
let lockOrderCounter = 0
const sortListeners = new Set<(event: { sourceId: string; scope: string }) => void>()

function notifyLockListeners() {
  for (const listener of lockListeners) {
    listener()
  }
}

function subscribeLockRegistry(listener: () => void) {
  lockListeners.add(listener)
  return () => {
    lockListeners.delete(listener)
  }
}

function setLockEntry(id: string, entry: LockRegistryEntry) {
  lockRegistry.set(id, entry)
  notifyLockListeners()
}

function removeLockEntry(id: string) {
  lockRegistry.delete(id)
  notifyLockListeners()
}

function subscribeSortScope(
  listener: (event: { sourceId: string; scope: string }) => void,
) {
  sortListeners.add(listener)
  return () => {
    sortListeners.delete(listener)
  }
}

function notifySortScope(event: { sourceId: string; scope: string }) {
  for (const listener of sortListeners) {
    listener(event)
  }
}

function getBadgeValue(id: string): number | null {
  const self = lockRegistry.get(id)
  if (!self) {
    return null
  }

  if (self.relatedGroup) {
    const related = [...lockRegistry.entries()]
      .filter(
        ([, value]) => value.relatedGroup === self.relatedGroup,
      )
      .sort((a, b) => a[1].order - b[1].order)
      .map(([entryId]) => entryId)

    const index = related.indexOf(id)
    return index >= 0 ? index + 1 : 1
  }

  if (self.progressionEnabled && self.hasDeleteButton && self.lockDeleteOnly) {
    const allActive = [...lockRegistry.entries()]
      .filter(
        ([, value]) =>
          value.progressionEnabled &&
          value.hasDeleteButton &&
          value.lockDeleteOnly,
      )
      .sort((a, b) => a[1].order - b[1].order)
      .map(([entryId]) => entryId)

    const index = allActive.indexOf(id)
    return index >= 0 ? index + 1 : 1
  }

  return 1
}

export interface MiniToolsButtonsProps extends HTMLAttributes<HTMLDivElement> {
  size?: IconButtonSize
  showLock?: boolean
  showSearch?: boolean
  showSort?: boolean
  showDelete?: boolean
  /**
   * [ES] Si es true, al bloquear se deshabilita la flecha de orden.
   * [EN] If true, locking disables the sort arrow button.
   */
  lockSortWhenLocked?: boolean
  /**
   * [ES] Direccion de orden aplicada al bloquear cuando la flecha estaba neutral.
   * [EN] Sort direction applied when locking from neutral state.
   */
  sortStateOnLock?: Exclude<MiniSortState, 'neutral'>
  /**
   * [ES] Si se informa, los botones de orden del mismo scope se comportan como excluyentes.
   * [EN] If provided, sort buttons in the same scope behave as mutually exclusive.
   */
  sortScope?: string
  /**
   * [ES] Id opcional de bloqueo para coordinar contadores entre instancias.
   * [EN] Optional lock id to coordinate counters between instances.
   */
  lockId?: string
  /**
   * [ES] Si se informa, los bloqueos del mismo grupo comparten progresion de badge.
   * [EN] If provided, locks with the same group increase badge order together.
   */
  relatedGroup?: string
  /**
   * [ES] Si es true y el bloqueo no esta relacionado, el badge sigue progresion global.
   * [EN] If true and lock is not related, badge follows global progression order.
   */
  progressionEnabled?: boolean
  onLockChange?: (locked: boolean, badge: number | null) => void
  onSearch?: () => void
  onSort?: () => void
  onSortChange?: (state: MiniSortState) => void
  onDelete?: () => void
}



export function MiniToolsButtons({
  size = 'xs',
  showLock,
  showSearch = false,
  showSort = true,
  showDelete = false,
  lockSortWhenLocked = false,
  sortStateOnLock = 'asc',
  lockId,
  relatedGroup,
  sortScope,
  progressionEnabled = false,
  onLockChange,
  onSearch,
  onSort,
  onSortChange,
  onDelete,
  className,
  ...props
}: MiniToolsButtonsProps) {
  const copy = useUiCopy()
  const [isLocked, setIsLocked] = useState(false)
  const [lockProgressValue, setLockProgressValue] = useState(0)
  const [sortState, setSortState] = useState<MiniSortState>('neutral')
  const [, rerenderTick] = useState(0)
  const lockOrderRef = useRef<number | null>(null)

  const generatedLockId = useId()
  const resolvedLockId = lockId ?? `mini-lock-${generatedLockId}`
  const resolvedSortScope = sortScope ?? relatedGroup

  const showLockResolved = showLock ?? true
  const lockDeleteOnly = showLockResolved && showDelete && !showSort
  const lockDeleteProgressMode = progressionEnabled && lockDeleteOnly
  const isSortBlocked = showSort && lockSortWhenLocked && isLocked

  useEffect(() => {
    const unsubscribe = subscribeLockRegistry(() => {
      rerenderTick((current) => current + 1)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!resolvedSortScope) {
      return
    }

    const unsubscribe = subscribeSortScope(({ sourceId, scope }) => {
      if (scope !== resolvedSortScope || sourceId === resolvedLockId || isLocked) {
        return
      }

      setSortState((current) => {
        if (current === 'neutral') {
          return current
        }
        onSortChange?.('neutral')
        return 'neutral'
      })
    })

    return unsubscribe
  }, [resolvedSortScope, resolvedLockId, isLocked, onSortChange])

  useEffect(() => {
    return () => {
      removeLockEntry(resolvedLockId)
    }
  }, [resolvedLockId])

  useEffect(() => {
    if (!isLocked || lockOrderRef.current === null) {
      return
    }

    const current = lockRegistry.get(resolvedLockId)
    if (
      current &&
      current.relatedGroup === relatedGroup &&
      current.progressionEnabled === progressionEnabled &&
      current.hasDeleteButton === showDelete &&
      current.lockDeleteOnly === lockDeleteOnly &&
      current.order === lockOrderRef.current
    ) {
      return
    }

    setLockEntry(resolvedLockId, {
      relatedGroup,
      progressionEnabled,
      hasDeleteButton: showDelete,
      lockDeleteOnly,
      order: lockOrderRef.current,
    })
  }, [resolvedLockId, isLocked, relatedGroup, progressionEnabled, showDelete, lockDeleteOnly])

  const iconSizeClass: Record<IconButtonSize, string> = {
    xs: styles.iconXs,
    sm: styles.iconSm,
    md: styles.iconMd,
  }

  const buttonSizeClass: Record<IconButtonSize, string> = {
    xs: styles.toolXs,
    sm: styles.toolSm,
    md: styles.toolMd,
  }

  const badgeValue = isLocked
    ? lockDeleteProgressMode
      ? Math.max(lockProgressValue, 1)
      : getBadgeValue(resolvedLockId) ?? 1
    : null

  useEffect(() => {
    onLockChange?.(isLocked, badgeValue)
  }, [isLocked, badgeValue, onLockChange])

  useEffect(() => {
    if (!isLocked || !showSort) {
      return
    }

    setSortState((current) => {
      if (current !== 'neutral') {
        return current
      }

      if (resolvedSortScope) {
        notifySortScope({ sourceId: resolvedLockId, scope: resolvedSortScope })
      }

      onSortChange?.(sortStateOnLock)
      return sortStateOnLock
    })
  }, [isLocked, showSort, resolvedSortScope, resolvedLockId, onSortChange, sortStateOnLock])

  function toggleLock() {
    if (lockDeleteProgressMode) {
      setLockProgressValue((current) => current + 1)

      if (!isLocked) {
        lockOrderCounter += 1
        lockOrderRef.current = lockOrderCounter
        setLockEntry(resolvedLockId, {
          relatedGroup,
          progressionEnabled,
          hasDeleteButton: showDelete,
          lockDeleteOnly,
          order: lockOrderCounter,
        })
        setIsLocked(true)
      }
      return
    }

    if (isLocked) {
      lockOrderRef.current = null
      removeLockEntry(resolvedLockId)
      setIsLocked(false)
      setLockProgressValue(0)
      return
    }

    lockOrderCounter += 1
    lockOrderRef.current = lockOrderCounter
    setLockEntry(resolvedLockId, {
      relatedGroup,
      progressionEnabled,
      hasDeleteButton: showDelete,
      lockDeleteOnly,
      order: lockOrderCounter,
    })
    setIsLocked(true)
    setLockProgressValue(0)
  }

  function handleDeleteClick() {
    setLockProgressValue(0)

    if (isLocked) {
      lockOrderRef.current = null
      removeLockEntry(resolvedLockId)
      setIsLocked(false)
    }
    onDelete?.()
  }

  function nextSortState(current: MiniSortState): MiniSortState {
    if (current === 'neutral') {
      return 'desc'
    }
    if (current === 'desc') {
      return 'asc'
    }
    return 'desc'
  }

  function handleSortClick() {
    if (isSortBlocked) {
      return
    }

    if (resolvedSortScope) {
      notifySortScope({ sourceId: resolvedLockId, scope: resolvedSortScope })
    }

    setSortState((current) => {
      const next = nextSortState(current)
      onSort?.()
      onSortChange?.(next)
      return next
    })
  }

  function handleSearchClick() {
    onSearch?.()
  }

  const sortIcon =
    sortState === 'desc' ? (
      <ArrowDown className={cx(styles.icon, iconSizeClass[size])} />
    ) : sortState === 'asc' ? (
      <ArrowUp className={cx(styles.icon, iconSizeClass[size])} />
    ) : (
      <ArrowUpDown className={cx(styles.icon, iconSizeClass[size])} />
    )

  return (
    <div className={cx(styles.miniToolsButtons, className)} {...props}>
      {showLockResolved && (
        <span className={styles.lockWrap}>
          <IconButton
            size={size}
            variant="default"
            className={cx(
              styles.toolButton,
              buttonSizeClass[size],
              isLocked && styles.lockActive,
            )}
            aria-label={copy.miniToolsButtons.lock}
            title={copy.miniToolsButtons.lock}
            onClick={toggleLock}
          >
            <Lock className={cx(styles.icon, iconSizeClass[size])} />
          </IconButton>
          {badgeValue !== null && (
            <span className={styles.lockBadge} aria-label={copy.miniToolsButtons.lockBadgeAriaLabel(badgeValue)}>
              {badgeValue}
            </span>
          )}
        </span>
      )}

      {showSearch && (
        <IconButton
          size={size}
          variant="default"
          className={cx(styles.toolButton, buttonSizeClass[size])}
          aria-label={copy.miniToolsButtons.search}
          title={copy.miniToolsButtons.search}
          onClick={handleSearchClick}
        >
          <Search className={cx(styles.icon, iconSizeClass[size])} />
        </IconButton>
      )}

      {showDelete && (
        <IconButton
          size={size}
          variant="default"
          className={cx(styles.toolButton, buttonSizeClass[size])}
          aria-label={copy.miniToolsButtons.clearLock}
          title={copy.miniToolsButtons.clearLock}
          onClick={handleDeleteClick}
        >
          <Trash2 className={cx(styles.icon, iconSizeClass[size])} />
        </IconButton>
      )}

      {showSort && (
        <IconButton
          size={size}
          variant="default"
          className={cx(
            styles.toolButton,
            buttonSizeClass[size],
            sortState !== 'neutral' && styles.sortActive,
            isSortBlocked && styles.sortBlocked,
          )}
          aria-label={isSortBlocked ? copy.miniToolsButtons.sortBlocked : copy.miniToolsButtons.sort}
          title={isSortBlocked ? copy.miniToolsButtons.sortBlocked : copy.miniToolsButtons.sort}
          aria-disabled={isSortBlocked ? 'true' : undefined}
          onClick={isSortBlocked ? undefined : handleSortClick}
        >
          {sortIcon}
        </IconButton>
      )}
    </div>
  )
}
