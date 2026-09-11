import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useGame } from '../ctx'
import { closeTour, dueTour, markTourSeen, openTour, setToursOff, tourSteps, useOpenTour } from './guide'
import type { TourKind, TourTarget } from './guide'
import './tour.css'

/**
 * The coach marks on screen; the steps, and when a tour opens by itself, are in
 * guide.ts. A ring round the real element with the page dimmed around it, a
 * card beside it, and nothing underneath clickable until the tour is closed —
 * the week does not move while it is being explained.
 *
 * It waits behind whatever the clock stopped on — a match, a decision, a run's
 * summary, a player's card — and picks up on the same step afterwards.
 */

interface Box { left: number; top: number; width: number; height: number }

/** room round the lit element, the gap to the card, and the card's distance from the screen's edge */
const PAD = 6
const GAP = 10
const EDGE = 8
const CARD_W = 360
/** less room than this beside the element, and the card goes over or under it instead */
const SIDE_MIN = 260

/** A panel answers to its title; anything else to its text. */
function labelOf(el: Element): string {
  if (el.classList.contains('panel')) return el.querySelector(':scope > .panel-head h2')?.textContent ?? ''
  return el.textContent ?? ''
}

function find(t: TourTarget): Element | null {
  const want = t.text === undefined ? null : Array.isArray(t.text) ? t.text : [t.text]
  for (const el of Array.from(document.querySelectorAll(t.sel))) {
    if (!want || want.some((w) => labelOf(el).includes(w))) return el
  }
  return null
}

const findAll = (at: TourTarget[] | undefined): Element[] => (at ?? []).map(find).filter((x): x is Element => !!x)

/** The lit area: the targets together, cut to what the screen shows of them. */
function boxOf(els: Element[]): Box | null {
  let l = Infinity
  let t = Infinity
  let r = -Infinity
  let b = -Infinity
  for (const el of els) {
    const rc = el.getBoundingClientRect()
    // in the scrolling column only its visible part counts: what sits above the column is not the target
    const clip = el.closest('.main')?.getBoundingClientRect()
    const top = clip ? Math.max(rc.top, clip.top) : rc.top
    const bottom = clip ? Math.min(rc.bottom, clip.bottom) : rc.bottom
    if (bottom <= top || rc.right <= rc.left) continue
    l = Math.min(l, rc.left)
    t = Math.min(t, top)
    r = Math.max(r, rc.right)
    b = Math.max(b, bottom)
  }
  if (l === Infinity) return null
  const left = Math.max(0, l - PAD)
  const top = Math.max(0, t - PAD)
  return { left, top, width: Math.min(window.innerWidth, r + PAD) - left, height: Math.min(window.innerHeight, b + PAD) - top }
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5
const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && near(a.left, b.left) && near(a.top, b.top) && near(a.width, b.width) && near(a.height, b.height))
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Under the lit area, over it, beside it — or, with no room anywhere, across the other half of the screen. */
function place(hole: Box | null, ch: number): { left: number; top: number; width: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(CARD_W, vw - EDGE * 2)
  if (!hole) return { left: (vw - width) / 2, top: Math.max(EDGE, (vh - ch) / 2), width }
  const x = vw <= 560 ? EDGE : clamp(hole.left, EDGE, vw - width - EDGE)
  const bottom = hole.top + hole.height
  if (vh - bottom - GAP - EDGE >= ch) return { left: x, top: bottom + GAP, width }
  if (hole.top - GAP - EDGE >= ch) return { left: x, top: hole.top - GAP - ch, width }
  const y = clamp(hole.top, EDGE, Math.max(EDGE, vh - ch - EDGE))
  const right = vw - (hole.left + hole.width) - GAP - EDGE
  if (right >= SIDE_MIN) return { left: hole.left + hole.width + GAP, top: y, width: Math.min(width, right) }
  const left = hole.left - GAP - EDGE
  if (left >= SIDE_MIN) {
    const w = Math.min(width, left)
    return { left: hole.left - GAP - w, top: y, width: w }
  }
  const low = hole.top + hole.height / 2 > vh / 2
  return { left: (vw - width) / 2, top: low ? EDGE : vh - ch - EDGE, width }
}

export default function Tour({ screen, go, blocked }: { screen: string; go: (s: string) => void; blocked: boolean }) {
  const { game } = useGame()
  const { kind, seq } = useOpenTour()
  const me = game.me
  const retired = !me || me.phase === 'retired'
  // whatever the clock stopped on comes first; the tour waits behind it
  const busy = blocked || retired || !!me?.pending.length || !!me?.duelLive
  useEffect(() => {
    if (kind && retired) { closeTour(); return }
    if (kind || busy) return
    const due = dueTour(game)
    if (due) openTour(due)
  })
  if (!kind) return null
  return <Run key={seq} kind={kind} screen={screen} go={go} busy={busy} />
}

