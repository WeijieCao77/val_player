import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GameState } from '../../engine/types'
import { LOOKS, chooseLook, lookOf, openLooks, peekCareerId, readHall } from '../../engine/me/hall'
import type { Hall, HallLook, LookKey } from '../../engine/me/hall'
import './looks.css'

/**
 * 卡面 (me/hall.ts LOOKS): the look the career-end card and the share picture
 * wear, chosen from what the hall has opened. Only how they are dressed — the
 * author, 2026-09-18: 「但是殿堂不影响游戏里的数值」.
 *
 * The choice lives in the hall record, outside the save; every card showing a
 * look hears a change at once (the poster behind the share card redraws with
 * it). A browser that stores nothing has the default and nothing else.
 */

const EV = 'valplayer:look'

export function useLook(): { look: LookKey; hall: Hall | null; choose: (k: LookKey) => boolean } {
  const [n, setN] = useState(0)
  useEffect(() => {
    const f = () => setN((x) => x + 1)
    window.addEventListener(EV, f)
    return () => window.removeEventListener(EV, f)
  }, [])
  const hall = useMemo(() => readHall(), [n])
  const choose = useCallback((k: LookKey) => {
    const ok = chooseLook(k)
    window.dispatchEvent(new Event(EV))
    return ok
  }, [])
  return { look: lookOf(hall), hall, choose }
}

/** The chip's second line: in use, open, opened by this very career, or what it takes. */
function stateLine(l: HallLook, open: boolean, on: boolean, fresh: boolean, hall: Hall | null): string {
  if (on) return '使用中'
  if (open) return fresh ? '这一局解锁' : '已解锁'
  const p = hall && l.progress ? l.progress(hall.cards) : ''
  return p ? `${l.short} · ${p}` : l.short
}

/**
 * Every look, open or not: a shut one is greyed with what opens it, never
 * hidden (the author's rule). `compact` for the share card's narrow sheet.
 */
export function LookPicker({ game, compact }: { game?: GameState | null; compact?: boolean }) {
  const { look, hall, choose } = useLook()
  const [msg, setMsg] = useState('')
  const open = openLooks(hall)
  const mine = game?.me ? peekCareerId(game) : ''
  // on a phone the share sheet's looks are one row that scrolls sideways: the one in use is brought into it
  const grid = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const g = grid.current
    const on = g?.querySelector<HTMLElement>('.lp-item.on')
    if (g && on && g.scrollWidth > g.clientWidth + 1) g.scrollLeft = Math.max(0, on.offsetLeft - g.offsetLeft - 12)
  }, [look])
  return (
    <div className={`look-pick${compact ? ' compact' : ''}`}>
      <div className="lp-head">
        <b>卡面</b>
        <span className="lp-note">{hall ? '打完不同的生涯，殿堂解锁新卡面。只换样子，不碰数值。' : '这个浏览器存不下殿堂，只有默认卡面。'}</span>
      </div>
      <div className="lp-grid" role="radiogroup" aria-label="卡面" ref={grid}>
        {LOOKS.map((l) => {
          const isOpen = open.has(l.key)
          const can = isOpen && (!!hall || l.key === 'studio')
          const on = look === l.key
          const fresh = !!mine && hall?.looks[l.key]?.id === mine
          return (
            <button
              key={l.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!can}
              className={`lp-item${on ? ' on' : ''}${can ? '' : ' locked'}${fresh && !on ? ' fresh' : ''}`}
              title={`${l.name}：${l.what}${can ? '' : `（${l.cond}）`}`}
              onClick={() => { if (!on) setMsg(choose(l.key) ? '' : '存不下，卡面没换。') }}
            >
              <span className={`lp-sw sw-${l.key}`} aria-hidden="true" />
              <span className="lp-name">{l.name}</span>
              <span className="lp-state">{stateLine(l, isOpen, on, fresh, hall)}</span>
            </button>
          )
        })}
      </div>
      {msg && <p className="lp-msg">{msg}</p>}
    </div>
  )
}
