/** Comprobación básica de formato de email (mismo regex usado en los formularios). */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
