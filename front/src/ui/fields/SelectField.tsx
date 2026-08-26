/**
 * [ES] Campo select reutilizable con opciones dinamicas y flags de cabecera.
 * [EN] Reusable select field with dynamic options and header flags.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEventHandler,
  type FocusEventHandler,
  type MouseEventHandler,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { Search } from 'lucide-react'
import { FieldShell, type FieldContainerSize, type FieldInputHeight } from './FieldShell'
import { syncOverflowTitle } from './overflow-title'
import styles from '../../styles/_components/fields/form-fields.module.sass'
import { cx } from '../../utils/cx.ts'
import { useUiCopy } from '../copy.ts'

const IGNORE_OPTION_VALUE = '__ignore__'
const CREATE_OPTION_VALUE = '__create__'
const SELECT_OPTION_VALUE = ''
const DIVIDER_OPTION_VALUE = '__divider__'

export interface SelectFieldOption {
  value: string
  label: string
  disabled?: boolean
  /**
   * [ES] Grupo del desplegable (optgroup): las opciones CONSECUTIVAS con el
   * mismo grupo se envuelven juntas; sin grupo, la opción queda suelta.
   * [EN] Optgroup label: CONSECUTIVE options sharing it are wrapped together;
   * ungrouped options stay top-level.
   */
  group?: string
}

interface RenderedOption extends SelectFieldOption {
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: ReactNode
  containerSize?: FieldContainerSize
  containerClassName?: string
  inputHeight?: FieldInputHeight
  requiredVisual?: boolean
  warningMessage?: ReactNode
  warningClosable?: boolean
  onWarningClose?: () => void
  options: SelectFieldOption[]
  includeSelectFlag?: boolean
  selectFlagLabel?: string
  includeIgnoreFlag?: boolean
  includeCreateFlag?: boolean
  includeDefaultFlag?: boolean
  defaultOptionValue?: string
  useDefaultOnLoad?: boolean
  enableSearchFilter?: boolean
  searchInputPlaceholder?: string
  onValueChange?: (value: string) => void
}



const heightClass: Record<FieldInputHeight, string> = {
  5: styles.inputPad5,
  10: styles.inputPad10,
}

