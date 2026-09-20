/**
 * 「每次世界赛的时候都是打完第一场世界赛之后才弹出你进了世界赛的弹窗」 — reported
 * 2026-09-19. The 打进大赛 card (engine/me/moments.ts noteQualify) should come up
 * the day the draw seats my club (engine/circuit.ts begin), not after the club's
 * first tie there has been played.
 *
 * This probe times it. Every day of a career is read (a getter on state.day, so
 * the engine is untouched) and, for every Masters / Champions / LOCK//IN, these
 * days are written down:
 *
 *   抽签   the first day my club stands in this world's field — circuit.mode set
 *          and the club among comp.teams / seeds / fill
 *   排赛程 the first day a tie of my club's is written into the schedule
 *   开打   the first day one of those ties has a result
 *   弹卡   the day the moment was queued (engine/me/moments.ts pushMoment)
 *   上屏   the day the player would actually SEE it — the queue is drawn only where
 *          PlayerGame.tsx draws it: not while a match is live, not under a 推进总结,
 *          so a run that hands back a match shows its cards only once that match is over
 *
 * Three ways of playing, since they stop in different places (engine/me/week.ts
 * runDays, engine/me/auto.ts advanceUntil):
 *
 *   周推       the week screen's own button
 *   快进一个月 advanceUntil(state, 'month') — hands my club's match back to me
 *   快进到赛季末 advanceUntil(state, 'season') — plays my club's matches itself
 *
 *   npx tsx scripts/probe_qualtime.ts [seed=11] [years=3] [scn=cn26,eu26,pa26,eu21,eu21b]
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
import type { AdvanceUntil } from '../src/engine/me/auto'
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
  { key: 'eu21b', label: '2021 欧洲 · 天梯起步', region: 'Europe', start: 'ladder', year: 2021 },
]

/** one Masters / Champions / LOCK//IN of one year, timed */
interface Row {
  year: number
  key: string
  name: string
  cls: string
  /** the event's own first day (circuit.start), 0 for an old world's own international */
  start: number
  /** end-of-day the club first stood in this world's field */
  drawn?: number
  /** end-of-day a tie of my club's first existed / first had a result */
  booked?: number
  played?: number
  /** the day the card was queued, and the day the screen would have drawn it */
  card?: number
  seen?: number
}

const INTL = (name: string): boolean => {
  const c = compClass(name)
  return c === 'masters' || c === 'champions' || c === 'lockin'
}

const rowOf = (book: Map<string, Row>, year: number, key: string, name: string, start: number): Row => {
  const k = `${year}:${key}`
  let r = book.get(k)
  if (!r) {
    r = { year, key, name, cls: compClass(name) ?? '?', start }
    book.set(k, r)
  }
  return r
}

/**
 * Read at the end of each day, before the clock rolls to the next: state.day is
 * still the day just played, so every day below is the day the thing happened.
 */
function sample(state: GameState, book: Map<string, Row>): void {
  const club = state.myTeam
  if (!state.me || !club) return
  for (const comp of Object.values(state.comps)) {
    if (!INTL(comp.name)) continue
    const c = comp.circuit
    const r = rowOf(book, state.year, comp.key, comp.name, c?.start ?? 0)
    const seated = c?.mode
      ? comp.teams.includes(club) || c.seeds.includes(club) || Object.values(c.fill ?? {}).includes(club)
      : !c && comp.teams.includes(club)
    if (seated && r.drawn == null) r.drawn = state.day
    const fx = state.fixtures.filter((f) => (f.comp === comp.key || f.comp === comp.name) && (f.teamA === club || f.teamB === club))
    if (fx.length && r.booked == null) r.booked = state.day
    if (fx.some((f) => f.played) && r.played == null) r.played = state.day
    // the queue as it stands today: the card is written down the day it is pushed, whether or not a screen draws it
    for (const m of state.me.moments ?? []) {
      if (m.kind !== 'qualify') continue
      const rr = rowOf(book, m.year, m.key.replace(/^qualify:/, ''), m.comp ?? '?', 0)
      rr.card ??= m.day
    }
  }
}

/**
 * The screen is up and nothing covers it: MomentQueue draws whatever is queued
 * (ui/me/MomentQueue.tsx, PlayerGame.tsx `!live && !summary`), one card at a time,
 * and the player takes them. Call this exactly where the player would be looking.
 */
function show(state: GameState, book: Map<string, Row>): void {
  const me = state.me
  if (!me?.moments?.length) return
  let guard = 0
  while (me.moments.length && guard++ < 40) {
    const m = me.moments[0]
    if (m.kind === 'qualify') {
      const r = rowOf(book, m.year, m.key.replace(/^qualify:/, ''), m.comp ?? '?', 0)
      r.card ??= m.day
      r.seen ??= state.day
    }
    takeMoment(state)
  }
}

