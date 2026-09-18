/**
 * The career on a phone, measured rather than looked at.
 *
 * Opens each save from scripts/mobile_saves.ts with the home page's 「继续」,
 * walks every screen, the match in each phase, the cards the clock stops on,
 * the player card, the new-career page and the home page with a save on it
 * (its card from a save with no summary and with one, the confirm before a new
 * career, the form behind it), and at each of 320…1440 measures in the page:
 *
 *   page-overflow  the document is wider than the window
 *   overflow-x     a box's content is wider than the box (not a scroller)
 *   clipped-x/-y   the same, hidden by overflow:hidden — text cut off
 *   ellipsis       text cut with an ellipsis
 *   poke-x/-y      text or an image outside its card, tile, panel, button or modal
 *   font<12        on a phone, any text under 12px
 *   font<13        on a phone, text between 12 and 13px (12px is the tiny step, 13px and up is body and small)
 *   tap<40         on a phone, a button, select, link or clickable row under 40px either way
 *   squashed       at any width, a button, select or link under 8px either way
 *
 * and, from a keyboard, each card in front of the page (the list of 键盘 at the
 * end of the report): a dialog with a name, the focus inside it — on its first
 * answer when it asks something — Tab and Shift+Tab going round inside it, the
 * page behind inert and the music window not (ui/me/layer.ts).
 *
 * Intended scroll containers (overflow auto/scroll) are not offenders, and
 * what is inside one is judged by the scroller, not by the card around it.
 *
 * It goes where a player's finger can go, and says so when it cannot. Reported
 * 2026-09-18 by an outside audit: this knew three kinds of card (.modal-bg,
 * .support-card, .share-overlay) and moved between screens with DOM .click(),
 * which presses a button under a full-screen card as readily as one on top. A
 * save that opened on a big moment (大事卡, .moment-bg) had 「我的」「帮助」… in
 * the report as measured, while every shot, long-me.png among them, showed the
 * same card. Now:
 *
 *  - whatever is in front is read off the middle of the window (elementFromPoint):
 *    the tour, a big moment, an achievement card, a ceremony, any other card,
 *    the changelog sheet, the 更多 menu, a poster, a share card. Each one met on
 *    the way is measured once as a scene of its own, then put away with its own
 *    button, pressed the way a finger presses it
 *  - every press is Playwright's, which refuses a button something else covers
 *  - after each move the tab is lit and the middle of the page is the page
 *  - a scene that did not come, a page not reached and an error in the page
 *    are listed, and the run exits 1; a press the page took over two seconds
 *    to answer is listed as slow
 *
 *   node scripts/mobile_audit.mjs <label> [--shots] [--sweep] [--only=<scenario>]
 *
 * Needs the dev server (npx vite --port 5190 --strictPort; AUDIT_URL for another
 * address) and the saves (npx tsx scripts/mobile_saves.ts). Writes
 * .cache/mobile-audit/<label>/report.md, report.json and shots/.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const label = process.argv[2] ?? 'run'
const args = process.argv.slice(3)
const SHOTS = args.includes('--shots')
const SWEEP = args.includes('--sweep')
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7)
const BASE = process.env.AUDIT_URL ?? 'http://localhost:5190/'
const ROOT = '.cache/mobile-audit'
const OUT = `${ROOT}/${label}`
mkdirSync(`${OUT}/shots`, { recursive: true })

const WIDTHS = [320, 360, 375, 390, 414, 430, 768, 820, 1024, 1280, 1440]
// every 16px across the range, for the states a sweep covers: the in-between widths no preset names
const SWEEP_WIDTHS = Array.from({ length: 71 }, (_, i) => 320 + i * 16)
const heightOf = (w) => (w <= 430 ? 812 : w <= 820 ? 1024 : 900)
// the player game's own key (src/engine/me/save.ts); a career under the old manager-namespace key is copied across on first load
const SAVE_KEY = 'val_player:save:autosave'

/* ------------------------------------------------------------------ in the page */

