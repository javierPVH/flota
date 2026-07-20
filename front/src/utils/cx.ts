/** Une tokens de clase truthy en una sola cadena (tipo clsx minimalista). */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}
