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
 *  - 卡来得是时候：「打进大赛」 comes up on the day the draw seats my club, and never
 *    after the club has played its first tie there (reported 2026-09-19; this is what
 *    fails on the old behaviour). The cards are taken where the screen takes them —
 *    at a stop, never under a match or a 推进总结
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
import { compClass, isIntlComp } from '../src/engine/me/compclass'
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

/** one international of one year and one club I was at, as the last day I was at that club saw it */
interface Row {
  year: number
  key: string
  name: string
  /**
   * the club I was at. A row is booked under it and read on the days I was there, so a move after the event
   * cannot rewrite what my club did there with what the next club did not: 2027 科隆大师赛 was TYLOO's, won with
   * six ties, and the 「打进大赛」 card was TYLOO's; from the day the career went to KeepBest Gaming, the row read
   * that club's 0 ties instead, and the card looked like one fired for an event nobody played (2026-09-17)
   */
  club: string
  /** this world plays it, rather than keeping the real result (engine/circuit.ts begin) */
  sim: boolean
  seated: boolean
  over: boolean
  /** ties of my club's written into the schedule, and how many have results */
  fx: number
  fxPlayed: number
  /** matches of it on my own record — the bench counts */
  mine: number
  /** the day the draw first seated my club here, and the day its first tie here was played — both kept from the day they happened */
  drawn?: number
  playedAt?: number
}

/**
 * a 打进大赛 card the screen showed (engine/me/moments.ts noteQualify, ui/me/MomentQueue.tsx), and the club I was at
 * the morning it was taken — the club it said had qualified, read off the world rather than off the card
 */
interface Card { year: number; key: string; comp: string; club: string; day: number; seen?: number }

let bad = 0
const fail = (m: string): void => { bad++; if (bad <= 30) console.log(`  ✗ ${m}`) }

/**
 * Every card the engine raised, written down the day it is raised and never lost to
 * the queue's cap (me/moments.ts MOMENTS_CAP) — but left in the queue, because when
 * the *screen* gets to draw it is the other half of what is checked here.
 */
function noteCards(state: GameState, cards: Card[]): void {
  const me = state.me
  for (const m of me?.moments ?? []) {
    if (m.kind !== 'qualify') continue
    const key = m.key.replace(/^qualify:/, '')
    if (cards.some((c) => c.year === m.year && c.key === key)) continue
    cards.push({ year: m.year, key, comp: m.comp ?? '?', club: state.myTeam, day: m.day })
  }
}

/**
 * The screen is up and nothing covers it: MomentQueue draws whatever is queued, one
 * card at a time (ui/me/MomentQueue.tsx, PlayerGame.tsx `!live && !summary`), and the
 * player takes them. Called exactly where the player would be looking — never under a
 * match, which covers the queue until it is over.
 */
function showCards(state: GameState, cards: Card[]): void {
  const me = state.me
  if (!me?.moments?.length) return
  let guard = 0
  while (me.moments.length && guard++ < 40) {
    const m = me.moments[0]
    if (m.kind === 'qualify') {
      const key = m.key.replace(/^qualify:/, '')
      const had = cards.find((c) => c.year === m.year && c.key === key)
      if (had) had.seen ??= state.day
      else cards.push({ year: m.year, key, comp: m.comp ?? '?', club: state.myTeam, day: m.day, seen: state.day })
    }
    takeMoment(state)
  }
}

/**
 * The events my club was seated in, that this world played, that are over and that are on my own record — one row
 * each. A move between two clubs of the same field leaves a row for each; the one whose ties were played speaks for
 * the event, so a campaign is never counted twice.
 */
function campaigns(book: Map<string, Row>): Row[] {
  const out = new Map<string, Row>()
  for (const r of book.values()) {
    if (!r.seated || !r.sim || !r.over || !r.mine) continue
    const k = `${r.year}:${r.key}`
    const had = out.get(k)
    if (!had || (!had.fxPlayed && r.fxPlayed)) out.set(k, r)
  }
  return [...out.values()]
}

