/**
 * 方案 C and the promotion decider, played out rather than read.
 *
 * Both were written and never reached in a check: none of the probe careers
 * got to an international in 2022, and DfuseTeam lost all five of its
 * deciders. So two manager saves here make their squads the best in the world
 * and hold them there:
 *
 *  - seat: Guild Esports from 2021. Good enough in 2022 to reach an
 *    international, so on the 2023 turn it takes a partner seat in EMEA and
 *    the weakest partner there goes down to Challengers. The seat is its own
 *    at LOCK//IN, in the 2023 league, at the 2024 Kickoff — and still in 2026.
 *  - promo: DfuseTeam, left as it was through 2022 and made strong from 2023,
 *    when it is a French club with no league. It has to win a Revolution
 *    decider and then play the split that decider fed.
 *
 *   npx tsx scripts/check_seats.ts [seed=11] [only: seat|promo]
 */
import { eventOf } from '../src/engine/circuit'
import { recomputeOverall, refreshValue } from '../src/engine/player'
import { Rng, hashStr } from '../src/engine/rng'
import { signForHistory } from '../src/engine/timeline'
import { advanceDay, setupSeason } from '../src/engine/season'
import { ATTR_KEYS } from '../src/engine/types'
import type { Competition, Fixture, GameState } from '../src/engine/types'
import { createNewGame } from '../src/engine/world'

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

const seed = Number(process.argv[2] ?? 11)
const only = process.argv[3]
let bad = 0
const fail = (msg: string) => { bad++; console.log(`✗ ${msg}`) }

/** The squad, the best in the world for as long as the probe wants it — and five of them, as a manager would keep it. */
function boost(state: GameState, club: string): void {
  const t = state.teams[club]
  const rng = new Rng(hashStr(`probe:${state.year}:${state.day}`))
  const free = Object.values(state.players)
    .filter((p) => !p.teamId && !p.retiring && p.id !== state.me?.id)
    .sort((a, b) => b.overall - a.overall)
  while (t.roster.length < 5 && free.length) signForHistory(state, free.shift()!, t, state.year, rng)
  for (const pid of t.roster) {
    const p = state.players[pid]
    if (!p) continue
    for (const k of ATTR_KEYS) p.attrs[k] = 96
    recomputeOverall(p)
    p.potential = 99
    p.form = 95
    p.morale = 95
    p.fatigue = 0
    p.injuredUntil = 0
    p.retiring = false
    p.contractYears = Math.max(p.contractYears, 3)
    refreshValue(p)
  }
  const top = t.roster.map((id) => state.players[id]?.overall ?? 0).sort((a, b) => b - a).slice(0, 5)
  if (top.length) t.rating = Math.round(top.reduce((s, v) => s + v, 0) / top.length)
}

/** Run the save to a day of a year, boosting from `from` on. Returns false if it broke. */
function runTo(state: GameState, label: string, year: number, day: number, club: string, from: number): boolean {
  let guard = 0
  let boosted = -1
  try {
    while ((state.year < year || (state.year === year && state.day < day)) && !state.gameOver && guard++ < 3000) {
      const mark = state.year * 1000 + Math.floor(state.day / 30)
      if (state.year >= from && boosted !== mark) {
        boost(state, club)
        boosted = mark
      }
      state.boardConfidence = 90
      advanceDay(state, { autoResolveDrawDecisions: true, autoScrims: true })
    }
  } catch (e) {
    fail(`${label}：${state.year} 年第 ${state.day} 天崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 5).join(' | ')}`)
    return false
  }
  if (state.gameOver) { fail(`${label}：存档在 ${state.year} 年第 ${state.day} 天结束了 —— ${state.gameOver}`); return false }
  return true
}

const circuitComps = (state: GameState): Competition[] => Object.values(state.comps).filter((c) => c.format === 'circuit' && !!c.circuit)
const nameOf = (state: GameState, id: string | undefined): string => (id ? state.teams[id]?.name ?? id : '—')
/** A league's own event of a stage — its region is the event's, which a combining layer leaves off the competition. */
const leagueEvent = (state: GameState, stage: string, league: string): Competition | undefined =>
  circuitComps(state).find((c) => {
    const ev = eventOf(c.circuit!.id)
    return c.stage === stage && ev?.region === league && !ev.scene
  })

