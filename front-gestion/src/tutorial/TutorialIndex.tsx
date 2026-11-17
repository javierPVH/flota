import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Check, ChevronDown } from 'lucide-react'

import type { TutorialCopy } from '../translations/tutorial.ts'
import { CHAPTERS, GROUP_IDS, chapterById, type ChapterId, type GroupId } from './chapters.ts'
import { isReady, readSeen } from './progress.ts'

interface TutorialIndexProps {
  copy: TutorialCopy
  active?: ChapterId
}

/** Índice de la Ayuda en acordeón: un grupo abierto cada vez. Al entrar en un
 * capítulo se abre el suyo y se pliegan los demás; pulsar otro grupo lo abre a
 * él (para poder ir a sus capítulos). Dentro, los capítulos numerados, el
 * abierto marcado y los ya leídos con ✓. */
export function TutorialIndex({ copy, active }: TutorialIndexProps) {
  const seen = readSeen()
  const current: GroupId = active ? chapterById(active).group : GROUP_IDS[0]
  const [open, setOpen] = useState<GroupId | null>(current)
  // Al cambiar de capítulo, el grupo abierto es el suyo.
  const [shown, setShown] = useState(active)
  if (shown !== active) {
    setShown(active)
    setOpen(current)
  }

  return (
    <nav className="tut-index" aria-label={copy.ui.indexLabel}>
      {GROUP_IDS.map((group) => {
        const chapters = CHAPTERS.filter((c) => c.group === group)
        const isOpen = open === group
        const done = chapters.filter((c) => seen.has(c.id)).length
        return (
          <div className={`tut-index-group${isOpen ? ' is-open' : ''}${group === current && active ? ' is-current' : ''}`} key={group}>
            <h3 className="tut-index-title">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`tut-index-${group}`}
                onClick={() => setOpen(isOpen ? null : group)}
              >
                <span>{copy.groups[group]}</span>
                <small aria-hidden="true">
                  {done}/{chapters.length}
                </small>
                <ChevronDown size={15} aria-hidden="true" />
              </button>
            </h3>
            {isOpen && (
              <ul id={`tut-index-${group}`}>
                {chapters.map((c) => {
                  const ready = isReady(copy, c.id)
                  const isActive = active === c.id
                  return (
                    <li key={c.id}>
                      <NavLink
                        to={`/ayuda/${c.id}`}
                        className={`tut-index-link${isActive ? ' is-active' : ''}${ready ? '' : ' is-soon'}`}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        {ready && seen.has(c.id) && !isActive ? (
                          <span className="tut-index-num is-seen">
                            <Check size={13} className="tut-index-seen" aria-label={copy.ui.read} />
                          </span>
                        ) : (
                          <span className="tut-index-num" aria-hidden="true">
                            {CHAPTERS.indexOf(c) + 1}
                          </span>
                        )}
                        <span className="tut-index-label">{copy.chapters[c.id].title}</span>
                        {!ready && <span className="tut-index-tag">{copy.ui.soon}</span>}
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}
