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
 * and the typesetting (added 2026-09-18, the author with a screenshot of 经济 · 外设 at 1280:
 * 「筛查所有的布局文字大小等视觉排版问题，图中的第一行就明显出现了文字放不下被挤去第二行的情况」 — the
 * 鼠标 row's 「换成 罗技 G PRO X SUPERLIGHT 2 ¥2,000」 dropped under its row while the other four stayed on one line):
 *
 *   row-mismatch   rows of one list or table (same element, same children) that take a different number of
 *                  lines: one row breaks where its siblings do not
 *   wrap-split     a flex row whose last control (a button, a tag) fell onto a line of its own
 *   label-wrap     a button, chip, tag or header whose own words run onto a second line
 *   num-wrap       a figure (¥2,000 · 1.2万 · 13–9) broken over two lines
 *   overlap        two boxes side by side in one parent drawn over each other
 *   off-screen     text past the window's left or right edge, not in anything that scrolls
 *   scroll-x       something that scrolls down (the page, a card) scrolling sideways too, or a sideways
 *                  scroller that is not a table
 *   font<scale     at a computer's width, text under the type scale's smallest step (base.css --t-label / --t-tiny)
 *   svg-font       words drawn in a picture (a radar's numbers, a map's letters) under that step at the size drawn
 *   ellipsis-bare  an ellipsis with no title to read the rest from
 *
 * and, across every screen at one width, the same role (a panel's title, a table's header, a card's title,
 * a small button, a tag) in more than one size: the report's 字号 section.
 *
 *   --layout         the layout run: 1920×1000 … 360×740, every scene, the checks above
 *   --themes         also measure 浅 and 米 at 1366 and 390 (theme-free layout, but a sheet can hide a rule)
 *   --evidence       a picture of each new flag, the first time it shows (report's 明细 links it)
 *   --widths=WxH,…   any other set of sizes
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
if (args.includes('--evidence')) mkdirSync(`${OUT}/ev`, { recursive: true })

const LAYOUT = args.includes('--layout')
const THEMES_RUN = args.includes('--themes')
const EVIDENCE = args.includes('--evidence')
const SIZES_ARG = args.find((a) => a.startsWith('--widths='))?.slice(9)
// the layout run's sizes (2026-09-18): the common monitors and laptops, a tablet upright, four phones
const LAYOUT_SIZES = ['1920x1000', '1600x900', '1366x768', '1280x720', '1024x768', '768x1024', '414x896', '390x844', '375x812', '360x740']
const SIZES = SIZES_ARG ? SIZES_ARG.split(',') : LAYOUT ? LAYOUT_SIZES : null
const HEIGHT = new Map((SIZES ?? []).map((s) => s.split('x').map(Number)))
const WIDTHS = SIZES ? [...HEIGHT.keys()] : [320, 360, 375, 390, 414, 430, 768, 820, 1024, 1280, 1440]
// every 16px across the range, for the states a sweep covers: the in-between widths no preset names
const SWEEP_WIDTHS = Array.from({ length: 71 }, (_, i) => 320 + i * 16)
const heightOf = (w) => HEIGHT.get(w) ?? (w <= 430 ? 812 : w <= 820 ? 1024 : 900)
/** the grounds measured at a width: the dark one everywhere, 浅 and 米 as well at 1366 and 390 with --themes */
const THEME_WIDTHS = new Set([1366, 390])
const themesAt = (w) => (THEMES_RUN && THEME_WIDTHS.has(w) ? ['dark', 'light', 'cream'] : ['dark'])
/** the width a phone is measured at when the page stays on one after a scene */
const REST_W = WIDTHS.includes(375) ? 375 : WIDTHS[WIDTHS.length - 1]
// the player game's own key (src/engine/me/save.ts); a career under the old manager-namespace key is copied across on first load
const SAVE_KEY = 'val_player:save:autosave'

/* ------------------------------------------------------------------ in the page */

function measure({ phone, root, exclude, mark }) {
  const W = window.innerWidth
  const out = []
  // --evidence: each flag's element carries data-aud="<n>" so the run can take its picture
  let audN = 0
  if (mark) for (const x of document.querySelectorAll('[data-aud]')) x.removeAttribute('data-aud')
  const audOf = (el) => {
    if (!mark || !el) return undefined
    const had = el.getAttribute('data-aud')
    if (had) return had
    const id = String(++audN)
    el.setAttribute('data-aud', id)
    return id
  }
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
  // the parts a screen's type plays, each expected at one size wherever it appears (the report's 字号)
  // (a cell that asks to be .small or .tiny is its own part, and so is anything in the side rail, whose buttons
  // all take the rail's size)
  const ROLES = [
    ['面板标题', '.panel-head h2'], ['卡片标题', '.modal-head h3'], ['侧卡标题', '.support-head h3'],
    ['表头', 'thead th'], ['表格正文', 'tbody td:not(.small):not(.tiny)'], ['小按钮', 'button.sm:not(.nav *)'],
    ['标签', '.tag'], ['筹码', '.chip'], ['小字 .small', '.small'], ['注释 .tiny', '.tiny'], ['栏目', '.nav .nav-item'],
  ]
  const ROLE_ANY = ROLES.map((r) => r[1]).join(',')
  const roles = new Map()

  const docW = document.documentElement.scrollWidth
  if (docW > W + 1) out.push({ kind: 'page-overflow', sel: 'html', text: '', px: docW - W })

  const rootEl = root ? document.querySelector(root) : document.body
  if (!rootEl) return { offenders: [{ kind: 'no-root', sel: String(root), text: '', px: 0 }], roles: [] }
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
        let kind = s.textOverflow === 'ellipsis' ? 'ellipsis' : /(hidden|clip)/.test(s.overflowX) ? 'clipped-x' : 'overflow-x'
        // an ellipsis is fine when the rest is a hover away; a club's name cut to 「Nightbl…」 with nothing to read it from is not
        if (kind === 'ellipsis' && !el.closest('[title]') && !el.getAttribute('aria-label')) kind = 'ellipsis-bare'
        add(kind, el, el.scrollWidth - el.clientWidth, kind === 'ellipsis-bare' ? { aud: audOf(el) } : undefined)
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
            // words cut by the box they are in (an ellipsis, overflow hidden) end where the box does: the range still
            // measures the whole run, the part past the cut is not drawn (that is `ellipsis` / `clipped-x` above)
            if (/(hidden|clip)/.test(s.overflowX)) rr = { ...rr, left: Math.max(rr.left, r.left), right: Math.min(rr.right, r.right) }
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
    // 3b. and on a computer, under the scale's smallest step where it stands (base.css: 11.5 at 721–1099, 12 from 1100)
    if (!phone && hasText) {
      const fs = parseFloat(s.fontSize)
      const floor = Math.min(parseFloat(s.getPropertyValue('--t-label')) || 12, parseFloat(s.getPropertyValue('--t-tiny')) || 12)
      if (fs < floor - 0.01) add('font<scale', el, fs, { aud: audOf(el) })
    }
    // 3c. who plays which part, and at what size: collected here, compared across every screen in the report
    if (hasText || el.matches(ROLE_ANY)) {
      for (const [role, sel] of ROLES) {
        if (!el.matches(sel)) continue
        const k = `${role}|${s.fontSize}`
        const r = roles.get(k)
        if (r) r.n++
        else roles.set(k, { role, size: s.fontSize, n: 1, sel: pathOf(el), text: textOf(el) })
      }
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
    // the words' drawn size: the font size times how far the picture is scaled from its viewBox (a radar's axis
    // numbers, a map's site letters) — held to the same floor as the page's type
    {
      const vb = svg.viewBox?.baseVal
      const scale = vb && vb.width ? sr.width / vb.width : 1
      const fs = parseFloat(cs(t).fontSize) * scale
      const floor = phone ? 12 : Math.min(parseFloat(cs(svg).getPropertyValue('--t-label')) || 12, parseFloat(cs(svg).getPropertyValue('--t-tiny')) || 12)
      if (fs < floor - 0.25) add('svg-font', t, Math.round(fs * 10) / 10, { box: pathOf(svg), aud: audOf(svg) })
    }
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

  // 6. the typesetting (2026-09-18): lines a row, a label or a figure breaks onto; boxes over each other; text past
  //    the window; a page scrolling sideways
  const STATE_CLS = /^(on|active|sel|up|dn|ok|bad|win|loss|mine|me|past|next|match|locked|capped|near|off|over|now|done|good|warn|hot|open|lost|dead|fresh|own|alert|opposite|clickable|primary|ghost|w|l|d|faint|muted)$/
  const sig = (el) => el.tagName + '.' + [...el.classList].filter((c) => !STATE_CLS.test(c)).sort().join('.')
  const shown = (el) => { const x = cs(el); return x.display !== 'none' && x.visibility === 'visible' && el.getClientRects().length > 0 }
  const skipped = (el) => (exclude && el.closest(exclude)) || el.closest('svg, .sr-only, .cer-barrage, [aria-hidden="true"]')
  const positioned = (el) => { const p = cs(el).position; return p === 'absolute' || p === 'fixed' }
  const INLINE = /^inline/
  /** visual lines of a set of [top, bottom] spans: a span joins the line its middle falls inside */
  const cluster = (spans) => {
    spans.sort((a, b) => a[0] - b[0])
    let n = 0
    let hi = -1e9
    for (const [t, b] of spans) {
      if ((t + b) / 2 > hi) { n++; hi = b } else hi = Math.max(hi, b)
    }
    return n
  }
  /** the lines one run of words takes: el's own text and its inline children, not the blocks stacked inside it */
  const ownLines = (el) => {
    const spans = []
    for (const n of el.childNodes) {
      if (n.nodeType === 3) {
        if (!n.textContent.trim()) continue
        const r = document.createRange()
        r.selectNodeContents(n)
        for (const x of r.getClientRects()) if (x.width > 0.5 && x.height > 0.5) spans.push([x.top, x.bottom])
      } else if (n.nodeType === 1 && INLINE.test(cs(n).display) && !positioned(n) && shown(n)) {
        for (const x of n.getClientRects()) if (x.width > 0.5 && x.height > 0.5) spans.push([x.top, x.bottom])
      }
    }
    return cluster(spans)
  }
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
  /** the rows a flex container's items sit on */
  const flowLines = (el) => {
    const spans = []
    for (const k of el.children) {
      if (positioned(k) || !shown(k)) continue
      const r = k.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) spans.push([r.top, r.bottom])
    }
    return cluster(spans)
  }
  const isRowFlex = (x) => /flex/.test(x.display) && !/column/.test(x.flexDirection)
  /**
   * every break inside el that a row should not have: a short run of words (a name, a label, a figure — up to
   * 24 characters) onto a further line, or a wrapping flex row's items onto a further row. A sentence wrapping is
   * what a sentence does, and a diary line or a course's blurb is left to it.
   */
  const SHORT = 20
  const PROSE = /[。，；！？,;!?]/
  const shortText = (t) => t.length <= SHORT && !PROSE.test(t)
  /** where the breaks are, for the report: the first part that broke */
  let breakAt = null
  const breaksIn = (el) => {
    let n = 0
    breakAt = null
    for (const e of [el, ...el.querySelectorAll('*')]) {
      if (e !== el && (skipped(e) || !shown(e))) continue
      const x = cs(e)
      if (x.display === 'none') continue
      let b = 0
      if (hasOwnText(e) && !INLINE.test(x.display) && shortText(e.textContent.trim())) b += Math.max(0, ownLines(e) - 1)
      // a run of like things (chips, tags, region buttons) wraps as a paragraph does; a row of unlike parts should not
      if (isRowFlex(x) && x.flexWrap !== 'nowrap' && new Set([...e.children].filter(shown).map(sig)).size > 1) b += Math.max(0, flowLines(e) - 1)
      if (b && !breakAt) breakAt = e
      n += b
    }
    return n
  }
  const FIGURE = /^[\s¥$€£₩+\-−–~·:：%.,，\d万亿KkMm×x/()（）]+$/

  const all = [...rootEl.querySelectorAll('*')].filter((el) => !skipped(el) && shown(el))
  const seenGroup = new Set()
  for (const el of all) {
    const x = cs(el)
    // 6a. rows of one list or table that break differently: siblings with the same element and the same children
    const p = el.parentElement
    if (p && !seenGroup.has(p)) {
      seenGroup.add(p)
      const groups = new Map()
      for (const k of p.children) {
        if (!shown(k) || skipped(k) || positioned(k)) continue
        const kx = cs(k)
        const rowish = k.tagName === 'TR' || k.tagName === 'LI' || ((isRowFlex(kx) || /grid/.test(kx.display)) && k.children.length >= 2)
        if (!rowish) continue
        const key = sig(k) + '>' + [...k.children].filter(shown).map(sig).join(',')
        const g = groups.get(key) ?? []
        g.push(k)
        groups.set(key, g)
      }
      for (const g of groups.values()) {
        if (g.length < 2) continue
        const br = g.map(breaksIn)
        const min = Math.min(...br)
        const max = Math.max(...br)
        if (max === min) continue
        // the odd ones out: the rows that break where most do not (or, where most break, the ones that do not)
        const count = new Map()
        for (const b of br) count.set(b, (count.get(b) ?? 0) + 1)
        const mode = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
        const odd = g.filter((_, i) => br[i] !== mode)
        // the part that broke: in the odd row when it has more breaks, else in a row of the majority
        const broke = br[g.indexOf(odd[0])] > mode ? odd[0] : g[br.indexOf(mode)]
        breaksIn(broke)
        add('row-mismatch', odd[0], max - min, { rows: `${odd.length}/${g.length}`, box: breakAt ? `${pathOf(breakAt)} 「${textOf(breakAt)}」` : undefined, aud: audOf(odd[0]) })
      }
    }
    // 6b. a row whose last control fell onto a line of its own: the author's 鼠标 row. A heading or a toolbar that
    //     puts its button under its title on a narrow screen does it on purpose
    const HEADS = '.panel-head, .hero-row, .modal-head, .support-head, .advance-me, .topbar, .pinbar, .save-head, .backup-top, .home-head, .mt-head, .mt-foot, label'
    if (isRowFlex(x) && x.flexWrap !== 'nowrap' && el.children.length >= 3 && !el.matches(HEADS)) {
      const kids = [...el.children].filter((k) => shown(k) && !positioned(k))
      if (kids.length >= 3 && new Set(kids.map(sig)).size > 1) {
        const top0 = kids[0].getBoundingClientRect()
        const later = kids.filter((k) => k.getBoundingClientRect().top >= top0.bottom - 1)
        const tail = later.length && later.length <= 2 && later.every((k) => kids.indexOf(k) >= kids.length - later.length)
        if (tail && later.some((k) => k.matches('button, .tag, .chip, select, a'))) add('wrap-split', later[0], later.length, { aud: audOf(el) })
      }
    }
    // 6c. a label's own words on two lines: a button, a chip, a tag, a header, a tab (not a card that is a button, with
    //     its title over its lines)
    if (el.matches('button, .chip, .tag, .bond-tag, [role=button], th, summary, .nav-item, a.share-dl')) {
      // a card or a list row that is a button (a title over its lines, a row of parts) is judged as a card or a row
      const flexKids = /flex/.test(x.display) && [...el.children].filter(shown).length >= 2
      const card = /column/.test(x.flexDirection) || /grid/.test(x.display) || flexKids ||
        [...el.children].some((k) => !INLINE.test(cs(k).display) && !/flex/.test(x.display)) || (el.textContent ?? '').trim().length > 40
      if (!card && breaksIn(el) > 0) add('label-wrap', el, breaksIn(el), { aud: audOf(el) })
    }
    // 6d. a figure broken over two lines
    if (hasOwnText(el) && !INLINE.test(x.display)) {
      const t = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
      if (t.length >= 2 && t.length <= 18 && /\d/.test(t) && FIGURE.test(t) && ownLines(el) > 1) add('num-wrap', el, ownLines(el), { aud: audOf(el) })
    } else if (INLINE.test(x.display) && el.children.length === 0 && hasOwnText(el)) {
      const t = el.textContent.trim()
      if (t.length >= 2 && t.length <= 18 && /\d/.test(t) && FIGURE.test(t)) {
        const spans = [...el.getClientRects()].filter((r) => r.width > 0.5).map((r) => [r.top, r.bottom])
        if (cluster(spans) > 1) add('num-wrap', el, cluster(spans), { aud: audOf(el) })
      }
    }
    // 6e. boxes side by side in one parent drawn over each other (a stack of faces is drawn that way on purpose)
    if (el.children.length >= 2 && !/^inline$/.test(x.display)) {
      // a sticky head over the rows scrolling under it is the design, not a collision, and so is anything fixed to the
      // window (the tab bar, the corner buttons), which the page leaves room for under its last line
      const kids = [...el.children].filter((k) => shown(k) && !skipped(k) && cs(k).display !== 'inline' && !/sticky|fixed/.test(cs(k).position) && !k.matches('.face-btn')
        && (k.textContent.trim() || k.matches('img, svg, input, select, textarea, button, canvas') || k.querySelector('img, svg, input, select, button')))
      if (kids.length >= 2 && kids.length <= 80) {
        // content boxes: a negative margin pulled into a neighbour's padding (the match sheet's 「胜利。」 under the score)
        // draws nothing over it
        const rs = kids.map((k) => {
          const b = k.getBoundingClientRect()
          const q = cs(k)
          const n = (v) => parseFloat(v) || 0
          return {
            left: b.left + n(q.paddingLeft) + n(q.borderLeftWidth), right: b.right - n(q.paddingRight) - n(q.borderRightWidth),
            top: b.top + n(q.paddingTop) + n(q.borderTopWidth), bottom: b.bottom - n(q.paddingBottom) - n(q.borderBottomWidth),
          }
        })
        let hit = 0
        for (let i = 0; i < kids.length && hit < 3; i++) {
          for (let j = i + 1; j < kids.length && hit < 3; j++) {
            // a positioned mark only counts when both carry words
            if ((positioned(kids[i]) || positioned(kids[j])) && !(kids[i].textContent.trim() && kids[j].textContent.trim())) continue
            const a = rs[i]; const b = rs[j]
            const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
            const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
            if (w > 2 && h > 2) { add('overlap', kids[j], Math.min(w, h), { box: pathOf(kids[i]), aud: audOf(el) }); hit++ }
          }
        }
      }
    }
    // 6f. text past the window's side, with nothing that scrolls or clips between it and the page
    if (hasOwnText(el)) {
      const r = document.createRange()
      r.selectNodeContents(el)
      const rects = [...r.getClientRects()].filter((q) => q.width > 0.5)
      if (rects.length) {
        const right = Math.max(...rects.map((q) => q.right))
        const left = Math.min(...rects.map((q) => q.left))
        const d = Math.max(right - W, -left)
        if (d > 1) {
          let held = false
          for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
            if (scrolls(a) || /(hidden|clip)/.test(cs(a).overflowX)) { held = true; break }
          }
          if (!held) add('off-screen', el, d, { aud: audOf(el) })
        }
      }
    }
    // 6g. a scroller wider than itself: the page or a card scrolling sideways, or a sideways scroller that is not a table
    if (/(auto|scroll)/.test(x.overflowX) && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
      const page = el.matches('.main, .modal, .modal-body, .support-card, .support-body, .share-body, .nav, .mt-card, .log-card, .newcareer')
      // a table, or one picture (the round ribbon's 24 rounds), scrolling sideways in its own box is the design
      // (and the share sheet's 卡面 on a phone: one row of chips that scrolls sideways, the one in use brought into it — ui/me/looks.tsx)
      const picture = (el.children.length === 1 && el.children[0].matches('svg, img, canvas')) || el.matches('.look-pick.compact .lp-grid')
      if (page || (!el.querySelector('table') && !picture)) add('scroll-x', el, el.scrollWidth - el.clientWidth, { page, aud: audOf(el) })
    }
  }
  // one line per thing, however many text nodes it has
  const seen = new Map()
  for (const o of out) {
    const k = `${o.kind}|${o.sel}|${o.text}`
    const had = seen.get(k)
    if (!had) seen.set(k, { ...o, n: 1 })
    else { had.n++; had.px = Math.max(had.px, o.px) }
  }
  return { offenders: [...seen.values()], roles: [...roles.values()] }
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

/** the kinds a picture is taken of with --evidence, and the pictures taken: state|kind|sel|phone → file */
const EV_KINDS = new Set(['svg-font', 'row-mismatch', 'wrap-split', 'label-wrap', 'num-wrap', 'overlap', 'off-screen', 'scroll-x', 'font<scale', 'ellipsis-bare'])
const evShots = new Map()
let evN = 0
const paintTheme = (page, t) => page.evaluate((t) => {
  if (t === 'dark') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
}, t)

async function measureAll(page, scenario, state, opts = {}) {
  const widths = opts.widths ?? WIDTHS
  const was = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark')
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: heightOf(w) })
    await settle(page, opts.wait ?? 60)
    const where = opts.root ? { root: opts.root, exclude: null } : await rootOf(page)
    for (const theme of opts.sweep ? ['dark'] : themesAt(w)) {
      if (theme !== was || themesAt(w).length > 1) await paintTheme(page, theme)
      const { offenders, roles } = await page.evaluate(measure, { phone: w <= 430, ...where, mark: EVIDENCE })
      results.push({ scenario, state, width: w, theme, offenders, roles, sweep: !!opts.sweep })
      if (EVIDENCE && theme === 'dark') await evidence(page, scenario, state, w, offenders)
    }
    if (themesAt(w).length > 1) await paintTheme(page, was)
    if (SHOTS && w === 375 && opts.shot) await page.screenshot({ path: `${OUT}/shots/${opts.shot}.png` })
  }
  await page.setViewportSize({ width: REST_W, height: heightOf(REST_W) })
  await settle(page)
}

