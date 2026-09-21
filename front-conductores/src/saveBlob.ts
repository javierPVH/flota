/**
 * Guardar en el móvil un archivo que ya está en memoria.
 *
 * Lo que se descarga no viene de una URL que se pueda poner en un `href`: el
 * binario lo trae el back con la cuenta de servicio (`fetchDocumentFile`), así
 * que aquí se fabrica un enlace de usar y tirar, se pulsa solo y se suelta.
 *
 * El `revokeObjectURL` va tras un tick porque hay navegadores que empiezan la
 * descarga después del clic: soltándolo en la misma línea, el archivo se
 * quedaba a medias.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = filename
  enlace.rel = 'noreferrer'
  document.body.append(enlace)
  enlace.click()
  enlace.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
