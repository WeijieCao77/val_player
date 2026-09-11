/**
 * What every real event paid, place by place: src/data/prizes_me.json.
 *
 * The author's request is 「奖金表按照真实重做」, with nothing invented: a place
 * is paid what its own event's prize table says, and an event whose amounts
 * were never published pays nothing and says so. The career reads the output
 * (engine/me/prizes.ts); the manager game's per-stage table is not consulted.
 *
 * Sources
 *  - Liquipedia's event pages. The VCT pages' wikitext is the cache
 *    scripts/fetch_lp_events.py leaves in .cache/lp; the Challengers leagues
 *    (VCL/…), the China Evolution Series and the FGC pages are fetched here
 *    (--fetch) into .cache/lp/prizes, two seconds apart.
 *  - Each prize table as Liquipedia renders it (--render-fetch): the places as
 *    the event's own results grouped them (a slot written as 5th renders as
 *    5–6 where two sides went out together), and a local-currency amount in
 *    the dollars Liquipedia converts it to — exchangerate.host on the event's
 *    own dates. Liquipedia allows one parse every thirty seconds, so several
 *    tables go in each. A page not rendered yet falls back to the dollars its
 *    wikitext states.
 *  - Which page is which event: routes.json and routes_partnered.json for the
 *    VCT, a name-and-dates match for the rest, and OVERRIDE where either is
 *    not the page with the prize table on it.
 *
 * An entry is `paid` (the table), `none` (every place written down as 0) or
 * `unpublished` (no amounts on the page, or only a total with no places).
 *
 *   npx tsx scripts/build_prizes.ts [--fetch] [--render-fetch] [--lp DIR]... [--cache DIR] [--render FILE] [--verbose]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'src', 'data')
const OUT = join(DATA, 'prizes_me.json')
const argv = process.argv.slice(2)
const opts = (name: string): string[] => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []))
const PRIZE_CACHE = opts('--cache')[0] ?? join(ROOT, '.cache', 'lp', 'prizes')
const LP_DIRS = [...(opts('--lp').length ? opts('--lp') : [join(ROOT, '.cache', 'lp')]), PRIZE_CACHE]
const RENDER = opts('--render')[0] ?? join(PRIZE_CACHE, 'render.json')

const API = 'https://liquipedia.net/valorant/api.php'
const UA = 'val_player-dataset/0.1 (personal VALORANT career-sim project; github.com/WeijieCao77)'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Row = [number, number, number]
interface Entry { y: number; lp: string; status?: 'none' | 'unpublished'; cur?: string; pay?: Row[] }
interface Slot { from: number; to: number; usd: number | null; local: number | null }
interface Rendered { rows: { place: string; usd: number | null; local: string | null }[] }
interface CEv { id: string; name: string; stage: string | null; region: string | null; start: number | null; end: number | null; prize?: string | null }

/* ------------------------------------------------------------------ */
/*  which page is which event                                          */
/* ------------------------------------------------------------------ */

/**
 * Where the routes point at a page with no prize table on it, or the match
 * below would pick the wrong page — and `null` for an event with no page of
 * its own (an open qualifier, a third-party cup nobody wrote a table for).
 */