function measure({ phone, root, exclude }) {
  const W = window.innerWidth
  const out = []
  const csCache = new Map()
  const cs = (el) => { let c = csCache.get(el); if (!c) { c = getComputedStyle(el); csCache.set(el, c) } return c }
  const pathOf = (el) => {
    const parts = []
    let e = el
    for (let i = 0; e && e.nodeType === 1 && i < 4 && e !== document.body; i++, e = e.parentElement) {
      let s = e.tagName.toLowerCase()
      const cls = [...e.classList].filter((c) => !/^(on|active|sel|up|dn|ok|bad|win|loss|mine|me|past|next|match|locked|capped|near)$/.test(c)).slice(0, 2)
      if (cls.length) s += '.' + cls.join('.')
      parts.unshift(s)
    }
    return parts.join('>')
  }
  const textOf = (el) => {
    const t = el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text : (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '')
    return String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 36)
  }
  const add = (kind, el, px, extra) => out.push({ kind, sel: pathOf(el), text: textOf(el), px: Math.round(px * 10) / 10, ...(extra ?? {}) })
  const scrolls = (el) => /(auto|scroll)/.test(cs(el).overflowX) || /(auto|scroll)/.test(cs(el).overflowY)

  const docW = document.documentElement.scrollWidth
  if (docW > W + 1) out.push({ kind: 'page-overflow', sel: 'html', text: '', px: docW - W })

  const rootEl = root ? document.querySelector(root) : document.body
  if (!rootEl) return [{ kind: 'no-root', sel: String(root), text: '', px: 0 }]
  const CONT = [
    '.panel', '.tile', '.act-card', 'button', '[role=button]', '.modal', '.node-box', '.week-day', '.hero', '.chip', '.tag',
    '.start-card', '.origin-pick', '.poster-me', '.mt-card', '.support-card', '.toast', '.pinbar', '.topbar', '.light', '.edge-row',
    '.attr-row', '.bar-row', '.ledger-r', '.clout-row', '.shop-row', '.bond-row', '.rv-row', '.breaks', '.round-feed', '.share-card',
    '.score-line', '.mapline', '.nav', '.nav-sheet', '.advance-me', '.advance-go', 'select', 'td', 'th', 'li', '.cer-stage', '.cer-bar',
  ].join(',')
  const TAP = 'button, a[href], select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]), textarea, [role=button], summary'

  for (const el of rootEl.querySelectorAll('*')) {
    if (exclude && el.closest(exclude)) continue
    const tag = el.tagName
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'OPTION') continue
    if (el.closest('svg') && tag.toLowerCase() !== 'svg') continue
    if (el.closest('.sr-only, .cer-barrage, [aria-hidden="true"]')) continue
    // what a closed <details> holds is not on screen, whatever box the engine still gives it — its own summary aside,
    // and only when every <details> around it is open too: 转会's 「挑一家接触」 holds a closed list of closed groups, and
    // the groups' summaries were measured as text 4000px outside the panel (2026-09-18)
    let hidden = false
    for (let d = el.closest('details:not([open])'); d && !hidden; d = d.parentElement?.closest('details:not([open])')) {
      if (el !== d && el.closest('summary')?.parentElement !== d) hidden = true
    }
    if (hidden) continue
    const s = cs(el)
    if (s.display === 'none' || s.visibility !== 'visible') continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    const inline = s.display === 'inline' || s.display === 'contents'
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())

    // 1. content wider or taller than its box
    if (!inline && el.clientWidth > 0) {
      if (!/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1) {
        const kind = s.textOverflow === 'ellipsis' ? 'ellipsis' : /(hidden|clip)/.test(s.overflowX) ? 'clipped-x' : 'overflow-x'
        add(kind, el, el.scrollWidth - el.clientWidth)
      }
      if (!/(auto|scroll)/.test(s.overflowY) && /(hidden|clip)/.test(s.overflowY) && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1) {
        add('clipped-y', el, el.scrollHeight - el.clientHeight)
      }
    }

    // 2. text or a picture outside the card it belongs to
    const leaf = hasText || /^(IMG|INPUT|SELECT|TEXTAREA|CANVAS)$/.test(tag) || tag.toLowerCase() === 'svg'
    if (leaf) {
      let box = null
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (scrolls(a)) break
        // a wrapper with display: contents draws no box of its own; the box is further up
        if (a.matches(CONT) && cs(a).display !== 'contents') { box = a; break }
      }
      if (box) {
        let rr = r
        if (hasText) {
          const range = document.createRange()
          range.selectNodeContents(el)
          const rects = [...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0)
          if (rects.length) {
            rr = {
              left: Math.min(...rects.map((x) => x.left)), right: Math.max(...rects.map((x) => x.right)),
              top: Math.min(...rects.map((x) => x.top)), bottom: Math.max(...rects.map((x) => x.bottom)),
            }
          }
        }
        const b = box.getBoundingClientRect()
        const dx = Math.max(rr.right - b.right, b.left - rr.left)
        const dy = Math.max(rr.bottom - b.bottom, b.top - rr.top)
        if (dx > 1) add('poke-x', el, dx, { box: pathOf(box) })
        if (dy > 1 && s.position !== 'absolute' && s.position !== 'fixed') add('poke-y', el, dy, { box: pathOf(box) })
      }
    }

    // 3. type size on a phone
    if (phone && hasText) {
      const fs = parseFloat(s.fontSize)
      if (fs < 11.99) add('font<12', el, fs)
      else if (fs > 12.01 && fs < 12.99) add('font<13', el, fs)
    }

    // 4a. something to tap squeezed to a sliver on one side while what it holds still shows, at any width (reported
    //     2026-09-18: a title's five face buttons came out 0×40 on a phone and 5×22 on a computer, piled on one spot)
    if (el.matches(TAP) && (r.width < 8 || r.height < 8)) add('squashed', el, Math.min(r.width, r.height), { size: `${Math.round(r.width)}x${Math.round(r.height)}` })

    // 4b. something to tap, on a phone
    if (phone) {
      const pointerRoot = s.cursor === 'pointer' && el.parentElement && cs(el.parentElement).cursor !== 'pointer' && !el.matches('label, option, img')
      if (el.matches(TAP) || pointerRoot) {
        if (r.height < 39.5 || r.width < 39.5) add('tap<40', el, Math.min(r.width, r.height), { size: `${Math.round(r.width)}x${Math.round(r.height)}` })
      }
    }
  }
  // 5. words drawn in an SVG (the radar's axis names, a map's site letters): cut by the picture's own edge, or outside its card
  for (const t of rootEl.querySelectorAll('svg text')) {
    if (exclude && t.closest(exclude)) continue
    const svg = t.ownerSVGElement
    if (!svg || !t.textContent.trim()) continue
    const tr = t.getBoundingClientRect()
    if (!tr.width && !tr.height) continue
    const sr = svg.getBoundingClientRect()
    if (/(hidden|clip)/.test(cs(svg).overflow)) {
      const d = Math.max(tr.right - sr.right, sr.left - tr.left, tr.bottom - sr.bottom, sr.top - tr.top)
      if (d > 1) add('svg-clip', t, d, { box: pathOf(svg) })
      continue
    }
    let box = null
    for (let a = svg.parentElement; a && a !== document.body; a = a.parentElement) {
      if (scrolls(a)) break
      if (a.matches(CONT) && cs(a).display !== 'contents') { box = a; break }
    }
    if (!box) continue
    const b = box.getBoundingClientRect()
    const d = Math.max(tr.right - b.right, b.left - tr.left)
    if (d > 1) add('poke-x', t, d, { box: pathOf(box) })
  }
  // one line per thing, however many text nodes it has
  const seen = new Map()
  for (const o of out) {
    const k = `${o.kind}|${o.sel}|${o.text}`
    const had = seen.get(k)
    if (!had) seen.set(k, { ...o, n: 1 })
    else { had.n++; had.px = Math.max(had.px, o.px) }
  }
  return [...seen.values()]
}

/* ------------------------------------------------------------------ the run */

const results = []
/** what the keyboard found on each card in front of the page (keyboard below) */
const keys = []
const errors = []
/** scenario · page for every page the run set out to measure and could not reach */
const unreached = []
/** scenario · page for every page it reached, lit in the tab bar and uncovered */
const reached = []
/** layers met on the way and put away, scenario · kind · name */
const layersSeen = []
// never a sound out of the machine running it (2026-09-18: preview tabs played the game's music out loud on the
// author's computer): Chromium muted, and the music window (ui/me/MusicPlayer.tsx) seeded paused and silent below
const browser = await chromium.launch({ args: ['--mute-audio'] })
const MUSIC_KEY = 'valplayer.music'
const MUSIC_OFF = JSON.stringify({ vol: 0, muted: true, loop: 'all', track: 0, off: true, open: false })

const settle = async (page, ms = 60) => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  if (ms) await page.waitForTimeout(ms)
}

/**
 * What is in front, read off the middle of the window: every card that can sit
 * over the page covers all of it (position: fixed; inset: 0, or a veil that
 * does), so the element under the middle belongs to the top one. null when it
 * is the page itself. `kind` is one of tour, moment, ach-pop, ceremony, share,
 * modal, sheet, nav-more, poster, pack, or unknown for something else on top.
 */