export function SelectField({
  label,
  containerSize = 'fill',
  containerClassName,
  inputHeight = 10,
  requiredVisual = false,
  warningMessage,
  warningClosable = true,
  onWarningClose,
  className,
  disabled = false,
  options,
  includeSelectFlag = false,
  selectFlagLabel = '',
  includeIgnoreFlag = false,
  includeCreateFlag = false,
  includeDefaultFlag = false,
  defaultOptionValue,
  useDefaultOnLoad = false,
  enableSearchFilter = false,
  searchInputPlaceholder = '',
  onValueChange,
  onChange,
  onFocus,
  title,
  onMouseEnter,
  required = false,
  value,
  defaultValue,
  ...props
}: SelectFieldProps) {
  const copy = useUiCopy()
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const normalizedOptions = useMemo(
    () => options.map((option) => ({
      ...option,
      value: String(option.value),
    })),
    [options],
  )

  const defaultOption = useMemo(
    () => (
      defaultOptionValue
        ? normalizedOptions.find((option) => option.value === defaultOptionValue)
        : undefined
    ),
    [defaultOptionValue, normalizedOptions],
  )

  const isRequiredField = Boolean(required)
  const effectiveIncludeSelectFlag = includeSelectFlag && isRequiredField
  const effectiveIncludeIgnoreFlag = includeIgnoreFlag || !isRequiredField

  const flagRows = useMemo(() => {
    const rows: RenderedOption[] = []

    if (effectiveIncludeSelectFlag) {
      rows.push({ value: SELECT_OPTION_VALUE, label: selectFlagLabel || copy.selectField.defaultSelectFlagLabel })
    }

    if (effectiveIncludeIgnoreFlag) {
      rows.push({ value: IGNORE_OPTION_VALUE, label: copy.selectField.ignoreLabel })
    }

    if (includeCreateFlag) {
      rows.push({ value: CREATE_OPTION_VALUE, label: copy.selectField.createLabel })
    }

    if (includeDefaultFlag && defaultOption) {
      rows.push({
        value: defaultOption.value,
        label: `${copy.selectField.defaultValuePrefix}: ${defaultOption.label}`,
      })
    }
    return rows
  }, [
    defaultOption,
    effectiveIncludeSelectFlag,
    effectiveIncludeIgnoreFlag,
    includeCreateFlag,
    includeDefaultFlag,
    selectFlagLabel,
    copy.selectField.createLabel,
    copy.selectField.defaultSelectFlagLabel,
    copy.selectField.defaultValuePrefix,
    copy.selectField.ignoreLabel,
  ])

  const dataOptions = useMemo(() => {
    let dataOptions = includeDefaultFlag && defaultOption
      ? normalizedOptions.filter((option) => option.value !== defaultOption.value)
      : normalizedOptions

    if (effectiveIncludeSelectFlag) {
      dataOptions = dataOptions.filter((option) => option.value !== SELECT_OPTION_VALUE)
    }

    return dataOptions
  }, [
    defaultOption,
    effectiveIncludeSelectFlag,
    includeDefaultFlag,
    normalizedOptions,
  ])

  const filteredDataOptions = useMemo(() => {
    if (!enableSearchFilter) {
      return dataOptions
    }
    const normalizedTerm = searchTerm.trim().toLocaleLowerCase()
    if (!normalizedTerm) {
      return dataOptions
    }
    return dataOptions.filter((option) => (
      option.label.toLocaleLowerCase().includes(normalizedTerm)
    ))
  }, [dataOptions, enableSearchFilter, searchTerm])

  const renderedOptions = useMemo(() => {
    const flaggedRowsWithDividers = flagRows.flatMap((option, index) => ([
      option,
      {
        value: `${DIVIDER_OPTION_VALUE}_${index}`,
        label: '_____________________',
        disabled: true,
      } satisfies RenderedOption,
    ]))

    return [
      ...flaggedRowsWithDividers,
      ...filteredDataOptions,
    ]
  }, [
    filteredDataOptions,
    flagRows,
  ])

  // [ES] Optgroups: tramos CONSECUTIVOS con el mismo `group`; los flags y
  // divisores no llevan grupo y quedan sueltos. [EN] Consecutive same-group
  // chunks become <optgroup>; flag/divider rows stay top-level.
  const groupedRenderedOptions = useMemo(() => {
    const chunks: Array<{ group: string | null; options: RenderedOption[] }> = []
    for (const option of renderedOptions) {
      const group = option.group || null
      const last = chunks[chunks.length - 1]
      if (last && last.group === group) {
        last.options.push(option)
      } else {
        chunks.push({ group, options: [option] })
      }
    }
    return chunks
  }, [renderedOptions])

  const resolvedDefaultValue = useMemo(() => {
    if (!useDefaultOnLoad) {
      return undefined
    }

    if (effectiveIncludeSelectFlag) {
      return SELECT_OPTION_VALUE
    }

    if (defaultOption?.value) {
      return defaultOption.value
    }

    return normalizedOptions[0]?.value ?? (effectiveIncludeIgnoreFlag ? IGNORE_OPTION_VALUE : undefined)
  }, [defaultOption, effectiveIncludeIgnoreFlag, effectiveIncludeSelectFlag, normalizedOptions, useDefaultOnLoad])

  const syncTitle = (select: HTMLSelectElement) => {
    if (!title) {
      const selectedOption = select.options[select.selectedIndex]
      const text = selectedOption?.text ?? ''
      syncOverflowTitle(select, text)
    }
  }

  const isControlled = value !== undefined
  const defaultValueString = defaultValue as string | undefined
  const [internalValue, setInternalValue] = useState<string>(defaultValueString ?? resolvedDefaultValue ?? '')

  const currentValue = String(isControlled ? (value ?? '') : internalValue)
  const effectiveCurrentValue = useMemo(() => {
    const hasOption = renderedOptions.some((option) => option.value === currentValue)
    if (hasOption) {
      return currentValue
    }
    if (effectiveIncludeIgnoreFlag) {
      return IGNORE_OPTION_VALUE
    }
    return currentValue
  }, [currentValue, effectiveIncludeIgnoreFlag, renderedOptions])

  function applyNextValue(nextValue: string) {
    if (!isControlled) {
      setInternalValue(nextValue)
    }
    onValueChange?.(nextValue)
  }

  const handleChange: ChangeEventHandler<HTMLSelectElement> = (event) => {
    syncTitle(event.currentTarget)
    if (!isControlled) {
      setInternalValue(event.target.value)
    }
    onValueChange?.(event.target.value)
    onChange?.(event)
  }

  const handleFocus: FocusEventHandler<HTMLSelectElement> = (event) => {
    syncTitle(event.currentTarget)
    onFocus?.(event)
  }

  const handleMouseEnter: MouseEventHandler<HTMLSelectElement> = (event) => {
    syncTitle(event.currentTarget)
    onMouseEnter?.(event)
  }

  useEffect(() => {
    if (!enableSearchFilter) {
      return
    }

    if (!searchVisible || disabled) {
      return
    }

    searchInputRef.current?.focus()
  }, [disabled, enableSearchFilter, searchVisible])

  useEffect(() => {
    if (!enableSearchFilter || disabled) {
      return
    }

    const normalizedTerm = searchTerm.trim()
    if (!normalizedTerm) {
      return
    }

    if (filteredDataOptions.length === 1) {
      const onlyValue = filteredDataOptions[0].value
      if (onlyValue !== currentValue) {
        applyNextValue(onlyValue)
      }
      return
    }

    if (filteredDataOptions.length === 0 && effectiveIncludeIgnoreFlag && currentValue !== IGNORE_OPTION_VALUE) {
      applyNextValue(IGNORE_OPTION_VALUE)
    }
  }, [
    currentValue,
    disabled,
    effectiveIncludeIgnoreFlag,
    enableSearchFilter,
    filteredDataOptions,
    searchTerm,
  ])

  return (
    <FieldShell
      label={label}
      size={containerSize}
      disabled={disabled}
      requiredVisual={requiredVisual}
      warningMessage={warningMessage}
      warningClosable={warningClosable}
      onWarningClose={onWarningClose}
      className={containerClassName}
    >
      <div className={styles.fieldSelectLayout}>
        {enableSearchFilter && searchVisible && (
          <div className={styles.fieldSelectSearchBar}>
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className={styles.fieldSearchInput}
              placeholder={searchInputPlaceholder || copy.selectField.searchInputPlaceholder}
              disabled={disabled}
            />
            <span className={styles.fieldSearchResultBubble}>
              {filteredDataOptions.length}
            </span>
          </div>
        )}

        <div className={styles.fieldSelectRow}>
          {enableSearchFilter && (
            <button
              type="button"
              className={styles.fieldSearchToggleButton}
              aria-label={searchVisible ? copy.selectField.hideSearchLabel : copy.selectField.showSearchLabel}
              title={searchVisible ? copy.selectField.hideSearchLabel : copy.selectField.showSearchLabel}
              disabled={disabled}
              onClick={() => {
                const nextVisible = !searchVisible
                setSearchVisible(nextVisible)
                if (!nextVisible) {
                  setSearchTerm('')
                }
              }}
            >
              <Search size={15} />
            </button>
          )}
          <select
            disabled={disabled}
            className={cx(
              styles.fieldSelect,
              heightClass[inputHeight],
              enableSearchFilter && styles.fieldSelectWithSearch,
              className,
            )}
            onChange={handleChange}
            onFocus={handleFocus}
            onMouseEnter={handleMouseEnter}
            title={title}
            value={effectiveCurrentValue}
            required={required}
            {...props}
          >
            {groupedRenderedOptions.map((chunk, chunkIndex) =>
              chunk.group === null ? (
                chunk.options.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    {option.label}
                  </option>
                ))
              ) : (
                <optgroup key={`group-${chunkIndex}-${chunk.group}`} label={chunk.group}>
                  {chunk.options.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                    >
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ),
            )}
          </select>
        </div>
      </div>
    </FieldShell>
  )
}
