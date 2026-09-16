// R5-54: compresión de fotos antes de subir/encolar (best-effort).
import { afterEach, describe, expect, it, vi } from 'vitest'

import { compressImage, compressImages, isCompressibleImage } from './images.ts'

const bigPhoto = (type = 'image/jpeg', name = 'foto.jpeg') =>
  new File([new Uint8Array(2 * 1024 * 1024)], name, { type })

describe('compressImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('no toca lo que no es imagen ni lo que ya es pequeño', async () => {
    const pdf = new File([new Uint8Array(3 * 1024 * 1024)], 'parte.pdf', { type: 'application/pdf' })
    expect(await compressImage(pdf)).toBe(pdf)
    const small = new File([new Uint8Array(10 * 1024)], 'mini.jpg', { type: 'image/jpeg' })
    expect(await compressImage(small)).toBe(small)
    expect(isCompressibleImage(pdf)).toBe(false)
    expect(isCompressibleImage(small)).toBe(true)
  })

  it('sin API de imagen en el navegador devuelve la original (nunca pierde la foto)', async () => {
    // jsdom no tiene createImageBitmap ni canvas real: el fallback falla y se
    // queda la foto tal cual.
    vi.stubGlobal('createImageBitmap', undefined)
    const photo = bigPhoto()
    expect(await compressImage(photo)).toBe(photo)
  })

  it('reescala al lado mayor y recodifica a JPEG cuando el navegador lo permite', async () => {
    const close = vi.fn()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 4000, height: 3000, close }) as unknown as ImageBitmap),
    )
    const drawImage = vi.fn()
    const convertToBlob = vi.fn(async () => new Blob([new Uint8Array(200 * 1024)], { type: 'image/jpeg' }))
    class FakeOffscreenCanvas {
      width: number
      height: number
      constructor(w: number, h: number) {
        this.width = w
        this.height = h
      }
      getContext() {
        return { drawImage }
      }
      convertToBlob = convertToBlob
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)

    const out = await compressImage(bigPhoto('image/png', 'daño.png'), { maxSide: 1600 })
    expect(out).not.toBe(bigPhoto())
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('daño.jpg')
    expect(out.size).toBe(200 * 1024)
    // 4000×3000 → 1600×1200 (lado mayor acotado, proporción conservada).
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200)
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/jpeg', quality: 0.8 })
    expect(close).toHaveBeenCalled()
  })

  it('si comprimir no ahorra, se queda la original; compressImages va en lote', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() }) as unknown as ImageBitmap),
    )
    class BigCanvas {
      constructor(_w: number, _h: number) {}
      getContext() {
        return { drawImage: vi.fn() }
      }
      convertToBlob = async () => new Blob([new Uint8Array(3 * 1024 * 1024)], { type: 'image/jpeg' })
    }
    vi.stubGlobal('OffscreenCanvas', BigCanvas)
    const photo = bigPhoto()
    const [same] = await compressImages([photo])
    expect(same).toBe(photo)
  })
})
