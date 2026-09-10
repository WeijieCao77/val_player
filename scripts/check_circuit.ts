/**
 * Does a 2021 career play the real calendar year after year, and hand over each winter?
 *
 * Three careers, the way the new-career screen starts them: a Challengers
 * starter in North America, a nobody on the Chinese ladder, a sixth man in
 * Europe. Each runs the headless week loop the buttons use through 2021, 2022
 * and 2023 — the open era, and the first year of the partnered one — and every
 * season is held to the author's two rules:
 *
 *  - 赛制是历史: every event that was on the real calendar is on this one, and
 *    every one of them has finished by its real last day
 *  - 够不着的地方保持原样: an international this career never reached, whose
 *    field nothing upstream changed, has its real champion
 *
 * Then a bystander: nobody signs him, and the world runs from 2021 to the end
 * of 2025 on its own. Nothing he does reaches anywhere, so every international
 * of all five years must end exactly as it really did — which it can only do
 * if the clubs and rosters followed history too (engine/timeline.ts): EDward
 * Gaming did not exist in January 2021 and won Champions 2024. And at 2026,
 * where the timeline hands over to the modern season, the save stops honestly.
 *
 *   npx tsx scripts/check_circuit.ts [seed=11]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { advanceDay, setupSeason } from '../src/engine/season'
import { createNewGame } from '../src/engine/world'
import { eventOf, eventsOf, worldIdOf } from '../src/engine/circuit'
import type { Competition, GameState, Region } from '../src/engine/types'

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
let bad = 0
const fail = (msg: string) => { bad++; console.log(`✗ ${msg}`) }

/** A year's internationals and who really won each, read off the events themselves. */
function internationals(year: number): { id: string; vlr: string; real: string }[] {
  return eventsOf(year)
    .filter((e) => !e.region && (e.stage === 'masters1' || e.stage === 'masters2' || e.stage === 'champions' || /LOCK\/\/IN/.test(e.name)))
    .map((e) => { const vlr = e.places[0]?.[0] ?? ''; return { id: e.id, vlr, real: e.names[vlr] ?? vlr } })
}

const championIs = (state: GameState, c: Competition | undefined, x: { vlr: string; real: string }): boolean =>
  !!c?.champion && (c.champion === worldIdOf(x.vlr) || (state.teams[c.champion]?.name ?? '').toLowerCase() === x.real.toLowerCase())

/** A season's books: finished on time, nobody placed twice, and what the internationals did. */
function season(state: GameState, label: string, year: number, strict: boolean): void {
  const circuit = Object.values(state.comps).filter((c) => c.format === 'circuit')
  const sim = circuit.filter((c) => c.circuit?.mode === 'sim')
  const late = circuit.filter((c) => !c.champion && !c.circuit?.done && (c.circuit?.end ?? 0) < state.day)
  const dup = circuit.filter((c) => new Set(c.finished).size !== c.finished.length)
  const why = { mine: 0, home: 0, ripple: 0 }
  for (const c of sim) why[c.circuit!.why ?? 'ripple']++
  const empty = circuit.filter((c) => c.circuit?.done)
  console.log(`  ${year} 到第 ${state.day} 天：${circuit.filter((c) => c.champion).length}/${circuit.length} 场打完 · `
    + `模拟 ${sim.length}（你的队 ${why.mine} · 本赛区 ${why.home} · 上游变了 ${why.ripple}）· 参赛队都不在世界里 ${empty.length}`)
  if (late.length) fail(`${label}：${year} 有 ${late.length} 场过了真实结束日没打完：${late.slice(0, 4).map((c) => `${c.name}（第 ${c.circuit!.end} 天）`).join('、')}`)
  if (dup.length) fail(`${label}：${year} 有 ${dup.length} 场名次表里有人出现两次：${dup.slice(0, 3).map((c) => c.name).join('、')}`)
  for (const x of internationals(year)) {
    const c = state.comps[`ev:${x.id}`]
    const got = c?.champion ? state.teams[c.champion]?.name : '（没打完）'
    const mode = c?.circuit?.mode === 'sim' ? '模拟' : '照历史'
    console.log(`    ${c?.name}：${got}（${mode}）· 真实：${x.real}`)
    if ((strict || c?.circuit?.mode === 'history') && !championIs(state, c, x)) {
      fail(`${label}：${year} ${c?.name ?? x.id} 应该是 ${x.real}，实际 ${got}（${mode}）`)
    }
  }
}

