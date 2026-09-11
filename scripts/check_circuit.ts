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
 * Then a bystander: nobody signs him, and the world runs from 2021 into 2028
 * on its own. Nothing he does reaches anywhere, so every international that
 * has really been played must end exactly as it did — which it can only do if
 * the clubs and rosters followed history too (engine/timeline.ts): EDward
 * Gaming did not exist in January 2021 and won Champions 2024. Champions 2026
 * has not been played; its field must be the sixteen that really qualified.
 * And the author's rule for the seam: 连贯 — no year turn may change the whole
 * world at once, 2025 into 2026 included, and the years nobody has played yet
 * change only what the game itself changes.
 *
 * The 2026 entrance opens on the same timeline: a nobody who starts on the
 * ladder in 2026 reaches nothing, so every 2026 event played so far keeps
 * its real result and Champions 2026 is the sixteen that really qualified.
 *
 * From 2027 the leagues play the format Riot announced for 2027, its gaps
 * 暂定 (engine/ahead.ts): a nobody from the 2026 entrance is left alone into
 * 2029, and each season is held to that format as written — and the partners
 * are chosen again for 2029.
 *
 *   npx tsx scripts/check_circuit.ts [seed=11] [only: careers|bystander|lineage|quiet|entry2026|ahead]
 */
import { readFileSync } from 'node:fs'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { advanceUntil, autoWeek, quietAhead } from '../src/engine/me/auto'
import { advanceDay, dateLabel, setupSeason } from '../src/engine/season'
import { createNewGame } from '../src/engine/world'
import { eventOf, eventsOf, worldIdOf } from '../src/engine/circuit'
import { MAX_NEW_PARTNERS } from '../src/engine/leagues'
import { historyNames } from '../src/engine/names'
import { bookClubsAt } from '../src/engine/timeline'
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
const only = process.argv[3]
let bad = 0
const fail = (msg: string) => { bad++; console.log(`✗ ${msg}`) }

