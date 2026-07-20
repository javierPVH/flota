/**
 * [ES] Bloque de tres acciones con icono (editar, fusionar, eliminar) para operaciones por fila.
 * [EN] Three-action icon block (edit, merge, delete) used in row-level operations.
 * Visibility, handlers and disabled state can be configured per action.
 */
import type { HTMLAttributes, ReactNode } from 'react'
import { ArrowLeftRight, Pencil, Trash } from 'lucide-react'
import { IconButton } from './IconButton'
import type { IconButtonSize } from './IconButton'
import styles from '../../styles/_components/buttons/action-buttons.module.sass'
import { cx } from '../../utils/cx.ts'
import { useUiCopy } from '../copy.ts'

export interface ActionButtonsProps extends HTMLAttributes<HTMLDivElement> {
  size?: IconButtonSize
  showEdit?: boolean
  showMerge?: boolean
  showDelete?: boolean
  disabled?: boolean
  editDisabled?: boolean
  mergeDisabled?: boolean
  deleteDisabled?: boolean
  onEdit?: () => void
  onMerge?: () => void
  onDelete?: () => void
  editIcon?: ReactNode
  mergeIcon?: ReactNode
  deleteIcon?: ReactNode
}



export function ActionButtons({
  size = 'md',
  showEdit = true,
  showMerge = true,
  showDelete = true,
  disabled = false,
  editDisabled = false,
  mergeDisabled = false,
  deleteDisabled = false,
  onEdit,
  onMerge,
  onDelete,
  editIcon,
  mergeIcon,
  deleteIcon,
  className,
  ...props
}: ActionButtonsProps) {
  const copy = useUiCopy()
  const iconSizeClass: Record<IconButtonSize, string> = {
    xs: styles.iconXs,
    sm: styles.iconSm,
    md: styles.iconMd,
  }

  const sharedIconClass = cx(styles.icon, iconSizeClass[size])
  const defaultEditIcon = <Pencil className={sharedIconClass} />
  const defaultMergeIcon = <ArrowLeftRight className={sharedIconClass} />
  const defaultDeleteIcon = (
    <Trash className={cx(sharedIconClass, styles.iconDelete)} />
  )

  return (
    <div className={cx(styles.actionButtons, className)} {...props}>
      {showEdit && (
        <IconButton
          size={size}
          variant="default"
          aria-label={copy.actionButtons.editAriaLabel}
          title={copy.actionButtons.editTitle}
          disabled={disabled || editDisabled}
          onClick={onEdit}
        >
          {editIcon ?? defaultEditIcon}
        </IconButton>
      )}

      {showMerge && (
        <IconButton
          size={size}
          variant="warning"
          aria-label={copy.actionButtons.mergeAriaLabel}
          title={copy.actionButtons.mergeTitle}
          disabled={disabled || mergeDisabled}
          onClick={onMerge}
        >
          {mergeIcon ?? defaultMergeIcon}
        </IconButton>
      )}

      {showDelete && (
        <IconButton
          size={size}
          variant="danger"
          aria-label={copy.actionButtons.deleteAriaLabel}
          title={copy.actionButtons.deleteTitle}
          disabled={disabled || deleteDisabled}
          onClick={onDelete}
        >
          {deleteIcon ?? defaultDeleteIcon}
        </IconButton>
      )}
    </div>
  )
}