/** Each morning: every international of the year, for the club I am at today — a row of its own per club. */
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
    const was = book.get(`${state.year}:${comp.key}:${club}`)
    book.set(`${state.year}:${comp.key}:${club}`, {
      year: state.year, key: comp.key, name: comp.name, club,
      // an old world with no real calendar plays its internationals too (engine/season.ts createMasters)
      sim: !c || c.mode === 'sim',
      seated, over: !!comp.champion || !!c?.done,
      fx: fx.length, fxPlayed: fx.filter((f) => f.played).length, mine: mine.length,
      // the day it happened, kept: the rest of the row is overwritten every day, these two are not
      drawn: was?.drawn ?? (seated && (!c || !!c.mode) ? state.day : undefined),
      playedAt: was?.playedAt ?? (fx.some((f) => f.played) ? state.day : undefined),
    })
  }
}

/**
 * Sample twice a day change: once with the clock still on the day that just
 * finished — so `drawn` and `playedAt` are the day the thing happened, not the
 * morning after — and once on the new day, which is the read the rest of the row
 * has always been taken on. The year's turn puts the day back to 0 with the old
 * year's competitions still on the books, and is not a day going forward.
 */
function watchDays(state: GameState, on: () => void): void {
  let d = state.day
  Object.defineProperty(state, 'day', {
    get: () => d,
    set: (v: number) => { if (v > d) { on(); d = v; on() } else d = v },
    configurable: true, enumerable: true,
  })
}

const clone = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState

/** the week screen's own button: every stop draws the screen again — a match covers it until it is over */
function weekly(state: GameState, untilYear: number, cards: Card[]): void {
  const me = state.me!
  let guard = 0
  while (state.year < untilYear && me.phase !== 'retired' && !state.gameOver && guard++ < 6000) {
    runAutoPilot(state)
    let g = 0
    while (me.pending.length && g++ < 40) autoResolve(state, me.pending[0])
    if (me.weekDay === 0 && me.ap === me.apMax) autoPlan(state)
    const stop = advanceTurn(state)
    if (stop.kind === 'match') new MeMatch(state, stop.fixture).runOut()
    showCards(state, cards)
    if (stop.kind === 'game-over') break
  }
}