/** A year's internationals and who really won each, read off the events themselves. */
function internationals(year: number): { id: string; vlr: string; real: string }[] {
  return eventsOf(year)
    .filter((e) => !e.projected && !e.region && (e.stage === 'masters1' || e.stage === 'masters2' || e.stage === 'champions' || /LOCK\/\/IN/.test(e.name)))
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

/** A year's world as it opens: what anyone would notice changing overnight. */
interface Snap { year: number; clubs: number; scenes: Set<string>; leagues: Record<string, number>; rostered: Map<string, number> }

function snap(state: GameState): Snap {
  const active = Object.values(state.teams).filter((t) => !t.dormant && t.roster.length >= 5)
  const leagues: Record<string, number> = {}
  for (const t of active) if (t.tier === 1 && t.league?.startsWith('VCT ')) leagues[t.league.slice(4)] = (leagues[t.league.slice(4)] ?? 0) + 1
  const rostered = new Map<string, number>()
  for (const p of Object.values(state.players)) {
    const t = p.teamId ? state.teams[p.teamId] : undefined
    if (t && !t.dormant) rostered.set(p.id, p.overall)
  }
  return { year: state.year, clubs: active.length, scenes: new Set(active.map((t) => t.scene).filter((s): s is string => !!s)), leagues, rostered }
}

interface Turn { into: number; clubs: number; clubsWas: number; scenesLost: string[]; kept: number; bigMoves: number }

function turnOf(a: Snap, b: Snap): Turn {
  let kept = 0
  let big = 0
  for (const [id, was] of a.rostered) {
    const now = b.rostered.get(id)
    if (now == null) continue
    kept++
    if (Math.abs(now - was) >= 10) big++
  }
  return {
    into: b.year, clubs: b.clubs, clubsWas: a.clubs, scenesLost: [...a.scenes].filter((s) => !b.scenes.has(s)),
    kept: kept / Math.max(1, a.rostered.size), bigMoves: big / Math.max(1, kept),
  }
}

const pct = (x: number): string => `${Math.round(x * 100)}%`

/**
 * 连贯. Real off-seasons change a lot — clubs fold, Challengers leagues merge,
 * ratings are re-read off a new year's numbers — so the turn into 2026 is held
 * to the turn before it, not to zero. The years nobody has played yet have no
 * book behind them: only the game's own ageing, retirements and transfers move
 * anything, and none of that empties a league or rewrites a rating overnight.
 */
function continuity(turns: Turn[]): void {
  const at = (y: number) => turns.find((t) => t.into === y)
  const [t25, t26] = [at(2025), at(2026)]
  if (t25 && t26) {
    if (t26.clubs < t26.clubsWas * 0.8) fail(`连贯：2026 开季在打的俱乐部从 ${t26.clubsWas} 家掉到 ${t26.clubs} 家`)
    if (t26.scenesLost.length > 2) fail(`连贯：2026 开季消失了 ${t26.scenesLost.length} 个 Challengers 联赛：${t26.scenesLost.join('、')}`)
    if (t26.bigMoves > t25.bigMoves * 1.5 + 0.05) fail(`连贯：2026 开季能力变动 10 分以上的人占 ${pct(t26.bigMoves)}，上一个换季是 ${pct(t25.bigMoves)}`)
    if (t26.kept < t25.kept * 0.8) fail(`连贯：2026 开季留在场上的人只有 ${pct(t26.kept)}，上一个换季是 ${pct(t25.kept)}`)
  }
  for (const t of [at(2027), at(2028)]) {
    if (!t) continue
    if (t.clubs < t.clubsWas * 0.9) fail(`连贯：${t.into} 开季在打的俱乐部从 ${t.clubsWas} 家掉到 ${t.clubs} 家`)
    if (t.scenesLost.length) fail(`连贯：${t.into} 开季消失了 Challengers 联赛：${t.scenesLost.join('、')}`)
    if (t.bigMoves > 0.05) fail(`连贯：${t.into} 开季能力变动 10 分以上的人占 ${pct(t.bigMoves)}——没有真实数据的年份不该有这种变化`)
  }
}

/** Champions 2026 has not been played. Nothing a bystander does reaches anywhere, so its field must be the sixteen that really qualified. */
function champions2026(state: GameState): void {
  const c = Object.values(state.comps).find((x) => x.format === 'circuit' && x.stage === 'champions' && !!x.circuit?.id.startsWith('F2026:'))
  if (!c) { fail('旁观者：2026 的日历上没有冠军赛'); return }
  const book = JSON.parse(readFileSync('src/data/routes_partnered.json', 'utf8')) as { fields?: Record<string, { champions?: [string, string, string | null][] }> }
  const real = book.fields?.['2026']?.champions ?? []
  const got = c.teams.map((t) => state.teams[t]?.name ?? t)
  const missing = real.filter(([, , tid]) => !tid || !c.teams.includes(worldIdOf(tid) ?? '')).map(([name]) => name)
  console.log(`    2026 全球冠军赛（还没打，模拟）：${c.teams.length} 队 · ${got.join('、')}${c.champion ? ` · 这个世界的冠军 ${state.teams[c.champion]?.name}` : ''}`)
  if (c.teams.length !== 16) fail(`旁观者：2026 冠军赛应该是 16 队，实际 ${c.teams.length}`)
  if (!real.length) fail('旁观者：routes_partnered.json 里没有 2026 冠军赛的真实名单')
  else if (missing.length) fail(`旁观者：2026 冠军赛应该是真实晋级的 16 队，缺 ${missing.join('、')}`)
}

function bystander(): void {
  const t0 = Date.now()
  const state = createCareer({
    name: 'Watcher', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed, year: 2021,
  })
  console.log('\n== 旁观者：中国天梯上没人签他，世界自己从 2021 一路走到 2028')
  // the months in which a club went quiet, per year: history let them go one at a time
  const foldMonths = new Map<number, Set<number>>()
  let quietNow = Object.values(state.teams).filter((t) => t.dormant).length
  // DRX by date: vlr has every year of it as KIWOOM DRX, a name it took on 2026-03-19 (engine/names.ts)
  const drx: [number, number, string][] = []
  const day = () => {
    advanceDay(state, { autoResolveDrawDecisions: true, autoScrims: true })
    const q = Object.values(state.teams).filter((t) => t.dormant).length
    if (q > quietNow && state.day > 3) foldMonths.set(state.year, (foldMonths.get(state.year) ?? new Set<number>()).add(Math.floor(state.day / 30)))
    quietNow = q
    const t = state.teams.V21T8185
    if (t && (state.day === 150 || (state.year === 2026 && (state.day === 76 || state.day === 77)))) drx.push([state.year, state.day, t.name])
  }
  let was = snap(state)
  const turns: Turn[] = []
  for (const year of [2021, 2022, 2023, 2024, 2025, 2026, 2027]) {
    const y0 = Date.now()
    if (!playYear(state, '旁观者', year, day, 400)) return
    season(state, '旁观者', year, true)
    if (year === 2021) {
      const leaked = Object.values(state.comps).filter((c) => c.circuit?.mode === 'sim' && c.region !== 'China')
      if (leaked.length) fail(`旁观者：中国赛事的结果波及到了中国以外 ${leaked.length} 场：${leaked.slice(0, 4).map((c) => c.name).join('、')}`)
    }
    if (year >= 2023) {
      // what has really been played stays as it was; only what nobody has played yet is played
      const sim = Object.values(state.comps).filter((c) => c.circuit?.mode === 'sim' && c.circuit.why !== 'ahead')
      if (sim.length) fail(`旁观者：${year} 年他没有俱乐部，却有 ${sim.length} 场被模拟：${sim.slice(0, 4).map((c) => c.name).join('、')}`)
    }
    if (year === 2026) champions2026(state)
    if (!cross(state, '旁观者', year, day, 40)) return
    if (state.year !== year + 1 || state.gameOver) {
      fail(`旁观者：${year} 打完应该进入 ${year + 1} 年，实际 ${state.year} 年，${state.timelinePause ?? state.gameOver ?? ''}`)
      return
    }
    const now = snap(state)
    const t = turnOf(was, now)
    turns.push(t)
    was = now
    console.log(`  → ${state.year}：俱乐部 ${now.clubs} 家在打（休眠 ${Object.values(state.teams).filter((x) => x.dormant).length}）`
      + ` · Challengers 联赛 ${now.scenes.size} 个 · 联赛 ${Object.entries(now.leagues).map(([k, v]) => `${k} ${v}`).join(' / ') || '—'}`
      + ` · 在队选手 ${now.rostered.size} 人，上一年的人留在场上 ${pct(t.kept)}，能力变动 10 分以上 ${pct(t.bigMoves)}`
      + (t.scenesLost.length ? ` · 不再有的联赛：${t.scenesLost.join('、')}` : '')
      + ` · ${((Date.now() - y0) / 1000).toFixed(1)}s`)
  }
  continuity(turns)
  const drxWant = (y: number, d: number) => (y < 2026 || (y === 2026 && d < 77) ? 'DRX' : 'KIWOOM DRX')
  const drxBad = drx.filter(([y, d, n]) => n !== drxWant(y, d))
  console.log(`  DRX 的队名：${drx.map(([y, d, n]) => `${y} 第 ${d} 天 ${n}`).join(' · ')}`)
  if (drx.length < 6 || drxBad.length) fail(`队名：DRX 2022–2025 应该叫 DRX，2026-03-19 起叫 KIWOOM DRX，实际 ${drxBad.map(([y, d, n]) => `${y} 第 ${d} 天 ${n}`).join('、') || `只看到 ${drx.length} 次`}`)
  console.log('  俱乐部在哪几个月陆续解散：' + [2022, 2023, 2024, 2025].map((y) => `${y} 年 ${foldMonths.get(y)?.size ?? 0} 个月`).join(' · '))
  for (const y of [2023, 2024]) {
    if ((foldMonths.get(y)?.size ?? 0) < 4) fail(`连贯：${y} 年真实历史里不再参赛的俱乐部应该分散在一年里陆续解散，实际只在 ${foldMonths.get(y)?.size ?? 0} 个月里有`)
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
    ['Vision Strikers → DRX', 'V21T198', 'V21T8185', 2022, 'DRX'],
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
    if (club === 'V21T198' && t) {
      // the club carried on as DRX takes KIWOOM DRX with the naming deal, not before (engine/names.ts)
      const notes: string[] = []
      state.year = 2026
      state.day = 76
      historyNames(state, notes)
      const before = `${t.name}（${t.tag}）`
      state.day = 77
      historyNames(state, notes)
      console.log(`  队名：2026-03-18 叫 ${before}，2026-03-19 叫 ${t.name}（${t.tag}）${notes.length ? ` · ${notes[0]}` : ''}`)
      if (before !== 'DRX（DRX）' || t.name !== 'KIWOOM DRX' || t.tag !== 'KRX' || !notes.length) {
        fail(`传承 ${label}：2026-03-18 应该叫 DRX（DRX），03-19 起叫 KIWOOM DRX（KRX）并通知你，实际 ${before} → ${t.name}（${t.tag}）`)
      }
    }
  }
}

/**
 * 策划稿 §3.5 A: the Chinese ladder in 2021 has three events in the year. On New
 * Year's Day nothing is coming for a month, so the clock can run a month at a time,
 * and it stops as soon as something is. A North American starter has Challengers
 * every few weeks and is never offered it.
 */
function quiet(): void {
  const cn = createCareer({ name: 'Q', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed, year: 2021 })
  const na = createCareer({ name: 'Q', region: 'North America', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed, year: 2021 })
  if (!quietAhead(cn, 28)) fail('空窗期：2021 年 1 月 1 日的中国天梯应该是「接下来四周没有比赛」')
  if (quietAhead(na, 28)) fail('空窗期：2021 年 1 月 1 日的北美二线首发不该被当成空窗')
  const log: string[] = []
  let runs = 0
  try {
    while (quietAhead(cn, 28) && runs < 12 && !cn.gameOver) {
      runs++
      const r = advanceUntil(cn, 'month')
      if (r.weeks < 1 && r.stop.kind === 'week-end') { fail('空窗期：按月推进一周都没走'); break }
      log.push(`${r.weeks} 周 → ${dateLabel(cn)}`)
    }
  } catch (e) {
    fail(`空窗期：按月推进崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 4).join(' | ')}`)
  }
  console.log(`\n== 空窗期（中国天梯 2021）：按月推进 ${runs} 次（${log.join('，')}），停在 ${dateLabel(cn)}——接下来四周有事了`)
  if (!runs) fail('空窗期：一次按月推进都没有发生')
}

if (!only || only === 'careers') {
  run('北美 · Challengers 首发', 'North America', 'chal')
  run('中国 · 从天梯开始', 'China', 'pre')
  run('欧洲 · 强队替补', 'Europe', 't1')
}
if (!only || only === 'bystander') bystander()
if (!only || only === 'lineage') lineage()
/** The 2026 entrance: 2026 as it really opened, on the timeline's own ruler — not another world. */
function entry2026(): void {
  const t0 = Date.now()
  const state = createCareer({
    name: 'Watcher', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed, year: 2026,
  })
  const books = Object.values(state.comps).filter((c) => c.format === 'circuit')
  const clubs = Object.values(state.teams).filter((t) => !t.dormant).length
  console.log(`\n== 2026 入口：${state.year} 年开局 · 在打的俱乐部 ${clubs} 家 · 日历上 ${books.length} 项赛事（其中还没打的 ${books.filter((c) => c.circuit!.id.startsWith('F')).length} 项）`)
  if (!Object.keys(state.teams).some((id) => id.startsWith('V21T'))) fail('2026 入口：世界应该是时间线上的 2026，而不是另一套世界')
  if (clubs < 180) fail(`2026 入口：真实 2026 年开季的俱乐部有两百多家，这里只有 ${clubs} 家`)
  if (books.length < 50) fail(`2026 入口：日历上只有 ${books.length} 项赛事`)
  const drxOpen = state.teams.V21T8185?.name
  let guard = 0
  try {
    while (state.year === 2026 && state.day < 340 && !state.gameOver && guard++ < 60) autoWeek(state)
  } catch (e) {
    fail(`2026 入口：第 ${state.day} 天崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 5).join(' | ')}`)
    return
  }
  season(state, '2026 入口', 2026, state.me?.phase !== 'pro')
  const sim = Object.values(state.comps).filter((c) => c.circuit?.mode === 'sim' && c.circuit.why !== 'ahead' && c.circuit.why !== 'mine')
  if (state.me?.phase !== 'pro' && sim.length) fail(`2026 入口：没有俱乐部的人却让 ${sim.length} 场真实赛事被模拟：${sim.slice(0, 4).map((c) => c.name).join('、')}`)
  // DRX until the naming deal of 2026-03-19, KIWOOM DRX from it: in this world, the roster book and every real event (engine/names.ts)
  const drxName = (y: number, d: number) => (y < 2026 || d < 77 ? 'DRX' : 'KIWOOM DRX')
  const drxNow = state.teams.V21T8185?.name
  const drxWrong = [
    ...[2022, 2023, 2024, 2025, 2026].map((y) => bookClubsAt(y).find((t) => t.id === 'V21T8185')).filter((t) => !!t && t.name !== 'DRX').map((t) => `名册书开季 ${t!.name}`),
    ...[2022, 2023, 2024, 2025, 2026].flatMap((y) => eventsOf(y).filter((e) => !e.projected && e.names['8185'] && e.names['8185'] !== drxName(y, e.start ?? 0)).map((e) => `${e.name} ${e.names['8185']}`)),
  ]
  console.log(`  DRX：开局叫 ${drxOpen}，第 ${state.day} 天叫 ${drxNow}；2022–2026 名册书和真实赛事里叫错的 ${drxWrong.length} 处`)
  if (drxOpen !== 'DRX' || drxNow !== 'KIWOOM DRX') fail(`2026 入口：DRX 开局应该叫 DRX，2026-03-19 起叫 KIWOOM DRX，实际 ${drxOpen} → ${drxNow}`)
  for (const x of drxWrong.slice(0, 5)) fail(`队名：${x}——DRX 2026-03-19 以前叫 DRX，之后叫 KIWOOM DRX`)
  champions2026(state)
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

/**
 * 2027 on (engine/ahead.ts, engine/leagues.ts), 暂定 rules as written: eight
 * partners a league, announced the day after Champions; Kickoff's twelve with
 * November's qualifiers; Masters from each league's top three; a Cup's twelve
 * from the event before and its Open Playoffs — China's partners and visitors
 * in by right; Champions from Cup 2's top four; 2028's partners 2027's, and
 * 2029's chosen again.
 */
function ahead(): void {
  const t0 = Date.now()
  const state = createCareer({
    name: 'Watcher', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed, year: 2026,
  })
  console.log('\n== 2027 起的新赛制（暂定规则）：2026 入口，没人签他，一路走到 2029')
  const L4 = ['Americas', 'EMEA', 'Pacific', 'China']
  const seeded = (c: Competition | undefined) => new Set(c?.circuit?.seeds.filter((x): x is string => !!x) ?? [])
  const tag = (id: string | undefined) => (id ? state.teams[id]?.tag || state.teams[id]?.name || id : '—')
  let partners2028: Record<string, string[]> | undefined
  const check = (year: number): void => {
    const by = (key: string) => state.comps[`ev:F${year}:${key}`]
    const plans = Object.values(state.comps).filter((c) => !!c.circuit && !!eventOf(c.circuit.id)?.plan)
    const late = plans.filter((c) => !c.champion && !c.circuit!.done && c.circuit!.end < state.day)
    const idle = plans.filter((c) => c.circuit!.done && !c.champion)
    console.log(`  ${year}：新赛制赛事 ${plans.length} 项 · 打完 ${plans.filter((c) => c.champion).length} · 报名队伍不足没有举行 ${idle.length}`)
    for (const c of late) fail(`新赛制：${c.name} 过了结束日（第 ${c.circuit!.end} 天）没打完`)
    for (const c of plans) if (new Set(c.finished).size !== c.finished.length) fail(`新赛制：${c.name} 名次表里有人出现两次`)
    const now = state.vct?.now
    const next = state.vct?.next
    if (next?.year !== year + 1) fail(`新赛制：${year} 年冠军赛之后没有公布 ${year + 1} 赛季的联赛`)
    else {
      for (const L of L4) if (next.partners[L]?.length !== 8) fail(`新赛制：${year + 1} ${L} 合作队 ${next.partners[L]?.length ?? 0} 支`)
      if (next.visitors.length !== 2) fail(`新赛制：${year + 1} 中国访客 ${next.visitors.length} 支`)
      if (!!next.reselected !== (year + 1 === 2027 || year + 1 === 2029)) fail(`新赛制：${year + 1} 赛季${next.reselected ? '不该' : '应该'}重选合作队`)
      if (year === 2027 && now) {
        partners2028 = next.partners
        for (const L of L4) {
          const was = new Set(now.partners[L])
          if (next.partners[L].some((t) => !was.has(t))) fail(`新赛制：2028 ${L} 合作队应该和 2027 一样（两年一选）`)
        }
      }
    }
    if (year === 2026) return
    for (const L of L4) {
      const field = seeded(by(`kickoff:${L}`))
      const own = [...(now?.partners[L] ?? []), ...(L === 'China' ? now?.visitors ?? [] : []), ...(now?.qualified?.[L] ?? [])]
      const missing = own.filter((t) => !field.has(t))
      if (field.size !== 12 || missing.length) fail(`新赛制：${year} ${L} 揭幕赛 ${field.size} 队${missing.length ? `，缺 ${missing.map(tag).join(' ')}` : ''}`)
      for (const cup of [1, 2]) {
        const before = by(cup === 1 ? `kickoff:${L}` : `cup1:${L}`)
        const open = by(`open${cup}:${L}`)
        const cupField = seeded(by(`cup${cup}:${L}`))
        const want = L === 'China'
          ? [...(now?.partners.China ?? []), ...(now?.visitors ?? []), ...(open?.finished.slice(0, 2) ?? [])]
          : [...(before?.finished.slice(0, 8) ?? []), ...(open?.finished.slice(0, 4) ?? [])]
        const miss = want.filter((t) => !cupField.has(t))
        if (cupField.size !== 12 || miss.length) fail(`新赛制：${year} ${L} 杯赛 ${cup} ${cupField.size} 队${miss.length ? `，缺 ${miss.map(tag).join(' ')}` : ''}`)
        if (L !== 'China') {
          const openField = seeded(open)
          const lost = (before?.finished.slice(8, 12) ?? []).filter((t) => !openField.has(t))
          if (lost.length) fail(`新赛制：${year} ${L} 杯赛 ${cup} 公开季后赛缺上一站后四 ${lost.map(tag).join(' ')}`)
        }
      }
    }
    for (const [m, feeder] of [['masters1', 'kickoff'], ['masters2', 'cup1']] as const) {
      const field = seeded(by(m))
      const miss = L4.flatMap((L) => by(`${feeder}:${L}`)?.finished.slice(0, 3) ?? []).filter((t) => !field.has(t))
      if (field.size !== 12 || miss.length) fail(`新赛制：${year} ${m} ${field.size} 队${miss.length ? `，缺 ${miss.map(tag).join(' ')}` : ''}`)
    }
    const champs = seeded(by('champions'))
    const miss = L4.flatMap((L) => by(`cup2:${L}`)?.finished.slice(0, 4) ?? []).filter((t) => !champs.has(t))
    if (champs.size !== 16 || miss.length) fail(`新赛制：${year} 冠军赛 ${champs.size} 队${miss.length ? `，缺 ${miss.map(tag).join(' ')}` : ''}`)
    console.log(`    大师赛 ${tag(by('masters1')?.champion)} / ${tag(by('masters2')?.champion)} · 冠军赛 ${tag(by('champions')?.champion)}`
      + ` · 公开资格赛打进揭幕赛的 ${L4.map((L) => (now?.qualified?.[L] ?? []).map(tag).join(' ') || '—').join(' | ')}`)
  }
  let guard = 0
  try {
    while (state.year < 2029 && !state.gameOver && guard++ < 1300) {
      advanceDay(state, { autoResolveDrawDecisions: true, autoScrims: true })
      if (state.day === 345) check(state.year)
    }
  } catch (e) {
    fail(`新赛制：${state.year} 年第 ${state.day} 天崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 5).join(' | ')}`)
    return
  }
  const now = state.vct?.now
  if (state.year !== 2029 || now?.year !== 2029) { fail(`新赛制：没有走进 2029 赛季（${state.year} 年，${state.gameOver ?? ''}）`); return }
  if (!now.reselected) fail('新赛制：2029 赛季应该按 2027–2028 两年成绩重选合作队')
  const changed = L4.map((L) => {
    const was = partners2028?.[L] ?? []
    const fresh = now.partners[L].filter((t) => !was.includes(t)).length
    // a partner since gone frees its seat on top of the cap
    const gone = was.filter((t) => !state.teams[t] || state.teams[t].dormant || state.teams[t].roster.length < 5).length
    if (fresh > MAX_NEW_PARTNERS + gone) fail(`新赛制：2029 ${L} 换进 ${fresh} 支新合作队，每次最多 ${MAX_NEW_PARTNERS} 支`)
    return `${L} 换了 ${fresh} 支`
  }).join(' · ')
  console.log(`  2029 重选合作队（每个联赛最多换 ${MAX_NEW_PARTNERS} 支）：${changed} · ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

if (!only || only === 'quiet') quiet()
if (!only || only === 'entry2026') entry2026()
if (!only || only === 'ahead') ahead()

console.log(bad ? `\n✗ ${bad} 项不对。` : '\n✓ 2021 到 2026 按真实赛历逐年打完，够不着的国际赛保持了真实冠军；2026 冠军赛是真实晋级的 16 队；换季没有一夜换掉世界，2027、2028 接着打；你的俱乐部跟着真实的改名、合并、整队收购走；队名按真实改名的日期换（DRX 2026-03-19 才叫 KIWOOM DRX）；中国的空窗期按月推进。')
process.exit(bad ? 1 : 0)