/** on(): the day that just finished, read before state.day moves on */
function watch(state: GameState, on: () => void): void {
  let d = state.day
  Object.defineProperty(state, 'day', {
    get: () => d,
    set: (v: number) => { if (v > d) on(); d = v },
    configurable: true, enumerable: true,
  })
}

const clone = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState

/** the week screen's button: every stop draws the screen again, except a match, which covers it until it is over */
function weekly(state: GameState, untilYear: number, book: Map<string, Row>): void {
  const me = state.me!
  let guard = 0
  while (state.year < untilYear && me.phase !== 'retired' && !state.gameOver && guard++ < 4000) {
    runAutoPilot(state)
    let g = 0
    while (me.pending.length && g++ < 40) autoResolve(state, me.pending[0])
    if (me.weekDay === 0 && me.ap === me.apMax) autoPlan(state)
    const stop = advanceTurn(state)
    if (stop.kind === 'match') new MeMatch(state, stop.fixture).runOut()
    show(state, book)
    if (stop.kind === 'game-over') break
  }
}

/** 「快进…」: the run hands back a match (month) or plays it itself (season); its cards wait for the screen */
function fastForward(state: GameState, untilYear: number, book: Map<string, Row>, until: AdvanceUntil): void {
  const me = state.me!
  let guard = 0
  let at = ''
  while (state.year < untilYear && me.phase !== 'retired' && !state.gameOver && guard++ < 4000) {
    const r = advanceUntil(state, until)
    if (r.stop.kind === 'game-over') break
    // PlayerGame.tsx advanceMany: a match opens at once (setLive), and the queue is not drawn under it
    if (r.stop.kind === 'match') { new MeMatch(state, r.stop.fixture).runOut(); show(state, book); continue }
    // anything else comes back as the 推进总结 or a card; the queue is drawn once that is closed
    show(state, book)
    if (r.stop.kind === 'pending' && me.pending.length) { autoResolve(state, me.pending[0]); continue }
    const now = `${state.year}:${state.day}:${me.pending.length}`
    if (now === at && !r.weeks) break
    at = now
  }
}

const t0 = Date.now()
let cards = 0
let onDraw = 0
let late = 0
let afterFirst = 0

for (const o of SCN) {
  if (only.length && !only.includes(o.key)) continue
  const born = createCareer({
    name: 'Probe', region: o.region as Region, role: '决斗者', talents: emptyTalents(),
    originKey: 'netcafe', start: o.start, seed, year: o.year,
  })
  console.log(`\n=== ${o.label} · seed ${seed} · ${born.teams[born.myTeam]?.name ?? '?'} ===`)

  for (const mode of ['周推', '快进一个月', '快进到赛季末'] as const) {
    const state = clone(born)
    const book = new Map<string, Row>()
    watch(state, () => sample(state, book))
    sample(state, book)
    if (mode === '周推') weekly(state, o.year + YEARS, book)
    else fastForward(state, o.year + YEARS, book, mode === '快进一个月' ? 'month' : 'season')
    sample(state, book)
    show(state, book)

    const rows = [...book.values()].filter((r) => r.drawn != null || r.card != null)
      .sort((a, b) => a.year - b.year || (a.start || 0) - (b.start || 0))
    console.log(`-- ${mode}`)
    for (const r of rows) {
      if (r.seen == null) { console.log(`   ${r.year} ${compCn(r.name)}（${r.cls}）抽签 ${r.drawn ?? '—'} · 没上屏`); continue }
      cards++
      const bad = r.played != null && r.seen >= r.played
      if (bad) afterFirst++
      if (r.drawn != null && r.seen === r.drawn) onDraw++
      else late++
      const tag = bad ? `✗ 打完我队第一场（第 ${r.played} 天）之后才看见`
        : r.drawn != null && r.seen === r.drawn ? '抽签当天看见'
          : `抽签后 ${r.drawn != null ? r.seen - r.drawn : '?'} 天看见`
      console.log(`   ${r.year} ${compCn(r.name)}（${r.cls}）赛事第 ${r.start} 天开打 · `
        + `抽签 ${r.drawn ?? '—'} · 排赛程 ${r.booked ?? '—'} · 我队开打 ${r.played ?? '—'} · `
        + `弹卡 ${r.card ?? '—'} · 上屏 ${r.seen} → ${tag}`)
    }
  }
}

console.log(`\n共 ${cards} 张「打进大赛」的卡上了屏：抽签当天看见的 ${onDraw} 张，晚于抽签 ${late} 张，`
  + `其中 ${afterFirst} 张是我队第一场打完之后才看见的 · ${((Date.now() - t0) / 1000).toFixed(0)}s`)