/** a picture of each new kind of flag the first time it shows in a scene, once for a phone and once for a computer */
async function evidence(page, scenario, state, w, offenders) {
  for (const o of offenders) {
    if (!EV_KINDS.has(o.kind) || !o.aud || evN >= 900) continue
    const key = `${scenario} · ${state}|${o.kind}|${o.sel}|${w <= 430 ? 'phone' : 'desk'}`
    if (evShots.has(key)) { o.shot = evShots.get(key); continue }
    const file = `ev/${String(++evN).padStart(4, '0')}-${w}-${o.kind.replace(/[<>]/g, '')}.png`
    try {
      // the flagged box in its setting: the list round a row, the row round a button — the nearest box at least 320px
      // wide (or the window's width), brought into view, and a little round it; a box taller than the window, its top
      const at = () => page.evaluate(({ id, want }) => {
        let el = document.querySelector(`[data-aud="${id}"]`)
        if (!el) return null
        const flagged = el
        while (el.parentElement && el.parentElement !== document.body && el.getBoundingClientRect().width < want) el = el.parentElement
        const r0 = flagged.getBoundingClientRect()
        if (r0.top < 0 || r0.bottom > innerHeight) flagged.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect()
        const f = flagged.getBoundingClientRect()
        // the flagged box with up to 160px of its setting above and below
        const top = Math.max(0, Math.max(r.top, f.top - 160) - 8)
        const bottom = Math.min(innerHeight, Math.min(r.bottom, f.bottom + 160) + 8, top + 640)
        const left = Math.max(0, r.left - 8)
        const right = Math.min(innerWidth, r.right + 8)
        return { x: left, y: top, width: right - left, height: bottom - top }
      }, { id: o.aud, want: Math.min(320, w - 16) })
      const clip = await at()
      if (!clip || clip.width < 4 || clip.height < 4) continue
      await page.screenshot({ path: `${OUT}/${file}`, clip })
      evShots.set(key, file)
      o.shot = file
    } catch { /* gone, or a live match moved on: no picture */ }
  }
  // back to the top of whatever a picture scrolled, so the next width is measured from where a player lands
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.main, .modal, .support-card, .support-body, .mt-card')) el.scrollTop = 0
    window.scrollTo(0, 0)
  }).catch(() => {})
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
const LAYER_WIDTHS = SIZES ? WIDTHS : [320, 375, 430, 768]

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