const OVERRIDE: Record<string, string | null> = {
  // 2021–2022: third-party China events
  465: null, 509: null, 651: null,
  895: 'FGC Valorant Invitational/2022/Act 1', 1025: 'FGC Valorant Invitational/2022/Act 2',
  1105: 'FGC Valorant Invitational/2022/Act 3', 1319: 'FGC Valorant Invitational/2022/Epilogue',
  // 2023
  1309: null, 1481: null, 1570: null,
  1458: 'VCL/2023/North America/Challenger Playoffs', // vlr keeps the Face Off and the Playoffs as one event; the Playoffs decide its places
  1525: 'FGC Valorant Invitational/2023/Act 1', 1610: 'FGC Valorant Invitational/2023/Act 2',
  1682: 'VCL/2023/Spain/Relegation', 1680: 'VCL/2023/DACH/Relegation', 1683: 'VCL/2023/Latin America',
  1747: 'China Evolution Series/2023/Act 1', 1825: 'China Evolution Series/2023/Act 2', 1880: 'China Evolution Series/2023/Act 3',
  // 2024
  1954: null, 2076: null, 2131: null,
  1952: 'VCL/2024/Indonesia/Split 1', // the match prefers its Group Stage page, whose dates are nearer and which has no table
  1971: 'VCL/2024/North America/Split 1/Mid Season Cup', 2071: 'VCL/2024/North America/Challenger Playoffs',
  2126: 'VCL/2024/Latin America', 2234: 'FGC Valorant Invitational/2024',
  // 2025
  2281: 'VCT/2025/Stage 1/Masters', // the routes point at its qualification page
  2339: 'China Evolution Series/2025/Act 1', 2450: 'China Evolution Series/2025/Act 2',
  2590: 'China Evolution Series/2025/Act 3', 2720: 'China Evolution Series/2025/Epilogue',
  2492: null, 2510: null, 2604: null, 2603: 'VCL/2025/Latin America',
  // 2026: the leagues' routes point at the Championship Points page
  2682: 'VCT/2026/Americas League/Kickoff', 2684: 'VCT/2026/EMEA League/Kickoff',
  2683: 'VCT/2026/Pacific League/Kickoff', 2685: 'VCT/2026/China League/Kickoff',
  2860: 'VCT/2026/Americas League/Stage 1', 2863: 'VCT/2026/EMEA League/Stage 1',
  2775: 'VCT/2026/Pacific League/Stage 1', 2864: 'VCT/2026/China League/Stage 1',
  2977: 'VCT/2026/Americas League/Stage 2', 2976: 'VCT/2026/EMEA League/Stage 2',
  2776: 'VCT/2026/Pacific League/Stage 2', 2978: 'VCT/2026/China League/Stage 2',
  2796: null, 2877: null, 3018: null, 3063: null,
  2820: 'VCL/2026/Southeast Asia/Split 1/Rest of SEA', 2827: 'VCL/2026/Southeast Asia/Split 2/Rest of SEA',
  2894: 'China Evolution Series/2026/Act 1', 2988: 'China Evolution Series/2026/Act 2',
  2921: 'VCL/2026/Spain/Stage 3/Phase 2',
}

/** Events that are not in circuit.json but are played: Champions 2026, drawn from 2025's (engine/circuit.ts OWED_EVENTS). */
const EXTRA: Record<string, [number, string]> = {
  'F2026:2283': [2026, 'VCT/2026/Champions'],
}

const REGION: [RegExp, string[]][] = [
  [/Malaysia\/Singapore|Malaysia & Singapore/i, ['Malaysia and Singapore']],
  [/Taiwan\/Hong Kong|Hong Kong & Taiwan/i, ['Hong Kong and Taiwan']],
  [/LATAM North/i, ['Latin America/North']],
  [/LATAM South/i, ['Latin America/South']],
  [/NORTH\/\/EAST/i, ['NORTH EAST']],
  [/Northern Europe|North: Polaris/i, ['Northern Europe', 'North']],
  [/T(ü|u)rkiye|Turkey/i, ['Turkey', 'Türkiye']],
  [/North America/i, ['North America']],
  [/Southeast Asia/i, ['Southeast Asia']],
  [/South Asia/i, ['South Asia']],
  [/Brazil/i, ['Brazil']], [/Korea/i, ['Korea']], [/Japan/i, ['Japan']], [/Thailand/i, ['Thailand']], [/Indonesia/i, ['Indonesia']],
  [/Philippines/i, ['Philippines']], [/Vietnam/i, ['Vietnam']], [/Oceania/i, ['Oceania']], [/MENA/i, ['MENA']], [/DACH/i, ['DACH']],
  [/France/i, ['France']], [/Spain/i, ['Spain']], [/Italy/i, ['Italy']], [/Portugal/i, ['Portugal']], [/East Surge|East:/i, ['East']],
  [/EMEA/i, ['EMEA']], [/Americas/i, ['Americas']], [/Pacific/i, ['Pacific']], [/China/i, ['China']], [/LATAM/i, ['Latin America']],
]

