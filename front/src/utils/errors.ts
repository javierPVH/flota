/** Extrae un mensaje legible de un error desconocido, con fallback. */
export function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}
