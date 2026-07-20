import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

function readStored<T>(key: string, initial: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw != null ? (JSON.parse(raw) as T) : initial
  } catch {
    return initial
  }
}

/**
 * Como useState, pero persiste el valor en localStorage bajo `key`, de modo que
 * el estado (p. ej. filtros de una vista) se recuerda entre recargas. Si la
 * lectura/escritura falla (modo privado, cuota), degrada a estado en memoria.
 *
 * Si `key` cambia, re-lee el valor de la NUEVA clave (patrón de React de ajuste
 * de estado en render), evitando escribir el estado viejo bajo la clave nueva.
 */
export function usePersistentState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => readStored(key, initial))

  // Ajuste de estado durante el render cuando cambia `key` (patrón oficial de
  // React "storing information from previous renders"; seguro con el Compiler,
  // que prohíbe refs en render). Evita escribir el estado viejo bajo la clave nueva.
  const [prevKey, setPrevKey] = useState(key)
  if (prevKey !== key) {
    setPrevKey(key)
    setState(readStored(key, initial))
  }

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch {
      /* almacenamiento no disponible: se mantiene solo en memoria */
    }
  }, [key, state])

  return [state, setState]
}
