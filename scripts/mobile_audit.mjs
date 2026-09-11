/**
 * The career on a phone, measured rather than looked at.
 *
 * Opens each save from scripts/mobile_saves.ts as 「继续上次的生涯」, walks
 * every screen, the match in each phase, the cards the clock stops on, the
 * player card and the new-career page, and at each of 320…1440 measures in
 * the page:
 *
 *   page-overflow  the document is wider than the window
 *   overflow-x     a box's content is wider than the box (not a scroller)
 *   clipped-x/-y   the same, hidden by overflow:hidden — text cut off
 *   ellipsis       text cut with an ellipsis
 *   poke-x/-y      text or an image outside its card, tile, panel, button or modal
 *   font<12        on a phone, any text under 12px
 *   font<13        on a phone, text between 12 and 13px (12px is the tiny step, 13px and up is body and small)
 *   tap<40         on a phone, a button, select, link or clickable row under 40px either way
 *
 * Intended scroll containers (overflow auto/scroll) are not offenders, and
 * what is inside one is judged by the scroller, not by the card around it.
 *
 *   node scripts/mobile_audit.mjs <label> [--shots] [--sweep] [--only=<scenario>]
 *
 * Needs the dev server (npx vite --port 5190 --strictPort) and the saves.
 * Writes .cache/mobile-audit/<label>/report.md, report.json and shots/.
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
    // what a closed <details> holds is not on screen, whatever box the engine still gives it
    const shut = el.closest('details:not([open])')
    if (shut && !el.closest('summary') && el !== shut) continue
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

    // 4. something to tap, on a phone
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
const errors = []
const browser = await chromium.launch()

const settle = async (page, ms = 60) => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  if (ms) await page.waitForTimeout(ms)
}

/** the card in front, or the page */
async function rootOf(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-audit-root]')) el.removeAttribute('data-audit-root')
    const top = [...document.querySelectorAll('.modal-bg, .support-card, .share-overlay')].pop()
    if (top) { top.setAttribute('data-audit-root', '1'); return { root: '[data-audit-root]', exclude: null } }
    return { root: document.querySelector('.app.career') ? '.app.career' : '.newcareer', exclude: '.modal-bg' }
  })
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