/** Play out a year and cross into the next. */
function playYear(state: GameState, label: string, year: number, step: () => void, cap: number): boolean {
  let guard = 0
  try {
    while (state.year === year && state.day < 350 && !state.gameOver && guard++ < cap) step()
  } catch (e) {
    fail(`${label}：${year} 年第 ${state.day} 天崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 5).join(' | ')}`)
    return false
  }
  return true
}

function cross(state: GameState, label: string, year: number, step: () => void, cap: number): boolean {
  let guard = 0
  try {
    while (state.year === year && !state.gameOver && guard++ < cap) step()
  } catch (e) {
    fail(`${label}：跨进 ${year + 1} 年时崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 5).join(' | ')}`)
    return false
  }
  return true
}

/** The partnered leagues of a year, as this world fields them. */
function leagues(state: GameState, year: number): string {
  return eventsOf(year)
    .filter((e) => e.region && ['Americas', 'EMEA', 'Pacific', 'China'].includes(e.region) && !e.scene
      && (e.stage === 'stage1' || e.stage === 'kickoff') && !/FGC|Qualifier|LOCK/.test(e.name))
    .map((e) => {
      const c = state.comps[`ev:${e.id}`]
      return `${e.cn} ${c?.teams.length ?? 0}/${new Set(e.seeds.filter((s) => !s.startsWith('N:'))).size}`
    })
    .join(' · ')
}

