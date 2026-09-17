/**
 * A place a placing earned, when history has let its club go by the draw.
 *
 * Reported 2026-09-17 (a European career from 2021, seeds 1 and 5): EXCEL finished third in 2022's EMEA Stage 2
 * Challengers, played here, and so held the EMEA place at Masters Copenhagen that third place gives. History had let
 * EXCEL go by the draw; the draw emptied the place and stood in the best side it could find anywhere — Version1, a
 * North American club that never played that event — over EMEA's fourth. The place is the next finisher's
 * (engine/circuit.ts nextFinisher). Built here rather than waited for, on Masters Reykjavík 2021, whose EMEA places
 * are the first two of the EMEA Challengers Playoffs:
 *
 *  - next: the Playoffs are played here and a club in their top two has been let go by the draw. Its place goes to the
 *    Playoffs' next finisher, not a stand-in — though the player's club, not in the Playoffs, is made the best side in
 *    the world, the one a stand-in's place would go to. The week's reading of the draw beforehand (drawStanding) says
 *    the same: the next finisher is seated, the player's club is not waiting on a place.
 *  - ran out: every finisher below the first has been let go, so the second place has no placing left behind it. That
 *    place still goes to a stand-in (fillGaps) — the player's club — and the week said beforehand that it might.
 *
 * A club history really had at Reykjavík is not the one let go: the draw puts each real side back on the floor with
 * the people it really brought (engine/timeline.ts syncEvent), which wakes it. EXCEL was not at Copenhagen.
 *
 * And the Champions places a Last Chance Qualifier reads before its draw (engine/circuit.ts championsDirect) are
 * counted the way the Champions draw will take them. 2023's Champions has the Americas League's top three; the
 * Americas qualifier takes the league's other sides, and a side already through hands its qualifier place to the
 * league's next side not in the qualifier:
 *
 *  - direct: the league is played here, its second let go before the qualifier's draw. Read as the Champions draw
 *    reads a placing (nextFinisher), that place is the league's fourth's, Cloud9's — so Cloud9 is through, and its
 *    qualifier place is the next side's: a club of the league not in the qualifier, placed fifth here. The week read
 *    the same field the day before. (Who is let go is read on the qualifier's day, the best reading there is before
 *    the Champions draw; NRG really played Champions 2023, and that draw would wake it — no club of the league's top
 *    three is let go by that day in the book, see the commit that added this.)
 *  - nobody let go: Cloud9 is not through and keeps its qualifier place; the fifth is not in it.
 *
 *   npx tsx scripts/check_gone_seat.ts [seed=11]
 */
import RAW_2021 from '../src/data/world_2021.json'
import { drawStanding, eventOf, progressCircuit, worldIdOf } from '../src/engine/circuit'
import { setupSeason } from '../src/engine/season'
import { foldsOf, openWorldAt } from '../src/engine/timeline'
import type { Competition, GameState } from '../src/engine/types'
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
let bad = 0
const fail = (msg: string) => { bad++; console.log(`  ✗ ${msg}`) }

const MASTERS = '353' // Valorant Champions Tour Stage 2: Masters Reykjavík
const PLAYOFFS = '376' // Champions Tour Stage 2: EMEA Challengers Playoffs — Reykjavík's EMEA places, first and second
const id = (vlr: string): string => worldIdOf(vlr)!
const [LIQUID, FNATIC, FPX, GAMBIT, OXYGEN, GUILD, BBL, FUT] = ['474', '2593', '628', '682', '921', '1209', '397', '1184'].map(id)

interface World { state: GameState; club: string; masters: Competition; playoffs: Competition }

/** A manager's save at a European club Reykjavík and the Playoffs did not have, on the day before Reykjavík's draw. */
function world(): World | null {
  const masters = eventOf(MASTERS)
  const playoffs = eventOf(PLAYOFFS)
  if (!masters?.start || !playoffs) { fail(`日历上找不到雷克雅未克大师赛或 EMEA 挑战者季后赛（${MASTERS} / ${PLAYOFFS}）`); return null }
  const booked = new Set([...masters.seeds, ...playoffs.seeds])
  const folding = new Set(foldsOf(2021).map((f) => f.vlr))
  const pick = (RAW_2021 as unknown as { teams: { id: string; region: string; roster: string[] }[] }).teams
    .find((t) => t.region === 'Europe' && t.roster.length >= 5 && !booked.has(t.id.slice(4)) && !folding.has(t.id.slice(4)))
  if (!pick) { fail('2021 年的世界里找不到一家不在这两项赛事里、这一年也没解散的欧洲俱乐部'); return null }
  const state = createNewGame(pick.id, 'Probe', seed, undefined, 2021)
  setupSeason(state)
  const m = state.comps[`ev:${MASTERS}`]
  const p = state.comps[`ev:${PLAYOFFS}`]
  if (!m?.circuit || !p?.circuit) { fail('存档里没有这两项赛事'); return null }
  state.day = masters.start - 2
  // the best side in the world, and a Masters side by tier: the one a stand-in's place goes to (fillGaps)
  const t = state.teams[pick.id]
  t.rating = 100
  t.tier = m.tier
  return { state, club: pick.id, masters: m, playoffs: p }
}