/**
 * opts.save: the save file when it is not named after the scenario; opts.stay: stay on the home page rather than
 * continue; opts.tour: the tour comes up as it does for a new player; opts.hall: a hall with the long career's card
 * and every 卡面 open (saves/hall.json, scripts/mobile_saves.ts); opts.music: the music window opened, still silent
 */
async function withSave(name, fn, opts = {}) {
  if (ONLY && !name?.includes(ONLY) && !(name === null && 'newcareer'.includes(ONLY))) return
  const file = name ? `${ROOT}/saves/${opts.save ?? name}.txt` : null
  if (file && !existsSync(file)) { errors.push(`${name}: no save file ${file}`); return }
  const text = file ? readFileSync(file, 'utf8') : null
  const hallFile = `${ROOT}/saves/hall.json`
  if (opts.hall && !existsSync(hallFile)) errors.push(`${name}: no hall file ${hallFile} (npx tsx scripts/mobile_saves.ts)`)
  const hall = opts.hall && existsSync(hallFile) ? readFileSync(hallFile, 'utf8') : null
  const music = opts.music ? JSON.stringify({ ...JSON.parse(MUSIC_OFF), open: true }) : MUSIC_OFF
  const ctx = await browser.newContext({ viewport: { width: REST_W, height: heightOf(REST_W) }, deviceScaleFactor: 1 })
  await ctx.addInitScript(([key, text, musicKey, musicOff, tour, hall]) => {
    try {
      // every load, a reload too: the music stays off whatever the page wrote since
      localStorage.setItem(musicKey, musicOff)
      if (sessionStorage.getItem('audit-seeded')) return
      localStorage.clear()
      localStorage.setItem(musicKey, musicOff)
      if (text) localStorage.setItem(key, text)
      if (hall) localStorage.setItem('val_player.hall', hall)
      if (!tour) {
        localStorage.setItem('val_player.tour.off', '1')
        for (const k of ['pre', 'club', 'season']) localStorage.setItem(`val_player.tour.${k}`, '1')
      }
      sessionStorage.setItem('audit-seeded', '1')
    } catch (e) { console.error('seed failed: ' + e) }
  }, [SAVE_KEY, text, MUSIC_KEY, music, !!opts.tour, hall])
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
  await measureAll(page, 'chal-days', 'match:live', { widths: SIZES ? WIDTHS : [320, 375, 430, 768, 1280] })
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

// ---- what the layout run added (2026-09-18): the hall inside a career and on the home page, the backup box and the
//      import page, the career-end card in every 卡面, the music window open, the tour card by card
const LOOK_KEYS = ['studio', 'night', 'film', 'paper', 'led', 'vault', 'split', 'redline']
await withSave('looks', async (page) => {
  const top = await clearLayers(page, 'looks', { keep: ['modal'] })
  if (top?.kind !== 'modal') { missing('looks', 'modal:ending'); return }
  for (const k of LOOK_KEYS) {
    const ok = await page.evaluate((k) => {
      const h = JSON.parse(localStorage.getItem('val_player.hall') ?? 'null')
      if (!h) return false
      if (k === 'studio') delete h.look
      else h.look = k
      localStorage.setItem('val_player.hall', JSON.stringify(h))
      window.dispatchEvent(new Event('valplayer:look'))
      return true
    }, k)
    if (!ok) { missing('looks', `look:${k} (no hall)`); break }
    await settle(page, 300)
    await measureAll(page, 'looks', `look:${k}`)
  }
}, { save: 'retired-ending', hall: true })

await withSave('hall', async (page) => {
  if (!(await go(page, 'hall', '成就'))) return
  const b = page.locator('#main button').filter({ hasText: /^\s*成就殿堂/ }).first()
  if (!(await b.count()) || !(await press(page, b, '成就殿堂', 'hall'))) { missing('hall', 'screen:殿堂'); return }
  await settle(page, 400)
  await measureAll(page, 'hall', 'screen:殿堂')
}, { save: 'long', hall: true })

await withSave('home-hall', async (page) => {
  await page.waitForSelector('.save-card', { timeout: 60000 })
  await measureAll(page, 'home-hall', 'home:save+hall')
  // 导出存档: the box under the card
  if (await press(page, page.getByRole('button', { name: '导出存档', exact: true }), '导出存档', 'home-hall')) {
    await settle(page, 600)
    if (await page.locator('.backup-box').count()) {
      await measureAll(page, 'home-hall', 'home:backup-box')
      // the code, as a browser that will not copy shows it: in a box to select by hand
      await press(page, page.locator('.backup-box').getByRole('button', { name: '复制存档码', exact: true }), '复制存档码', 'home-hall')
      await settle(page, 300)
      await measureAll(page, 'home-hall', 'home:backup-box+note')
    } else missing('home-hall', 'home:backup-box')
  }
  const code = await page.evaluate(() => document.querySelector('.backup-box textarea')?.value ?? null)
  // 导入存档: its page, empty and with the backup read back
  if (await press(page, page.getByRole('button', { name: '导入存档', exact: true }).first(), '导入存档', 'home-hall')) {
    await settle(page, 400)
    await measureAll(page, 'home-hall', 'home:import')
    if (code) {
      await page.locator('.backup-paste').fill(code)
      await press(page, page.getByRole('button', { name: '读取存档码', exact: true }), '读取存档码', 'home-hall')
      await settle(page, 1200)
      if (await page.locator('.backup-page .save-card').count()) await measureAll(page, 'home-hall', 'home:import-read')
      else missing('home-hall', 'home:import-read')
    } else missing('home-hall', 'home:import-read (no code to paste)')
    await press(page, page.locator('.backup-top button').first(), '← 返回', 'home-hall')
    await settle(page, 300)
  }
  // 成就殿堂 from the home page
  const hb = page.locator('.newcareer button').filter({ hasText: /^\s*成就殿堂/ }).first()
  if (await hb.count() && await press(page, hb, '成就殿堂', 'home-hall')) {
    await settle(page, 400)
    await measureAll(page, 'home-hall', 'home:hall')
  } else missing('home-hall', 'home:hall')
}, { save: 'long', stay: true, hall: true })

await withSave('music', async (page) => {
  await settle(page, 400)
  if (!(await page.locator('.bgm').count())) { missing('music', 'music window'); return }
  // the window measured as its own scene; the page under it is measured elsewhere
  await measureAll(page, 'music', 'music:open', { root: '.bgm' })
  // and silent: nothing playing
  const playing = await page.evaluate(() => [...document.querySelectorAll('audio')].some((a) => !a.paused && !a.muted && a.volume > 0))
  if (playing) errors.push('music: a track is playing with sound')
}, { save: 'chal-days', music: true })

await withSave('tour', async (page) => {
  for (let i = 0; i < 20; i++) {
    const top = await topLayer(page)
    if (top?.kind !== 'tour') { if (i === 0) missing('tour', 'tour card'); break }
    await measureAll(page, 'tour', `tour:${i + 1}`)
    const next = page.locator('.mt-card .mt-foot button.primary')
    if (!(await next.count()) || !(await press(page, next, 'the tour\'s next', 'tour'))) break
    await settle(page, 400)
  }
}, { save: 'pre-w0', tour: true })

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

// the dark ground is the run; 浅 and 米 (--themes) are counted in their own table
const named = results.filter((r) => !r.sweep && (r.theme ?? 'dark') === 'dark')
const themed = results.filter((r) => !r.sweep && r.theme && r.theme !== 'dark')
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
// each kind at each width: the before/after table of a layout run
const kindList = Object.keys(kinds).sort((a, b) => kinds[b] - kinds[a])
lines.push('## 类型 × 宽度', '')
lines.push(`| 类型 | ${WIDTHS.join(' | ')} | 合计 |`)
lines.push(`|---|${WIDTHS.map(() => '---:').join('|')}|---:|`)
for (const k of kindList) {
  const n = WIDTHS.map((w) => named.filter((r) => r.width === w).reduce((s, r) => s + r.offenders.filter((o) => o.kind === k).length, 0))
  lines.push(`| ${k} | ${n.join(' | ')} | ${kinds[k]} |`)
}
lines.push('')
if (themed.length) {
  lines.push('## 三种配色（同一宽度下，深 / 浅 / 米 各自的问题数）', '')
  for (const w of [...THEME_WIDTHS].filter((w) => WIDTHS.includes(w))) {
    const n = ['dark', 'light', 'cream'].map((t) => total(results.filter((r) => !r.sweep && r.width === w && (r.theme ?? 'dark') === t)))
    lines.push(`- ${w}：深 ${n[0]} · 浅 ${n[1]} · 米 ${n[2]}`)
  }
  lines.push('')
}
// the same part in more than one size across the screens, at one width (the most common size first)
const roleAt = new Map()
for (const r of named) {
  for (const x of r.roles ?? []) {
    const k = `${x.role}|${r.width}`
    const m = roleAt.get(k) ?? new Map()
    const e = m.get(x.size) ?? { n: 0, where: new Set(), sel: x.sel, text: x.text }
    e.n += x.n
    e.where.add(`${r.scenario} · ${r.state}`)
    m.set(x.size, e)
    roleAt.set(k, m)
  }
}
// one line per role and set of odd ones out, with the widths it holds at (the sizes step with the scale, the odd ones stay odd)
const roleLines = new Map()
for (const [k, m] of roleAt) {
  if (m.size < 2) continue
  const [role, w] = k.split('|')
  const sizes = [...m.entries()].sort((a, b) => b[1].n - a[1].n)
  const odd = sizes.slice(1).map(([, e]) => `\`${e.sel}\` 「${e.text}」`).join('；')
  const key = `${role}|${odd}`
  const g = roleLines.get(key) ?? { role, widths: [], sizes, odd: sizes.slice(1) }
  g.widths.push(w)
  roleLines.set(key, g)
}
lines.push('## 字号：同一角色在不同画面上的大小', '', `${roleLines.size} 处不止一种大小（按角色和出格的那几个合并）。`, '')
for (const g of roleLines.values()) {
  const [main, e0] = g.sizes[0]
  lines.push(`- **${g.role}** @ ${g.widths.join(',')}：多数 ${main} ×${e0.n}；${g.odd.map(([s, e]) => `${s} ×${e.n} \`${e.sel}\` 「${e.text}」 在 ${[...e.where].slice(0, 3).join('、')}${e.where.size > 3 ? ' 等' : ''}`).join('；')}`)
}
lines.push('')

lines.push('## 明细（同一处在几个宽度上合并）', '')
const groups = new Map()
for (const r of results) {
  if (r.theme && r.theme !== 'dark') continue
  for (const o of r.offenders) {
    const k = `${r.scenario} · ${r.state}|${o.kind}|${o.sel}`
    const g = groups.get(k) ?? { st: `${r.scenario} · ${r.state}`, kind: o.kind, sel: o.sel, widths: new Set(), px: 0, text: o.text, box: o.box, size: o.size, rows: o.rows, shots: new Set() }
    g.widths.add(r.width)
    g.px = Math.max(g.px, o.px)
    if (o.shot) g.shots.add(o.shot)
    groups.set(k, g)
  }
}
let last = ''
for (const g of [...groups.values()].sort((a, b) => a.st.localeCompare(b.st) || a.kind.localeCompare(b.kind))) {
  if (g.st !== last) { lines.push('', `### ${g.st}`, ''); last = g.st }
  const ws = [...g.widths].sort((a, b) => a - b)
  const pics = [...g.shots].map((f) => `[图](${f})`).join(' ')
  lines.push(`- \`${g.kind}\` \`${g.sel}\` ${g.px}px${g.size ? ` (${g.size})` : ''}${g.rows ? ` [${g.rows} 行]` : ''}${g.box ? ` in \`${g.box}\`` : ''} — 「${g.text}」 @ ${ws.length > 6 ? `${ws[0]}…${ws[ws.length - 1]} (${ws.length})` : ws.join(',')}${pics ? ` ${pics}` : ''}`)
}
const keyBad = keys.filter((k) => k.found.length)
lines.push('', '## 键盘（卡片在前时）', '', `${keys.length} 张卡，${keyBad.length} 张有问题。`, '')
for (const k of keys) {
  lines.push(`- ${k.scenario} · ${k.state}${k.n ? `（${k.n} 处可按）` : ''}：${k.found.length ? k.found.map((f) => `\`${f.kind}\`${f.text ? ` ${f.text}` : ''}`).join('，') : '没问题'}`)
}
if (errors.length) lines.push('', '## 运行中的错误', '', ...errors.map((e) => `- ${e}`))
writeFileSync(`${OUT}/report.md`, lines.join('\n'))
writeFileSync(`${OUT}/report.json`, JSON.stringify({ widths: WIDTHS, results: results.map(({ roles, ...r }) => r), roles: [...roleAt.entries()].map(([k, m]) => [k, [...m.entries()].map(([s, e]) => [s, e.n, [...e.where]])]), keys, errors, reached, unreached, layers: layersSeen, slow }, null, 1))
console.log(`${total(named)} offenders across ${states.length} states (${byWidth.join(' / ')})${SWEEP ? `; sweep ${total(swept)}` : ''}; keyboard ${keyBad.length}/${keys.length} cards with findings`)
console.log(`pages reached ${reached.length}, not reached ${unreached.length}; cards put away on the way ${layersSeen.length}; errors ${errors.length}`)
for (const x of slow) console.log(`  ⚠ slow: ${x.scenario} · ${x.what} took ${(x.ms / 1000).toFixed(1)}s to answer`)
for (const e of errors) console.log(`  ✗ ${e}`)
console.log(`→ ${OUT}/report.md`)
// a scene that did not come, a page not reached, an error in the page: the run did not measure what it says it did
process.exit(errors.length ? 1 : 0)