function Run({ kind, screen, go, busy }: { kind: TourKind; screen: string; go: (s: string) => void; busy: boolean }) {
  const { game } = useGame()
  const steps = tourSteps(kind, game)
  const [i, setI] = useState(0)
  const [hole, setHole] = useState<Box | null>(null)
  const [ready, setReady] = useState(false)
  const [ch, setCh] = useState(150)
  const dir = useRef<1 | -1>(1)
  // where it was opened — the week, or 帮助 — and where it goes back to
  const from = useRef(screen)
  const lit = useRef<Element[]>([])
  const cardRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const step = steps[Math.min(i, steps.length - 1)]
  const last = i >= steps.length - 1

  const close = (how: 'done' | 'skip' | 'never') => {
    markTourSeen(kind)
    if (how === 'never') setToursOff(true)
    closeTour()
    if (from.current !== screen) go(from.current)
  }
  const move = (d: 1 | -1) => {
    const n = i + d
    if (n < 0) return
    if (n >= steps.length) { close('done'); return }
    dir.current = d
    setReady(false)
    setI(n)
  }

  // the step's page first, then what it lights, brought into view
  useEffect(() => {
    if (busy || !step) return
    if (screen !== step.screen) { go(step.screen); return }
    setReady(false)
    const t = window.setTimeout(() => {
      const els = findAll(step.at)
      if (step.at?.length && !els.length) {
        // not on the page right now: on to the next step the same way (a missing first step goes forward)
        const d = i === 0 ? 1 : dir.current
        const n = i + d
        if (n < 0 || n >= steps.length) close('done')
        else { dir.current = d; setI(n) }
        return
      }
      lit.current = els
      const first = els[0]
      if (first) {
        const tall = first.getBoundingClientRect().height > window.innerHeight * 0.5
        first.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest' })
      }
      setHole(boxOf(els))
      setReady(true)
    }, 60)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, busy, screen])

  // the ring stays on the element while the page scrolls, reflows or re-renders under it
  useEffect(() => {
    if (busy || !ready) return
    let raf = 0
    const tick = () => {
      if (lit.current.some((el) => !el.isConnected)) lit.current = findAll(step?.at)
      const b = lit.current.length ? boxOf(lit.current) : null
      setHole((cur) => (sameBox(cur, b) ? cur : b))
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, ready, i])

  // Esc skips, the arrows walk; Enter is the focused 下一步 itself
  useEffect(() => {
    if (busy) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close('skip') }
      else if (e.key === 'ArrowRight') { e.preventDefault(); move(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1) }
      else if (e.key === 'Tab') {
        // the card is modal: focus goes round its own buttons, not out to the page under the veil
        const list = Array.from(cardRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        if (!list.length) return
        e.preventDefault()
        const at = list.indexOf(document.activeElement as HTMLButtonElement)
        const n = e.shiftKey ? (at <= 0 ? list.length - 1 : at - 1) : (at < 0 || at === list.length - 1 ? 0 : at + 1)
        list[n].focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (ready && !busy) nextRef.current?.focus({ preventScroll: true })
  }, [ready, busy, i])

  // the card's height decides whether it fits over or under the ring
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight ?? 0
    if (h && Math.abs(h - ch) > 1) setCh(h)
  })

  if (busy || !step) return null
  const spot = !!step.at?.length && !!hole
  const pos = place(spot ? hole : null, ch)
  return (
    <>
      <div className={`mt-veil${spot ? '' : ' dim'}`} aria-hidden="true" />
      {spot && hole && <div className="mt-hole" style={{ left: hole.left, top: hole.top, width: hole.width, height: hole.height }} aria-hidden="true" />}
      <div
        ref={cardRef} className="mt-card" role="dialog" aria-modal="true" aria-labelledby="mt-title" aria-describedby="mt-body"
        style={{ left: pos.left, top: pos.top, width: pos.width, visibility: ready ? 'visible' : 'hidden' }}
      >
        <div className="mt-head">
          <span className="mt-count">{kind === 'season' ? '签约之后' : '导览'} · {i + 1}/{steps.length}</span>
          <button className="sm ghost" onClick={() => close('skip')}>跳过</button>
        </div>
        <h3 id="mt-title">{step.title}</h3>
        <p id="mt-body">{step.body}</p>
        <div className="mt-foot">
          <button className="sm ghost mt-off" onClick={() => close('never')} title="新生涯和第一次签约时都不再自动弹出；「帮助」里随时能重看">不再显示</button>
          {i > 0 && <button className="sm" onClick={() => move(-1)}>上一步</button>}
          <button ref={nextRef} className="sm primary" onClick={() => move(1)}>{last ? (kind === 'season' ? '知道了' : '开始吧') : '下一步'}</button>
        </div>
      </div>
    </>
  )
}
