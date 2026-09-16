/** Las variables que el back sabe rellenar (`mailer.ALLOWED_VARIABLES`). */
export const TEMPLATE_VARIABLES = [
  'matricula',
  'conductor',
  'empresa',
  'fecha_vencimiento',
  'km_exceso',
  'mensaje',
] as const

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]