function run(label: string, region: Region, start: StartPoint): void {
  const t0 = Date.now()
  const state = createCareer({
    name: 'Probe', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed, year: 2021,
  })
  console.log(`\n== ${label}（${state.teams[state.myTeam]?.name ?? '无'}）`)
  if (state.year !== 2021) fail(`${label}：开局是 ${state.year} 年`)
  const onBooks = Object.values(state.comps).filter((c) => c.format === 'circuit').length
  if (onBooks < 100) fail(`${label}：日历上只有 ${onBooks} 场赛事，2021 真实有 121 场`)
  const week = () => { autoWeek(state) }
  for (const year of [2021, 2022, 2023]) {
    if (!playYear(state, label, year, week, 60)) return
    season(state, label, year, false)
    const played = state.fixtures.filter((f) => f.played && state.comps[f.comp]?.format === 'circuit')
    const mine = played.filter((f) => f.teamA === state.myTeam || f.teamB === state.myTeam)
    const club = state.teams[state.myTeam]
    console.log(`    你：${state.me?.phase === 'pro' ? `${club?.name} 的选手（${club?.tier === 1 ? '一线' : '二线'}${club?.scene ? ` · ${club.scene}` : ''}）` : '还没有队'}，`
      + `这一年正式比赛 ${mine.length} 场${state.seat ? `；合作席位：${state.teams[state.seat.club]?.name} 顶替 ${state.teams[state.seat.displaced]?.name}` : ''}`)
    if (!cross(state, label, year, week, 10)) return
    if (state.year !== year + 1) {
      fail(`${label}：${year} 年底没能进入 ${year + 1} 年（现在 ${state.year} 年，${state.gameOver ?? '没有停'}）`)
      return
    }
    const books = Object.values(state.comps).filter((c) => c.format === 'circuit').length
    console.log(`  → ${state.year}：日历上 ${books} 场赛事${state.year >= 2023 ? `；联赛 ${leagues(state, state.year)}` : ''}`)
    if (!books) fail(`${label}：${state.year} 年的日历是空的`)
  }
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

function bystander(): void {
  const t0 = Date.now()
  const state = createCareer({
    name: 'Watcher', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed, year: 2021,
  })
  console.log('\n== 旁观者：中国天梯上没人签他，世界自己从 2021 走到 2025')
  const day = () => { advanceDay(state, { autoResolveDrawDecisions: true, autoScrims: true }) }
  for (const year of [2021, 2022, 2023, 2024, 2025]) {
    if (!playYear(state, '旁观者', year, day, 400)) return
    season(state, '旁观者', year, true)
    if (year === 2021) {
      const leaked = Object.values(state.comps).filter((c) => c.circuit?.mode === 'sim' && c.region !== 'China')
      if (leaked.length) fail(`旁观者：中国赛事的结果波及到了中国以外 ${leaked.length} 场：${leaked.slice(0, 4).map((c) => c.name).join('、')}`)
    }
    if (year >= 2023) {
      const sim = Object.values(state.comps).filter((c) => c.circuit?.mode === 'sim')
      if (sim.length) fail(`旁观者：${year} 年他没有俱乐部，却有 ${sim.length} 场被模拟：${sim.slice(0, 4).map((c) => c.name).join('、')}`)
    }
    if (!cross(state, '旁观者', year, day, 40)) return
    const teams = Object.values(state.teams)
    console.log(`  → ${state.year}：俱乐部 ${teams.filter((t) => !t.dormant).length} 家在打（休眠 ${teams.filter((t) => t.dormant).length}）· 选手 ${Object.keys(state.players).length} 人`
      + (state.year >= 2023 && state.year <= 2025 ? `；联赛 ${leagues(state, state.year)}` : ''))
  }
  if (state.year !== 2026 || !state.timelinePause) {
    fail(`旁观者：2025 年底应该停在「时间线暂停」，实际 ${state.year} 年，${state.gameOver ?? '没有停'}`)
  } else {
    console.log(`  → 停在 ${state.year} 年 1 月 1 日：${state.timelinePause.slice(0, 30)}…`)
  }
  const size = JSON.stringify(state).length
  console.log(`  存档体积 ${(size / 1024 / 1024).toFixed(1)} MB（未压缩）· ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  void eventOf
}

/**
 * A club history carried on under another name (src/data/lineage.json): the
 * player's club takes the new name the day history did, and the events that
 * seeded the successor seed it. Two managers — Vision Strikers, which DRX
 * bought in January 2022, and DAMWON, which became Dplus in January 2023.
 */
function lineage(): void {
  for (const [label, club, successor, year, want] of [
    ['Vision Strikers → DRX', 'V21T198', 'V21T8185', 2022, 'KIWOOM DRX'],
    ['DAMWON → Dplus', 'V21T2542', 'V21T11348', 2023, 'Dplus Esports'],
  ] as [string, string, string, number, string][]) {
    const state = createNewGame(club, 'Probe', seed, undefined, 2021)
    setupSeason(state)
    const day = () => {
      state.boardConfidence = 90
      advanceDay(state, { autoResolveDrawDecisions: true, autoScrims: true })
    }
    let guard = 0
    try {
      while (state.year < year && !state.gameOver && guard++ < 900) day()
      while (state.year === year && state.day < 80 && !state.gameOver && guard++ < 1000) day()
    } catch (e) {
      fail(`传承 ${label}：第 ${state.year} 年第 ${state.day} 天崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 5).join(' | ')}`)
      continue
    }
    const t = state.teams[club]
    const seeded = Object.values(state.comps)
      .filter((c) => c.circuit?.mode && eventOf(c.circuit.id)?.seeds.includes(successor.slice(4)))
    const inIt = seeded.filter((c) => c.teams.includes(club))
    console.log(`\n== 传承：${label}：${state.year} 年第 ${state.day} 天，你的俱乐部叫 ${t?.name}；`
      + `真实种子里有它的已开赛事 ${seeded.length} 场，你在其中 ${inIt.length} 场`)
    if (state.gameOver) fail(`传承 ${label}：${state.gameOver}`)
    if (t?.name !== want) fail(`传承 ${label}：${year} 年应该改名为 ${want}，实际 ${t?.name}`)
    if (state.heirs?.[successor] !== club) fail(`传承 ${label}：没有记下 ${successor} 由你的俱乐部承接`)
    const other = state.teams[successor]
    if (other && !other.dormant && other.roster.length) fail(`传承 ${label}：${other.name} 还作为另一家俱乐部在打`)
    if (inIt.length < seeded.length) fail(`传承 ${label}：${seeded.length - inIt.length} 场本该由你承接的赛事里没有你`)
  }
}

run('北美 · Challengers 首发', 'North America', 'chal')
run('中国 · 从天梯开始', 'China', 'pre')
run('欧洲 · 强队替补', 'Europe', 't1')
bystander()
lineage()

console.log(bad ? `\n✗ ${bad} 项不对。` : '\n✓ 2021 到 2025 按真实赛历逐年打完，够不着的国际赛保持了真实冠军，2026 如实停下；你的俱乐部跟着真实的改名、合并、整队收购走。')
process.exit(bad ? 1 : 0)
