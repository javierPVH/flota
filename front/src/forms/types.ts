/**
 * Tipos compartidos para el motor de formularios de creación de catálogos.
 *
 * Genéricos y desacoplados del backend: el "cómo" (crear, importar, cargar
 * opciones) se inyecta por props.
 */

/** Datos del formulario (pares campo→valor string). */
export type CatalogCreateData = Record<string, string>

/** Identificador de la entidad de catálogo (string libre definido por la app). */
export type CatalogCreateEntity = string

/** Respuesta de éxito al crear un registro. */
export interface CatalogCreateSuccessResponse {
  id: string | number
  code?: string
  name?: string
  label?: string
}

/**
 * Función inyectada que ejecuta la creación real contra el backend de la app.
 * El motor la llama en el submit; la app decide el endpoint/transporte.
 */
export type CatalogCreateSubmit = (
  payload: { entity: CatalogCreateEntity; data: CatalogCreateData },
  options: { baseUrl?: string; csrfToken?: string },
) => Promise<CatalogCreateSuccessResponse>

export interface CatalogCreateFormCommonProps {
  className?: string
  disabled?: boolean
  apiBaseUrl?: string
  csrfToken?: string
  resetOnSuccess?: boolean
  onCreated?: (payload: CatalogCreateSuccessResponse) => void
  onCancel?: () => void
}
