/**
 * 大师赛 and 冠军赛 are played, and the season says so — whichever way the
 * season was played out.
 *
 * Reported 2026-09-16: 「点击推进到赛季末从来都不会模拟大师赛和冠军赛……在点击推进到
 * 赛季末然后看总结的时候从没显示过世界赛的俱乐部战绩」. They were being played all
 * along (scripts/probe_seasonend.ts: the same career run both ways, not one tie
 * different) — nothing wrote them down, so a club that went to a Masters and lost
 * left no trace on the 赛季结束 card or in the 生涯 table, and from the bench no
 * match screen ever opened either.
 *
 * One career, cloned, played out twice:
 *
 *   周推   engine/me/week.ts advanceTurn — the week screen's own button
 *   快进   engine/me/auto.ts advanceUntil(state, 'season') — 「快进到…」 → 赛季末,
 *          exactly what ui PlayerGame.tsx advanceMany calls
 *
 * and every day of both is read (a getter on state.day, so the engine is untouched):
 *
 *  - 打了：an international my club is seated in and that this world plays has ties
 *    of my club's in the schedule, and results in them, by the time it ends
 *  - 记下了：the season's row names it — 几胜几负, the placing, how many I started
 *    (engine/me/intl.ts; this is what fails on the old behaviour)
 *  - 两条路一样：both ways of playing the season see the same events, the same
 *    number of matches in each, and the same lines in the season's row
 *  - 总结里说了：the 推进总结 of a 快进 run carries my club's international matches
 *
 *   npx tsx scripts/check_seasonend.ts [seed=11]
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
import { isIntlComp } from '../src/engine/me/compclass'
import { compCn } from '../src/engine/me/compname'
import type { GameState, Region } from '../src/engine/types'

const seed = Number(process.argv[2] ?? 11)
/** campaigns of my club's that must turn up, or the check is passing on nothing */
const SAMPLE_MIN = 4
/** and 打进大赛 cards, for the same reason */
const CARDS_MIN = 8

interface Scn { label: string; region: string; start: StartPoint; year: number; years: number }
const SCN: Scn[] = [
  { label: '2026 中国 · VCT 第六人', region: 'China', start: 't1', year: 2026, years: 3 },
  { label: '2021 欧洲 · 强队第六人', region: 'Europe', start: 't1', year: 2021, years: 3 },
]

/** one international of one year, as my club's last day of it saw it */
interface Row {
  year: number
  key: string
  name: string
  /** this world plays it, rather than keeping the real result (engine/circuit.ts begin) */
  sim: boolean
  seated: boolean
  over: boolean
  /** ties of my club's written into the schedule, and how many have results */
  fx: number
  fxPlayed: number
  /** matches of it on my own record — the bench counts */
  mine: number
}

/** a 打进大赛 card the screen showed (engine/me/moments.ts noteQualify, ui/me/MomentQueue.tsx) */
interface Card { year: number; key: string; comp: string }

let bad = 0
const fail = (m: string): void => { bad++; if (bad <= 30) console.log(`  ✗ ${m}`) }

/**
 * The screen takes the cards one at a time; here they are taken every morning, so
 * none is lost to the queue's cap (me/moments.ts MOMENTS_CAP) and every card the
 * player would have been shown is counted.
 */
function drain(state: GameState, cards: Card[]): void {
  const me = state.me
  if (!me?.moments?.length) return
  let guard = 0
  while (me.moments.length && guard++ < 40) {
    const m = me.moments[0]
    if (m.kind === 'qualify') cards.push({ year: m.year, key: m.key.replace(/^qualify:/, ''), comp: m.comp ?? '?' })
    takeMoment(state)
  }
}

