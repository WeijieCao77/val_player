/**
 * Does a 2021 career play a whole year on the real calendar, and hand over to 2022?
 *
 * Three careers, the way the new-career screen starts them: a Challengers
 * starter in North America, a nobody on the Chinese ladder, a sixth man in
 * Europe. Each runs the headless week loop the buttons use until the year is
 * nearly out, and the season is then held to the author's two rules:
 *
 *  - 赛制是历史: every event that was on the real calendar is on this one, and
 *    every one of them has finished by its real last day
 *  - 够不着的地方保持原样: an international this career never reached, whose
 *    field nothing upstream changed, has its real champion
 *
 *   npx tsx scripts/check_circuit.ts [seed=11]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { advanceDay } from '../src/engine/season'
import { eventOf, worldIdOf } from '../src/engine/circuit'
import type { GameState, Region } from '../src/engine/types'

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

// the three internationals of 2021, and who really won them
const REAL: [string, string][] = [['353', 'Sentinels'], ['466', 'Gambit Esports'], ['449', 'Acend']]

const realSeedsOf = (state: GameState, id: string): (string | null)[] =>
  (eventOf(id)?.seeds ?? []).map((v) => { const w = worldIdOf(v); return w && state.teams[w] ? w : null })

function run(label: string, region: Region, start: StartPoint): void {
  const t0 = Date.now()
  const state = createCareer({
    name: 'Probe', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed, year: 2021,
  })
  console.log(`\n== ${label}（${state.teams[state.myTeam]?.name ?? '无'}）`)
  if (state.year !== 2021) fail(`${label}：开局是 ${state.year} 年`)
  const onBooks = Object.values(state.comps).filter((c) => c.format === 'circuit').length
  if (onBooks < 100) fail(`${label}：日历上只有 ${onBooks} 场赛事，2021 真实有 121 场`)

  let weeks = 0
  try {
    while (state.year === 2021 && state.day < 350 && weeks < 60) { autoWeek(state); weeks++ }
  } catch (e) {
    fail(`${label}：第 ${weeks} 周崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 5).join(' | ')}`)
    return
  }

  const circuit = Object.values(state.comps).filter((c) => c.format === 'circuit')
  const sim = circuit.filter((c) => c.circuit?.mode === 'sim')
  const hist = circuit.filter((c) => c.circuit?.mode === 'history')
  const late = circuit.filter((c) => !c.champion && !c.circuit?.done && (c.circuit?.end ?? 0) < state.day)
  const dup = circuit.filter((c) => new Set(c.finished).size !== c.finished.length)
  const reshaped = sim.filter((c) => c.circuit!.why === 'ripple')
  void realSeedsOf
  const walks = circuit.reduce((s, c) => s + Object.keys(c.circuit?.walk ?? {}).length, 0)
  const played = state.fixtures.filter((f) => f.played && state.comps[f.comp]?.format === 'circuit')
  const mine = played.filter((f) => f.teamA === state.myTeam || f.teamB === state.myTeam)
  const playIns = circuit.filter((c) => c.circuit?.playin)
  console.log(`  ${weeks} 周，${((Date.now() - t0) / 1000).toFixed(1)}s；到 ${state.day} 天`)
  console.log(`  赛事 ${circuit.length}：模拟 ${sim.length}（其中名单被上游改写 ${reshaped.length}）· 照历史 ${hist.length} · 轮空 ${walks} 场`)
  console.log(`  正式比赛 ${played.length} 场，你的队 ${mine.length} 场；海选决胜局 ${playIns.length} 次`)
  const why = { mine: 0, home: 0, ripple: 0 }
  for (const c of sim) why[c.circuit!.why ?? 'ripple']++
  console.log(`  为什么模拟：你的队在里面 ${why.mine} · 本赛区 ${why.home} · 上游名次变了 ${why.ripple}`)
  for (const c of reshaped.slice(0, 5)) {
    const ev = eventOf(c.circuit!.id)!
    const lines = (c.circuit!.swaps ?? []).slice(0, 3)
      .map((s) => `${ev.names[s.real] ?? s.real} → ${state.teams[s.now ?? '']?.name ?? '空'}（${state.comps[s.from]?.name}）`)
    console.log(`    ${c.name}：${lines.join('；')}`)
  }
  if (me(state)) {
    console.log(`  你：${state.me!.phase === 'pro' ? `${state.teams[state.myTeam].name} 的选手` : '还没有队'}，打过 ${state.me!.matches.filter((m) => !m.friendly).length} 场`)
  }
  if (late.length) fail(`${label}：${late.length} 场赛事过了真实结束日还没打完：${late.slice(0, 5).map((c) => `${c.name}（第 ${c.circuit!.end} 天）`).join('、')}`)
  if (dup.length) fail(`${label}：${dup.length} 场赛事的名次表里有人出现两次：${dup.slice(0, 3).map((c) => c.name).join('、')}`)

  for (const [id, real] of REAL) {
    const c = state.comps[`ev:${id}`]
    const got = c?.champion ? state.teams[c.champion]?.name : '（没打完）'
    console.log(`  ${c?.name}：${got}（${c?.circuit?.mode === 'sim' ? '模拟' : '照历史'}）· 真实：${real}`)
    if (c?.circuit?.mode === 'history' && got !== real) fail(`${label}：${c.name} 照历史进行，冠军却是 ${got}`)
  }
  const top = Object.values(state.teams).filter((t) => t.champPoints > 0).sort((a, b) => b.champPoints - a.champPoints).slice(0, 6)
  console.log(`  赛区积分前六：${top.map((t) => `${t.tag || t.name} ${t.champPoints}`).join(' · ')}`)

  try {
    let guard = 0
    while (state.year === 2021 && guard++ < 10) autoWeek(state)
    const on22 = Object.values(state.comps).filter((c) => c.format === 'circuit').length
    for (let i = 0; i < 8; i++) autoWeek(state)
    const begun = Object.values(state.comps).filter((c) => c.circuit?.mode).length
    console.log(`  → ${state.year}：日历上 ${on22} 场赛事，推进 8 周后已开始 ${begun} 场`)
    if (state.year !== 2022 || !on22) fail(`${label}：没能进入 2022 的赛历（年份 ${state.year}，赛事 ${on22}）`)

    // the rest of 2022, then the honest stop at the partnered era
    guard = 0
    while (state.year === 2022 && state.day < 350 && !state.gameOver && guard++ < 60) autoWeek(state)
    const c22 = Object.values(state.comps).filter((c) => c.format === 'circuit')
    const late22 = c22.filter((c) => !c.champion && !c.circuit?.done && (c.circuit?.end ?? 0) < state.day)
    const empty22 = c22.filter((c) => c.circuit?.done)
    if (empty22.length) console.log(`  2022 有 ${empty22.length} 场打过但参赛队都不在这个世界里：${empty22.map((c) => c.name).join('、')}`)
    console.log(`  2022 到第 ${state.day} 天：${c22.filter((c) => c.champion).length}/${c22.length} 场打完，你的队 ${state.teams[state.myTeam]?.name}`)
    if (late22.length) fail(`${label}：2022 有 ${late22.length} 场过了真实结束日没打完：${late22.slice(0, 4).map((c) => c.name).join('、')}`)
    guard = 0
    while (!state.gameOver && guard++ < 10) autoWeek(state)
    if (state.year !== 2023 || !state.timelinePause) {
      fail(`${label}：2022 年底应该停在「时间线暂停」，实际 ${state.year} 年，${state.gameOver ?? '没有停'}`)
    } else if (autoWeek(state).kind !== 'game-over' || state.day !== 0) {
      fail(`${label}：停下之后时钟还在走（第 ${state.day} 天）`)
    } else {
      console.log(`  → 停在 ${state.year} 年 1 月 1 日：${state.timelinePause.slice(0, 26)}…`)
    }
  } catch (e) {
    fail(`${label}：2022 里崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 5).join(' | ')}`)
  }
}

const me = (state: GameState): boolean => !!state.me

/**
 * Nobody signs him, and the world runs a year on its own. China had no road
 * out in 2021, so nothing the Chinese events do can reach anywhere else: every
 * international must end exactly as it really did. Champions is the hard one —
 * its winner, Acend, is not in the roster book under that name at all; its
 * five started the year at Raise Your Edge, and the club has to be recognised
 * by the people on it.
 */