async function withSave(name, fn) {
  if (ONLY && !name?.includes(ONLY) && !(name === null && 'newcareer'.includes(ONLY))) return
  const file = name ? `${ROOT}/saves/${name}.txt` : null
  if (file && !existsSync(file)) { errors.push(`${name}: no save file`); return }
  const text = file ? readFileSync(file, 'utf8') : null
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 })
  await ctx.addInitScript(([key, text]) => {
    try {
      if (sessionStorage.getItem('audit-seeded')) return
      localStorage.clear()
      if (text) localStorage.setItem(key, text)
      localStorage.setItem('val_player.tour.off', '1')
      for (const k of ['pre', 'club', 'season']) localStorage.setItem(`val_player.tour.${k}`, '1')
      sessionStorage.setItem('audit-seeded', '1')
    } catch (e) { console.error('seed failed: ' + e) }
  }, [SAVE_KEY, text])
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: console ${m.text().slice(0, 160)}`) })
  const t = Date.now()
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.newcareer, .app.career', { timeout: 60000 })
    if (text) {
      await page.getByRole('button', { name: '继续上次的生涯' }).click()
      await page.waitForSelector('.app.career', { timeout: 60000 })
    }
    await settle(page, 300)
    // an achievement card left from the headless run: measured once, then put away
    const pop = await page.evaluate(() => [...document.querySelectorAll('[role=status][aria-live=polite]')].some((x) => x.textContent.includes('成就解锁')))
    if (pop) {
      await measureAll(page, name, 'ach-pop', { widths: [320, 375, 430, 768] })
      await page.evaluate(() => {
        const card = [...document.querySelectorAll('[role=status][aria-live=polite]')].find((x) => x.textContent.includes('成就解锁'))
        ;[...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '好')?.click()
      })
      await settle(page, 150)
    }
    await fn(page)
  } catch (e) {
    errors.push(`${name}: ${String(e.message ?? e).split('\n')[0]}`)
  } finally {
    console.log(`  ${name ?? 'newcareer'} ${((Date.now() - t) / 1000).toFixed(0)}s`)
    await ctx.close()
  }
}

async function go(page, label) {
  for (let i = 0; i < 3; i++) {
    const how = await page.evaluate((label) => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility === 'visible' }
      const b = [...document.querySelectorAll('.nav button, .nav-sheet button')].find((x) => x.textContent.trim() === label && vis(x))
      if (b) { b.click(); return 'done' }
      const more = [...document.querySelectorAll('.nav button')].find((x) => x.textContent.trim().startsWith('更多') && vis(x))
      if (more) { more.click(); return 'more' }
      return 'none'
    }, label)
    await settle(page, 120)
    if (how === 'done') return true
    if (how === 'none') return false
  }
  return false
}

async function closeTop(page) {
  await page.evaluate(() => {
    const m = [...document.querySelectorAll('.modal-bg')].pop()
    m?.querySelector('.modal-head button')?.click()
  })
  await settle(page, 150)
}

async function screens(page, name, list, shots = {}) {
  for (const s of list) {
    if (!(await go(page, s))) { errors.push(`${name}: no nav item ${s}`); continue }
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

async function clickText(page, text) {
  return page.evaluate((text) => {
    const m = [...document.querySelectorAll('.modal-bg')].pop() ?? document
    const b = [...m.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(text))
    b?.click()
    return !!b
  }, text)
}

/** press the week's button until the match opens, answering anything in the way the plain way */
async function toMatch(page) {
  for (let i = 0; i < 12; i++) {
    const at = await topModal(page)
    if (at === 'pre') return true
    if (at === 'other') {
      await page.evaluate(() => {
        const m = [...document.querySelectorAll('.modal-bg')].pop()
        const b = m.querySelector('.node-opt button') ?? m.querySelector('button.primary') ?? m.querySelector('.modal-body button')
        b?.click()
      })
    } else if (at === 'page') {
      await page.evaluate(() => document.querySelector('.advance-me button.primary')?.click())
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

const PRE = ['本周', '我的', '转会', '经济', '积分榜', '成就', '日志', '托管', '帮助']
const PRO = ['本周', '我的', '队伍', '转会', '经济', '赛程', '积分榜', '成就', '日志', '托管', '帮助']

// ---- the new-career page
await withSave(null, async (page) => {
  await measureAll(page, 'newcareer', 'new-career', { shot: 'newcareer' })
  // a club start opens the list of clubs that came
  await page.evaluate(() => { const g = document.querySelectorAll('.start-grid')[1]; g?.querySelectorAll('button')[2]?.click() })
  await settle(page, 200)
  await measureAll(page, 'newcareer', 'new-career:club')
})

// ---- a ladder start, first week
await withSave('pre-w0', async (page) => {
  await screens(page, 'pre-w0', PRE, { 本周: 'week-pre' })
  if (SWEEP) { await go(page, '本周'); await measureAll(page, 'pre-w0', 'screen:本周', { widths: SWEEP_WIDTHS, sweep: true, wait: 30 }) }
  // the changelog card
  await page.evaluate(() => document.querySelector('.log-fab')?.click())
  await settle(page, 200)
  if (await page.$('.log-card')) await measureAll(page, 'pre-w0', 'changelog')
})

// ---- twenty weeks in, then a run to the end of the stage and its summary
await withSave('pre-w20', async (page) => {
  await screens(page, 'pre-w20', PRE)
  await go(page, '本周')
  await page.selectOption('select.advance-far', 'stage').catch(() => {})
  await settle(page, 1500)
  for (let i = 0; i < 3; i++) {
    const t = await page.evaluate(() => [...document.querySelectorAll('.modal-bg')].pop()?.querySelector('.modal-head h3')?.textContent ?? '')
    if (t.startsWith('推进总结')) { await measureAll(page, 'pre-w20', 'summary'); break }
    if (!t) break
    await page.evaluate(() => { const m = [...document.querySelectorAll('.modal-bg')].pop(); (m.querySelector('.node-opt button') ?? m.querySelector('button.primary'))?.click() })
    await settle(page, 800)
  }
})

// ---- a Challengers starter, a week of days, the evening before a match
await withSave('chal-days', async (page) => {
  await screens(page, 'chal-days', PRO, { 本周: 'week-pro-days', 我的: 'me', 队伍: 'team' })
  if (SWEEP) {
    for (const s of ['本周', '我的', '队伍']) { await go(page, s); await measureAll(page, 'chal-days', `screen:${s}`, { widths: SWEEP_WIDTHS, sweep: true, wait: 30 }) }
  }
  // the player card, from the roster
  await go(page, '队伍')
  await page.evaluate(() => document.querySelector('tr.clickable')?.click())
  await settle(page, 300)
  if (await page.$('.modal-bg')) { await measureAll(page, 'chal-days', 'player-card', { shot: 'player-card' }); await closeTop(page) }
  // a played match's sheet, from 最近的比赛 on the week page
  await go(page, '本周')
  await page.evaluate(() => document.querySelector('.panel-body.flush table tr.clickable')?.click())
  await settle(page, 400)
  if (await page.$('.modal-bg')) { await measureAll(page, 'chal-days', 'match-sheet'); await closeTop(page) }
  // the match, phase by phase
  await go(page, '本周')
  if (!(await toMatch(page))) { errors.push('chal-days: the match did not open'); return }
  await measureAll(page, 'chal-days', 'match:pre', { shot: 'match-pre' })
  if (SWEEP) await measureAll(page, 'chal-days', 'match:pre', { widths: SWEEP_WIDTHS, sweep: true, wait: 30 })
  await clickText(page, '逐回合观战')
  await page.waitForTimeout(1500)
  await measureAll(page, 'chal-days', 'match:live', { widths: [320, 375, 430, 768, 1280] })
  let at = await waitFor(page, ['node', 'break', 'done'], 120000)
  let sawNode = false
  let sawBreak = false
  for (let guard = 0; guard < 12 && at !== 'done'; guard++) {
    if (at === 'node') {
      if (!sawNode) { await measureAll(page, 'chal-days', 'match:node', { shot: 'match-node' }); sawNode = true }
      await page.evaluate(() => [...document.querySelectorAll('.modal-bg')].pop()?.querySelector('.node-opt button')?.click())
    } else if (at === 'break') {
      if (!sawBreak) { await measureAll(page, 'chal-days', 'match:break', { shot: 'match-break' }); sawBreak = true }
      await clickText(page, sawNode ? '快进剩余' : '开始下一把')
    } else if (at === 'live' || at === 'other') {
      // nothing asked yet: wait for the next beat
    }
    at = await waitFor(page, ['node', 'break', 'done'], 120000)
  }
  if (at === 'done') await measureAll(page, 'chal-days', 'match:done', { shot: 'match-post' })
  else errors.push(`chal-days: the match ended in ${at}`)
})

// ---- a VCT club at an international event
await withSave('t1-intl', async (page) => {
  await screens(page, 't1-intl', ['本周', '队伍', '赛程', '积分榜'], { 本周: 'week-t1-intl' })
  await go(page, '本周')
  if (!(await toMatch(page))) { errors.push('t1-intl: the match did not open'); return }
  await measureAll(page, 't1-intl', 'match:pre')
  await clickText(page, '快进到结果')
  if ((await waitFor(page, ['done'], 20000)) === 'done') await measureAll(page, 't1-intl', 'match:done')
})

// ---- eight seasons in
await withSave('long', async (page) => {
  await screens(page, 'long', PRO, { 我的: 'long-me', 成就: 'long-awards' })
})

// ---- the ending, the card, the page after
await withSave('retired-ending', async (page) => {
  await measureAll(page, 'retired-ending', 'modal:ending', { shot: 'modal-ending' })
  await clickText(page, '生成生涯名片图')
  await settle(page, 1500)
  if (await page.$('.share-card')) await measureAll(page, 'retired-ending', 'share-card')
})
await withSave('retired', async (page) => {
  await screens(page, 'retired', ['本周', '我的', '成就', '日志', '帮助'], { 本周: 'retired' })
})

// ---- one save per card the clock stops on
for (const m of ['cup', 'invite', 'tryout', 'deal', 'event', 'ceremony', 'hurt', 'trait', 'season']) {
  await withSave(`modal-${m}`, async (page) => {
    await measureAll(page, `modal-${m}`, `modal:${m}`, { shot: m === 'invite' ? 'modal-invite' : m === 'ceremony' ? 'modal-ceremony' : undefined })
    if (SWEEP && m === 'deal') await measureAll(page, `modal-${m}`, `modal:${m}`, { widths: SWEEP_WIDTHS, sweep: true, wait: 30 })
  })
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
if (errors.length) lines.push('', '## 运行中的错误', '', ...errors.map((e) => `- ${e}`))
writeFileSync(`${OUT}/report.md`, lines.join('\n'))
writeFileSync(`${OUT}/report.json`, JSON.stringify({ widths: WIDTHS, results, errors }, null, 1))
console.log(`${total(named)} offenders across ${states.length} states (${byWidth.join(' / ')})${SWEEP ? `; sweep ${total(swept)}` : ''}; errors ${errors.length}`)
console.log(`→ ${OUT}/report.md`)