/** The Playoffs as this world played them: `order`, first to last. */
function playedHere(comp: Competition, order: string[]): void {
  comp.circuit!.mode = 'sim'
  comp.circuit!.why = 'home'
  comp.teams = [...order]
  comp.finished = [...order]
  comp.places = order.map((_, i) => i + 1)
  comp.champion = order[0]
}

const nameOf = (w: World, t: string | null | undefined): string => (t ? w.state.teams[t]?.name ?? t : '（空）')

/** The day before the draw, the week's reading of it; then the draw. */
function draw(w: World, watch: string[]): { before: Map<string, string | null>; seat: (vlr: string) => string | null } {
  const before = new Map(watch.map((t) => [t, drawStanding(w.state, w.masters, t)]))
  w.state.day++
  const notes: string[] = []
  progressCircuit(w.state, w.masters, notes)
  const ev = eventOf(MASTERS)!
  const c = w.masters.circuit!
  if (c.mode !== 'sim') fail(`雷克雅未克大师赛应该按这个世界的结果抽签（上游变了），实际 ${c.mode ?? '没抽签'}`)
  return { before, seat: (vlr) => c.seeds[ev.seeds.indexOf(vlr)] ?? null }
}

function next(): void {
  const w = world()
  if (!w) return
  const { state, club } = w
  // FPX first, Gambit second and let go by the draw, Oxygen third: none of them was at Reykjavík, so nothing wakes Gambit
  playedHere(w.playoffs, [FPX, GAMBIT, OXYGEN, LIQUID, FNATIC, GUILD, BBL, FUT])
  state.teams[GAMBIT].dormant = true
  console.log(`\n== 下一名：EMEA 挑战者季后赛第二名 ${nameOf(w, GAMBIT)} 抽签前已经解散；你执教 ${nameOf(w, club)}，全世界最强、不在季后赛里`)
  const { before, seat } = draw(w, [OXYGEN, club])
  const [first, second] = [seat('474'), seat('2593')]
  console.log(`  抽签前一天：${nameOf(w, OXYGEN)} ${before.get(OXYGEN) ?? '进不去'} · ${nameOf(w, club)} ${before.get(club) ?? '进不去'}`)
  console.log(`  EMEA 两个名额：第一个 ${nameOf(w, first)}，第二个 ${nameOf(w, second)}`)
  if (first !== FPX) fail(`EMEA 第一个名额应该是季后赛第一 ${nameOf(w, FPX)}，实际 ${nameOf(w, first)}`)
  if (second !== OXYGEN) fail(`EMEA 第二个名额：第二名 ${nameOf(w, GAMBIT)} 解散了，应该给季后赛下一名 ${nameOf(w, OXYGEN)}，实际 ${nameOf(w, second)}`)
  if (w.masters.teams.includes(GAMBIT)) fail(`已经解散的 ${nameOf(w, GAMBIT)} 不该进大师赛`)
  if (w.masters.teams.includes(club)) fail(`${nameOf(w, club)} 没打 EMEA 挑战者季后赛，不该替补进雷克雅未克：名额有季后赛的下一名接`)
  // the week and the draw agree
  if (before.get(OXYGEN) !== 'seated') fail(`抽签前一天应该读出 ${nameOf(w, OXYGEN)} 会进（seated），实际 ${before.get(OXYGEN) ?? '进不去'}`)
  if (before.get(club) != null) fail(`抽签前一天不该说 ${nameOf(w, club)} 还有机会替补进去（${before.get(club)}）：抽签没有空出来的名额`)
}

function ranOut(): void {
  const w = world()
  if (!w) return
  const { state, club } = w
  // Fnatic first; every side below it let go, none of them at Reykjavík; Liquid, whose place the first one really was, not placed here
  const gone = [GAMBIT, OXYGEN, FPX, GUILD, BBL, FUT]
  playedHere(w.playoffs, [FNATIC, ...gone])
  for (const t of gone) state.teams[t].dormant = true
  console.log(`\n== 名次用完：EMEA 挑战者季后赛第一名以下全部解散；你执教 ${nameOf(w, club)}，全世界最强、不在季后赛里`)
  const { before, seat } = draw(w, [club])
  const [first, second] = [seat('474'), seat('2593')]
  console.log(`  抽签前一天：${nameOf(w, club)} ${before.get(club) ?? '进不去'}`)
  console.log(`  EMEA 两个名额：第一个 ${nameOf(w, first)}，第二个 ${nameOf(w, second)}`)
  if (first !== FNATIC) fail(`EMEA 第一个名额应该是季后赛第一 ${nameOf(w, FNATIC)}，实际 ${nameOf(w, first)}`)
  if (second !== club) fail(`EMEA 第二个名额后面没有名次可接，应该照旧给替补里最强的 ${nameOf(w, club)}，实际 ${nameOf(w, second)}`)
  for (const t of gone) if (w.masters.teams.includes(t)) fail(`已经解散的 ${nameOf(w, t)} 不该进大师赛`)
  if (before.get(club) !== 'maybe') fail(`抽签前一天应该读出 ${nameOf(w, club)} 可能替补进去（maybe），实际 ${before.get(club) ?? '进不去'}`)
}

