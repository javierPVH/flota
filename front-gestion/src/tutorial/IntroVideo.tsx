import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Info } from 'lucide-react'

import type { TutorialCopy } from '../translations/tutorial.ts'
import { isChapterId } from './chapters.ts'
import { RichText } from './RichText.tsx'
import type { ShotLang } from './shots.ts'
import data from './video-scenes.json'

/** Lo que tarda una escena en fundirse con la anterior (`FADE` en
 * `docs/tutoriales-capturas/video_gestion.py`): se salta a cuando ya se ve. */
const FADE = 0.4

/** Las escenas del vídeo con su segundo de inicio. El texto es el mismo que
 * lleva el vídeo dentro: los dos salen de `video-scenes.json`. */
const VIDEO_SCENES = data.scenes.map((scene, i) => ({
  ...scene,
  at: data.scenes.slice(0, i).reduce((sum, s) => sum + s.seconds, 0),
}))

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

/** El vídeo de presentación (uno por idioma, sin sonido) y, debajo, sus
 * escenas: el minuto salta en el vídeo y el nombre lleva al capítulo. */
export function IntroVideo({ copy, lang }: { copy: TutorialCopy; lang: ShotLang }) {
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(-1)
  const ui = copy.ui
  const base = `${import.meta.env.BASE_URL}tutorial/video/presentacion-${lang}`

  function seek(at: number) {
    const v = video.current
    if (!v) return
    v.currentTime = at > 0 ? at + FADE : 0
    void v.play()?.catch(() => {})
  }

  function onTime() {
    const v = video.current
    if (!v || v.paused) return
    let current = 0
    VIDEO_SCENES.forEach((s, i) => {
      if (v.currentTime >= s.at) current = i
    })
    setPlaying(current)
  }

  return (
    <>
      <figure className="tut-video">
        {/* `key`: al cambiar de idioma se carga el otro vídeo. */}
        <video
          key={lang}
          ref={video}
          controls
          muted
          playsInline
          preload="metadata"
          poster={`${base}.jpg`}
          width={1600}
          height={900}
          aria-describedby="tut-video-scenes"
          onTimeUpdate={onTime}
          onPause={() => setPlaying(-1)}
          onEnded={() => setPlaying(-1)}
        >
          <source src={`${base}.webm`} type="video/webm" />
          {ui.videoFallback}
        </video>
      </figure>
      <p className="tut-callout">
        <Info size={18} aria-hidden="true" />
        <span>
          <RichText text={ui.videoLangHint} />
        </span>
      </p>

      <section className="tut-section" aria-labelledby="tut-video-h">
        <h3 className="tut-sub-h" id="tut-video-h">
          {ui.videoScenesTitle}
        </h3>
        <p className="tut-hint">{ui.videoScenesHint}</p>
        <ol className="tut-scenes" id="tut-video-scenes">
          {VIDEO_SCENES.map((scene, i) => {
            const text = scene[lang]
            const id = scene.chapter ?? undefined
            const chapter = isChapterId(id) ? id : undefined
            return (
              <li key={scene.at} className={playing === i ? 'is-playing' : undefined}>
                <button
                  type="button"
                  className="tut-scene-time"
                  aria-label={ui.videoSeek(clock(scene.at))}
                  onClick={() => seek(scene.at)}
                >
                  {clock(scene.at)}
                </button>
                <div className="tut-scene-text">
                  <strong>{text.title}</strong>
                  <span>{text.text}</span>
                </div>
                {chapter && (
                  <Link to={`/ayuda/${chapter}`} className="tut-scene-link">
                    {copy.chapters[chapter].title} <ChevronRight size={14} aria-hidden="true" />
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      </section>
    </>
  )
}
