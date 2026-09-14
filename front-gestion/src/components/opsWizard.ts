import { useState, type RefObject } from 'react'

/**
 * El asistente por pasos de los modales de operación (estado del vehículo y
 * envío de correo). El formulario no se recorre a dedo: se avanza y se
 * retrocede, y cada paso pide lo suyo antes de dejarte salir.
 *
 * Los paneles siguen todos montados (ocultos) para no perder lo escrito ni la
 * validación nativa; `data-section` es lo que permite encontrar los campos de
 * un paso y saltar al del campo inválido.
 */

/** Un paso: `off` = no aplica con lo elegido, así que ni se pisa ni se cuenta. */
export interface Paso<K extends string> {
  key: K
  label: string
  off: boolean
}

interface Opciones<K extends string> {
  pasos: Array<Paso<K>>
  /** Formulario donde viven los paneles (para buscar los campos del paso). */
  formRef: RefObject<HTMLFormElement | null>
  /** Reglas propias del paso, las que el navegador no sabe. '' = nada que objetar. */
  reglas?: (paso: K) => string
  /** Dónde se cuenta lo que falla (el aviso en rojo del formulario). */
  onError: (mensaje: string) => void
}

export function useAsistente<K extends string>({ pasos, formRef, reglas, onError }: Opciones<K>) {
  const [pedido, setPedido] = useState<K>(pasos[0].key)
  const vivos = pasos.filter((p) => !p.off)
  // Si el paso que se miraba deja de aplicar —cambia lo elegido—, se vuelve al
  // primero en vez de quedarse en una pestaña que ya no se puede rellenar.
  const paso = vivos.some((p) => p.key === pedido) ? pedido : (vivos[0]?.key ?? pasos[0].key)
  const indice = vivos.findIndex((p) => p.key === paso)
  const pasoPrevio = indice > 0 ? vivos[indice - 1] : null
  const pasoSiguiente = vivos[indice + 1] ?? null

  /**
   * Pasar de paso exige tener sus obligatorios: los del navegador (`required`,
   * `pattern`) sobre los campos de ESE panel, más los propios de `reglas`. Un
   * paso sin obligatorios deja pasar sin más.
   */
  function avanzar() {
    if (!pasoSiguiente) return
    const propio = reglas?.(paso) ?? ''
    if (propio) {
      onError(propio)
      return
    }
    const panel = formRef.current?.querySelector(`[data-section="${paso}"]`)
    const campos = Array.from(
      panel?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input, select, textarea',
      ) ?? [],
    )
    const invalido = campos.find((campo) => !campo.checkValidity())
    if (invalido) {
      invalido.reportValidity()
      return
    }
    onError('')
    setPedido(pasoSiguiente.key)
  }

  /**
   * El navegador bloquea el envío por un campo obligatorio vacío que puede
   * estar en un paso que no se ve: se salta a él y se le pide al propio campo
   * que enseñe su aviso, ya visible.
   *
   * Si el campo está en el paso que ya se mira no hay nada que saltar, y
   * reaccionar aquí pisaría la navegación del pie (el reenfoque diferido
   * devolvería a este paso).
   */
  const alInvalido = (event: { target: EventTarget | null }) => {
    const campo = event.target as HTMLElement | null
    const seccion = campo?.closest?.('[data-section]')?.getAttribute('data-section')
    if (!seccion || seccion === paso) return
    setPedido(seccion as K)
    setTimeout(() => {
      const control = campo as HTMLInputElement | null
      control?.focus?.()
      control?.reportValidity?.()
    }, 0)
  }

  return { paso, setPaso: setPedido, pasoPrevio, pasoSiguiente, avanzar, alInvalido }
}
