import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadCsvTemplateFile } from './csv-template.ts'

// jsdom no implementa Blob.text(); leemos el contenido con FileReader.
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

describe('downloadCsvTemplateFile', () => {
  let capturedBlob: Blob | null
  let clickSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    capturedBlob = null
    // jsdom no implementa createObjectURL/revokeObjectURL: los stubeamos.
    URL.createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob
      return 'blob:mock'
    }) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('genera el CSV con cabeceras y fila de ejemplo y dispara la descarga', async () => {
    downloadCsvTemplateFile({
      filename: 'plantilla.csv',
      headers: ['nombre', 'email'],
      exampleRow: ['Ada', 'ada@x.io'],
    })

    expect(clickSpy).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    expect(capturedBlob).toBeInstanceOf(Blob)
    const text = await readBlob(capturedBlob!)
    expect(text).toBe('nombre,email\nAda,ada@x.io')
  })

  it('sin fila de ejemplo solo escribe cabeceras', async () => {
    downloadCsvTemplateFile({ filename: 'p.csv', headers: ['a', 'b'] })
    const text = await readBlob(capturedBlob!)
    expect(text).toBe('a,b')
  })

  it('limpia el anchor del DOM tras la descarga', () => {
    downloadCsvTemplateFile({ filename: 'p.csv', headers: ['a'] })
    expect(document.querySelector('a[download]')).toBeNull()
  })
})
