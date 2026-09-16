/**
 * 「有成就弹窗我打进了冠军赛」 — but the club never played it.
 *
 * Found while probing the season summary (scripts/probe_seasonend.ts): the
 * 打进大赛 card (engine/me/moments.ts noteQualify) tests `comp.teams`, and for a
 * real event that list is history's booking, written when the season is set up
 * (engine/circuit.ts bookEvent) — months before the draw seats anybody here
 * (circuit.ts begin). So the card can name an event this world will seat someone
 * else in, and no match ever follows.
 *
 * That was read off the code. This probe proves it happens, and counts it.
 *
 * Every day of a career the moments queue is drained exactly as the screen drains
 * it (ui/me/MomentQueue.tsx takeMoment), so every card that reaches the player is
 * written down: which event, which day, and — read the morning after — whether the
 * event had even been drawn yet. Each card is then held against what the club
 * really did there: a card for an event with no tie of my club's in it, all season,
 * is a card the player was shown for a 冠军赛 he never played.
 *
 * Both ways of playing the season out, since the card is raised in the day loop
 * both of them share (engine/me/week.ts runDays).
 *
 *   npx tsx scripts/probe_qualcard.ts [seed=11] [years=3] [scn=cn26,eu26,pa26,eu21]
 */
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

import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { advanceTurn } from '../src/engine/me/week'
import { advanceUntil, autoPlan, autoResolve, runAutoPilot } from '../src/engine/me/auto'
import { MeMatch } from '../src/engine/me/matchplay'
import { takeMoment } from '../src/engine/me/moments'
import { compClass } from '../src/engine/me/compclass'
import { compCn } from '../src/engine/me/compname'
import type { GameState, Region } from '../src/engine/types'

const seed = Number(process.argv[2] ?? 11)
const YEARS = Number(process.argv[3] ?? 3)
const only = (process.argv[4] ?? '').split(',').filter(Boolean)

interface Scn { key: string; label: string; region: string; start: StartPoint; year: number }
const SCN: Scn[] = [
  { key: 'cn26', label: '2026 中国 · VCT 第六人', region: 'China', start: 't1', year: 2026 },
  { key: 'eu26', label: '2026 欧洲 · VCT 第六人', region: 'Europe', start: 't1', year: 2026 },
  { key: 'pa26', label: '2026 太平洋 · VCT 第六人', region: 'Pacific', start: 't1', year: 2026 },
  { key: 'eu21', label: '2021 欧洲 · 强队第六人', region: 'Europe', start: 't1', year: 2021 },
]

/** a 打进大赛 card the screen showed */
interface Card {
  year: number
  day: number
  comp: string
  key: string
  /** the event's own first day, and whether it had been drawn when the card was read back */
  start: number
  mode: string
}

/** what my club really did at that event, by the end of its year */
interface Row {
  year: number
  key: string
  name: string
  seated: boolean
  mode: string
  start: number
  fx: number
  fxPlayed: number
  mine: number
}

/** the three classes the card is raised for (engine/me/moments.ts noteQualify) */
const INTL = (name: string): boolean => {
  const c = compClass(name)
  return c === 'masters' || c === 'champions' || c === 'lockin'
}

function rowsOf(state: GameState, book: Map<string, Row>): void {
  const me = state.me
  const club = state.myTeam
  if (!me || !club) return
  for (const comp of Object.values(state.comps)) {
    if (!INTL(comp.name)) continue
    const c = comp.circuit
    const fx = state.fixtures.filter((f) => f.comp === comp.key && (f.teamA === club || f.teamB === club))
    book.set(`${state.year}:${comp.key}`, {
      year: state.year, key: comp.key, name: comp.name,
      seated: comp.teams.includes(club) || !!c?.seeds.includes(club) || Object.values(c?.fill ?? {}).includes(club),
      mode: c ? (c.mode ?? '未开') : '非真实赛历',
      start: c?.start ?? 0,
      fx: fx.length,
      fxPlayed: fx.filter((f) => f.played).length,
      mine: me.matches.filter((m) => m.year === state.year && !m.friendly && m.comp === comp.name).length,
    })
  }
}

