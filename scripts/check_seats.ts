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
 * And the other way round, the author's rule that the player is one player:
 *
 *  - fold: a career put on a club whose last real event was in the spring of
 *    2023 and that never played again. The club tells him two or three weeks
 *    ahead, closes after its last event, and he is a free agent.
 *
 * And China, whose second tier in 2024 was no Challengers league at all:
 *
 *  - china: Attacking Soul Esports, outside the league and strong from 2024,
 *    plays the National Competition's Season 2 — and, finishing where one of
 *    its real top five did, takes that place at the Ascension.
 *
 *  - east: a CIS club that East Surge 2023 did not have, strong from 2023. The
 *    league's Promotion Cup is its bottom two against two challengers from
 *    outside; the club plays the weaker challenger for that seat.
 *
 *  - oq: 2027's way in from outside the league. A 2026 career at a European
 *    Challengers club with the best teammates in the world enters November's
 *    European open qualifier, takes one of Europe's two places, and plays the
 *    2027 EMEA Kickoff as a side from outside the league.
 *
 *   npx tsx scripts/check_seats.ts [seed=11] [only: seat|promo|fold|china|east|end|oq]
 */
import { eventOf, eventsOf } from '../src/engine/circuit'
import RAW_2021 from '../src/data/world_2021.json'
import { autoResolve, autoWeek } from '../src/engine/me/auto'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { declineDeal, joinClub, makeDeal } from '../src/engine/me/contract'
import { pop } from '../src/engine/me/pending'
import { declineInvite } from '../src/engine/me/tryout'
import { retirementTick } from '../src/engine/me/endings'
import { advanceWeek } from '../src/engine/me/week'
import { recomputeOverall, refreshValue } from '../src/engine/player'
import { Rng, hashStr } from '../src/engine/rng'
import { foldsOf, signForHistory } from '../src/engine/timeline'
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