const dayOf = (s: string | undefined, year: number): number | null => {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '')
  return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(year, 0, 1)) / 86400000) : null
}

/** A Challengers-tier event's page: the same scene, the same split number, the nearest dates. */
function guess(year: number, ev: CEv, pages: Map<string, string>): string | null {
  const regs = REGION.find(([re]) => re.test(ev.name))?.[1]
  if (!regs || ev.start == null || ev.end == null) return null
  const num = /(Split|Stage|Act)\s*(\d)/i.exec(ev.name)
  const best = [...pages.keys()]
    .filter((t) => t.startsWith(`VCL/${year}/`) && regs.some((rg) => t.includes(`/${rg}/`) || t.endsWith(`/${rg}`)))
    .map((t) => {
      const info = infobox(pages.get(t)!)
      const s = dayOf(info.sdate, year)
      const e = dayOf(info.edate, year)
      const dist = s != null && e != null ? Math.abs(s - ev.start!) + Math.abs(e - ev.end!) : 999
      const numOk = num ? new RegExp(`(Split|Stage|Act) ${num[2]}\\b`).test(t) : true
      return { t, dist, numOk }
    })
    .sort((a, b) => Number(b.numOk) - Number(a.numOk) || a.dist - b.dist)[0]
  return best && best.numOk && best.dist <= 120 ? best.t : null
}

/* ------------------------------------------------------------------ */
/*  wikitext                                                           */
/* ------------------------------------------------------------------ */

function loadPages(dirs: string[]): Map<string, string> {
  const pages = new Map<string, string>()
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((x) => /^(events_\d+|pages_.*)\.json$/.test(x))) {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      for (const p of d?.query?.pages ?? []) {
        const text = p?.revisions?.[0]?.slots?.main?.content
        if (!p.missing && typeof text === 'string') pages.set(p.title, text)
      }
    }
  }
  return pages
}

/** Every {{name …}} in the text, brace-matched: the whole template, and its body after the name. */
function templates(text: string, nameRe: string): { full: string; body: string }[] {
  const out: { full: string; body: string }[] = []
  const re = new RegExp(`\\{\\{\\s*(${nameRe})\\s*(\\||\\}\\}|\\n)`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    let depth = 0
    let i = m.index
    while (i < text.length) {
      if (text.startsWith('{{', i)) { depth++; i += 2; continue }
      if (text.startsWith('}}', i)) { depth--; i += 2; if (depth === 0) break; continue }
      i++
    }
    const inner = text.slice(m.index + 2, i - 2)
    out.push({ full: text.slice(m.index, i), body: inner.slice(inner.indexOf(m[1]) + m[1].length) })
  }
  return out
}

/** A template's parameters, split on the pipes that are not inside another template or link. */
function splitTop(body: string): string[] {
  const out: string[] = []
  let dt = 0
  let dl = 0
  let cur = ''
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2)
    if (two === '{{' || two === '}}' || two === '[[' || two === ']]') {
      if (two === '{{') dt++
      else if (two === '}}') dt--
      else if (two === '[[') dl++
      else dl--
      cur += two
      i++
      continue
    }
    if (body[i] === '|' && dt === 0 && dl === 0) { out.push(cur); cur = '' } else cur += body[i]
  }
  out.push(cur)
  return out
}

function named(body: string): Record<string, string> {
  const o: Record<string, string> = {}
  for (const part of splitTop(body)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    if (/^[a-z0-9_]+$/i.test(k)) o[k.toLowerCase()] = part.slice(eq + 1).replace(/<!--[\s\S]*?-->/g, '').trim()
  }
  return o
}

