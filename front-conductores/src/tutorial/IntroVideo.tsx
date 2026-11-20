import { useEffect, useState } from 'react'
import { CloudOff, Info } from 'lucide-react'

import type { TutorialCopy } from '../translations/tutorial.ts'
import type { ShotLang } from './shots.ts'
import data from './video-scenes.json'

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** El vídeo de presentación (sin sonido). `preload="none"`: pesa ~11 MB y no
 * se baja hasta que se pide (datos móviles). */
export function IntroVideo({ copy, lang }: { copy: TutorialCopy; lang: ShotLang }) {
  const online = useOnline()
  const ui = copy.ui
  const own = (data.videos as string[]).includes(lang)
  const base = `${import.meta.env.BASE_URL}tutorial/video/promo-${own ? lang : 'es'}`

  return (
    <>
      {online ? (
        <figure className="tut-video">
          <video key={lang} controls muted playsInline preload="none" poster={`${base}.jpg`} width={1280} height={720}>
            <source src={`${base}.webm`} type="video/webm" />
            {ui.videoFallback}
          </video>
        </figure>
      ) : (
        <p className="tut-note is-warn">
          <CloudOff size={16} aria-hidden="true" />
          <span>{ui.videoOffline}</span>
        </p>
      )}
      {!own && ui.videoLangHint && (
        <p className="tut-note">
          <Info size={16} aria-hidden="true" />
          <span>{ui.videoLangHint}</span>
        </p>
      )}
    </>
  )
}
