import { useState } from 'react'
import { ImageOff, Maximize2 } from 'lucide-react'
import { Modal } from '@flota/ui/ui'

import { shotUrl, type ShotLang } from './shots.ts'

interface ShotProps {
  name: string
  alt: string
  lang: ShotLang
  pendingLabel: string
  zoomLabel: string
}

/** Captura de la app: alto máximo para que quepa con el texto en un móvil, y
 * al tocarla se abre a pantalla completa (con zoom de los dedos). Sin fichero,
 * un recuadro «Captura pendiente» (nunca una imagen rota). */
export function Shot({ name, alt, lang, pendingLabel, zoomLabel }: ShotProps) {
  const [open, setOpen] = useState(false)
  const url = shotUrl(lang, name)

  if (!url) {
    return (
      <figure className="tut-shot tut-shot--pending" data-shot={name}>
        <ImageOff size={20} aria-hidden="true" />
        <figcaption>
          {pendingLabel} · {alt}
        </figcaption>
      </figure>
    )
  }

  return (
    <figure className="tut-shot" data-shot={name}>
      <button type="button" className="tut-shot-frame" onClick={() => setOpen(true)} aria-label={`${zoomLabel}: ${alt}`}>
        <img src={url} alt={alt} loading="lazy" />
      </button>
      <figcaption>
        {alt}
        <span className="tut-shot-zoomhint" aria-hidden="true">
          <Maximize2 size={12} /> {zoomLabel}
        </span>
      </figcaption>
      <Modal open={open} title={alt} onClose={() => setOpen(false)} maxWidth="min(640px, 96vw)">
        <img className="tut-shot-zoom" src={url} alt={alt} />
      </Modal>
    </figure>
  )
}

interface GalleryProps {
  shots: string[]
  labels?: string[]
  alts: Record<string, string>
  lang: ShotLang
  pendingLabel: string
  zoomLabel: string
}

/** Varias capturas de un mismo paso (las `.gallery` del HTML): chips arriba y
 * una sola captura a la vista, que en un móvil no caben dos. */
export function Gallery({ shots, labels, alts, lang, pendingLabel, zoomLabel }: GalleryProps) {
  const [current, setCurrent] = useState(0)
  const shot = (name: string) => (
    <Shot key={name} name={name} alt={alts[name] ?? name} lang={lang} pendingLabel={pendingLabel} zoomLabel={zoomLabel} />
  )
  if (shots.length === 1) return shot(shots[0])
  const index = Math.min(current, shots.length - 1)
  return (
    <div className="tut-gallery">
      <div className="tut-gallery-tabs" role="group">
        {shots.map((name, i) => (
          <button
            key={name}
            type="button"
            className={i === index ? 'is-active' : undefined}
            aria-pressed={i === index}
            onClick={() => setCurrent(i)}
          >
            {labels?.[i] ?? i + 1}
          </button>
        ))}
      </div>
      {shot(shots[index])}
    </div>
  )
}