const num = (s: string | undefined | null): number | null => {
  const t = String(s ?? '').replace(/<ref[\s\S]*?(\/>|<\/ref>)/g, '').replace(/\\n/g, '').trim()
  return /^\$?[\d,']+(\.\d+)?$/.test(t) ? Math.round(Number(t.replace(/[$,']/g, ''))) : null
}

function infobox(text: string): Record<string, string> {
  const o: Record<string, string> = {}
  for (const k of ['prizepool', 'prizepoolusd', 'localcurrency', 'sdate', 'edate']) {
    const m = new RegExp(`^\\|\\s*${k}\\s*=(.*)$`, 'mi').exec(text)
    if (m && m[1].trim()) o[k] = m[1].trim()
  }
  return o
}

/** The page's first prize table as its wikitext writes it: each place range, in dollars or in its own currency. */
function poolOf(text: string): { slots: Slot[]; currency: string | null } | null {
  for (const { body } of templates(text, 'TeamPrizePool|PrizePool|SoloPrizePool')) {
    const top = named(body.replace(/\{\{\s*Slot[\s\S]*$/i, ''))
    const slots: Slot[] = []
    let next = 1
    for (const part of splitTop(body)) {
      const s = part.trim()
      if (!/^\{\{\s*Slot\s*[|}]/i.test(s)) continue
      const p = named(s.replace(/^\{\{\s*Slot\s*/i, '').replace(/\}\}\s*$/, ''))
      // an award, or a place paid for not playing (FPX at Reykjavík 2022), is not a placing
      if (p.award || /^(true|y|yes)$/i.test(p.dnp ?? '')) continue
      const pm = /^(\d+)(?:\s*-\s*(\d+))?/.exec(p.place ?? '')
      const from = pm ? Number(pm[1]) : next
      const to = pm ? Number(pm[2] ?? pm[1]) : next + (Number(p.count) || 1) - 1
      next = to + 1
      slots.push({ from, to, usd: num(p.usdprize), local: num(p.localprize) })
    }
    if (slots.length) return { slots, currency: top.localcurrency ?? null }
  }
  const old = templates(text, 'prize pool slot')
  if (old.length) {
    const top = named(templates(text, 'prize pool start')[0]?.body ?? '')
    const slots: Slot[] = []
    for (const { body } of old) {
      const p = named(body)
      const pm = /^(\d+)(?:\s*-\s*(\d+))?/.exec(p.place ?? '')
      if (pm) slots.push({ from: Number(pm[1]), to: Number(pm[2] ?? pm[1]), usd: num(p.usdprize), local: num(p.localprize) })
    }
    if (slots.length) return { slots, currency: top.localcurrency ?? null }
  }
  return null
}

const realCurrency = (c: string | null | undefined): string | undefined =>
  c && !/^(usd|seed)$/i.test(c.trim()) ? c.trim().toUpperCase() : undefined

/** A rendered table's placing rows — not its awards. */
const placementRows = (r: Rendered | undefined): Rendered['rows'] => (r?.rows ?? []).filter((x) => /^\d+(-\d+)?$/.test(x.place))

function entryOf(year: number, lp: string, text: string, renders: Record<string, Rendered>): Entry & { needs?: boolean } {
  const info = infobox(text)
  const pool = poolOf(text)
  const cur = pool?.slots.some((s) => !((s.usd ?? 0) > 0) && (s.local ?? 0) > 0)
    ? realCurrency(pool.currency) ?? realCurrency(info.localcurrency) : undefined
  const rows = placementRows(renders[lp])
  // the table as Liquipedia shows it: its places as the results grouped them, every amount in dollars
  if (rows.some((r) => (r.usd ?? 0) > 0)) {
    const pay: Row[] = []
    const seen = new Set<string>()
    for (const r of rows) {
      if (seen.has(r.place) || !((r.usd ?? 0) > 0)) continue
      seen.add(r.place)
      const [a, b] = r.place.split('-').map(Number)
      pay.push([a, b ?? a, Math.round(r.usd!)])
    }
    return { y: year, lp, ...(cur ? { cur } : {}), pay }
  }
  if (!pool) return { y: year, lp, status: 'unpublished' }
  const positive = pool.slots.some((s) => (s.usd ?? 0) > 0 || (s.local ?? 0) > 0)
  if (!positive) {
    const zero = pool.slots.every((s) => s.usd === 0 || s.local === 0)
    const declared = num(info.prizepoolusd) ?? num(info.prizepool)
    return { y: year, lp, status: zero && !declared ? 'none' : 'unpublished' }
  }
  // not rendered: the dollars the wikitext states, and a local amount waits for its conversion
  if (cur) return { y: year, lp, status: 'unpublished', needs: true }
  const pay: Row[] = pool.slots.filter((s) => (s.usd ?? 0) > 0).map((s) => [s.from, s.to, Math.round(s.usd!)])
  return { y: year, lp, pay, needs: true }
}

/* ------------------------------------------------------------------ */
/*  Liquipedia                                                         */
/* ------------------------------------------------------------------ */

async function api(params: Record<string, string>, post = false): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = post
      ? await fetch(API, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Encoding': 'gzip' }, body: new URLSearchParams(params) })
      : await fetch(`${API}?${new URLSearchParams(params)}`, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } })
    if (r.status === 429 || r.status >= 500) {
      console.log(`  （Liquipedia ${r.status}，${60 * (attempt + 1)} 秒后再试）`)
      await sleep(60000 * (attempt + 1))
      continue
    }
    return r.json()
  }
  throw new Error('Liquipedia 一直不回')
}

