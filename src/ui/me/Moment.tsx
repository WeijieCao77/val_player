/**
 * A big moment, full screen (大事卡): direction A 「转播红」, chosen by the author on
 * 2026-09-14 (design page https://claude.ai/code/artifact/7fdca3cb-f1b9-4d1f-a090-3891ffea8eaa),
 * after 破晓's .rankup card.
 *
 * One card at a time. No ✕ and no closing on the veil — a trophy is taken, not
 * waved away — so the primary button is the way out, and Enter or Escape press
 * it. The art sits over a red slash with slow rays behind (moment.css).
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { Rays } from './art/fx'
import { chime } from './sfx'
import { isTopLayer, useLayer } from './layer'
import './moment.css'

export interface MomentChip { text: string; kind?: 'up' | 'dn' | 'gold' }
interface Press { label: string; onClick: () => void }

export default function Moment({
  tone = 'accent', band = true, wide = false, art, eyebrow, title, body, chips, children, primary, secondary, next,
}: {
  /** gold for the rare ones (a hidden achievement); red for the rest */
  tone?: 'accent' | 'gold'
  /** the red slash behind the art; without it the art takes the tone */
  band?: boolean
  /** art wider than the square slot, e.g. two crests and an arrow */
  wide?: boolean
  art: ReactNode
  eyebrow: string
  title: string
  body?: ReactNode
  chips?: MomentChip[]
  children?: ReactNode
  primary: Press
  secondary?: Press
  /** a line under the buttons, e.g. how many more are waiting */
  next?: string
}) {
  const bg = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const press = useRef(primary.onClick)
  press.current = primary.onClick
  // in front of the page like every card (layer.ts): Tab goes round its own buttons — the five faces on a title, the
  // two presses — and not out to the page or the music window
  useLayer(bg, { first: () => btn.current })

  // each new card: the primary button takes the focus, and the chime plays if the player turned sound on (sfx.ts)
  useEffect(() => {
    btn.current?.focus({ preventScroll: true })
    chime()
  }, [eyebrow, title])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      // a player's card opened from a title's five stands in front of it: the keys are that card's
      if (!isTopLayer(bg.current)) return
      // Enter on the focused secondary button is that button's own press
      const at = document.activeElement
      if (e.key === 'Enter' && (at instanceof HTMLSelectElement || at instanceof HTMLInputElement || at instanceof HTMLTextAreaElement || (at instanceof HTMLElement && at.isContentEditable))) return
      if (e.key === 'Enter' && at instanceof HTMLButtonElement && at !== btn.current) return
      e.preventDefault()
      press.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="moment-bg" ref={bg} role="dialog" aria-modal="true" aria-labelledby="mo-title">
      <div className={`moment-glow${tone === 'gold' ? ' gold' : ''}`}>
        <div className={`moment${band ? '' : ' bare'}`}>
          <div className="mo-hero" aria-hidden="true">
            {band && <span className="mo-band" />}
            <Rays className="mo-rays" />
            <div className={`mo-art${wide ? ' wide' : ''}`}>{art}</div>
          </div>
          <p className="mo-eyebrow">{eyebrow}</p>
          <h2 className="mo-title" id="mo-title">{title}</h2>
          {body && <p className="mo-body">{body}</p>}
          {!!chips?.length && (
            <div className="mo-chips">
              {chips.map((c, i) => <span key={i} className={`mo-chip${c.kind ? ` ${c.kind}` : ''}`}>{c.text}</span>)}
            </div>
          )}
          {children}
          <div className="mo-acts">
            {secondary && <button onClick={secondary.onClick}>{secondary.label}</button>}
            <button ref={btn} className="primary" onClick={primary.onClick}>{primary.label}</button>
          </div>
          {next && <p className="mo-next">{next}</p>}
        </div>
      </div>
    </div>
  )
}
