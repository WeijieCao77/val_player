/**
 * What changed in the career, in a corner where it does not interrupt anything.
 *
 * A dot on the button when the newest entry is one you have not opened, and
 * nothing at all once you have — a permanent badge is just noise, and the last
 * date read is the whole of the state it keeps. The career's own copy of the
 * manager game's changelog card, reading only the career's log.
 */
import { useEffect, useRef, useState } from 'react'
import { CHANGELOG_ME, LATEST_ME } from '../../data/changelog_me'
import Rich from './rich'
import { useLayer } from './layer'

/** the newest entry this browser has opened, by date and title: a second build on one day lights the dot too */
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

      {open && <LogSheet onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * The sheet itself, a card in front of the page like the others (layer.ts): the
 * focus goes onto it, so the arrow keys scroll the list; Tab stays on it, and the
 * page behind is inert until it closes, when the focus goes back to the corner
 * button. The veil and the sheet sit in one box of their own that draws nothing
 * (display: contents), so a click on the veil still closes it.
 */
function LogSheet({ onClose }: { onClose: () => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  useLayer(wrap, { box: card })
  return (
    <div ref={wrap} style={{ display: 'contents' }}>
      <div className="support-veil" onClick={onClose} />
      <div ref={card} className="support-card log-card" role="dialog" aria-modal="true" aria-labelledby="log-card-t" tabIndex={-1}>
        <div className="support-head">
          <h3 id="log-card-t">更新日志</h3>
          <button className="sm ghost" onClick={onClose}>关闭 ✕</button>
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
          <span className="tiny faint">选手生涯 · 每一版改了什么都在这里，回看用</span>
        </div>
      </div>
    </div>
  )
}
