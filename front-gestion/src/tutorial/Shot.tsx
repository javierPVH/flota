import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { Modal } from '@flota/ui/ui'

import { shotUrl, type ShotLang } from './shots.ts'

interface ShotProps {
  name: string
  alt: string
  lang: ShotLang
  pendingLabel: string
  zoomLabel: string
}

/** Captura de la app en marco de escritorio; al pulsarla se amplía. Sin
 * fichero, un recuadro «Captura pendiente» (nunca una imagen rota). */
export function Shot({ name, alt, lang, pendingLabel, zoomLabel }: ShotProps) {
  const [open, setOpen] = useState(false)
  const url = shotUrl(lang, name)

  if (!url) {
    return (
      <figure className="tut-shot tut-shot--pending" data-shot={name}>
        <ImageOff size={20} aria-hidden="true" />
        <figcaption>
          {pendingLabel} · <span className="tut-shot-alt">{alt}</span>
        </figcaption>
      </figure>
    )
  }

  return (
    <figure className="tut-shot" data-shot={name}>
      <button type="button" className="tut-shot-frame" onClick={() => setOpen(true)} title={zoomLabel}>
        <img src={url} alt={alt} loading="lazy" />
      </button>
      <figcaption>{alt}</figcaption>
      <Modal open={open} title={alt} onClose={() => setOpen(false)} maxWidth="92vw">
        <img className="tut-shot-zoom" src={url} alt={alt} />
      </Modal>
    </figure>
  )
}
