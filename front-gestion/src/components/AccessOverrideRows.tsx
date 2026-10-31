import type { ReactNode } from 'react'

import type {
  DocumentTypeAccess,
  DriverActionMode,
  DriverDeleteMode,
  DriverDocumentRead,
} from '../api.ts'
import { useDocumentsCopy } from '../translations/documents.ts'
import type { AccessPick } from './accessPick.ts'
import { AccessLegend, SegSwitch, type AccessOption } from './AccessSwitch.tsx'
import { useAccessOptions } from './accessOptions.tsx'

type Pick3 = 'yes' | 'no'

/** Un conmutador con «según el tipo» delante de las posiciones propias: va
 * solo con iconos, como la tabla de Ajustes, y «según el tipo» lleva el
 * icono de lo que el tipo dice hoy más sus dos palabras (y el valor entero
 * en el `title`). */
function AccessSwitch<V extends string>({
  label,
  inherited,
  inheritedText,
  inheritedIcon,
  value,
  options,
  onChange,
  disabled,
  disabledHint,
}: {
  label: string
  inherited: string
  inheritedText: string
  inheritedIcon: ReactNode
  value: '' | V
  options: Array<AccessOption<V>>
  onChange: (v: '' | V) => void
  disabled?: boolean
  disabledHint?: string
}) {
  const all: Array<AccessOption<'' | V>> = [
    { value: '', label: inherited, text: inheritedText, icon: inheritedIcon },
    ...options,
  ]
  return (
    <div className="doc-access-row">
      <span className="doc-access-label">{label}</span>
      <SegSwitch
        label={label}
        value={value}
        options={all}
        onChange={onChange}
        iconsOnly
        disabled={disabled}
        disabledHint={disabledHint}
      />
    </div>
  )
}

/**
 * Los cinco mandos del ajuste de UN documento, con la leyenda de los iconos
 * encima: la supervisión, lo que lista el conductor, cómo lo ve, cómo se lo
 * baja y cómo pide su borrado. Cada uno lleva «según el tipo» —con el icono
 * de lo que el tipo (`rule`) dice hoy— más sus posiciones propias. Los pinta
 * el modal «Acceso» de la fila y la subida desde la bandeja de solicitudes,
 * que decide el acceso del documento al subirlo.
 */
export function AccessOverrideRows({
  pick,
  onChange,
  rule,
}: {
  pick: AccessPick
  onChange: (next: AccessPick) => void
  /** La regla del tipo, para decir qué vale «según el tipo». */
  rule: DocumentTypeAccess | undefined
}) {
  const t = useDocumentsCopy()
  const copy = t.access.modal
  const options = useAccessOptions()
  const find = <V extends string>(opts: Array<AccessOption<V>>, v: V) =>
    opts.find((o) => o.value === v) ?? opts[0]
  const typeSays = {
    supervisor: find(options.yesNo, (rule?.supervisor_read ?? true) ? 'yes' : 'no'),
    list: find(options.list, rule?.driver_read ?? 'all'),
    view: find(options.action, rule?.driver_view ?? 'allow'),
    download: find(options.action, rule?.driver_download ?? 'allow'),
    remove: find(options.remove, rule?.driver_delete ?? 'request'),
  }
  const inheritedOf = (opt: AccessOption<string>) => ({
    inherited: copy.inherit(opt.label),
    inheritedText: copy.inheritShort,
    inheritedIcon: opt.icon,
  })
  // Lo que vale para ÉL en «listar»: su ajuste o, sin él, lo del tipo. Si
  // no se lista, lectura, descarga y borrado no aplican y van apagados.
  const notListed = (pick.list || typeSays.list.value) === 'none'
  const moot = { disabled: notListed, disabledHint: t.settings.notListedHint }
  const set = <K extends keyof AccessPick>(key: K, value: AccessPick[K]) =>
    onChange({ ...pick, [key]: value })
  return (
    <>
      <AccessLegend title={t.settings.legend} options={options.legend} />
      <div className="doc-access-rows">
        <AccessSwitch<Pick3>
          label={copy.supervisor}
          {...inheritedOf(typeSays.supervisor)}
          value={pick.supervisor}
          options={options.yesNo}
          onChange={(v) => set('supervisor', v)}
        />
        <AccessSwitch<DriverDocumentRead>
          label={copy.list}
          {...inheritedOf(typeSays.list)}
          value={pick.list}
          options={options.list}
          onChange={(v) => set('list', v)}
        />
        <AccessSwitch<DriverActionMode>
          label={copy.view}
          {...inheritedOf(typeSays.view)}
          {...moot}
          value={pick.view}
          options={options.action}
          onChange={(v) => set('view', v)}
        />
        <AccessSwitch<DriverActionMode>
          label={copy.download}
          {...inheritedOf(typeSays.download)}
          {...moot}
          value={pick.download}
          options={options.action}
          onChange={(v) => set('download', v)}
        />
        <AccessSwitch<DriverDeleteMode>
          label={copy.remove}
          {...inheritedOf(typeSays.remove)}
          {...moot}
          value={pick.remove}
          options={options.remove}
          onChange={(v) => set('remove', v)}
        />
      </div>
    </>
  )
}
