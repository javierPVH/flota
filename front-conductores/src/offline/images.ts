/**
 * R5-54 — Compresión de fotos ANTES de subirlas o encolarlas.
 *
 * Una foto de un móvil actual son 4-12 MB; el límite del back es 10 MB
 * (`FLEET_DOCUMENT_MAX_MB`) y nginx corta en 12, así que una foto de daños
 * normal podía rebotar con 413 — y sin cobertura se guardaba entera en
 * IndexedDB, compitiendo con la cuota del origen. Aquí se reescala al lado
 * mayor `maxSide` y se recodifica a JPEG: un orden de magnitud menos.
 *
 * Best-effort por diseño: si el navegador no tiene `createImageBitmap` /
 * canvas (o algo falla), devuelve el fichero original — antes que perder una
 * foto, se sube grande. Los PDF y lo que no sea imagen no se tocan; el HEIC se
 * intenta (Safari lo decodifica) y si no, se deja tal cual.
 */

export interface CompressOptions {
  /** Lado mayor máximo en píxeles (por defecto 1600, de sobra para un daño). */
  maxSide?: number
  /** Calidad JPEG 0-1 (por defecto 0,8). */
  quality?: number
  /** Por debajo de este tamaño no merece la pena tocar la foto (por defecto 600 kB). */
  minBytes?: number
}

const DEFAULTS: Required<CompressOptions> = { maxSide: 1600, quality: 0.8, minBytes: 600 * 1024 }

/** ¿Es una imagen que sabemos recodificar? */
export function isCompressibleImage(file: File): boolean {
  return /^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(file.type)
}

function targetSize(width: number, height: number, maxSide: number): [number, number] {
  const longest = Math.max(width, height)
  if (longest <= maxSide) return [width, height]
  const ratio = maxSide / longest
  return [Math.round(width * ratio), Math.round(height * ratio)]
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  // Fallback: <img> sobre un object URL (navegadores sin createImageBitmap).
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('imagen no decodificable'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function encode(
  source: ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('sin contexto 2d')
    ctx.drawImage(source, 0, 0, width, height)
    return canvas.convertToBlob({ type: 'image/jpeg', quality })
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('sin contexto 2d')
  ctx.drawImage(source, 0, 0, width, height)
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob vacío'))), 'image/jpeg', quality),
  )
}

/** Devuelve la foto reescalada/recodificada, o la ORIGINAL si no procede o falla. */
export async function compressImage(file: File, options: CompressOptions = {}): Promise<File> {
  const opts = { ...DEFAULTS, ...options }
  if (!isCompressibleImage(file) || file.size < opts.minBytes) return file
  try {
    const source = await decode(file)
    const [width, height] = targetSize(source.width, source.height, opts.maxSide)
    const blob = await encode(source, width, height, opts.quality)
    if ('close' in source && typeof source.close === 'function') source.close()
    // Si comprimir no ahorra nada (ya venía optimizada), se queda la original.
    if (blob.size >= file.size) return file
    const name = file.name.replace(/\.(png|webp|heic|heif|jpeg|jpg)$/i, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  }
}

/** La misma compresión para una selección múltiple, en paralelo. */
export function compressImages(files: readonly File[], options?: CompressOptions): Promise<File[]> {
  return Promise.all(files.map((file) => compressImage(file, options)))
}
