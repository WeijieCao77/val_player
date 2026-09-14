/**
 * Each real prize table in the currency the career is paid in: the `nat` field
 * of src/data/prizes_me.json. Run after scripts/build_prizes.ts (which rewrites
 * the file without it) and before scripts/build_prize_estimates.ts.
 *
 * The author, 2026-09-14: four currencies, one per VCT league (engine/me/currency.ts).
 *  - A table published in dollars stays in dollars — the internationals, and
 *    every league or Challengers table Riot or its operator wrote in dollars.
 *  - A table published in euros, won or yuan is kept in that currency, at the
 *    amounts its page writes (each Slot's localprize), not converted back from
 *    Liquipedia's dollars. Those pages are fetched once into .cache/lp/prizes
 *    (--fetch), two seconds apart, fifty titles a request.
 *  - A table published in any other currency (baht, peso, dong, lira, Singapore
 *    or Malaysian dollars, rupiah, Australian dollars, yen, real…) is converted
 *    into its league's currency: the dollars Liquipedia converted it to at the
 *    event's own dates, times that currency's IRS yearly average for the prize
 *    year. The entry says so (`src` and `via`).
 *
 *   npx tsx scripts/build_prize_currency.ts [--fetch]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) }, removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0 }
const realFetch = globalThis.fetch

const { eventOf } = await import('../src/engine/circuit')
const { leagueCurOf, perUsd } = await import('../src/engine/me/currency')
type Cur = import('../src/engine/me/currency').Cur

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(ROOT, 'src', 'data', 'prizes_me.json')
const CACHE = join(ROOT, '.cache', 'lp', 'prizes')
const FETCH = process.argv.includes('--fetch')
const API = 'https://liquipedia.net/valorant/api.php'
// the project only: no personal or account details in request headers
const UA = 'val_player-dataset/0.1 (VALORANT career simulator; prize table build)'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Row = [number, number, number]
interface Nat { cur: Cur; pay: Row[]; src?: string; via?: string }
interface Entry { y: number; lp: string; status?: string; cur?: string; pay?: Row[]; nat?: Nat }
const doc = JSON.parse(readFileSync(FILE, 'utf8')) as { source: string; currency?: string; events: Record<string, Entry> }

const KEPT = new Set(['EUR', 'KRW', 'CNY'])

/* ---------------- wikitext: each slot's local amount ---------------- */

function templates(text: string, nameRe: string): string[] {
  const out: string[] = []
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
    out.push(inner.slice(inner.indexOf(m[1]) + m[1].length))
  }
  return out
}
function splitTop(body: string): string[] {
  const out: string[] = []
  let dt = 0, dl = 0, cur = ''
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2)
    if (two === '{{' || two === '}}' || two === '[[' || two === ']]') {
      if (two === '{{') dt++; else if (two === '}}') dt--; else if (two === '[[') dl++; else dl--
      cur += two; i++; continue
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
const num = (s: string | undefined): number | null => {
  const t = String(s ?? '').replace(/<ref[\s\S]*?(\/>|<\/ref>)/g, '').trim()
  return /^\$?[\d,']+(\.\d+)?$/.test(t) ? Number(t.replace(/[$,']/g, '')) : null
}
/** place → local amount, from the page's first prize table */
function localByPlace(text: string): Map<number, number> {
  const out = new Map<number, number>()
  for (const body of templates(text, 'TeamPrizePool|PrizePool|SoloPrizePool')) {
    let next = 1
    for (const part of splitTop(body)) {
      const s = part.trim()
      if (!/^\{\{\s*Slot\s*[|}]/i.test(s)) continue
      const p = named(s.replace(/^\{\{\s*Slot\s*/i, '').replace(/\}\}\s*$/, ''))
      if (p.award || /^(true|y|yes)$/i.test(p.dnp ?? '')) continue
      const pm = /^(\d+)(?:\s*-\s*(\d+))?/.exec(p.place ?? '')
      const from = pm ? Number(pm[1]) : next
      const to = pm ? Number(pm[2] ?? pm[1]) : next + (Number(p.count) || 1) - 1
      next = to + 1
      const local = num(p.localprize)
      if (local != null) for (let q = from; q <= to; q++) out.set(q, local)
    }
    if (out.size) return out
  }
  for (const body of templates(text, 'prize pool slot')) {
    const p = named(body)
    const pm = /^(\d+)(?:\s*-\s*(\d+))?/.exec(p.place ?? '')
    const local = num(p.localprize)
    if (pm && local != null) for (let q = Number(pm[1]); q <= Number(pm[2] ?? pm[1]); q++) out.set(q, local)
  }
  return out
}

/* ---------------- the pages ---------------- */

function loadPages(): Map<string, string> {
  const pages = new Map<string, string>()
  if (!existsSync(CACHE)) return pages
  for (const f of readdirSync(CACHE).filter((x) => /^currency_\d+\.json$/.test(x))) {
    const d = JSON.parse(readFileSync(join(CACHE, f), 'utf8'))
    for (const p of d?.query?.pages ?? []) {
      const text = p?.revisions?.[0]?.slots?.main?.content
      if (!p.missing && typeof text === 'string') pages.set(p.title, text)
    }
  }
  return pages
}

const wanted = Object.values(doc.events).filter((e) => e.cur && KEPT.has(e.cur) && e.pay?.length).map((e) => e.lp)
let pages = loadPages()
const missing = [...new Set(wanted)].filter((t) => !pages.has(t))
if (missing.length && FETCH) {
  mkdirSync(CACHE, { recursive: true })
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50)
    const params = new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', format: 'json', formatversion: '2', titles: chunk.join('|') })
    const r = await realFetch(API, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Encoding': 'gzip' }, body: params })
    if (!r.ok) throw new Error(`Liquipedia ${r.status}`)
    writeFileSync(join(CACHE, `currency_${String(i / 50).padStart(3, '0')}.json`), JSON.stringify(await r.json()))
    console.log(`  取回 ${chunk.length} 页`)
    await sleep(2500)
  }
  pages = loadPages()
}
const stillMissing = [...new Set(wanted)].filter((t) => !pages.has(t))
if (stillMissing.length && !FETCH) console.log(`${stillMissing.length} 页不在缓存里，加 --fetch 取回；这些先按汇率折算`)

