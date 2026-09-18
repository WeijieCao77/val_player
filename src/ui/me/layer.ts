/**
 * Every card in front of the page, one behaviour for a keyboard and a screen reader.
 *
 * Reported 2026-09-18 by an outside audit (of 6d128ed): an event card said
 * nothing about being a dialog, took no focus, and Tab walked from its answers
 * out to 回到首页, 推进一周 and 更新日志 behind the veil, then round the music
 * window. Now, while a card is up:
 *
 *   · the focus goes into it: the button the card names (a big moment's
 *     primary, a cup's way out, 开新生涯's 取消), else the first answer on a
 *     card that asks something (an event, a tryout day, the IGL talk: cards
 *     that are answered, not closed), else the card itself — so a key meant
 *     for the page never answers a card, and a screen reader reads its title;
 *   · Tab and Shift+Tab go round the card's own controls;
 *   · everything behind it is `inert`: not clickable, not focusable, not read;
 *   · closing it hands the focus back to whatever had it before.
 *
 * Cards open over cards — a player's card from a match sheet, or from the five
 * faces on a title — and the newest is the one in front: it is drawn above the
 * one it came from (a player's card is 50 and a title is 60, so it used to open
 * under it, out of sight), and closing it gives that one back.
 *
 * Left live under every card, on purpose:
 *   · the music window (ui/me/MusicPlayer.tsx). It changes nothing in the
 *     career, and on a computer it stands above an ordinary card so a long
 *     series can be turned down without closing the report (music.css). Where a
 *     card covers it — every card on a phone, a big moment anywhere — the veil
 *     already stops the pointer, and Tab stays on the card, so inert there would
 *     only hide it from a screen reader. No card is blocking enough to need it.
 *   · the update and save bars and the toast, which stand above the cards and
 *     are about the save, not the career;
 *   · the tour's coach marks (ui/me/Tour.tsx), which stand above the cards, are
 *     not modal and keep their own keys.
 *
 * Escape is left to each card as it was: most ordinary cards ignore it, the
 * changelog, a cup's page and the name card close on it, a big moment presses
 * its button.
 */
import { useLayoutEffect, useState, type RefObject } from 'react'

/** never made inert by a card (see above) */
const MODELESS = '.bgm, .toast, .update-nudge, .save-chip, .mt-veil, .mt-hole, .mt-card'
const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT'])
const TABBABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'summary', 'iframe', 'audio[controls]', 'video[controls]',
  '[contenteditable]:not([contenteditable="false"])', '[tabindex]',
].join(',')

interface Layer {
  root: HTMLElement
  /** where the focus lands when nothing in the card asks for it */
  box: HTMLElement | null
  /** where the focus goes back to on closing */
  back: HTMLElement | null
  /** the card's own choice of where the focus starts */
  first?: () => HTMLElement | null | undefined
  /**
   * No key has gone down or up since the card opened. A card opened by Enter
   * (on 推进一周) with the key still held would take the key's repeats as presses
   * on whatever it focused — an event's first answer — so those are dropped.
   */
  held: boolean
}

const stack: Layer[] = []
/** the elements this module made inert, so it only ever undoes its own */
let benched: HTMLElement[] = []
let watch: MutationObserver | null = null

const topLayer = (): Layer | undefined => stack[stack.length - 1]

/** Whether this card is the one in front — for a card's own keys (a big moment's Enter and Escape). */
export function isTopLayer(el: Element | null): boolean {
  const t = topLayer()
  return !!t && !!el && t.root === el
}

function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) =>
    el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible')
}

function unbench(): void {
  for (const el of benched) el.inert = false
  benched = []
  watch?.disconnect()
  watch = null
}

/**
 * Everything but the card in front goes inert: at each step from the card up to
 * the body, the siblings beside it. Whatever the page adds at those steps while
 * the card is up (a toast, another card) is caught as it comes.
 */
function bench(): void {
  unbench()
  const top = topLayer()
  if (!top || !top.root.isConnected) return
  const steps: HTMLElement[] = []
  for (let el: HTMLElement = top.root; el.parentElement && el !== document.body; el = el.parentElement) {
    const parent = el.parentElement
    for (const sib of parent.children) {
      if (sib === el || !(sib instanceof HTMLElement) || sib.inert || SKIP.has(sib.tagName) || sib.matches(MODELESS)) continue
      sib.inert = true
      benched.push(sib)
    }
    steps.push(parent)
  }
  if (typeof MutationObserver === 'undefined') return
  watch = new MutationObserver(rebench)
  for (const el of steps) watch.observe(el, { childList: true })
}