/** 「快进到赛季末」: PlayerGame.tsx advanceMany — a match opens at once, anything else comes back as the 推进总结 */
function fastForward(state: GameState, untilYear: number, cards: Card[]): string[] {
  const me = state.me!
  const notes: string[] = []
  let guard = 0
  let at = ''
  while (state.year < untilYear && me.phase !== 'retired' && !state.gameOver && guard++ < 4000) {
    const r = advanceUntil(state, 'season')
    notes.push(...r.notes)
    if (r.stop.kind === 'game-over') break
    if (r.stop.kind === 'match') { new MeMatch(state, r.stop.fixture).runOut(); showCards(state, cards); continue }
    showCards(state, cards)
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
let fieldsSeen = 0

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
    watchDays(state, () => { noteCards(state, cards); rowsOf(state, book) })
    rowsOf(state, book)
    const notes = mode === '周推' ? (weekly(state, o.year + o.years, cards), []) : fastForward(state, o.year + o.years, cards)
    noteCards(state, cards)
    showCards(state, cards)
    runs.push({ label: mode, book, notes, cards, state })
  }

  for (const run of runs) {
    const me = run.state.me!
    // an event my club is in, that this world plays, that is over, and that I was there for
    for (const r of campaigns(run.book)) {
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
    // — my club being the club I was at when the card came, not whichever club I am at by the event's end
    for (const c of run.cards) {
      const r = run.book.get(`${c.year}:${c.key}:${c.club}`)
      if (!r || !r.fx) {
        fail(`${o.label} · ${run.label}：${c.year} 弹了「打进${compCn(c.comp)}」的卡，我队（${run.state.teams[c.club]?.name ?? c.club}）整届一场都没打`)
      }
      // and it comes up the day the draw seats my club — not after the club's first tie there.
      // Reported 2026-09-19: 「每次世界赛的时候都是打完第一场世界赛之后才弹出你进了世界赛的弹窗」.
      // The engine raised it on the draw's own day all along; nothing stopped the clock for it, so
      // one press of the week ran past the draw and a 快进 played the whole campaign first
      // (scripts/probe_qualtime.ts: 15 of 15 cards late, 10 of them after the club had played).
      if (c.seen == null) {
        fail(`${o.label} · ${run.label}：${c.year} 第 ${c.day} 天弹了「打进${compCn(c.comp)}」的卡，屏幕上一直没出现过`)
      } else {
        if (r?.drawn != null && c.day !== r.drawn) {
          fail(`${o.label} · ${run.label}：${c.year} ${compCn(c.comp)} 第 ${r.drawn} 天抽签定下我队，卡是第 ${c.day} 天才记下的`)
        }
        if (c.seen !== c.day) {
          fail(`${o.label} · ${run.label}：${c.year}「打进${compCn(c.comp)}」第 ${c.day} 天（抽签当天）就该弹，第 ${c.seen} 天才弹到玩家面前`)
        }
        if (r?.playedAt != null && c.seen >= r.playedAt) {
          fail(`${o.label} · ${run.label}：${c.year}「打进${compCn(c.comp)}」第 ${c.seen} 天才弹，我队第 ${r.playedAt} 天就把第一场打完了`)
        }
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

    // The campaign's class and placing are kept beside the line so the career-end card can
    // rank campaigns without reading the prose back (engine/me/types.ts MeIntlRun). They have
    // to say exactly what the line says, or the two drift apart the moment either is edited.
    for (const r of me.intlRuns ?? []) {
      if (r.cls !== compClass(r.comp)) {
        fail(`${o.label} · ${run.label}：${r.year} ${compCn(r.comp)} 的赛事类别记成「${r.cls ?? '没记'}」，`
          + `compClass 读出来是「${compClass(r.comp)}」`)
      }
      const said = r.line.match(/第 (\d+) 名/)
      const want = r.line.includes('· 夺冠') ? 1 : said ? Number(said[1]) : undefined
      if (r.place !== want) {
        fail(`${o.label} · ${run.label}：${r.year} ${compCn(r.comp)} 的名次记成「${r.place ?? '没记'}」，`
          + `行里写的是「${r.line}」`)
      }
      fieldsSeen++
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
  for (const r of campaigns(b.book)) {
    if (b.notes.some((n) => n.startsWith(`${compCn(r.name)} vs `))) inSummary++
  }

  const mine = campaigns(b.book)
  console.log(`  ${o.label}：${o.years} 个赛季，我队打了 ${mine.length} 项大师赛 / 冠军赛`
    + `${mine.length ? ` — ${mine.map((r) => `${r.year} ${compCn(r.name)} ${r.fxPlayed} 场`).join('、')}` : ''}`)
  for (const row of b.state.me!.seasons) {
    if (row.intl?.length) console.log(`    ${row.year} 赛季总结：${row.intl.join('；')}`)
  }
}

if (sample < SAMPLE_MIN) fail(`只查到 ${sample} 项我队打过的大师赛 / 冠军赛，样本太少（至少 ${SAMPLE_MIN} 项）`)
if (cardsSeen < CARDS_MIN) fail(`只弹出 ${cardsSeen} 张「打进大赛」的卡，样本太少（至少 ${CARDS_MIN} 张）`)
if (fieldsSeen < SAMPLE_MIN) fail(`只查到 ${fieldsSeen} 条大师赛 / 冠军赛战绩，样本太少（至少 ${SAMPLE_MIN} 条）`)
if (!inSummary) fail('「快进到赛季末」的推进总结里，一场大师赛 / 冠军赛都没写')

console.log(bad
  ? `\n✗ ${bad} 项不对。`
  : `\n✓ 我队打过的 ${sample} 项大师赛 / 冠军赛，两条路（周推、快进到赛季末）打出的场次和结果一样，`
    + `每一项都真打了、也都写进了赛季总结；推进总结里写到了其中 ${inSummary} 项，我自己的记录共 ${played} 场；`
    + `${cardsSeen} 张「打进大赛」的卡，每一张都是我队真打了的赛事、都在抽签当天就弹到了玩家面前，真打了的也都弹了卡；`
    + `${fieldsSeen} 条战绩记下的赛事类别和名次，和那一行写的一字不差`
    + ` · ${((Date.now() - t0) / 1000).toFixed(0)}s`)
process.exit(bad ? 1 : 0)