function rowsOf(state: GameState, book: Map<string, Row>): void {
  const me = state.me
  const club = state.myTeam
  if (!me || !club) return
  for (const comp of Object.values(state.comps)) {
    if (!isIntlComp(comp.name)) continue
    const c = comp.circuit
    const seated = comp.teams.includes(club)
      || !!c?.seeds.includes(club) || Object.values(c?.fill ?? {}).includes(club)
    const fx = state.fixtures.filter((f) => f.comp === comp.key && (f.teamA === club || f.teamB === club))
    const mine = me.matches.filter((m) => m.year === state.year && !m.friendly && m.comp === comp.name)
    book.set(`${state.year}:${comp.key}`, {
      year: state.year, key: comp.key, name: comp.name,
      // an old world with no real calendar plays its internationals too (engine/season.ts createMasters)
      sim: !c || c.mode === 'sim',
      seated, over: !!comp.champion || !!c?.done,
      fx: fx.length, fxPlayed: fx.filter((f) => f.played).length, mine: mine.length,
    })
  }
}

/** sample every morning; the year's turn puts the day back to 0 with the old year's competitions still on the books */
function watchDays(state: GameState, on: () => void): void {
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

function fastForward(state: GameState, untilYear: number): string[] {
  const me = state.me!
  const notes: string[] = []
  let guard = 0
  let at = ''
  while (state.year < untilYear && me.phase !== 'retired' && !state.gameOver && guard++ < 400) {
    const r = advanceUntil(state, 'season')
    notes.push(...r.notes)
    if (r.stop.kind === 'game-over') break
    if (r.stop.kind === 'match') { new MeMatch(state, r.stop.fixture).runOut(); continue }
    if (r.stop.kind === 'pending' && me.pending.length) { autoResolve(state, me.pending[0]); continue }
    const now = `${state.year}:${state.day}:${me.pending.length}`
    if (now === at && !r.weeks) break
    at = now
  }
  return notes
}

const t0 = Date.now()
let sample = 0
let inSummary = 0
let played = 0
let cardsSeen = 0

for (const o of SCN) {
  const born = createCareer({
    name: 'Check', region: o.region as Region, role: '决斗者', talents: emptyTalents(),
    originKey: 'netcafe', start: o.start, seed, year: o.year,
  })
  const runs: { label: string; book: Map<string, Row>; notes: string[]; cards: Card[]; state: GameState }[] = []
  for (const mode of ['周推', '快进到赛季末'] as const) {
    const state = clone(born)
    const book = new Map<string, Row>()
    const cards: Card[] = []
    watchDays(state, () => { drain(state, cards); rowsOf(state, book) })
    rowsOf(state, book)
    const notes = mode === '周推' ? (weekly(state, o.year + o.years), []) : fastForward(state, o.year + o.years)
    drain(state, cards)
    runs.push({ label: mode, book, notes, cards, state })
  }

  for (const run of runs) {
    const me = run.state.me!
    for (const r of run.book.values()) {
      // an event my club is in, that this world plays, that is over, and that I was there for
      if (!r.seated || !r.sim || !r.over || !r.mine) continue
      sample++
      played += r.mine
      if (!r.fxPlayed) {
        fail(`${o.label} · ${run.label}：${r.year} ${compCn(r.name)} 我队在列，赛程里一场都没打`)
        continue
      }
      const row = me.seasons.find((x) => x.year === r.year)
      if (!row) { fail(`${o.label} · ${run.label}：${r.year} 赛季没有生涯行`); continue }
      const said = (row.intl ?? []).some((line) => line.startsWith(compCn(r.name)))
      if (!said) {
        fail(`${o.label} · ${run.label}：${r.year} ${compCn(r.name)} 打了 ${r.fxPlayed} 场，`
          + `赛季总结里一个字都没写（生涯行写的是「${[...row.titles, ...(row.intl ?? [])].join('、') || '空的'}」）`)
      }
    }

    // 「打进大赛」 never for an event my club has no tie in — the card used to be raised off
    // history's booking, months before the draw (reported 2026-09-16, scripts/probe_qualcard.ts)
    for (const c of run.cards) {
      const r = run.book.get(`${c.year}:${c.key}`)
      if (!r || !r.fx) {
        fail(`${o.label} · ${run.label}：${c.year} 弹了「打进${compCn(c.comp)}」的卡，我队整届一场都没打`)
      }
      cardsSeen++
    }
    // and never missing from one it really played
    for (const r of run.book.values()) {
      if (!r.seated || !r.sim || !r.mine || !r.fxPlayed) continue
      if (!run.cards.some((c) => c.key === r.key && c.year === r.year)) {
        fail(`${o.label} · ${run.label}：${r.year} ${compCn(r.name)} 打了 ${r.fxPlayed} 场，却没弹「打进大赛」的卡`)
      }
    }
  }

  // the two ways of playing the season out must see the same thing
  const [a, b] = runs
  const keys = [...new Set([...a.book.keys(), ...b.book.keys()])].sort()
  for (const k of keys) {
    const x = a.book.get(k)
    const y = b.book.get(k)
    if (!x?.seated && !y?.seated) continue
    if (!x || !y) { fail(`${o.label}：${k} 只有一条路上有这项赛事`); continue }
    if (x.seated !== y.seated || x.fxPlayed !== y.fxPlayed || x.mine !== y.mine) {
      fail(`${o.label}：${compCn(x.name)}（${x.year}）两条路不一样 — `
        + `${a.label} 打完 ${x.fxPlayed} 场 / 我的记录 ${x.mine}，${b.label} 打完 ${y.fxPlayed} 场 / 我的记录 ${y.mine}`)
    }
  }
  for (const y of new Set([...a.book.values()].map((r) => r.year))) {
    const la = (a.state.me!.seasons.find((x) => x.year === y)?.intl ?? []).join('|')
    const lb = (b.state.me!.seasons.find((x) => x.year === y)?.intl ?? []).join('|')
    if (la !== lb) fail(`${o.label}：${y} 赛季总结两条路写得不一样 — ${a.label}「${la || '空的'}」，${b.label}「${lb || '空的'}」`)
  }

  // the 推进总结 a 快进 run hands back carries my club's international matches
  for (const r of b.book.values()) {
    if (!r.seated || !r.sim || !r.over || !r.mine) continue
    if (b.notes.some((n) => n.startsWith(`${compCn(r.name)} vs `))) inSummary++
  }

  const mine = [...b.book.values()].filter((r) => r.seated && r.sim && r.over && r.mine)
  console.log(`  ${o.label}：${o.years} 个赛季，我队打了 ${mine.length} 项大师赛 / 冠军赛`
    + `${mine.length ? ` — ${mine.map((r) => `${r.year} ${compCn(r.name)} ${r.fxPlayed} 场`).join('、')}` : ''}`)
  for (const row of b.state.me!.seasons) {
    if (row.intl?.length) console.log(`    ${row.year} 赛季总结：${row.intl.join('；')}`)
  }
}

if (sample < SAMPLE_MIN) fail(`只查到 ${sample} 项我队打过的大师赛 / 冠军赛，样本太少（至少 ${SAMPLE_MIN} 项）`)
if (cardsSeen < CARDS_MIN) fail(`只弹出 ${cardsSeen} 张「打进大赛」的卡，样本太少（至少 ${CARDS_MIN} 张）`)
if (!inSummary) fail('「快进到赛季末」的推进总结里，一场大师赛 / 冠军赛都没写')

console.log(bad
  ? `\n✗ ${bad} 项不对。`
  : `\n✓ 我队打过的 ${sample} 项大师赛 / 冠军赛，两条路（周推、快进到赛季末）打出的场次和结果一样，`
    + `每一项都真打了、也都写进了赛季总结；推进总结里写到了其中 ${inSummary} 项，我自己的记录共 ${played} 场；`
    + `${cardsSeen} 张「打进大赛」的卡，每一张都是我队真打了的赛事，真打了的也都弹了卡`
    + ` · ${((Date.now() - t0) / 1000).toFixed(0)}s`)
process.exit(bad ? 1 : 0)