function bystander(): void {
  const state = createCareer({
    name: 'Watcher', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed, year: 2021,
  })
  console.log('\n== 旁观者：中国天梯上没人签他，世界自己走一年')
  try {
    while (state.year === 2021 && state.day < 350) advanceDay(state, { autoResolveDrawDecisions: true, autoScrims: true })
  } catch (e) {
    fail(`旁观者：第 ${state.day} 天崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 5).join(' | ')}`)
    return
  }
  const circuit = Object.values(state.comps).filter((c) => c.format === 'circuit')
  const sim = circuit.filter((c) => c.circuit?.mode === 'sim')
  console.log(`  模拟 ${sim.length} 场：${sim.map((c) => `${c.name}（${c.circuit!.why}）`).join('、')}`)
  const leaked = sim.filter((c) => c.region !== 'China')
  if (leaked.length) fail(`旁观者：中国赛事的结果波及到了中国以外 ${leaked.length} 场：${leaked.slice(0, 4).map((c) => c.name).join('、')}`)
  for (const [id, real] of REAL) {
    const c = state.comps[`ev:${id}`]
    const got = c?.champion ? state.teams[c.champion]?.name : '（没打完）'
    console.log(`  ${c?.name}：${got}（${c?.circuit?.mode === 'sim' ? '模拟' : '照历史'}）· 真实：${real}`)
    if (got !== real) fail(`旁观者：${c?.name} 应该是 ${real}，实际 ${got}`)
  }
}

run('北美 · Challengers 首发', 'North America', 'chal')
run('中国 · 从天梯开始', 'China', 'pre')
run('欧洲 · 强队替补', 'Europe', 't1')
bystander()

console.log(bad ? `\n✗ ${bad} 项不对。` : '\n✓ 2021 按真实赛历打完一整年，够不着的国际赛保持了真实冠军，并接上了 2022。')
process.exit(bad ? 1 : 0)