function topLayerInPage() {
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  const hit = document.elementFromPoint(Math.floor(innerWidth / 2), Math.floor(innerHeight / 2))
  if (!hit) return null
  const mark = (el) => {
    for (const x of document.querySelectorAll('[data-audit-layer]')) x.removeAttribute('data-audit-layer')
    el?.setAttribute('data-audit-layer', '1')
  }
  let el
  if ((el = hit.closest('.mt-veil, .mt-card, .mt-hole'))) {
    const card = document.querySelector('.mt-card')
    mark(card)
    return { kind: 'tour', name: clean(card?.querySelector('h3')?.textContent) }
  }
  if ((el = hit.closest('.tour-bg, .tut-bg, .tut-card'))) { mark(el); return { kind: 'tour', name: clean(el.querySelector('h3')?.textContent) } }
  if ((el = hit.closest('.moment-bg'))) {
    mark(el)
    const eyebrow = clean(el.querySelector('.mo-eyebrow')?.textContent)
    return { kind: /成就/.test(eyebrow) ? 'ach-pop' : 'moment', name: clean(el.querySelector('.mo-title')?.textContent) || eyebrow }
  }
  if ((el = hit.closest('.modal-bg'))) {
    mark(el)
    const name = clean(el.querySelector('.modal-head h3')?.textContent)
    if (el.classList.contains('share-overlay')) return { kind: 'share', name: 'share-card' }
    if (el.querySelector('.cer-story, .cer-game, .cer-tones, .cer-tier')) return { kind: 'ceremony', name }
    return { kind: 'modal', name }
  }
  if (hit.closest('.support-veil, .support-card')) {
    const card = [...document.querySelectorAll('.support-card')].pop()
    mark(card)
    return { kind: 'sheet', name: clean(card?.querySelector('h3')?.textContent) }
  }
  if (hit.closest('.nav-scrim')) return { kind: 'nav-more', name: '更多' }
  if ((el = hit.closest('.poster-bg'))) { mark(el); return { kind: 'poster', name: clean(el.getAttribute('aria-label')) } }
  if ((el = hit.closest('.pack-stage'))) { mark(el); return { kind: 'pack', name: '' } }
  // the page: the career, the new-career page, the home page's save card
  if (hit.closest('.app.career, .newcareer')) return null
  const path = []
  for (let e = hit; e && e !== document.body && path.length < 3; e = e.parentElement) path.unshift(e.tagName.toLowerCase() + [...e.classList].slice(0, 2).map((c) => `.${c}`).join(''))
  return { kind: 'unknown', name: path.join('>') }
}
const topLayer = (page) => page.evaluate(topLayerInPage)

/** the layer in front, or the page, to measure; a page is measured without any card that might still be there */
async function rootOf(page) {
  const top = await topLayer(page)
  if (top && top.kind !== 'nav-more' && top.kind !== 'unknown') return { root: '[data-audit-layer]', exclude: null }
  return page.evaluate(() => ({
    root: document.querySelector('.app.career') ? '.app.career' : '.newcareer',
    exclude: '.modal-bg, .moment-bg, .support-card, .mt-card, .poster-bg, .pack-stage',
  }))
}

async function measureAll(page, scenario, state, opts = {}) {
  const widths = opts.widths ?? WIDTHS
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: heightOf(w) })
    await settle(page, opts.wait ?? 60)
    const where = await rootOf(page)
    const offenders = await page.evaluate(measure, { phone: w <= 430, ...where })
    results.push({ scenario, state, width: w, offenders, sweep: !!opts.sweep })
    if (SHOTS && w === 375 && opts.shot) await page.screenshot({ path: `${OUT}/shots/${opts.shot}.png` })
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await settle(page)
}

const CARDS = '.modal-bg, .moment-bg, .support-card, .share-overlay'

/**
 * The card in front, from a keyboard (reported 2026-09-18: an event card was no
 * dialog and took no focus, and Tab walked from its answers out to 回到首页,
 * 推进一周 and 本周 behind the veil, then round the music window). A dialog with
 * a name; the focus inside it, on the first answer of a card that asks
 * something; the page behind inert and the music window not; Tab and Shift+Tab
 * never leaving it. opts.escape: 'stays' (a card answered, not closed) or
 * 'closes'. Returns what it found; the report lists it under 键盘.
 */
async function keyboard(page, scenario, state, opts = {}) {
  const found = []
  const add = (kind, text = '') => found.push({ kind, text })
  const at = await page.evaluate((CARDS) => {
    for (const el of document.querySelectorAll('[data-kb-top]')) el.removeAttribute('data-kb-top')
    const cards = [...document.querySelectorAll(CARDS)]
    const top = cards.filter((c) => !c.closest('[inert]')).pop() ?? cards.pop()
    if (!top) return null
    top.setAttribute('data-kb-top', '1')
    const dlg = top.matches('[role=dialog], [role=alertdialog]') ? top : top.querySelector('[role=dialog], [role=alertdialog]')
    const a = document.activeElement
    const tabs = [...top.querySelectorAll('button, a[href], select, input, textarea, summary, [tabindex]')]
      .filter((el) => el.tabIndex >= 0 && !el.disabled && el.getClientRects().length > 0)
    // a control on the page behind that is still live (the music window, the update and save bars and the tour's card
    // stand above the cards and stay live on purpose)
    const live = [...document.querySelectorAll('button, a[href], select, input, textarea')].find((el) =>
      !top.contains(el) && !el.closest('.bgm, .toast, .update-nudge, .save-chip, .mt-card') && el.getClientRects().length > 0 && !el.closest('[inert]'))
    const label = dlg && (dlg.getAttribute('aria-label') || document.getElementById(dlg.getAttribute('aria-labelledby') ?? '')?.textContent)
    return {
      dialog: !!dlg,
      modal: dlg?.getAttribute('aria-modal') === 'true',
      named: !!label?.trim(),
      inside: !!a && a !== document.body && top.contains(a),
      asks: !!top.querySelector('.node-opt button'),
      first: !!a && a === top.querySelector('.node-opt button'),
      n: tabs.length,
      behindLive: live ? (live.getAttribute('aria-label') || live.textContent || live.tagName).trim().replace(/\s+/g, ' ').slice(0, 24) : null,
      musicInert: !!document.querySelector('.bgm')?.closest('[inert]'),
    }
  }, CARDS)
  if (!at) {
    add('kb:no-card')
  } else {
    if (!at.dialog) add('kb:no-dialog')
    else {
      if (!at.modal) add('kb:not-modal')
      if (!at.named) add('kb:no-name')
    }
    if (!at.inside) add('kb:focus-outside')
    else if (at.asks && !at.first) add('kb:not-first-answer')
    if (at.behindLive) add('kb:page-live', at.behindLive)
    if (at.musicInert) add('kb:music-inert')
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < at.n + 2; i++) {
        await page.keyboard.press(key)
        const out = await page.evaluate(() => {
          const a = document.activeElement
          const top = document.querySelector('[data-kb-top]')
          if (top && a && top.contains(a)) return null
          return !a || a === document.body ? '(页面外)' : (a.getAttribute('aria-label') || a.textContent || a.tagName).trim().replace(/\s+/g, ' ').slice(0, 24)
        })
        if (out) { add('kb:tab-leak', `${key} → ${out}`); break }
      }
    }
    if (opts.escape) {
      const title = () => page.evaluate(() => document.querySelector('[data-kb-top]')?.textContent.slice(0, 40) ?? null)
      const was = await title()
      await page.keyboard.press('Escape')
      await settle(page, 150)
      const now = await title()
      if (opts.escape === 'stays' && now !== was) add('kb:escape-closed')
      if (opts.escape === 'closes' && now) add('kb:escape-stayed')
    }
  }
  keys.push({ scenario, state, n: at?.n ?? 0, found })
  return found
}