/**
 * The page changed beside the card. If what had the focus went with it — a bar that stays live over the cards, like
 * 「这个存档已在另一个页面更新」 once its 载入最新存档 has opened the career again under the same card — the focus
 * goes back into the card rather than being left on nothing.
 */
function rebench(): void {
  bench()
  const t = topLayer()
  const at = document.activeElement
  if (t && (!at || at === document.body)) enter(t)
}

const zOf = (el: Element): number => {
  const z = parseInt(getComputedStyle(el).zIndex, 10)
  return Number.isNaN(z) ? 0 : z
}

/** The focus into the card: already inside (autoFocus), the card's own choice, the first answer, or the card itself. */
function enter(l: Layer): void {
  const at = document.activeElement
  if (at && at !== document.body && l.root.contains(at)) return
  const pick = l.first?.()
    ?? l.root.querySelector<HTMLElement>('.node-opt button:not(:disabled)')
    ?? l.box
  pick?.focus({ preventScroll: true })
}

function onKeyDown(e: KeyboardEvent): void {
  const top = topLayer()
  if (!top) return
  if (!e.repeat) for (const l of stack) l.held = false
  // a key held down since before the card opened: its repeats are not a press on the card
  else if ((e.key === 'Enter' || e.key === ' ') && top.held) {
    e.preventDefault()
    e.stopPropagation()
    return
  }
  if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
  const at = document.activeElement as HTMLElement | null
  // on the music window or the tour's card: Tab is theirs
  if (at?.closest(MODELESS)) return
  e.preventDefault()
  const list = tabbables(top.root)
  if (!list.length) return
  const back = e.shiftKey
  let next: HTMLElement
  if (!at || !top.root.contains(at)) next = back ? list[list.length - 1] : list[0]
  else {
    const i = list.indexOf(at)
    if (i >= 0) next = list[(i + (back ? -1 : 1) + list.length) % list.length]
    else {
      // on something Tab does not stop at (the card itself): the next one along, round the ends
      const after = list.findIndex((el) => !!(at.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))
      next = back ? list[(after <= 0 ? list.length : after) - 1] : list[after < 0 ? 0 : after]
    }
  }
  next.focus()
}

const onKeyUp = (): void => { for (const l of stack) l.held = false }

function open(l: Layer): void {
  // a card opened from a card in front of it goes in front of that one
  const under = stack.filter((x) => x.root.isConnected).map((x) => zOf(x.root))
  if (under.length && getComputedStyle(l.root).position !== 'static') {
    const z = Math.max(...under)
    if (z >= zOf(l.root)) l.root.style.zIndex = String(z + 1)
  }
  if (!stack.length) {
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keyup', onKeyUp, true)
  }
  stack.push(l)
  bench()
  enter(l)
}

function close(l: Layer): void {
  const i = stack.indexOf(l)
  if (i < 0) return
  const wasTop = i === stack.length - 1
  stack.splice(i, 1)
  // a card that came from this one goes back to where this one would have
  for (const x of stack.slice(i)) if (!x.back || !x.back.isConnected || l.root.contains(x.back)) x.back = l.back
  bench()
  if (!stack.length) {
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('keyup', onKeyUp, true)
  }
  if (!wasTop) return
  const to = l.back
  if (to && to.isConnected && !to.closest('[inert]')) to.focus({ preventScroll: true })
  else {
    const t = topLayer()
    if (t) enter(t)
  }
}

/**
 * Make `root` a card in front of the page (see the top of this file). `box` is
 * where the focus lands when nothing in the card asks for it (give it
 * tabIndex -1); `first` is the card's own choice of where it starts.
 *
 * A layout effect, so the card is the one in front before anything else runs:
 * a card mounting beside another in the same commit (a big moment over the
 * ruler notice) is benched and un-benched before its own buttons try the focus.
 */
export function useLayer(
  root: RefObject<HTMLElement | null>,
  opts: { box?: RefObject<HTMLElement | null>; first?: () => HTMLElement | null | undefined } = {},
): void {
  // what had the focus as the card was drawn — before an autoFocus inside it moved it
  const [before] = useState(() => (typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null))
  const first = opts.first
  const box = opts.box
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const at = document.activeElement as HTMLElement | null
    const back = at && at !== document.body && !el.contains(at) ? at : before && before !== document.body && !el.contains(before) ? before : null
    const l: Layer = { root: el, box: box?.current ?? null, back, first, held: true }
    open(l)
    return () => close(l)
    // once a card: its contents change under it (a match's rounds, the next achievement), the card stays
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