/** the screen takes the cards one by one (ui/me/MomentQueue.tsx); here they are taken every morning */
function drain(state: GameState, cards: Card[]): void {
  const me = state.me
  if (!me?.moments?.length) return
  let guard = 0
  while (me.moments.length && guard++ < 40) {
    const m = me.moments[0]
    if (m.kind === 'qualify') {
      const key = m.key.replace(/^qualify:/, '')
      const c = state.comps[key]?.circuit
      cards.push({ year: m.year, day: m.day, comp: m.comp ?? '?', key, start: c?.start ?? 0, mode: c ? (c.mode ?? '未开') : '非真实赛历' })
    }
    takeMoment(state)
  }
}

function watch(state: GameState, on: () => void): void {
  let d = state.day
  Object.defineProperty(state, 'day', {
    get: () => d,
    set: (v: number) => { const fwd = v > d; d = v; if (fwd) on() },
    configurable: true, enumerable: true,
  })
}

const clone = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState

function weekly(state: GameState, untilYear: number): void {
  const me = state.me!
  let guard = 0
  while (state.year < untilYear && me.phase !== 'retired' && !state.gameOver && guard++ < 4000) {
    runAutoPilot(state)
    let g = 0
    while (me.pending.length && g++ < 40) autoResolve(state, me.pending[0])
    if (me.weekDay === 0 && me.ap === me.apMax) autoPlan(state)
    const stop = advanceTurn(state)
    if (stop.kind === 'match') new MeMatch(state, stop.fixture).runOut()
    if (stop.kind === 'game-over') break
  }
}

function fastForward(state: GameState, untilYear: number): void {
  const me = state.me!
  let guard = 0
  let at = ''
  while (state.year < untilYear && me.phase !== 'retired' && !state.gameOver && guard++ < 400) {
    const r = advanceUntil(state, 'season')
    if (r.stop.kind === 'game-over') break
    if (r.stop.kind === 'match') { new MeMatch(state, r.stop.fixture).runOut(); continue }
    if (r.stop.kind === 'pending' && me.pending.length) { autoResolve(state, me.pending[0]); continue }
    const now = `${state.year}:${state.day}:${me.pending.length}`
    if (now === at && !r.weeks) break
    at = now
  }
}

const t0 = Date.now()
let cardsAll = 0
let falseAll = 0
let missingAll = 0

for (const o of SCN) {
  if (only.length && !only.includes(o.key)) continue
  const born = createCareer({
    name: 'Probe', region: o.region as Region, role: '决斗者', talents: emptyTalents(),
    originKey: 'netcafe', start: o.start, seed, year: o.year,
  })
  console.log(`\n=== ${o.label} · seed ${seed} · ${born.teams[born.myTeam]?.name ?? '?'} ===`)

  for (const mode of ['周推', '快进到赛季末'] as const) {
    const state = clone(born)
    const cards: Card[] = []
    const book = new Map<string, Row>()
    watch(state, () => { drain(state, cards); rowsOf(state, book) })
    rowsOf(state, book)
    if (mode === '周推') weekly(state, o.year + YEARS)
    else fastForward(state, o.year + YEARS)
    drain(state, cards)

    const bad: string[] = []
    for (const c of cards) {
      const r = book.get(`${c.year}:${c.key}`)
      if (!r || !r.fx) {
        bad.push(`${c.year} 第 ${c.day} 天弹卡「打进${compCn(c.comp)}」，`
          + `赛事第 ${c.start} 天才开打（弹卡时${c.mode === '未开' ? '还没抽签' : `已 ${c.mode}`}），`
          + `我队整届 ${r ? r.fx : 0} 场比赛${r && !r.seated ? '，最后名单里没有我队' : ''}`)
      }
    }
    // the other way round: an international my club really played that raised no card
    const missing = [...book.values()].filter((r) => r.mine > 0 && r.fxPlayed > 0
      && !cards.some((c) => c.key === r.key && c.year === r.year))
    cardsAll += cards.length
    falseAll += bad.length
    missingAll += missing.length
    console.log(`-- ${mode}：弹了 ${cards.length} 张打进大赛的卡，其中 ${bad.length} 张是我队一场都没打的赛事`
      + `${missing.length ? `；真打了却没弹卡的 ${missing.length} 项` : ''}`)
    for (const b of bad) console.log(`   ✗ ${b}`)
    for (const m of missing) console.log(`   ? ${m.year} ${compCn(m.name)}：打了 ${m.fxPlayed} 场，没有弹卡`)
  }
}

console.log(`\n共弹出 ${cardsAll} 张「打进大赛」的卡，其中 ${falseAll} 张的赛事我队一场都没打；`
  + `真打了却没弹卡的 ${missingAll} 项 · ${((Date.now() - t0) / 1000).toFixed(0)}s`)