function seat(): void {
  const club = 'V21T1209'
  const t0 = Date.now()
  const state = createNewGame(club, 'Probe', seed, undefined, 2021)
  setupSeason(state)
  console.log(`\n== 方案 C：执教 ${nameOf(state, club)}，阵容顶满，从 2021 打起`)
  if (!runTo(state, '方案 C', 2023, 110, club, 2021)) return
  const reached = state.seat
  console.log(`  2023 第 110 天：${reached ? `拿到 VCT ${reached.league} 席位，顶掉 ${nameOf(state, reached.displaced)}` : '没有席位'}`)
  if (!reached || reached.club !== club) { fail('方案 C：2022 年打进过国际赛的俱乐部，2023 年应该拿到合作席位'); return }
  const lockin = circuitComps(state).find((c) => /LOCK\/\/IN/i.test(eventOf(c.circuit!.id)?.name ?? ''))
  const league = leagueEvent(state, 'stage1', reached.league)
  console.log(`  LOCK//IN：${lockin?.teams.includes(club) ? '有你' : '没有你'}；${league?.name ?? 'VCT 联赛（没找到）'}：${league?.teams.includes(club) ? '有你' : '没有你'}，`
    + `${nameOf(state, reached.displaced)} ${league?.teams.includes(reached.displaced) ? '还在' : '不在'}（现在是${state.teams[reached.displaced]?.tier === 2 ? '二线' : '一线'}）`)
  if (!lockin?.teams.includes(club)) fail('方案 C：LOCK//IN 圣保罗里应该有你的俱乐部')
  if (!league?.teams.includes(club)) fail(`方案 C：2023 VCT ${reached.league} 联赛里应该有你的俱乐部`)
  if (league?.teams.includes(reached.displaced)) fail(`方案 C：被顶掉的 ${nameOf(state, reached.displaced)} 不应该还在 2023 联赛里`)
  if (state.teams[reached.displaced]?.tier !== 2) fail(`方案 C：被顶掉的 ${nameOf(state, reached.displaced)} 应该去了二线`)

  for (const [year, day] of [[2024, 70], [2026, 50]] as [number, number][]) {
    if (!runTo(state, '方案 C', year, day, club, 2021)) return
    const kickoff = leagueEvent(state, 'kickoff', reached.league)
    const t = state.teams[club]
    console.log(`  ${year} ${kickoff?.name ?? '揭幕赛（没找到）'}：${kickoff?.teams.includes(club) ? '有你' : '没有你'} · 你的俱乐部 ${t.tier === 1 ? '一线' : '二线'} · ${t.league}`)
    if (!kickoff?.teams.includes(club)) fail(`方案 C：${year} VCT ${reached.league} 揭幕赛里应该有你的俱乐部`)
    if (t.tier !== 1 || t.league !== `VCT ${reached.league}`) fail(`方案 C：${year} 你的俱乐部应该还在 VCT ${reached.league}，实际 ${t.league}`)
  }
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

function promo(): void {
  const club = 'V21T1982'
  const t0 = Date.now()
  const state = createNewGame(club, 'Probe', seed, undefined, 2021)
  setupSeason(state)
  console.log(`\n== 升级赛：执教 ${nameOf(state, club)}，2023 年起阵容顶满`)
  const mine = (f: Fixture) => f.teamA === club || f.teamB === club
  const winner = (f: Fixture) => (f.result ? (f.result.mapsWonA > f.result.mapsWonB ? f.teamA : f.teamB) : null)
  let deciders = 0
  let won = 0
  let played = 0
  // each season's fixtures are cleared at the turn, so read each year on its last day
  for (const year of [2023, 2024]) {
    if (!runTo(state, '升级赛', year, 350, club, 2023)) return
    if (state.seat?.club === club) console.log('  （这支队 2022 年打进了国际赛，拿了合作席位——升级赛的路没有走到）')
    const d = state.fixtures.filter((f) => mine(f) && f.label.includes('决胜局'))
    const w = d.filter((f) => f.played && winner(f) === club)
    const league = state.fixtures.filter((f) => f.played && mine(f) && !f.label.includes('决胜局')
      && !!state.comps[f.comp]?.circuit && !!eventOf(state.comps[f.comp].circuit!.id)?.scene)
    const events = [...new Set(league.map((f) => state.comps[f.comp]?.name))]
    console.log(`  ${year}：决胜局 ${d.length} 场，赢 ${w.length} 场；Challengers 联赛正赛 ${league.length} 场（${events.join('、') || '—'}）· 你的俱乐部 ${state.teams[club].scene ?? '—'}`)
    deciders += d.length
    won += w.length
    played += league.length
  }
  if (!deciders && !played) fail('升级赛：两年里既没有决胜局也没有联赛比赛——没有席位的法国俱乐部应该被安排升级赛')
  else if (deciders && !won && !played) fail('升级赛：阵容顶满还是一场决胜局都没赢')
  else if (won && !played) fail('升级赛：赢了决胜局，却没有打进它送去的那个赛段')
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

if (!only || only === 'seat') seat()
if (!only || only === 'promo') promo()
console.log(bad ? `\n✗ ${bad} 项不对。` : '\n✓ 方案 C 的席位拿到、占住、带进 2026；没有席位的俱乐部赢下决胜局就打进了联赛。')
process.exit(bad ? 1 : 0)
