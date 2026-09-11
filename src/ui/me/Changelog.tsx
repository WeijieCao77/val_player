/**
 * What changed in the career, in a corner where it does not interrupt anything.
 *
 * A dot on the button when the newest entry is one you have not opened, and
 * nothing at all once you have — a permanent badge is just noise, and the last
 * date read is the whole of the state it keeps. The career's own copy of the
 * manager game's changelog card, reading only the career's log.
 */
import { useEffect, useState } from 'react'
import { CHANGELOG_ME, LATEST_ME } from '../../data/changelog_me'
import Rich from './rich'

/** the date of the newest entry this browser has opened */
const SEEN = 'valplayer.changelog.seen'

const readSeen = (): string => {
  try { return localStorage.getItem(SEEN) ?? '' } catch { return '' }
}

export default function Changelog() {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(readSeen)

  // Escape closes it, like every other panel in the game
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const fresh = !!LATEST_ME && seen !== LATEST_ME

  const toggle = () => {
    setOpen((x) => {
      // Marked read on open, not on close: someone who opens it and then hits
      // Escape has still seen what is new.
      if (!x && fresh) {
        setSeen(LATEST_ME)
        try { localStorage.setItem(SEEN, LATEST_ME) } catch { /* private mode */ }
      }
      return !x
    })
  }

  return (
    <>
      <button
        className={`support-fab log-fab${open ? ' on' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-label="更新日志"
        title="看看这版改了什么"
      >
        <span className="ico" aria-hidden="true">📋</span>
        <span className="lbl">更新日志</span>
        {fresh && <span className="dot" aria-label="有新内容" />}
      </button>

      {open && (
        <>
          <div className="support-veil" onClick={() => setOpen(false)} />
          <div className="support-card log-card" role="dialog" aria-label="更新日志">
            <div className="support-head">
              <h3>更新日志</h3>
              <button className="sm ghost" onClick={() => setOpen(false)}>关闭 ✕</button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              这里大部分改动都来自群里的反馈。如果你提过某个 bug，多半能在下面找到。
            </p>

            <div className="log-list">
              {CHANGELOG_ME.map((entry) => (
                <section key={entry.date + entry.title}>
                  <header>
                    <b>{entry.title}</b>
                    <span className="tiny faint mono">{entry.date}</span>
                  </header>
                  <ul>
                    {entry.changes.map((c, i) => (
                      <li key={i}>
                        <span className={`log-kind k-${c.kind}`}>{c.kind}</span>
                        <Rich text={c.text} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <div className="support-foot">
              <span className="tiny faint">选手生涯 demo · 每一版改了什么都在这里，回看用</span>
            </div>
          </div>
        </>
      )}
    </>
  )
}