const LEAGUE = '1189' // Champions Tour 2023: Americas League — Champions 2023's three Americas places
const LCQ = '1658' // Champions Tour 2023: Americas Last Chance Qualifier — the league's other sides
const [LOUD, NRG, EG, C9, FURIA, LEV, T100, SEN, MIBR, KRU] = ['6961', '1034', '5248', '188', '2406', '2359', '120', '2', '7386', '2355'].map(id)

/**
 * direct: see the top of the file. A world brought up to 2023 on the book alone (engine/timeline.ts openWorldAt, as a
 * 2026 career's is), the day before the Americas qualifier's draw, the league played here with `fifth` placed fifth.
 */
function direct(letGo: boolean): void {
  const lcq = eventOf(LCQ)
  if (!lcq?.start) { fail(`日历上找不到 2023 美洲最后机会资格赛（${LCQ}）`); return }
  const state = createNewGame((RAW_2021 as unknown as { teams: { id: string }[] }).teams[0].id, 'Probe', seed, undefined, 2021)
  state.myTeam = ''
  openWorldAt(state, 2023)
  const busy = new Set([...eventOf(LEAGUE)!.seeds, ...lcq.seeds, ...eventOf('1657')!.seeds].map(id))
  const folding = new Set(foldsOf(2023).map((f) => id(f.vlr)))
  const fifth = Object.values(state.teams)
    .filter((t) => t.region === 'North America' && !t.dormant && t.roster.length >= 5 && !busy.has(t.id) && !folding.has(t.id))
    .sort((a, b) => a.id.localeCompare(b.id))[0]
  if (!fifth) { fail('2023 年的世界里找不到一家不在美洲联赛和资格赛里、这一年也没解散的北美俱乐部'); return }
  state.myTeam = fifth.id
  setupSeason(state)
  const league = state.comps[`ev:${LEAGUE}`]
  const comp = state.comps[`ev:${LCQ}`]
  if (!league?.circuit || !comp?.circuit) { fail('2023 存档里没有美洲联赛或美洲最后机会资格赛'); return }
  playedHere(league, [LOUD, NRG, EG, C9, fifth.id, FURIA, LEV, T100, SEN, MIBR, KRU])
  // NRG was not in the qualifier, so its draw wakes nobody who is let go here
  if (letGo) state.teams[NRG].dormant = true
  const w = { state, club: fifth.id } as World
  console.log(letGo
    ? `\n== 直通：2023 美洲联赛第二名 ${nameOf(w, NRG)} 在资格赛抽签前解散；第四名 ${nameOf(w, C9)}，第五名 ${nameOf(w, fifth.id)}（不在资格赛真实名单里）`
    : `\n== 没人解散：2023 美洲联赛前三直通，第四名 ${nameOf(w, C9)}，第五名 ${nameOf(w, fifth.id)}`)
  state.day = lcq.start - 2
  const before = drawStanding(state, comp, fifth.id)
  state.day++
  progressCircuit(state, comp, [])
  const field = comp.circuit.seeds.filter((t): t is string => !!t)
  console.log(`  抽签前一天：${nameOf(w, fifth.id)} ${before ?? '进不去'} · 资格赛名单：${field.map((t) => nameOf(w, t)).join('、')}`)
  if (letGo) {
    if (field.includes(C9)) fail(`${nameOf(w, C9)} 接了解散的 ${nameOf(w, NRG)} 的冠军赛名额，已经直通，不该还占着资格赛的位置`)
    if (!field.includes(fifth.id)) fail(`${nameOf(w, C9)} 直通后空出来的资格赛位置，应该给联赛下一名、不在资格赛里的 ${nameOf(w, fifth.id)}`)
    if (field.includes(NRG)) fail(`已经解散的 ${nameOf(w, NRG)} 不该进资格赛`)
    if (before !== 'seated') fail(`抽签前一天应该读出 ${nameOf(w, fifth.id)} 会进资格赛（seated），实际 ${before ?? '进不去'}`)
  } else {
    if (!field.includes(C9)) fail(`没人解散时 ${nameOf(w, C9)} 是联赛第四、没有直通，应该留在资格赛`)
    if (field.includes(fifth.id)) fail(`没人解散时资格赛没有空出来的位置，${nameOf(w, fifth.id)} 不该进去`)
  }
}

const t0 = Date.now()
next()
ranOut()
direct(true)
direct(false)
console.log(bad
  ? `\n✗ ${bad} 项不对。`
  : `\n✓ 靠名次拿到的大师赛名额，俱乐部抽签前解散了，名额给同一项赛事的下一名，不再从全世界找替补；后面没有名次可接的名额照旧找替补；最后机会资格赛读的冠军赛直通名单和冠军赛抽签同一个走法；抽签前一周读出来的和抽签一致 · ${((Date.now() - t0) / 1000).toFixed(1)}s`)
process.exit(bad ? 1 : 0)