const PREFIXES = ['VCL/2023/', 'VCL/2024/', 'VCL/2025/', 'VCL/2026/', 'China Evolution Series', 'FGC']
const SKIP = /\/(Statistics|Player Information|Additional Content|Broadcasts|Media|Showmatch|Bootcamps)$|Game Changers|Circuit Points$/i

/** The Challengers leagues' pages, which fetch_lp_events.py does not read. */
async function fetchPages(): Promise<void> {
  mkdirSync(PRIZE_CACHE, { recursive: true })
  const titles: string[] = []
  for (const prefix of PREFIXES) {
    let cont: string | undefined
    for (let n = 0; ; n++) {
      const file = join(PRIZE_CACHE, `allpages_${prefix.replace(/[^a-z0-9]+/gi, '_')}_${n}.json`)
      let d: any
      if (existsSync(file)) d = JSON.parse(readFileSync(file, 'utf8'))
      else {
        await sleep(2100)
        d = await api({ action: 'query', list: 'allpages', apprefix: prefix, aplimit: '500', format: 'json', formatversion: '2', ...(cont ? { apcontinue: cont } : {}) })
        writeFileSync(file, JSON.stringify(d))
      }
      titles.push(...(d?.query?.allpages ?? []).map((p: { title: string }) => p.title).filter((t: string) => !SKIP.test(t)))
      cont = d?.continue?.apcontinue
      if (!cont) break
    }
  }
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50)
    const file = join(PRIZE_CACHE, `pages_${String(i / 50).padStart(3, '0')}.json`)
    if (existsSync(file)) continue
    await sleep(2100)
    writeFileSync(file, JSON.stringify(await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', format: 'json', formatversion: '2', titles: chunk.join('|') })))
    console.log(`  页面 ${Math.min(i + 50, titles.length)}/${titles.length}`)
  }
}

