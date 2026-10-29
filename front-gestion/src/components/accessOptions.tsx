import { useMemo } from 'react'
import { Ban, Check, EyeOff, Send, User, Users } from 'lucide-react'

import type { DriverActionMode, DriverDeleteMode, DriverDocumentRead } from '../api.ts'
import { useDocumentsCopy } from '../translations/documents.ts'
import type { AccessOption } from './AccessSwitch.tsx'

/** Las posiciones de los mandos del conductor, con su icono y su color: qué
 * lista, cómo ve / se baja el archivo (tres) y cómo pide su borrado (dos:
 * nunca es directo). Una sola tabla para Ajustes y para el modal. */
export function useAccessOptions() {
  const t = useDocumentsCopy().settings
  return useMemo(() => {
    const allow: AccessOption<DriverActionMode> = {
      value: 'allow',
      label: t.actionOptions.allow,
      icon: <Check size={14} aria-hidden />,
      tone: 'ok',
    }
    const request: AccessOption<'request'> = {
      value: 'request',
      label: t.actionOptions.request,
      icon: <Send size={14} aria-hidden />,
      tone: 'ask',
    }
    const deny: AccessOption<'deny'> = {
      value: 'deny',
      label: t.actionOptions.deny,
      icon: <Ban size={14} aria-hidden />,
      tone: 'no',
    }
    // Qué lista: nada (como el «no» de la supervisión), lo suyo o todo.
    const list: Array<AccessOption<DriverDocumentRead>> = [
      { value: 'none', label: t.driverOptions.none, icon: <EyeOff size={14} aria-hidden />, tone: 'no' },
      { value: 'own', label: t.driverOptions.own, icon: <User size={14} aria-hidden /> },
      { value: 'all', label: t.driverOptions.all, icon: <Users size={14} aria-hidden /> },
    ]
    const action: Array<AccessOption<DriverActionMode>> = [allow, request, deny]
    const remove: Array<AccessOption<DriverDeleteMode>> = [request, deny]
    // La supervisión lee o no: el mismo dibujo que permitir / no permitir.
    const yesNo: Array<AccessOption<'yes' | 'no'>> = [
      { value: 'yes', label: t.yes, icon: <Check size={14} aria-hidden />, tone: 'ok' },
      { value: 'no', label: t.no, icon: <Ban size={14} aria-hidden />, tone: 'no' },
    ]
    const legend: Array<AccessOption<string>> = [...list, ...action]
    return { list, action, remove, yesNo, legend }
  }, [t])
}