/** presses the page took more than SLOW_MS to answer: the page froze on them (measured from the press to the next frame) */
const slow = []
const SLOW_MS = 2000

/**
 * A real press: Playwright waits for the element to be visible, steady and the one the pointer would land on.
 * A press that went in while the page is still busy with it is waited out and listed as slow, not as missed
 * (the long save's 转会 took 11 s to open the first time, 2026-09-18).
 */
async function press(page, locator, what, scenario, quiet = false) {
  const t = Date.now()
  const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(0))))
  try {
    await locator.click({ timeout: 5000 })
  } catch (e) {
    const msg = String(e.message ?? e)
    const log = msg.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim().replace(/^-\s*/, '')).filter(Boolean)
    if (/Timeout/.test(log[0]) && log[log.length - 1] === 'performing click action') {
      await frame()
      slow.push({ scenario: scenario ?? '', what, ms: Date.now() - t })
      return true
    }
    // Playwright's log says why: what covers the button, or that it never held still, showed or enabled
    const why = [...new Set(log.filter((l) => /intercepts pointer events|not stable|not visible|not enabled|outside of the viewport/.test(l)))].slice(-2)
    if (!quiet) errors.push(`${scenario}: could not press ${what}: ${log[0]}${why.length ? ` (${why.join('; ')})` : ''}`)
    return false
  }
  await frame()
  const ms = Date.now() - t
  if (ms > SLOW_MS) slow.push({ scenario: scenario ?? '', what, ms })
  return true
}

/** each kind's own way out, the button a player would press */
const WAY_OUT = {
  tour: ['.mt-card .mt-head button', '.tut-card button', '.tour-bg button'],
  moment: ['[data-audit-layer] .mo-acts button.primary'],
  'ach-pop': ['[data-audit-layer] .mo-acts button.primary'],
  ceremony: ['[data-audit-layer] .modal-head button'],
  modal: ['[data-audit-layer] .modal-head button'],
  share: ['[data-audit-layer] button:has-text("关闭")'],
  sheet: ['[data-audit-layer] .support-head button'],
  'nav-more': ['.nav-more .nav-item'],
  poster: ['[data-audit-layer] button.primary'],
}
const LAYER_WIDTHS = [320, 375, 430, 768]

/**
 * Put away what is in front until the page shows, or a kind in `keep` is on top.
 * Each layer met is measured once in a scenario, as a scene of its own. Returns
 * what is still in front (null for the page).
 */
async function clearLayers(page, scenario, { keep = [], measureLayers = true } = {}) {
  let last = ''
  let same = 0
  for (let i = 0; i < 16; i++) {
    const top = await topLayer(page)
    if (!top || keep.includes(top.kind)) return top
    const key = `${top.kind}:${top.name}`
    same = key === last ? same + 1 : 0
    last = key
    if (same >= 2) { errors.push(`${scenario}: ${top.kind}「${top.name}」stays in front after pressing its way out`); return top }
    if (!layersSeen.some((x) => x.scenario === scenario && x.key === key)) {
      layersSeen.push({ scenario, key })
      if (measureLayers && top.kind !== 'nav-more' && top.kind !== 'unknown') await measureAll(page, scenario, `layer:${key}`, { widths: LAYER_WIDTHS })
    }
    const ways = WAY_OUT[top.kind]
    if (!ways) { errors.push(`${scenario}: something unknown is in front (${top.name})`); return top }
    let out = false
    for (const sel of ways) {
      const b = page.locator(sel)
      if (!(await b.count())) continue
      if (await press(page, b.last(), `${top.kind}「${top.name}」's way out`, scenario, true)) { out = true; break }
    }
    if (!out) { errors.push(`${scenario}: no button puts away ${top.kind}「${top.name}」`); return top }
    await settle(page, 250)
  }
  return topLayer(page)
}

/** opts.save: the save file when it is not named after the scenario; opts.stay: stay on the home page rather than continue */
async function withSave(name, fn, opts = {}) {
  if (ONLY && !name?.includes(ONLY) && !(name === null && 'newcareer'.includes(ONLY))) return
  const file = name ? `${ROOT}/saves/${opts.save ?? name}.txt` : null
  if (file && !existsSync(file)) { errors.push(`${name}: no save file ${file}`); return }
  const text = file ? readFileSync(file, 'utf8') : null
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(([key, text, musicKey, musicOff]) => {
    try {
      // every load, a reload too: the music stays off whatever the page wrote since
      localStorage.setItem(musicKey, musicOff)
      if (sessionStorage.getItem('audit-seeded')) return
      localStorage.clear()
      localStorage.setItem(musicKey, musicOff)
      if (text) localStorage.setItem(key, text)
      localStorage.setItem('val_player.tour.off', '1')
      for (const k of ['pre', 'club', 'season']) localStorage.setItem(`val_player.tour.${k}`, '1')
      sessionStorage.setItem('audit-seeded', '1')
    } catch (e) { console.error('seed failed: ' + e) }
  }, [SAVE_KEY, text, MUSIC_KEY, MUSIC_OFF])
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)
  const who = name ?? 'newcareer'
  page.on('pageerror', (e) => errors.push(`${who}: page error ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${who}: console ${m.text().slice(0, 160)}`) })
  const t = Date.now()
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.newcareer, .app.career', { timeout: 60000 })
    if (text && !opts.stay) {
      await page.getByRole('button', { name: '继续', exact: true }).click()
      await page.waitForSelector('.app.career', { timeout: 60000 })
    }
    await settle(page, 300)
    await fn(page)
  } catch (e) {
    errors.push(`${who}: ${String(e.message ?? e).split('\n')[0]}`)
  } finally {
    console.log(`  ${who} ${((Date.now() - t) / 1000).toFixed(0)}s`)
    await ctx.close()
  }
}