/** What a page's prize tables need to render: its infobox (for the dates) and every prize table on it, wherever it sits. */
function renderPiece(text: string): string | null {
  const firstHead = text.search(/^==[^=]/m)
  const head = firstHead < 0 ? text : text.slice(0, firstHead)
  const pools = templates(text, 'TeamPrizePool|PrizePool|SoloPrizePool').map((t) => t.full)
  const old = /\{\{\s*prize pool start[\s\S]*?\{\{\s*prize pool end\s*\}\}/i.exec(text)
  if (old) pools.push(old[0])
  return pools.length ? `${head}\n${pools.join('\n')}` : null
}

function renderedRows(html: string): Rendered['rows'] {
  const rows: Rendered['rows'] = []
  const h = html.replace(/&#95;/g, '_').replace(/&#45;/g, '-')
  const re = /<tr class="table2__row--body[^"]*"[^>]*>([\s\S]*?)<\/tr>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(h))) {
    const place = /prizepooltable-place[^>]*>(?:\s*<span[^>]*>)?\s*([^<]*)</.exec(m[1])
    // two currencies: the dollar column is toggle area 1; dollars alone: the first right-aligned amount
    const usd = /data-toggle-area-content="1"[^>]*>\s*\$([\d,]+(?:\.\d+)?)/.exec(m[1]) ?? /<td data-align="right"[^>]*>\s*\$([\d,]+(?:\.\d+)?)/.exec(m[1])
    const local = /data-toggle-area-content="2"[^>]*>([^<]*)</.exec(m[1])
    if (place) rows.push({ place: place[1].trim(), usd: usd ? Number(usd[1].replace(/,/g, '')) : null, local: local ? local[1].replace(/&#160;/g, ' ').trim() : null })
  }
  return rows
}

async function fetchRenders(titles: string[], pages: Map<string, string>, renders: Record<string, Rendered>): Promise<void> {
  const todo = titles.filter((t) => !placementRows(renders[t]).length && renderPiece(pages.get(t) ?? ''))
  const BATCH = 8
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH)
    const text = chunk.map((t, k) => `\n<div id="lpbatch-${k}"></div>\n${renderPiece(pages.get(t)!)}\n`).join('\n') + '\n<div id="lpbatch-end"></div>\n'
    const j = await api({ action: 'parse', format: 'json', formatversion: '2', prop: 'text', contentmodel: 'wikitext', title: chunk[0], text, disablelimitreport: '1' }, true)
    const html: string = j?.parse?.text ?? ''
    chunk.forEach((t, k) => {
      const a = html.indexOf(`id="lpbatch-${k}"`)
      const next = html.indexOf(`id="lpbatch-${k + 1}"`)
      const b = next >= 0 ? next : html.indexOf('id="lpbatch-end"')
      if (a >= 0) renders[t] = { rows: renderedRows(html.slice(a, b >= 0 ? b : undefined)) }
    })
    mkdirSync(dirname(RENDER), { recursive: true })
    writeFileSync(RENDER, JSON.stringify(renders, null, 1))
    console.log(`  渲染 ${Math.min(i + BATCH, todo.length)}/${todo.length}`)
    if (i + BATCH < todo.length) await sleep(31000)
  }
}

/* ------------------------------------------------------------------ */
/*  build                                                              */
/* ------------------------------------------------------------------ */

function build(pages: Map<string, string>, renders: Record<string, Rendered>) {
  const circuit = JSON.parse(readFileSync(join(DATA, 'circuit.json'), 'utf8')) as Record<string, CEv[]>
  const routes = JSON.parse(readFileSync(join(DATA, 'routes.json'), 'utf8'))
  const partnered = JSON.parse(readFileSync(join(DATA, 'routes_partnered.json'), 'utf8'))
  const routed: Record<string, { lp?: string }> = { ...routes.events, ...partnered.events }
  const events: Record<string, Entry> = {}
  const needs = new Set<string>()
  const unconverted = new Set<string>()
  const unmapped: string[] = []
  const guessed: string[] = []
  const add = (id: string, y: number, lp: string) => {
    const e = entryOf(y, lp, pages.get(lp)!, renders)
    if (e.needs) {
      needs.add(lp)
      if (e.status === 'unpublished') unconverted.add(lp)
    }
    delete e.needs
    events[id] = e
  }
  for (const [ys, evs] of Object.entries(circuit)) {
    const y = Number(ys)
    for (const ev of evs) {
      let lp: string | null | undefined = Object.prototype.hasOwnProperty.call(OVERRIDE, ev.id) ? OVERRIDE[ev.id] : routed[ev.id]?.lp
      if (lp === undefined && y >= 2023) {
        lp = guess(y, ev, pages)
        if (lp) guessed.push(`${y} ${ev.id} ${ev.name} → ${lp}`)
      }
      if (!lp || !pages.has(lp)) { unmapped.push(`${y} ${ev.id} ${ev.name}${lp ? `（${lp} 不在缓存里）` : ''}`); continue }
      add(ev.id, y, lp)
    }
  }
  for (const [id, [y, lp]] of Object.entries(EXTRA)) if (pages.has(lp)) add(id, y, lp)
  return { events, needs, unconverted, unmapped, guessed }
}

async function main(): Promise<void> {
  if (argv.includes('--fetch')) await fetchPages()
  const pages = loadPages(LP_DIRS)
  const renders: Record<string, Rendered> = existsSync(RENDER) ? JSON.parse(readFileSync(RENDER, 'utf8')) : {}
  let out = build(pages, renders)
  if (argv.includes('--render-fetch') && out.needs.size) {
    await fetchRenders([...out.needs], pages, renders)
    out = build(pages, renders)
  }
  const { events, needs, unconverted, unmapped, guessed } = out
  const doc = {
    source: 'Liquipedia VALORANT (https://liquipedia.net/valorant/<lp>): each event page\'s prize pool as Liquipedia renders it; local-currency places at the USD it shows for them. Built by scripts/build_prizes.ts.',
    events,
  }
  writeFileSync(OUT, JSON.stringify(doc, null, 0).replace(/\},"/g, '},\n"') + '\n')

  const byYear = new Map<number, Record<string, number>>()
  for (const e of Object.values(events)) {
    const r = byYear.get(e.y) ?? {}
    const k = e.status ?? 'paid'
    r[k] = (r[k] ?? 0) + 1
    byYear.set(e.y, r)
  }
  console.log(`写入 ${OUT}：${Object.keys(events).length} 场`)
  for (const [y, r] of [...byYear].sort((a, b) => a[0] - b[0])) console.log(`  ${y}  有奖金表 ${r.paid ?? 0} · 无奖金 ${r.none ?? 0} · 未公开 ${r.unpublished ?? 0}`)
  if (argv.includes('--verbose')) for (const g of guessed) console.log(`  按名称和日期配上：${g}`)

  // a table whose places do not add up to the pool its infobox declares in dollars
  const off: string[] = []
  for (const [id, e] of Object.entries(events)) {
    if (e.status || e.cur) continue
    const info = infobox(pages.get(e.lp)!)
    const pool = info.localcurrency && realCurrency(info.localcurrency) ? null : num(info.prizepoolusd) ?? num(info.prizepool)
    const sum = (e.pay ?? []).reduce((s, [a, b, v]) => s + v * (b - a + 1), 0)
    if (pool && Math.abs(sum - pool) > pool * 0.01) off.push(`${id} ${e.lp}：各名次合计 $${sum.toLocaleString()}，总奖池 $${pool.toLocaleString()}`)
  }
  console.log(`\n和总奖池对不上的 ${off.length} 场：`)
  for (const o of off) console.log(`  ${o}`)
  console.log(`\n没有页面的 ${unmapped.length} 场：`)
  for (const u of unmapped) console.log(`  ${u}`)
  console.log(`\n还没渲染的 ${needs.size} 页（--render-fetch），其中本地货币未换算 ${unconverted.size} 页`)
  if (argv.includes('--verbose')) for (const t of unconverted) console.log(`  ${t}`)
}

main()
