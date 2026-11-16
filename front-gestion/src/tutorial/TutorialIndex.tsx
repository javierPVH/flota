import { NavLink } from 'react-router-dom'

import type { TutorialCopy } from '../translations/tutorial.ts'
import { CHAPTERS, GROUP_IDS, type ChapterId } from './chapters.ts'

interface TutorialIndexProps {
  copy: TutorialCopy
  active?: ChapterId
}

/** Índice de la Ayuda: los capítulos por grupo, el abierto marcado. */
export function TutorialIndex({ copy, active }: TutorialIndexProps) {
  return (
    <nav className="tut-index" aria-label={copy.ui.indexLabel}>
      {GROUP_IDS.map((group) => (
        <div className="tut-index-group" key={group}>
          <h3 className="tut-index-title">{copy.groups[group]}</h3>
          <ul>
            {CHAPTERS.filter((c) => c.group === group).map((c) => {
              const Icon = c.icon
              return (
                <li key={c.id}>
                  <NavLink
                    to={`/ayuda/${c.id}`}
                    className={`tut-index-link${active === c.id ? ' is-active' : ''}`}
                    aria-current={active === c.id ? 'page' : undefined}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span>{copy.chapters[c.id].title}</span>
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
