/**
 * [ES] Asigna title dinamico solo cuando el contenido visual queda truncado.
 * [EN] Assigns a dynamic title only when visible content is truncated.
 */
let measureCanvas: HTMLCanvasElement | null = null

function parsePixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildCanvasFont(element: HTMLElement): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const styles = window.getComputedStyle(element)
  const lineHeight = styles.lineHeight && styles.lineHeight !== 'normal'
    ? `/${styles.lineHeight}`
    : ''

  return [
    styles.fontStyle,
    styles.fontVariant,
    styles.fontWeight,
    styles.fontSize ? `${styles.fontSize}${lineHeight}` : '',
    styles.fontFamily,
  ]
    .filter(Boolean)
    .join(' ')
}

function measureTextWidth(element: HTMLElement, text: string): number {
  if (typeof document === 'undefined' || !text) {
    return 0
  }

  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas')
  }

  const context = measureCanvas.getContext('2d')
  if (!context) {
    return 0
  }

  context.font = buildCanvasFont(element)
  return context.measureText(text).width
}

function hasVisibleOverflow(element: HTMLElement, text: string): boolean {
  if (!text.trim()) {
    return false
  }

  if (element.scrollWidth > element.clientWidth + 1) {
    return true
  }

  if (typeof window === 'undefined') {
    return false
  }

  const styles = window.getComputedStyle(element)
  const clientWidth = element.clientWidth
  if (clientWidth <= 0) {
    return false
  }

  const horizontalPadding = parsePixels(styles.paddingLeft) + parsePixels(styles.paddingRight)
  const controlExtraWidth = element instanceof HTMLSelectElement ? 24 : 0
  const contentWidth = measureTextWidth(element, text)

  return contentWidth + horizontalPadding + controlExtraWidth > clientWidth
}

export function syncOverflowTitle(element: HTMLElement, text: string): void {
  const cleanText = text.trim()

  if (!cleanText) {
    element.removeAttribute('title')
    return
  }

  const hasOverflow = hasVisibleOverflow(element, cleanText)

  if (hasOverflow) {
    element.setAttribute('title', cleanText)
    return
  }

  element.removeAttribute('title')
}