/* ---------------- each table ---------------- */

const REGION_OF_LP: [RegExp, string][] = [
  [/China/i, 'China'], [/EMEA|DACH|France|Spain|Italy|Portugal|NORTH|East|Turkey|Türkiye|MENA|Europe|CIS|Northern/i, 'EMEA'],
  [/Korea|Japan|Southeast Asia|Malaysia|Singapore|Indonesia|Thailand|Philippines|Vietnam|Oceania|South Asia|Hong Kong|Taiwan|Pacific|APAC/i, 'Pacific'],
  [/North America|Brazil|Latin America|LATAM|Americas/i, 'Americas'],
]
function regionOf(id: string, e: Entry): string | null {
  const ev = eventOf(id.replace(/^F\d{4}:/, ''))
  if (ev?.region) return ev.region
  if (ev && !ev.region) return null
  return REGION_OF_LP.find(([re]) => re.test(e.lp))?.[1] ?? null
}
const roundAmt = (v: number, cur: Cur): number => (cur === 'KRW' ? Math.round(v / 1000) * 1000 : Math.round(v))

let kept = 0, converted = 0, fallback = 0
const notes: string[] = []
for (const [id, e] of Object.entries(doc.events)) {
  delete e.nat
  if (!e.pay?.length || !e.cur) continue
  const region = regionOf(id, e)
  if (KEPT.has(e.cur)) {
    const cur = e.cur as Cur
    const text = pages.get(e.lp)
    const local = text ? localByPlace(text) : new Map<number, number>()
    const rows: Row[] = []
    const ratios: number[] = []
    let ok = true
    for (const [a, b, usd] of e.pay) {
      const xs: number[] = []
      for (let q = a; q <= b; q++) { const v = local.get(q); if (v == null || !(v > 0)) { ok = false; break } xs.push(v) }
      if (!ok) break
      const v = xs.reduce((s, x) => s + x, 0) / xs.length
      rows.push([a, b, roundAmt(v, cur)])
      ratios.push(v / usd)
    }
    // one conversion rate per event: a page whose amounts disagree with its own dollars is not trusted
    const spread = ratios.length ? Math.max(...ratios) / Math.min(...ratios) : 99
    if (ok && rows.length === e.pay.length && spread <= 1.06) {
      e.nat = { cur, pay: rows }
      kept++
      continue
    }
    const r = perUsd(cur, e.y)
    e.nat = { cur, pay: e.pay.map(([a, b, v]) => [a, b, roundAmt(v * r, cur)] as Row), src: e.cur, via: `页面没写本币金额：Liquipedia 美元 × ${e.y} 年 IRS 年均汇率` }
    fallback++
    notes.push(`${id} ${e.lp}：${text ? '本币金额和美元对不上' : '页面不在缓存'}，按汇率折算`)
    continue
  }
  const cur = leagueCurOf(region)
  const r = perUsd(cur, e.y)
  e.nat = { cur, pay: e.pay.map(([a, b, v]) => [a, b, roundAmt(v * r, cur)] as Row), src: e.cur, via: `${e.cur} 按 Liquipedia 折成美元（赛事当期汇率），再按 ${e.y} 年 IRS 年均汇率折成${cur === 'USD' ? '美元' : cur === 'EUR' ? '欧元' : cur === 'KRW' ? '韩元' : '人民币'}` }
  converted++
}

doc.currency = 'nat = the table in the career\'s currency (engine/me/currency.ts). Dollar tables have none and are paid in dollars. EUR/KRW/CNY tables keep the amounts their Liquipedia page writes; any other currency is Liquipedia\'s dollars times the prize year\'s IRS yearly average for its league\'s currency (src, via). Built by scripts/build_prize_currency.ts.'
const ordered = { source: doc.source, currency: doc.currency, events: doc.events }
writeFileSync(FILE, JSON.stringify(ordered, null, 0).replace(/\},"/g, '},\n"') + '\n')
console.log(`本币原额 ${kept} 张 · 折算 ${converted} 张 · 本币没取到按汇率 ${fallback} 张`)
for (const n of notes) console.log(`  ${n}`)