function fold(): void {
  const t0 = Date.now()
  const state = createCareer({
    name: 'Probe', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed, year: 2021,
  })
  console.log('\n== 解散：生涯选手签进一家真实历史里 2023 年后没有再参赛的俱乐部')
  let guard = 0
  try {
    while (state.year < 2023 && !state.gameOver && guard++ < 400) autoWeek(state)
  } catch (e) {
    fail(`解散：${state.year} 年第 ${state.day} 天崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 5).join(' | ')}`)
    return
  }
  const pick = foldsOf(2023).map((f) => ({ f, t: state.teams[`V21T${f.vlr}`] }))
    .find(({ f, t }) => !!t && !t.dormant && t.roster.length >= 5 && f.last > 90 && f.last < 220)
  if (!pick) { fail('解散：2023 年找不到一家年中打完最后一场、开季时还在的俱乐部'); return }
  const { f, t } = pick
  const me = state.me!
  joinClub(state, makeDeal(state, t.id, 'transfer', 'B', new Rng(hashStr('fold-probe'))))
  console.log(`  2023 第 ${state.day} 天签进 ${t.name}：真实历史里它 2023 年最后一场在第 ${f.last} 天，之后没有再参加 Riot 赛事`)
  let told: number | null = null
  let closing: number | null = null
  let released: number | null = null
  guard = 0
  try {
    while (state.year === 2023 && released == null && !state.gameOver && guard++ < 80) {
      const stop = advanceWeek(state)
      if (stop.kind !== 'pending') continue
      const item = stop.item
      if (item.kind === 'folding') { told = state.day; closing = state.foldNotice?.day ?? null; pop(state, 'folding'); continue }
      if (item.kind === 'released') { if (item.id === 'fold') released = state.day; pop(state, 'released'); continue }
      // the probe says no to every offer: it is here to see the club close under him
      if (item.kind === 'deal') { declineDeal(state, item.id!); pop(state, 'deal', item.id); continue }
      if (item.kind === 'invite') { declineInvite(state, item.id!); pop(state, 'invite', item.id); continue }
      autoResolve(state, item)
      pop(state, item.kind, item.id)
    }
  } catch (e) {
    fail(`解散：${state.year} 年第 ${state.day} 天崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 5).join(' | ')}`)
    return
  }
  console.log(`  通知：第 ${told ?? '—'} 天（说第 ${closing ?? '—'} 天解散）· 成为自由人：第 ${released ?? '—'} 天 · `
    + `你现在是${me.phase === 'free' ? '自由人' : me.phase} · ${t.name}${t.dormant ? ' 已解散' : ' 还在'}`)
  if (told == null) fail('解散：俱乐部没有提前通知')
  if (released == null) fail('解散：俱乐部没有解散，或者你没有成为自由人')
  if (told != null && released != null && released - told < 14) fail(`解散：通知到解散只有 ${released - told} 天，应该至少两周`)
  if (released != null && released <= f.last) fail('解散：俱乐部在它最后一场真实比赛之前就解散了')
  if (me.phase !== 'free') fail(`解散：俱乐部解散后你应该是自由人，实际是 ${me.phase}`)
  if (!t.dormant || t.roster.includes(me.id)) fail(`解散：${t.name} 应该已经解散、名单上没有你`)
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

function china(): void {
  const club = 'V21T1837'
  const t0 = Date.now()
  const state = createNewGame(club, 'Probe', seed, undefined, 2021)
  setupSeason(state)
  console.log(`\n== 中国二线：执教 ${nameOf(state, club)}，2024 年起阵容顶满`)
  if (!runTo(state, '中国二线', 2024, 350, club, 2024)) return
  const t = state.teams[club]
  const nc = circuitComps(state).find((c) => /China National Competition: Season 2/.test(eventOf(c.circuit!.id)?.name ?? ''))
  const asc = circuitComps(state).find((c) => c.stage === 'ascension' && eventOf(c.circuit!.id)?.region === 'China')
  const place = nc ? nc.finished.indexOf(club) + 1 : 0
  console.log(`  2024：你的俱乐部 ${t.tier === 1 ? '一线' : '二线'} · ${t.league} · 全国大赛第二赛季${nc?.teams.includes(club) ? `打了，第 ${place || '—'} 名` : '没打'}`
    + ` · 中国 Ascension ${asc?.teams.includes(club) ? '有你' : '没有你'}（${asc?.teams.length ?? 0} 队）`)
  if (!nc) { fail('中国二线：2024 年的日历上没有全国大赛第二赛季'); return }
  if (!nc.teams.includes(club)) fail('中国二线：没有联赛席位的中国俱乐部应该能打 2024 年全国大赛')
  if (place >= 1 && place <= 5 && !asc?.teams.includes(club)) fail(`中国二线：全国大赛第 ${place} 名，应该拿到 2024 中国 Ascension 的名额`)
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

if (!only || only === 'seat') seat()
if (!only || only === 'promo') promo()
if (!only || only === 'fold') fold()
function east(): void {
  const t0 = Date.now()
  const surge = eventsOf(2023).filter((e) => e.scene === 'East')
  const seeded = new Set(surge.flatMap((e) => e.seeds))
  const pick = (RAW_2021 as unknown as { teams: { id: string; region: string; roster: string[] }[] }).teams
    .find((t) => t.region === 'CIS' && t.roster.length >= 5 && !seeded.has(t.id.slice(4)))
  if (!pick) { fail('东欧：2021 年的世界里找不到一家 2023 年东欧 Surge 没有的独联体俱乐部'); return }
  const club = pick.id
  const state = createNewGame(club, 'Probe', seed, undefined, 2021)
  setupSeason(state)
  console.log(`\n== 东欧升级杯：执教 ${nameOf(state, club)}（2023 年东欧 Surge 没有它），2023 年起阵容顶满`)
  if (!runTo(state, '东欧升级杯', 2023, 200, club, 2023)) return
  const cup = circuitComps(state).find((c) => /Surge Promotion Cup/.test(eventOf(c.circuit!.id)?.name ?? ''))
  const decider = state.fixtures.find((f) => f.comp === cup?.key && f.label.includes('决胜局') && (f.teamA === club || f.teamB === club))
  const won = !!decider?.result && (decider.result.mapsWonA > decider.result.mapsWonB ? decider.teamA : decider.teamB) === club
  const place = cup ? cup.finished.indexOf(club) + 1 : 0
  console.log(`  2023：你的俱乐部 ${state.teams[club].scene ?? '—'} · 升级杯决胜局${decider ? (won ? '赢了' : '输了') : '没有'}`
    + `${cup?.teams.includes(club) ? `，升级杯第 ${place || '—'} 名` : ''}`)
  if (!cup) { fail('东欧升级杯：2023 年的日历上没有 Surge Promotion Cup'); return }
  if (!decider) fail('东欧升级杯：没有席位的东欧俱乐部应该被安排和外来队伍打一场决胜局')
  if (won && !cup.teams.includes(club)) fail('东欧升级杯：赢了决胜局，却没有打升级杯')
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

/** oq: see the top of the file. His teammates are made the best in the world, not him: a man rated 96 is bought by a partner before November. */
function oq(): void {
  const t0 = Date.now()
  const state = createCareer({
    name: 'Probe', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed, year: 2026,
  })
  const club = state.myTeam
  console.log(`\n== 公开资格赛：2026 入口，${nameOf(state, club)}（${state.teams[club]?.tier === 1 ? '一线' : '二线'}），队友顶满`)
  const mates = () => {
    const t = state.teams[club]
    if (!t) return
    const rng = new Rng(hashStr(`probe:${state.year}:${state.day}`))
    const free = Object.values(state.players).filter((p) => !p.teamId && !p.retiring && p.id !== state.me?.id).sort((a, b) => b.overall - a.overall)
    while (t.roster.length < 6 && free.length) signForHistory(state, free.shift()!, t, state.year, rng)
    for (const pid of t.roster) {
      const p = state.players[pid]
      if (!p || pid === state.me?.id) continue
      for (const k of ATTR_KEYS) p.attrs[k] = 96
      recomputeOverall(p)
      p.form = 95
      p.morale = 95
      p.fatigue = 0
      p.injuredUntil = 0
      p.retiring = false
      p.contractYears = Math.max(p.contractYears, 3)
      refreshValue(p)
    }
  }
  let moved = false
  const run = (year: number, day: number): boolean => {
    let guard = 0
    try {
      while ((state.year < year || (state.year === year && state.day < day)) && !state.gameOver && guard++ < 120) {
        mates()
        autoWeek(state)
      }
    } catch (e) {
      fail(`公开资格赛：${state.year} 年第 ${state.day} 天崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 5).join(' | ')}`)
      return false
    }
    // the probe follows the club: he may be bought away, and the club goes on without him
    if (state.myTeam !== club && !moved) {
      moved = true
      console.log(`  （他在 ${state.year} 年第 ${state.day} 天前离开了 ${nameOf(state, club)}，去了 ${nameOf(state, state.myTeam)}；接着看这家俱乐部）`)
    }
    return true
  }
  if (!run(2026, 320)) return
  const q = state.comps['ev:F2026:oq0:eu']
  const decider = state.fixtures.find((f) => f.comp === q?.key && f.label.includes('决胜局'))
  const place = q ? q.finished.indexOf(club) + 1 : 0
  console.log(`  2026 年 11 月欧洲公开资格赛：${q?.teams.includes(club) ? `参赛${decider ? '（先打了报名决胜局）' : ''}，第 ${place || '—'} 名` : '没有参赛'} · 冠军 ${nameOf(state, q?.champion)}`)
  if (!q?.teams.includes(club)) { fail('公开资格赛：没有联赛席位的欧洲俱乐部应该能打 11 月的欧洲公开资格赛'); return }
  if (!place || place > 2) { fail(`公开资格赛：顶满的阵容在欧洲公开资格赛只拿到第 ${place || '—'} 名`); return }
  if (!run(2027, 50)) return
  const qualified = state.vct?.now?.qualified?.EMEA ?? []
  const kickoff = state.comps['ev:F2027:kickoff:EMEA']
  const lost = state.news.find((n) => n.text.includes('冬窗换人太多') && n.text.includes(nameOf(state, club)))
  console.log(`  2027 EMEA 揭幕赛公开资格赛出线：${qualified.map((id) => nameOf(state, id)).join('、')}`
    + ` · ${nameOf(state, club)} ${kickoff?.teams.includes(club) ? `打了揭幕赛，第 ${kickoff.finished.indexOf(club) + 1 || '—'} 名` : '没打揭幕赛'}${lost ? `（${lost.text}）` : ''}`
    + ` · ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  if (!lost && !qualified.includes(club)) fail('公开资格赛：拿到欧洲前两名，却没有带进 2027 揭幕赛')
  if (qualified.includes(club) && !kickoff?.teams.includes(club)) fail('公开资格赛：出线了，却没打 2027 EMEA 揭幕赛')
}

/** end: the world line stops when the 2034 season is over, whatever the career is doing. */
function end(): void {
  const state = createCareer({
    name: 'Probe', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed, year: 2021,
  })
  state.year = 2035
  retirementTick(state, new Rng(1))
  console.log(`\n== 世界线终点：2034 赛季结束后 → ${state.me!.phase === 'retired' ? `生涯结束（${state.gameOver}）` : `还在继续（${state.me!.phase}）`}`)
  if (state.me!.phase !== 'retired') fail('世界线终点：2034 赛季结束后生涯应该结束')
}

if (!only || only === 'china') china()
if (!only || only === 'east') east()
if (!only || only === 'end') end()
if (!only || only === 'oq') oq()
console.log(bad ? `\n✗ ${bad} 项不对。` : '\n✓ 方案 C 的席位拿到、占住、带进 2026；没有席位的俱乐部赢下决胜局就打进了联赛；真实历史里解散的俱乐部提前通知、按时解散，你成了自由人；中国二线打全国大赛进 Ascension；东欧升级杯给外来队伍的名额可以去争；2027 起没有席位的俱乐部从 11 月的公开资格赛打进揭幕赛。')
process.exit(bad ? 1 : 0)