/** the page a screen shows, told apart from the one before it */
const lastSig = new Map()

/**
 * To a screen by its tab, as a finger gets there: whatever is in front put away
 * first, 更多 opened when a phone keeps the tab under it. It counts as reached
 * when the tab is lit and the middle of the page area is the page, not a card.
 */
async function go(page, scenario, label) {
  const fail = (why) => { unreached.push(`${scenario} · ${label}`); errors.push(`${scenario}: page ${label} not reached — ${why}`); return false }
  const top = await clearLayers(page, scenario)
  if (top) return fail(`${top.kind}「${top.name}」in front`)
  const item = page.locator('.nav .nav-item').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first()
  if (!(await item.count())) return fail('no tab')
  if (!(await item.isVisible())) {
    // a phone's tab bar holds four and 更多
    const more = page.locator('.nav-more .nav-item')
    if (!(await more.count()) || !(await press(page, more, '更多', scenario))) return fail('更多 would not open')
    await settle(page, 150)
  }
  if (!(await press(page, item, `the tab ${label}`, scenario))) return fail('the tab could not be pressed')
  await settle(page, 200)
  const at = await page.evaluate((label) => {
    const lit = [...document.querySelectorAll('.nav .nav-item.active')].map((b) => b.textContent.trim()).filter((t) => t !== '更多')
    const main = document.querySelector('#main')
    if (!main) return { lit, covered: 'no #main', sig: '' }
    const r = main.getBoundingClientRect()
    const top = Math.max(r.top, 0)
    const bottom = Math.min(r.bottom, innerHeight)
    const x = Math.floor(Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 2))
    const y = Math.floor(bottom > top ? (top + bottom) / 2 : innerHeight / 2)
    const hit = document.elementFromPoint(x, y)
    const covered = hit && !main.contains(hit) ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}` : null
    // the whole page's words, hashed: a retired career's pages all open on the same poster
    const text = main.innerText.replace(/\s+/g, ' ')
    let h = 0
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
    return { lit, covered, sig: `${text.length}:${h}` }
  }, label)
  if (!at.lit.includes(label)) return fail(`the lit tab is ${at.lit.join('/') || 'none'}`)
  if (at.covered) return fail(`the middle of the page is ${at.covered}`)
  const prev = lastSig.get(scenario)
  if (prev && prev.label !== label && prev.sig === at.sig) return fail(`it shows the same thing as ${prev.label}`)
  lastSig.set(scenario, { label, sig: at.sig })
  reached.push(`${scenario} · ${label}`)
  return true
}

async function closeTop(page, scenario) {
  const b = page.locator('.modal-bg').last().locator('.modal-head button')
  if (await b.count()) await press(page, b.first(), 'the card\'s 关闭', scenario)
  await settle(page, 150)
}

async function screens(page, name, list, shots = {}) {
  for (const s of list) {
    if (!(await go(page, name, s))) continue
    await measureAll(page, name, `screen:${s}`, { shot: shots[s] })
  }
}

const topModal = (page) => page.evaluate(() => {
  const m = [...document.querySelectorAll('.modal-bg')].pop()
  if (!m) return 'page'
  const t = m.querySelector('.modal-head h3')?.textContent ?? ''
  if (m.querySelector('.node-opt button') && !/试训|事件|直播/.test(t)) return 'node'
  if ([...m.querySelectorAll('button')].some((b) => b.textContent.startsWith('开始下一把'))) return 'break'
  if ([...m.querySelectorAll('button')].some((b) => b.textContent.trim() === '逐回合观战')) return 'pre'
  if (t === '终场') return 'done'
  if (m.querySelector('.score-line') && [...m.querySelectorAll('button')].some((b) => b.textContent.trim() === '快进剩余')) return 'live'
  return 'other'
})

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** a button on the card in front whose words start with `text`, pressed */
async function clickText(page, text, scenario) {
  const b = page.locator('.modal-bg').last().locator('button').filter({ hasText: new RegExp(`^\\s*${escRe(text)}`) })
  if (!(await b.count())) return false
  return press(page, b.first(), `「${text}」`, scenario)
}

/** press the week's button until the match opens, answering anything in the way the plain way */
async function toMatch(page, scenario) {
  for (let i = 0; i < 12; i++) {
    // a big moment or an achievement over the week goes first, as it does for a player
    const top = await clearLayers(page, scenario, { keep: ['modal', 'ceremony'] })
    if (top?.kind === 'ceremony') {
      // a ceremony on the way is walked past (silver), not played
      await press(page, page.locator('[data-audit-layer] .modal-head button'), 'the ceremony\'s 关闭', scenario)
      await settle(page, 400)
      continue
    }
    const at = await topModal(page)
    if (at === 'pre') return true
    if (at === 'other') {
      const m = page.locator('.modal-bg').last()
      const b = (await m.locator('.node-opt button').count()) ? m.locator('.node-opt button')
        : (await m.locator('button.primary').count()) ? m.locator('button.primary') : m.locator('.modal-body button')
      if (!(await press(page, b.first(), 'the card\'s answer', scenario))) return false
    } else if (at === 'page') {
      if (!(await press(page, page.locator('.advance-me button.primary').first(), 'the week\'s button', scenario))) return false
    } else return false
    await settle(page, 500)
  }
  return false
}

async function waitFor(page, phases, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const at = await topModal(page)
    if (phases.includes(at)) return at
    await page.waitForTimeout(250)
  }
  return topModal(page)
}

/** a scene the run expected and did not get */
const missing = (scenario, what) => errors.push(`${scenario}: missing scene ${what}`)

const PRE = ['本周', '我的', '转会', '经济', '积分榜', '成就', '日志', '托管', '帮助']
const PRO = ['本周', '我的', '队伍', '转会', '经济', '赛程', '积分榜', '成就', '日志', '托管', '帮助']

// ---- the new-career page
await withSave(null, async (page) => {
  await measureAll(page, 'newcareer', 'new-career', { shot: 'newcareer' })
  // the third door, a club start: the club is the game's pick, and the form says so
  const door = page.locator('.start-grid').nth(1).locator('button').nth(2)
  if (!(await press(page, door, 'the third door', 'newcareer'))) return
  await settle(page, 200)
  if (!/\bon\b/.test((await door.getAttribute('class')) ?? '')) { missing('newcareer', 'new-career:club (the door did not take)'); return }
  await measureAll(page, 'newcareer', 'new-career:club')
})

// ---- the home page with a save on it: a save from before the summary, the confirm on 开新生涯, the card once
//      continuing has written a summary, and the form behind the confirm
await withSave('home', async (page) => {
  await page.waitForSelector('.save-card', { timeout: 60000 })
  await measureAll(page, 'home', 'home:old-save', { shot: 'home-old-save' })
  await page.getByRole('button', { name: '开新生涯', exact: true }).click()
  await settle(page, 150)
  await measureAll(page, 'home', 'home:confirm', { shot: 'home-confirm' })
  await keyboard(page, 'home', 'home:confirm')
  await page.locator('.modal-bg').getByRole('button', { name: '取消', exact: true }).click()
  await settle(page, 150)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.waitForSelector('.app.career', { timeout: 60000 })
  await settle(page, 400)
  // back to the front page, where the first autosave's summary now draws the card
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.save-card .save-tile', { timeout: 60000 })
  await settle(page, 300)
  await measureAll(page, 'home', 'home:save', { shot: 'home-save' })
  await page.getByRole('button', { name: '开新生涯', exact: true }).click()
  await settle(page, 150)
  await page.locator('.modal-bg').getByRole('button', { name: '开新生涯', exact: true }).click()
  await settle(page, 250)
  await measureAll(page, 'home', 'home:form', { shot: 'home-form' })
}, { save: 'chal-days', stay: true })

// ---- a ladder start, first week
await withSave('pre-w0', async (page) => {
  await screens(page, 'pre-w0', PRE, { 本周: 'week-pre' })
  if (SWEEP && await go(page, 'pre-w0', '本周')) await measureAll(page, 'pre-w0', 'screen:本周', { widths: SWEEP_WIDTHS, sweep: true, wait: 30 })
  // the changelog card
  if (await clearLayers(page, 'pre-w0')) return
  if (!(await press(page, page.locator('.log-fab'), '更新日志', 'pre-w0'))) return
  await settle(page, 200)
  if ((await topLayer(page))?.kind === 'sheet' && await page.locator('.log-card').count()) {
    await measureAll(page, 'pre-w0', 'changelog')
    const found = await keyboard(page, 'pre-w0', 'changelog', { escape: 'closes' })
    // closed, the focus is back on the corner button that opened it (a press focuses it, as a finger's does)
    if (!(await page.evaluate(() => document.activeElement?.classList.contains('log-fab')))) found.push({ kind: 'kb:focus-not-back', text: '更新日志' })
    await clearLayers(page, 'pre-w0', { measureLayers: false })
  } else missing('pre-w0', 'changelog')
})

// ---- twenty weeks in, then a run to the end of the stage and its summary
await withSave('pre-w20', async (page) => {
  await screens(page, 'pre-w20', PRE)
  if (!(await go(page, 'pre-w20', '本周'))) return
  const far = page.locator('select.advance-far')
  if (!(await far.count()) || await far.isDisabled()) { missing('pre-w20', 'summary (快进 is not open)'); return }
  await far.selectOption('stage')
  await settle(page, 1500)
  // the run is over when a card comes up: its summary, or a decision it stopped for
  for (let t = 0; t < 80 && !(await topLayer(page)); t++) await page.waitForTimeout(250)
  let got = false
  for (let i = 0; i < 6 && !got; i++) {
    const top = await clearLayers(page, 'pre-w20', { keep: ['modal', 'ceremony'] })
    if (!top) break
    if (top.name.startsWith('推进总结')) { await measureAll(page, 'pre-w20', 'summary'); got = true; break }
    const m = page.locator('[data-audit-layer]')
    const b = (await m.locator('.node-opt button').count()) ? m.locator('.node-opt button') : m.locator('button.primary')
    if (!(await b.count()) || !(await press(page, b.first(), `the answer on「${top.name}」`, 'pre-w20'))) break
    await settle(page, 800)
  }
  if (!got) missing('pre-w20', 'summary')
})

// ---- a Challengers starter, a week of days, the evening before a match
await withSave('chal-days', async (page) => {
  await screens(page, 'chal-days', PRO, { 本周: 'week-pro-days', 我的: 'me', 队伍: 'team' })
  if (SWEEP) {
    for (const s of ['本周', '我的', '队伍']) if (await go(page, 'chal-days', s)) await measureAll(page, 'chal-days', `screen:${s}`, { widths: SWEEP_WIDTHS, sweep: true, wait: 30 })
  }
  // the player card, from the roster
  if (await go(page, 'chal-days', '队伍')) {
    const row = page.locator('#main tr.clickable').first()
    if (await row.count() && await press(page, row, 'a roster row', 'chal-days')) {
      await settle(page, 300)
      if ((await topLayer(page))?.kind === 'modal') {
        await measureAll(page, 'chal-days', 'player-card', { shot: 'player-card' })
        await keyboard(page, 'chal-days', 'player-card', { escape: 'stays' })
        await closeTop(page, 'chal-days')
      } else missing('chal-days', 'player-card')
    } else missing('chal-days', 'player-card (no roster row)')
  }
  // a played match's sheet, from 最近的比赛 on the week page
  if (await go(page, 'chal-days', '本周')) {
    const row = page.locator('#main .panel-body.flush table tr.clickable').first()
    if (await row.count() && await press(page, row, 'a played match', 'chal-days')) {
      await settle(page, 400)
      if ((await topLayer(page))?.kind === 'modal') {
        await measureAll(page, 'chal-days', 'match-sheet')
        await keyboard(page, 'chal-days', 'match-sheet')
        await closeTop(page, 'chal-days')
      } else missing('chal-days', 'match-sheet')
    } else missing('chal-days', 'match-sheet (no played match)')
  }
  // the match, phase by phase
  if (!(await go(page, 'chal-days', '本周'))) return
  if (!(await toMatch(page, 'chal-days'))) { missing('chal-days', 'match:pre (the match did not open)'); return }
  await measureAll(page, 'chal-days', 'match:pre', { shot: 'match-pre' })
  await keyboard(page, 'chal-days', 'match:pre')
  if (SWEEP) await measureAll(page, 'chal-days', 'match:pre', { widths: SWEEP_WIDTHS, sweep: true, wait: 30 })
  if (!(await clickText(page, '逐回合观战', 'chal-days'))) { missing('chal-days', 'match:live'); return }
  await page.waitForTimeout(1500)
  await measureAll(page, 'chal-days', 'match:live', { widths: [320, 375, 430, 768, 1280] })
  let at = await waitFor(page, ['node', 'break', 'done'], 120000)
  let sawNode = false
  let sawBreak = false
  for (let guard = 0; guard < 12 && at !== 'done'; guard++) {
    if (at === 'node') {
      if (!sawNode) { await measureAll(page, 'chal-days', 'match:node', { shot: 'match-node' }); sawNode = true }
      await press(page, page.locator('.modal-bg').last().locator('.node-opt button').first(), 'a key-round option', 'chal-days')
    } else if (at === 'break') {
      if (!sawBreak) { await measureAll(page, 'chal-days', 'match:break', { shot: 'match-break' }); sawBreak = true }
      await clickText(page, sawNode ? '快进剩余' : '开始下一把', 'chal-days')
    }
    // live or other: nothing asked yet, wait for the next beat
    at = await waitFor(page, ['node', 'break', 'done'], 120000)
  }
  if (at === 'done') await measureAll(page, 'chal-days', 'match:done', { shot: 'match-post' })
  else missing('chal-days', `match:done (the match ended in ${at})`)
})

// ---- a VCT club at an international event
await withSave('t1-intl', async (page) => {
  await screens(page, 't1-intl', ['本周', '队伍', '赛程', '积分榜'], { 本周: 'week-t1-intl' })
  if (!(await go(page, 't1-intl', '本周'))) return
  if (!(await toMatch(page, 't1-intl'))) { missing('t1-intl', 'match:pre (the match did not open)'); return }
  await measureAll(page, 't1-intl', 'match:pre')
  if (!(await clickText(page, '快进到结果', 't1-intl'))) { missing('t1-intl', 'match:done (no 快进到结果)'); return }
  if ((await waitFor(page, ['done'], 20000)) === 'done') await measureAll(page, 't1-intl', 'match:done')
  else missing('t1-intl', 'match:done')
})

// ---- eight seasons in
await withSave('long', async (page) => {
  await screens(page, 'long', PRO, { 我的: 'long-me', 成就: 'long-awards' })
})

// ---- the ending, the card, the page after
await withSave('retired-ending', async (page) => {
  const top = await clearLayers(page, 'retired-ending', { keep: ['modal'] })
  if (top?.kind !== 'modal') { missing('retired-ending', 'modal:ending'); return }
  await measureAll(page, 'retired-ending', 'modal:ending', { shot: 'modal-ending' })
  await keyboard(page, 'retired-ending', 'modal:ending')
  if (!(await clickText(page, '生成生涯名片图', 'retired-ending'))) { missing('retired-ending', 'share-card (no button)'); return }
  await settle(page, 1500)
  if (await page.locator('.share-card').count()) {
    await measureAll(page, 'retired-ending', 'share-card')
    const found = await keyboard(page, 'retired-ending', 'share-card', { escape: 'closes' })
    // closed, the focus is back on the button that made it, on the ending's card
    if (!(await page.evaluate(() => document.activeElement?.textContent.trim().startsWith('生成生涯名片图')))) found.push({ kind: 'kb:focus-not-back', text: '生成生涯名片图' })
  } else missing('retired-ending', 'share-card')
})
await withSave('retired', async (page) => {
  await screens(page, 'retired', ['本周', '我的', '成就', '日志', '帮助'], { 本周: 'retired' })
})

// ---- one save per card the clock stops on, and a title's full-screen card
for (const m of ['cup', 'invite', 'tryout', 'deal', 'event', 'ceremony', 'hurt', 'trait', 'season', 'title']) {
  await withSave(`modal-${m}`, async (page) => {
    // a big moment or an achievement queued in the save comes first, as it does for a player; a title's card is the scenario itself
    const want = m === 'ceremony' ? 'ceremony' : m === 'title' ? 'moment' : 'modal'
    const top = await clearLayers(page, `modal-${m}`, { keep: [want] })
    if (top?.kind !== want) { missing(`modal-${m}`, `modal:${m} (in front: ${top ? `${top.kind}「${top.name}」` : 'the page'})`); return }
    await measureAll(page, `modal-${m}`, `modal:${m}`, { shot: m === 'invite' ? 'modal-invite' : m === 'ceremony' ? 'modal-ceremony' : m === 'title' ? 'modal-title' : undefined })
    if (SWEEP && (m === 'deal' || m === 'title')) await measureAll(page, `modal-${m}`, `modal:${m}`, { widths: SWEEP_WIDTHS, sweep: true, wait: 30 })
    // a title's card opens on its own button, 收下, with the history line (me/worldline.ts) above the five as text
    const primary = m === 'title' && await page.evaluate(() => document.activeElement === document.querySelector('.moment-bg .mo-acts .primary'))
    // the cards that are answered, not closed: Escape leaves them up
    const found = await keyboard(page, `modal-${m}`, `modal:${m}`, { escape: m === 'event' || m === 'tryout' ? 'stays' : undefined })
    if (m === 'title' && !primary) found.push({ kind: 'kb:not-primary', text: '收下' })
    if (m === 'event') {
      // answered from the keyboard: the result goes up in front, with the focus in it
      await page.evaluate(() => document.querySelector('.modal-bg .node-opt button')?.focus())
      await page.keyboard.press('Enter')
      await settle(page, 300)
      await keyboard(page, `modal-${m}`, 'modal:event:result')
    }
    if (m === 'title') await titleFaces(page)
  })
}

/**
 * A title's five, from the keyboard: each face a real button, and the player's
 * card it opens stands in front of the title rather than under it (a player's
 * card is a card at 50, a big moment 60), keeps the keys to itself — Escape and
 * Enter used to press 收下 under it — and gives the focus back to the face.
 */
async function titleFaces(page) {
  const found = []
  // the achievements the run unlocked are big cards too, next in line: the title is told by its own words
  const heading = () => page.evaluate(() => document.querySelector('.moment-bg .mo-title')?.textContent ?? null)
  const title = await heading()
  const n = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.mo-people .face-btn')]
    b[1]?.focus()
    return b.filter((x) => x.getBoundingClientRect().width >= 30).length
  })
  if (n < 5) found.push({ kind: 'faces', text: `${n}/5 个头像按钮有宽度` })
  await page.keyboard.press('Enter')
  await settle(page, 400)
  const card = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.modal-bg')].pop()
    const b = m?.querySelector('.modal')?.getBoundingClientRect()
    const hit = b && document.elementFromPoint(b.left + b.width / 2, b.top + Math.min(40, b.height / 2))
    return { open: !!m, front: !!(hit && m.contains(hit)), focus: !!m && m.contains(document.activeElement) }
  })
  if (!card.open) found.push({ kind: 'faces', text: '点头像没有打开选手卡' })
  else {
    if (!card.front) found.push({ kind: 'faces', text: '选手卡开在冠军卡下面' })
    if (!card.focus) found.push({ kind: 'kb:focus-outside', text: '选手卡' })
    await page.keyboard.press('Escape')
    await settle(page, 200)
    if ((await heading()) !== title) found.push({ kind: 'faces', text: '选手卡上按 Escape 收下了下面的冠军卡' })
    await closeTop(page, 'modal-title')
    if (!(await page.evaluate(() => document.activeElement?.classList.contains('face-btn')))) found.push({ kind: 'kb:focus-not-back', text: '头像' })
  }
  keys.push({ scenario: 'modal-title', state: 'modal:title:player-card', n: 0, found })
}

await browser.close()

/* ------------------------------------------------------------------ the report */

const named = results.filter((r) => !r.sweep)
const swept = results.filter((r) => r.sweep)
const total = (rs) => rs.reduce((s, r) => s + r.offenders.length, 0)
const states = [...new Set(named.map((r) => `${r.scenario} · ${r.state}`))]
const lines = []
lines.push(`# 手机审计 · ${label}`, '')
lines.push(`${new Date().toISOString()} · ${states.length} 个画面 × ${WIDTHS.length} 个宽度 · 共 ${total(named)} 处${SWEEP ? ` · 逐 16px 扫描 ${swept.length} 次，${total(swept)} 处` : ''}`, '')
// what the run really stood in front of: a page counts once its tab is lit and nothing covers it
lines.push('## 走到了哪里', '')
lines.push(`- 页面：到了 ${reached.length} 个，没到 ${unreached.length} 个${unreached.length ? `（${unreached.join('、')}）` : ''}`)
lines.push(`- 路上收起的卡：${layersSeen.length} 张${layersSeen.length ? `（${layersSeen.map((x) => `${x.scenario} · ${x.key}`).join('、')}）` : ''}`)
lines.push(`- 按下去 ${SLOW_MS / 1000} 秒以上才有反应：${slow.length} 次${slow.length ? `（${slow.map((x) => `${x.scenario} · ${x.what} ${(x.ms / 1000).toFixed(1)}s`).join('、')}）` : ''}`)
lines.push(`- 出错：${errors.length} 条${errors.length ? '，见文末' : ''}`, '')
lines.push('## 每个画面 × 宽度的问题数', '')
lines.push(`| 画面 | ${WIDTHS.join(' | ')} | 合计 |`)
lines.push(`|---|${WIDTHS.map(() => '---:').join('|')}|---:|`)
for (const st of states) {
  const row = WIDTHS.map((w) => named.find((r) => `${r.scenario} · ${r.state}` === st && r.width === w))
  const n = row.map((r) => (r ? r.offenders.length : '·'))
  lines.push(`| ${st} | ${n.join(' | ')} | ${row.reduce((s, r) => s + (r ? r.offenders.length : 0), 0)} |`)
}
const byWidth = WIDTHS.map((w) => total(named.filter((r) => r.width === w)))
lines.push(`| **合计** | ${byWidth.join(' | ')} | ${total(named)} |`, '')

const kinds = {}
for (const r of named) for (const o of r.offenders) kinds[o.kind] = (kinds[o.kind] ?? 0) + 1
lines.push('## 按类型', '', ...Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`), '')

lines.push('## 明细（同一处在几个宽度上合并）', '')
const groups = new Map()
for (const r of results) {
  for (const o of r.offenders) {
    const k = `${r.scenario} · ${r.state}|${o.kind}|${o.sel}`
    const g = groups.get(k) ?? { st: `${r.scenario} · ${r.state}`, kind: o.kind, sel: o.sel, widths: new Set(), px: 0, text: o.text, box: o.box, size: o.size }
    g.widths.add(r.width)
    g.px = Math.max(g.px, o.px)
    groups.set(k, g)
  }
}
let last = ''
for (const g of [...groups.values()].sort((a, b) => a.st.localeCompare(b.st) || a.kind.localeCompare(b.kind))) {
  if (g.st !== last) { lines.push('', `### ${g.st}`, ''); last = g.st }
  const ws = [...g.widths].sort((a, b) => a - b)
  lines.push(`- \`${g.kind}\` \`${g.sel}\` ${g.px}px${g.size ? ` (${g.size})` : ''}${g.box ? ` in \`${g.box}\`` : ''} — 「${g.text}」 @ ${ws.length > 6 ? `${ws[0]}…${ws[ws.length - 1]} (${ws.length})` : ws.join(',')}`)
}
const keyBad = keys.filter((k) => k.found.length)
lines.push('', '## 键盘（卡片在前时）', '', `${keys.length} 张卡，${keyBad.length} 张有问题。`, '')
for (const k of keys) {
  lines.push(`- ${k.scenario} · ${k.state}${k.n ? `（${k.n} 处可按）` : ''}：${k.found.length ? k.found.map((f) => `\`${f.kind}\`${f.text ? ` ${f.text}` : ''}`).join('，') : '没问题'}`)
}
if (errors.length) lines.push('', '## 运行中的错误', '', ...errors.map((e) => `- ${e}`))
writeFileSync(`${OUT}/report.md`, lines.join('\n'))
writeFileSync(`${OUT}/report.json`, JSON.stringify({ widths: WIDTHS, results, keys, errors, reached, unreached, layers: layersSeen, slow }, null, 1))
console.log(`${total(named)} offenders across ${states.length} states (${byWidth.join(' / ')})${SWEEP ? `; sweep ${total(swept)}` : ''}; keyboard ${keyBad.length}/${keys.length} cards with findings`)
console.log(`pages reached ${reached.length}, not reached ${unreached.length}; cards put away on the way ${layersSeen.length}; errors ${errors.length}`)
for (const x of slow) console.log(`  ⚠ slow: ${x.scenario} · ${x.what} took ${(x.ms / 1000).toFixed(1)}s to answer`)
for (const e of errors) console.log(`  ✗ ${e}`)
console.log(`→ ${OUT}/report.md`)
// a scene that did not come, a page not reached, an error in the page: the run did not measure what it says it did
process.exit(errors.length ? 1 : 0)
