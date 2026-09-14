/**
 * The ladder years, measured: how fast a ladder start is noticed, how many
 * sign, and how long they spend at the top of the ladder. The score columns
 * (≥52 … ≥88) read the engine's ladder score, so a run before and after a
 * change to how the ladder is shown compares like with like.
 *
 *   npx tsx scripts/probe_rank.ts [seeds=8] [region=China] [year=2026] [origin=netcafe] [years=4]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import type { Region } from '../src/engine/types'
import { ladderLabel } from '../src/engine/me/prepro'
import { rankAt } from '../src/engine/me/rank'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
} as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const SEEDS = [1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31].slice(0, Number(process.argv[2] ?? 8))
const region = (process.argv[3] ?? 'China') as Region
const year = Number(process.argv[4] ?? 2026)
const originKey = process.argv[5] ?? 'netcafe'
const years = Number(process.argv[6] ?? 4)

const HOW: [RegExp, string][] = [
  [/看了你的杯赛/, 'cup'], [/在天梯上注意到你/, 'rank'], [/看了你的直播/, 'fans'], [/知道你在找队/, 'free'], [/教练组推荐/, 'scout'],
]
// today's reading is the place on the board as it has climbed past the score (me/rank.ts), the best one the place held
const label = (s: ReturnType<typeof createCareer>, peak = false) => ladderLabel(s, peak ? s.me!.pre.ladderPeak : undefined)

const rows: Record<string, number | string>[] = []
for (const seed of SEEDS) {
  const t0 = Date.now()
  const state = createCareer({ name: 'Probe', region, role: '决斗者', talents: emptyTalents(), originKey, start: 'pre', seed, year })
  const me = state.me!
  const startLabel = label(state)
  const startLadder = me.pre.ladder
  const seen = new Set<string>()
  let firstInvite = 0, firstRank = 0, signed = 0, weeks = 0
  const byVia: Record<string, number> = {}
  let w52 = 0, w62 = 0, w72 = 0, w88 = 0, wBoard = 0, wRadiant = 0
  const labels = new Set<string>()
  while (me.phase === 'pre' && weeks < years * 52) {
    if (autoWeek(state).kind === 'game-over') break
    weeks++
    const l = me.pre.ladder
    if (l >= 52) w52++
    if (l >= 62) w62++
    if (l >= 72) w72++
    if (l >= 88) w88++
    const r = rankAt(state)
    if (r.pos !== null) wBoard++
    if (r.radiant) wRadiant++
    if (weeks % 4 === 0) labels.add(label(state))
    for (const ln of me.log) {
      const k = `${ln.year}:${ln.day}:${ln.text}`
      if (seen.has(k)) continue
      seen.add(k)
      if (!/邀请你去试训|直接给了报价/.test(ln.text)) continue
      const via = HOW.find(([re]) => re.test(ln.text))?.[1] ?? '?'
      byVia[via] = (byVia[via] ?? 0) + 1
      if (!firstInvite) firstInvite = weeks
      if (via === 'rank' && !firstRank) firstRank = weeks
    }
    if (me.phase === 'pro') signed = weeks
  }
  rows.push({
    seed, startL: Math.round(startLadder), start: startLabel, peak: Math.round(me.pre.ladderPeak), peakLabel: label(state, true),
    firstInvite, firstRank, signed, w52, w62, w72, w88, wBoard, wRadiant, weeks,
    via: Object.entries(byVia).map(([k, v]) => `${k}${v}`).join(' '),
    ach100: me.achievements.includes('ladder_100') ? 1 : 0, achTop: me.achievements.includes('ladder_top') ? 1 : 0,
    scoutDm: me.eventCounts?.scout_dm ?? 0, fans: Math.round(me.fans), secs: ((Date.now() - t0) / 1000).toFixed(1),
    seenLabels: [...labels].slice(0, 6).join(' / '),
  })
  console.log(JSON.stringify(rows[rows.length - 1]))
}

const num = (k: string) => rows.map((r) => Number(r[k]))
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
const med = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const nz = (xs: number[]) => xs.filter((x) => x > 0)
console.log(`\n== ${region} ${year} ${originKey}, ${rows.length} seeds, up to ${years} years`)
console.log(`start ladder mean ${mean(num('startL')).toFixed(1)}; peak mean ${mean(num('peak')).toFixed(1)}`)
console.log(`first invite week: median ${med(nz(num('firstInvite')))} (${nz(num('firstInvite')).length}/${rows.length} got one)`)
console.log(`first ladder invite week: median ${med(nz(num('firstRank')))} (${nz(num('firstRank')).length}/${rows.length})`)
console.log(`signed: ${nz(num('signed')).length}/${rows.length}, median week ${med(nz(num('signed')))}`)
console.log(`weeks at >=52 ${mean(num('w52')).toFixed(1)}, >=62 ${mean(num('w62')).toFixed(1)}, >=72 ${mean(num('w72')).toFixed(1)}, >=88 ${mean(num('w88')).toFixed(1)} (mean of ${mean(num('weeks')).toFixed(1)} weeks pre-pro)`)
console.log(`weeks on the board ${mean(num('wBoard')).toFixed(1)}, as 辐能战魂 ${mean(num('wRadiant')).toFixed(1)}`)
console.log(`ach 前一百 ${mean(num('ach100')).toFixed(2)}, 登顶 ${mean(num('achTop')).toFixed(2)}; scout_dm ${mean(num('scoutDm')).toFixed(2)}; fans ${mean(num('fans')).toFixed(0)}`)
