import { Rng, clamp, hashStr } from './rng'
import {
  activePool, applyMatchStats, poolFor, poolPhaseOf, pruneMatchDetail, simulateMatch, stripRoundLogs,
} from './match'
import type { MatchResult } from './types'
import {
  CHAMP_POINTS, advanceBracket, applyResultToStandings, makeFixture, newStandings,
  resetFixtureSeq, scheduleRegularSeason, sortStandings, startBracket, respaceRounds, groupTable, scheduleGroupSeason
} from './league'
import { awardPrize, sponsorWorth, weeklyBudgets } from './budget'
import { mapCn } from './content'
import { FAM_MATCH, FAM_SCRIM, learnComp } from './comp'
import { CHAMPIONS, MASTERS_1, MASTERS_2 } from './endings'
import { hostCity } from './hosts'
import { applyMatchBonds } from './bonds'
import { titleLoyalty } from './attachment'
import { applyMatchFatigue, seasonRollover, weeklyTick } from './training'
import { deskOf } from './desk'
import type { ContractsRun, StayApproach } from './desk'
import { autoStarters, ensureCaller } from './world'
import { CHAMPIONS_2025, drawRules } from './ruleset'
import {
  createPlayoffPick, drawChampionsGroups, drawChampionsPlayoffs, drawKickoffBracket, drawStageGroups,
  drawStageReshuffle, drawSwissRound, drawsOf, needsManager, nextPendingDraw, resetDrawSeq, resolvePicks, revealAll,
} from './draw'
import type { DrawEvent } from './draw'
import { importBlock } from './imports'
import { contractLength, expectedSalary } from './player'
import { REGIONS } from './types'
import { circuitPointsFor, formatOf, onTimeline, stageAtIn, stageNameIn } from './era'
import { bookAheadEvents, circuitAward, circuitBonus, eventsOf, progressCircuit, setupCircuitSeason } from './circuit'
import { announceLeagues, keepScore, turnLeagues } from './leagues'
import { bookCovers, historyFolds, isTimelineWorld, lastYearOf, reachOf, syncYear } from './timeline'
import { historyNames } from './names'
import { arrive2026 } from './today'
import type { Competition, Fixture, GameState, Player, Region, StageKey, Team, Tier } from './types'
import {
  DOUBLE_8, GROUPS, advanceTemplate, championsGroups, championsSeeds, decided, doubleFor,
  mastersSeeds, swissDone, swissNext, swissOutcome, templateDone, MASTERS_8, TRIPLE_12, TRIPLE_12_PLACES, STAGE_8, STAGE_8_PLACES, swissRoundOf, SWISS_ROUNDS, swissRecord
} from './bracket'

/**
 * The year, in days.
 *
 * The calendar ran 336 days with one stage hard against the next: Kickoff's
 * final on a Sunday, the Masters draw on Tuesday, Stage 1 opening the day
 * after the Masters final. A manager wrote that it was 「拥挤」 — no time to
 * do business between competitions — and the sport itself does not play
 * like that. So the year is the whole year now, and the stages are shaped
 * like the real ones: a league plays twice a week for five weeks, then a
 * fortnight of playoffs, then three to four weeks off before the Masters,
 * with the market open through the break that leads into it — and three
 * weeks off after the Masters before the next league starts (see
 * LEAGUE_DAYS, and keepBreaks for the rule that holds it whatever happens).
 */
export const SEASON_DAYS = 364

/**
 * The days each regional regular season is spread over.
 *
 * A Masters ends on day 92 and Masters II on 200 (Swiss round on the
 * INTERNATIONAL_OPEN day, playoffs eight days later, a round every two
 * days), so the leagues after them open on 112 and 220: twenty days off,
 * about what the real circuit gives. Stage 1 used to open on 100 — eight
 * days after the Masters final — and, before the year was the whole year,
 * on 89, the day after it.
 */
export const LEAGUE_DAYS: Record<'kickoff' | 'stage1' | 'stage2' | 'challengers1' | 'challengers2', [number, number]> = {
  kickoff: [24, 38],
  stage1: [112, 147],
  stage2: [220, 255],
  challengers1: [28, 112],
  challengers2: [216, 256],
}

/** Days between an international's last match and the next league's first. */
export const BREAK_AFTER_INTERNATIONAL = 14

/*
 * The calendar lives in era.ts, keyed on the year: 2021 ran three stages of
 * open qualifiers, 2022 two, and 2023 onward the shape that used to sit here.
 * Those numbers moved across unchanged, so an existing save keeps its dates.
 */

/**
 * The earliest day each international opens on — the Swiss round of a
 * Masters, the groups of Champions. Each sits about a fortnight into its
 * stage, so the stage begins with a break. The playoffs of a Masters start
 * eight days after its Swiss round.
 */
export const INTERNATIONAL_OPEN: Record<'masters1' | 'masters2' | 'champions', number> = {
  masters1: 76, masters2: 184, champions: 296,
}

/** Display a day index as an in-fiction date. */
export function dateLabel(state: GameState): string {
  const d = new Date(Date.UTC(state.year, 0, 1))
  d.setUTCDate(d.getUTCDate() + state.day)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}

export const compKey = (stage: string, region?: Region) => (region ? `${stage}:${region}` : stage)

function makeComp(
  state: GameState, stage: StageKey, name: string, teams: string[],
  region?: Region, tier?: Tier,
): Competition {
  const comp: Competition = {
    key: compKey(stage, region),
    name,
    region,
    tier,
    stage,
    teams,
    standings: newStandings(teams),
    finished: [],
  }
  state.comps[comp.key] = comp
  return comp
}

// a club history closed (engine/timeline.ts) keeps its record and plays nothing
const tier1Of = (state: GameState, region: Region) =>
  Object.values(state.teams)
    .filter((t) => t.region === region && t.tier === 1 && !t.dormant)
    .sort((a, b) => b.rating - a.rating)
    .map((t) => t.id)

const tier2Of = (state: GameState, region: Region) =>
  Object.values(state.teams)
    .filter((t) => t.region === region && t.tier === 2 && !t.dormant)
    .sort((a, b) => b.rating - a.rating)
    .map((t) => t.id)

/** Build every fixture that can be known before a ball is thrown. */
export function setupSeason(state: GameState, notes?: string[]): void {
  // a manager's save: his contract for the new season (engine/desk.ts)
  deskOf(state)?.seasonSetup(state, notes)
  resetFixtureSeq(0)
  state.fixtures = []
  state.comps = {}
  // a world that entered in 2021: the season that really happened, event by event,
  // and past the last real one the same calendar again (engine/circuit.ts projectedOf)
  if (isTimelineWorld(state) && eventsOf(state.year).length) {
    setupCircuitSeason(state)
    return
  }
  const rng = new Rng(hashStr(`season:${state.seed}:${state.year}`))
  resetDrawSeq(0)

  for (const region of REGIONS) {
    const t1 = tier1Of(state, region)
    const t2 = tier2Of(state, region)

    // ---- vct-2026: Kickoff drawn as a twelve-team triple elimination; the
    // two stages are shells until their groups are drawn (see openStage1Draw)
    if (drawRules(state) && t1.length === 12) {
      const kc = makeComp(state, 'kickoff', `${region} Kickoff`, t1, region, 1)
      openKickoffDraw(state, kc, false)
      const s1 = makeComp(state, 'stage1', `VCT ${region} · Stage 1`, t1, region, 1)
      s1.grouped = true
      const s2 = makeComp(state, 'stage2', `VCT ${region} · Stage 2`, t1, region, 1)
      s2.grouped = true
      if (t2.length >= 2) {
        const c1 = makeComp(state, 'challengers1', `Challengers ${region} · 第一赛段`, t2, region, 2)
        state.fixtures.push(...scheduleRegularSeason(c1, 'challengers1', ...LEAGUE_DAYS.challengers1, 3, rng, '常规赛'))
        const c2 = makeComp(state, 'challengers2', `Challengers ${region} · 第二赛段`, t2, region, 2)
        state.fixtures.push(...scheduleRegularSeason(c2, 'challengers2', ...LEAGUE_DAYS.challengers2, 3, rng, '常规赛'))
      }
      continue
    }

    // ---- Kickoff: a short group phase, then a top-four knockout.
    // A bare bracket meant the very first fixture of a career was a
    // quarter-final against a club you had never played, and the standings
    // stayed empty all the way through because knockouts do not build a table.
    const kc = makeComp(state, 'kickoff', `${region} Kickoff`, t1, region, 1)
    state.fixtures.push(...scheduleRegularSeason(kc, 'kickoff', ...LEAGUE_DAYS.kickoff, 3, rng, '小组赛', 5))

    // ---- Stage 1 & Stage 2: full round robin, playoffs seeded from the table
    const s1 = makeComp(state, 'stage1', `VCT ${region} · Stage 1`, t1, region, 1)
    state.fixtures.push(...scheduleRegularSeason(s1, 'stage1', ...LEAGUE_DAYS.stage1, 3, rng))

    const s2 = makeComp(state, 'stage2', `VCT ${region} · Stage 2`, t1, region, 1)
    state.fixtures.push(...scheduleRegularSeason(s2, 'stage2', ...LEAGUE_DAYS.stage2, 3, rng))

    // ---- Challengers: two splits, running alongside the tier-1 calendar
    // even a two-club Challengers league is playable now that small leagues cycle
    if (t2.length >= 2) {
      const c1 = makeComp(state, 'challengers1', `Challengers ${region} · 第一赛段`, t2, region, 2)
      state.fixtures.push(...scheduleRegularSeason(c1, 'challengers1', ...LEAGUE_DAYS.challengers1, 3, rng, '常规赛'))

      const c2 = makeComp(state, 'challengers2', `Challengers ${region} · 第二赛段`, t2, region, 2)
      state.fixtures.push(...scheduleRegularSeason(c2, 'challengers2', ...LEAGUE_DAYS.challengers2, 3, rng, '常规赛'))
    }
  }
}

export const PLAYOFF_CUT: Partial<Record<StageKey, number>> = {
  kickoff: 4, stage1: 8, stage2: 8, challengers1: 4, challengers2: 4,
}

/** Days between two waves of a bracket, and before the first. */
const WAVE_GAP = 2

const byPoints = (state: GameState) => (x: string, y: string) =>
  (state.teams[y]?.champPoints ?? 0) - (state.teams[x]?.champPoints ?? 0)
  || (state.teams[y]?.rating ?? 0) - (state.teams[x]?.rating ?? 0)

/**
 * A Masters' twelve: each region's top three from the feeder stage. The four
 * winners wait in the playoffs; the four seconds and four thirds play the
 * Swiss, seeded so that round one crosses a second with a third.
 */
export function mastersField(state: GameState, feeder: StageKey): { byes: string[]; swiss: string[] } {
  const byes: string[] = []
  const seconds: string[] = []
  const thirds: string[] = []
  for (const region of REGIONS) {
    const comp = state.comps[compKey(feeder, region)]
    if (!comp?.finished.length) continue
    const [a, b, c] = comp.finished
    if (a) byes.push(a)
    if (b) seconds.push(b)
    if (c) thirds.push(c)
  }
  const cmp = byPoints(state)
  return { byes: byes.sort(cmp), swiss: [...seconds.sort(cmp), ...thirds.sort(cmp)] }
}

/**
 * Champions' sixteen, per region and best first: the Stage 2 playoff's top
 * two go straight in, then the two highest on the season's points among the
 * rest. Callable before Stage 2 ends — the qualification panel asks it who
 * is on course.
 */
export function championsField(state: GameState): Record<Region, string[]> {
  const out = {} as Record<Region, string[]>
  for (const region of REGIONS) {
    const s2 = state.comps[compKey('stage2', region)]
    const direct = (s2?.finished ?? []).slice(0, 2)
    const rest = Object.values(state.teams)
      .filter((t) => t.region === region && t.tier === 1 && !direct.includes(t.id))
      .map((t) => t.id)
      .sort(byPoints(state))
      .slice(0, 2)
    out[region] = [...direct, ...rest]
  }
  return out
}

/** A Masters, opened on its Swiss round. */
function createMasters(state: GameState, stage: StageKey, name: string, feeder: StageKey, day: number): void {
  if (state.comps[stage]) return
  const { byes, swiss } = mastersField(state, feeder)
  if (byes.length + swiss.length < 8) return
  const comp = makeComp(state, stage, name, [...byes, ...swiss])
  comp.format = 'masters'
  comp.byes = byes
  comp.swissSeeds = swiss
  comp.city = hostCity(state, stage as 'masters1' | 'masters2')
  comp.plannedStart = day
  if (drawRules(state)) openSwissDraw(state, comp, day, false)
  else state.fixtures.push(...swissNext(state, comp, swiss, day))
  state.news.push({
    day: state.day, kind: 'league', important: true,
    text: `${name}（${comp.city}）参赛名单出炉：${byes.map((t) => state.teams[t]?.name).join('、')} 作为赛区冠军直接进入季后赛；`
      + `${swiss.map((t) => state.teams[t]?.name).join('、')} 先打瑞士轮。`,
  })
}

/** Champions, opened on its four groups — one team from each region in
 *  each, seed levels spread so no group holds two regional winners. */
function createChampions(state: GameState, name: string, day: number): void {
  if (state.comps.champions) return
  const field = championsField(state)
  const groups = GROUPS.map((_, i) =>
    REGIONS.map((r, j) => field[r][(i + j) % 4]).filter((t): t is string => !!t))
  const all = groups.flat()
  if (all.length < 8) return
  const comp = makeComp(state, 'champions', name, all)
  comp.format = 'champions'
  comp.city = hostCity(state, 'champions')
  comp.plannedStart = day
  if (drawRules(state) && all.length === 16) {
    // four pots — the four regions' first seeds, seconds, first and second
    // points qualifiers — drawn into A–D with one side per region per group;
    // held first, the groups and their ties written when it is finished
    const pots = [0, 1, 2, 3].map((k) => REGIONS.map((r) => field[r][k]).filter((t): t is string => !!t))
    comp.seedPots = pots
    holdDraw(state, drawChampionsGroups(state, comp, pots, day), false)
    state.news.push({
      day: state.day, kind: 'league', important: true,
      text: `${name}（${comp.city}）参赛名单出炉，分组抽签待举行：${all.map((t) => state.teams[t]?.tag).join('、')}。`,
    })
    return
  }
  comp.groups = groups
  state.fixtures.push(...advanceTemplate(state, comp, championsGroups(), null, all, day, 3, 0))
  state.news.push({
    day: state.day, kind: 'league', important: true,
    text: `${name}（${comp.city}）分组出炉：`
      + groups.map((g, i) => `${GROUPS[i]}组 ${g.map((t) => state.teams[t]?.name).join('、')}`).join('；') + '。',
  })
}

/**
 * Hand out the prizes when a competition ends: the prize money into each
 * club's budget, the championship points, the champion's news and the title
 * on every winner's record. A world title for our club paints a target on it.
 * A manager's desk then books the prize, hears from the board and pays the
 * sponsors' bonuses (engine/desk.ts).
 */
export function settleCompetition(state: GameState, comp: Competition, notes: string[] = []): void {
  if (comp.awarded || !comp.champion) return
  comp.awarded = true

  awardPrize(state, comp.stage, comp.finished)

  // a real event pays what it really paid, and joint places were paid alike
  if (comp.format === 'circuit' || formatOf(state.year) === 'open') {
    comp.finished.forEach((teamId, i) => {
      const t = state.teams[teamId]
      const place = comp.places?.[i] ?? i + 1
      // the event's own prize table where Liquipedia has it; Riot's 2021 chart for the open era otherwise
      const v = (comp.format === 'circuit' ? circuitAward(comp, place) : null)
        ?? (state.year <= 2022 ? circuitPointsFor(comp.stage, place) : 0)
      if (t && v) t.champPoints += v
    })
  }
  // and from 2024, what its matches, groups and byes paid on top
  if (comp.format === 'circuit') {
    for (const [teamId, v] of circuitBonus(state, comp)) {
      const t = state.teams[teamId]
      if (t) t.champPoints += v
    }
  }
  const pts = comp.format === 'circuit' || formatOf(state.year) === 'open' ? undefined : CHAMP_POINTS[comp.stage]
  if (pts) {
    comp.finished.forEach((teamId, i) => {
      const t = state.teams[teamId]
      if (t && pts[i]) t.champPoints += pts[i]
    })
  }

  const champ = state.teams[comp.champion]
  state.news.push({
    day: state.day, kind: 'league', important: true,
    text: `🏆 ${champ?.name} 夺得 ${comp.name} 冠军！`,
  })
  // every man on the winning roster carries this title from now on — the
  // farewell card reads it, and it is entirely a thing that happened here
  for (const pid of champ?.roster ?? []) {
    const winner = state.players[pid]
    if (!winner) continue
    winner.titles ??= []
    winner.titles.push({ year: state.year, title: comp.name })
    if (winner.titles.length > 40) winner.titles.splice(0, winner.titles.length - 40)
  }

  // Everyone who was in the room when it was won, at whichever club won it —
  // a trophy is the shared history that loyalty is made of, and the AI's
  // champions get to keep their core for the same reason ours do.
  if (comp.champion) titleLoyalty(state, comp.champion, !comp.region)

  if (comp.champion === state.myTeam) {
    // A world title paints a target on the club. The league answers: harder
    // training and hungrier recruitment everywhere else, so the second trophy
    // has to be earned against a better world than the first.
    if (!comp.region) {
      state.rivalry = (state.rivalry ?? 0) + 1
      state.news.push({
        day: state.day, kind: 'league', important: true,
        text: `🔥 ${champ?.name} 的 ${comp.name} 冠军震动了各赛区——多家俱乐部宣布加练备战，休赛期引援预计更加激进。`,
      })
    }
    notes.push(`🏆 我们夺得 ${comp.name} 冠军！`)
  }
  // a manager's save: the prize in his books, the board, his name, the sponsors' bonuses
  deskOf(state)?.competitionSettled(state, comp, notes)
}

// ---------------------------------------------------------------- vct-2026 draws

/**
 * A draw is held, then its ties are written.
 *
 * The event is created with its outcome locked the moment the field is
 * known — but nothing goes into the fixture list until the draw is
 * finished: watched to the last ball, skipped, or (the pick) chosen. Until
 * then the schedule shows the round as 待定 vs 待定 and, if the draw is the
 * manager's to hold, the clock waits for it: advanceDay hands back
 * `pendingDraw` and the screen opens the ceremony, to be drawn ball by
 * ball or skipped. A draw that is not his — another region's league, an
 * international he is not in — is finished at once, in the background,
 * and the news carries the result.
 */
function holdDraw(state: GameState, ev: DrawEvent, auto: boolean): void {
  if (!auto && needsManager(state, ev)) {
    state.pendingDrawId ??= ev.id
    return
  }
  finishDraw(state, ev, true)
}

/**
 * Finish a draw: every ball out, the ties written for its play day, the
 * clock released. For the pick, the AI's choices are made and the
 * manager's own is waited for unless `auto` hands it to the coaches.
 * Returns false while the pick still waits on him.
 */
export function finishDraw(state: GameState, ev: DrawEvent, auto = false): boolean {
  const comp = state.comps[ev.competitionKey]
  if (!comp) return false
  if (ev.kind === 'masters-playoff-pick' && ev.status !== 'complete') {
    if (!resolvePicks(state, ev, comp, auto)) {
      state.pendingDrawId = ev.id
      return false
    }
  }
  revealAll(ev)
  consumeDraw(state, comp, ev)
  if (state.pendingDrawId === ev.id) state.pendingDrawId = nextPendingDraw(state)
  return true
}

/** The kept-for-compatibility name: the pick the manager was asked for. */
export function settlePendingPick(state: GameState, auto = false): void {
  const ev = (state.draws ?? []).find((d) => d.kind === 'masters-playoff-pick' && !d.consumed)
  if (ev) finishDraw(state, ev, auto)
}

/** Write a finished draw's ties into the competition. */
function consumeDraw(state: GameState, comp: Competition, ev: DrawEvent): void {
  if (ev.consumed) return
  const mine = (ids: string[]) => ids.includes(state.myTeam)
  switch (ev.kind) {
    case 'kickoff-bracket': {
      comp.seeds = ev.outcome.seeds
      comp.byes = ev.pots[1]?.teams.slice()
      comp.bracketStarted = true
      state.fixtures.push(...advanceTemplate(state, comp, TRIPLE_12, TRIPLE_12_PLACES, comp.seeds ?? [], ev.playDay, 3))
      state.news.push({
        day: state.day, kind: 'league', important: mine(comp.teams),
        text: `${comp.name} 抽签完成：${(comp.byes ?? []).map((t) => state.teams[t]?.name).join('、')} 轮空至胜者组第二轮，其余八队抽入首轮。`,
      })
      break
    }
    case 'stage1-groups':
    case 'stage2-reshuffle': {
      const groups = ev.outcome.groups ?? []
      comp.groups = groups
      comp.groupNames = ['Alpha', 'Omega']
      const stage = comp.stage as 'stage1' | 'stage2'
      const days = LEAGUE_DAYS[stage]
      const rng = new Rng(hashStr(`season:${state.seed}:${state.year}:${comp.key}:groups`))
      groups.forEach((g, i) => {
        state.fixtures.push(...scheduleGroupSeason(comp, g, comp.groupNames![i], stage, days[0], days[1], 3, rng))
      })
      state.news.push({
        day: state.day, kind: 'league', important: mine(comp.teams),
        text: `${comp.name} 分组抽签完成——Alpha：${groups[0]?.map((t) => state.teams[t]?.tag).join('、')}；Omega：${groups[1]?.map((t) => state.teams[t]?.tag).join('、')}。`,
      })
      break
    }
    case 'masters-swiss': {
      const round = Number(ev.phase?.match(/swiss-r(\d)/)?.[1] ?? 1)
      state.fixtures.push(...(ev.outcome.pairs ?? []).map(([a, b]) =>
        makeFixture(ev.playDay, comp.stage, comp.key, a, b, 3, `SW:${round}:瑞士轮 第${round}轮`)))
      state.news.push({
        day: state.day, kind: 'league', important: mine(comp.teams),
        text: `${comp.name} 瑞士轮第 ${round} 轮抽签：${(ev.outcome.pairs ?? []).map(([a, b]) => `${state.teams[a]?.tag} vs ${state.teams[b]?.tag}`).join('，')}。`,
      })
      break
    }
    case 'masters-playoff-pick': {
      comp.seeds = (ev.outcome.pairs ?? []).flat()
      comp.byes = undefined
      comp.bracketStarted = true
      state.fixtures.push(...advanceTemplate(state, comp, MASTERS_8, doubleFor(8).places, comp.seeds, ev.playDay, 3))
      state.news.push({
        day: state.day, kind: 'league', important: mine(comp.seeds),
        text: `${comp.name} 八强对阵确定：${(ev.outcome.pairs ?? []).map(([a, b]) => `${state.teams[a]?.tag} vs ${state.teams[b]?.tag}`).join('，')}。`,
      })
      break
    }
    case 'champions-groups': {
      const groups = ev.outcome.groups ?? []
      comp.groups = groups
      comp.groupNames = ['A', 'B', 'C', 'D']
      comp.teams = groups.flat()
      state.fixtures.push(...advanceTemplate(state, comp, championsGroups(), null, comp.teams, ev.playDay, 3, 0))
      state.news.push({
        day: state.day, kind: 'league', important: true,
        text: `${comp.name}（${comp.city}）分组抽签：`
          + groups.map((g, i) => `${GROUPS[i]}组 ${g.map((t) => state.teams[t]?.name).join('、')}`).join('；') + '。',
      })
      break
    }
    case 'champions-playoffs': {
      comp.seeds = (ev.outcome.pairs ?? []).flat()
      comp.bracketStarted = true
      state.fixtures.push(...advanceTemplate(state, comp, MASTERS_8, doubleFor(8).places, comp.seeds, ev.playDay, 3, championsGroups().length))
      state.news.push({
        day: state.day, kind: 'league', important: mine(comp.seeds),
        text: `${comp.name} 八强抽签：${(ev.outcome.pairs ?? []).map(([a, b]) => `${state.teams[a]?.tag} vs ${state.teams[b]?.tag}`).join('，')}。`,
      })
      break
    }
  }
  ev.consumed = true
}

/**
 * Kickoff's draw: last year's Champions sides sit out the opening round —
 * in a career's first season, the real Champions 2025 field from the
 * records — and the other eight are drawn into the four opening ties.
 */
function openKickoffDraw(state: GameState, comp: Competition, auto: boolean): void {
  const t1 = comp.teams
  const firstYear = !(state.lastChampionsTeams?.length)
  const source = firstYear ? CHAMPIONS_2025 : state.lastChampionsTeams ?? []
  const last = source.filter((id) => t1.includes(id)).slice(0, 4)
  const byRep = t1.slice().sort((a, b) => (state.teams[b]?.reputation ?? 0) - (state.teams[a]?.reputation ?? 0))
  const byes = last.slice()
  for (const id of byRep) if (byes.length < 4 && !byes.includes(id)) byes.push(id)
  const first = t1.filter((id) => !byes.includes(id))
  comp.format = 'triple'
  comp.plannedStart = LEAGUE_DAYS.kickoff[0]
  const ev = drawKickoffBracket(state, comp, byes, first, LEAGUE_DAYS.kickoff[0])
  ev.log.unshift(firstYear ? `轮空位给 2025 Champions 的参赛队：${last.map((t) => state.teams[t]?.tag).join('、')}` : `轮空位给上届 Champions 的参赛队：${last.map((t) => state.teams[t]?.tag).join('、')}`)
  if (last.length < 4) ev.log.unshift(`上届 Champions 只有 ${last.length} 队仍在本赛区，其余轮空位按俱乐部声望补足`)
  holdDraw(state, ev, auto)
}

/** Stage 1's groups, drawn from the Kickoff placings the day it ends. */
function openStage1Draw(state: GameState, region: Region, placings: string[], auto: boolean): void {
  const comp = state.comps[compKey('stage1', region)]
  if (!comp || !comp.grouped || comp.groups || drawsOf(state, comp.key).length) return
  const pots: string[][] = []
  for (let i = 0; i + 1 < placings.length && pots.length < 6; i += 2) pots.push([placings[i], placings[i + 1]])
  comp.seedPots = pots
  comp.plannedStart = LEAGUE_DAYS.stage1[0]
  holdDraw(state, drawStageGroups(state, comp, pots, LEAGUE_DAYS.stage1[0]), auto)
}

/** Stage 2's groups: Stage 1's reshuffled by the three swap pools. */
function openStage2Draw(state: GameState, s1: Competition, auto: boolean): void {
  if (!s1.region || !s1.groups) return
  const comp = state.comps[compKey('stage2', s1.region)]
  if (!comp || !comp.grouped || comp.groups || drawsOf(state, comp.key).length) return
  const alpha = groupTable(s1, s1.groups[0])
  const omega = groupTable(s1, s1.groups[1])
  comp.seedPots = [[...alpha.slice(0, 2), ...omega.slice(0, 2)], [...alpha.slice(2, 4), ...omega.slice(2, 4)], [...alpha.slice(4, 6), ...omega.slice(4, 6)]]
  comp.plannedStart = LEAGUE_DAYS.stage2[0]
  holdDraw(state, drawStageReshuffle(state, comp, alpha, omega, LEAGUE_DAYS.stage2[0]), auto)
}

/**
 * The next Swiss round of a Masters, drawn: round one crosses the second
 * seeds with third seeds of other regions; two and three pair by record,
 * three without a rematch. Nothing is written until the draw is finished.
 */
function openSwissDraw(state: GameState, comp: Competition, day: number, auto: boolean): void {
  const sw = state.fixtures.filter((f) => f.comp === comp.key && f.label.startsWith('SW:'))
  if (sw.some((f) => !f.played)) return
  const round = sw.length ? Math.max(...sw.map(swissRoundOf)) : 0
  if (round >= SWISS_ROUNDS) return
  const swiss = comp.swissSeeds ?? []
  const played = new Set<string>()
  for (const f of sw) { played.add(`${f.teamA}|${f.teamB}`); played.add(`${f.teamB}|${f.teamA}`) }
  let pools: { name: string; teams: string[] }[]
  if (round === 0) {
    pools = [{ name: '二号种子', teams: swiss.slice(0, 4) }, { name: '三号种子', teams: swiss.slice(4) }]
  } else {
    const rec = (id: string) => swissRecord(comp, id)
    const alive = swiss.filter((id) => rec(id).w < 2 && rec(id).l < 2)
    const keys = [...new Set(alive.map((id) => `${rec(id).w}-${rec(id).l}`))].sort()
    pools = keys.map((k) => ({ name: `${k} 池`, teams: alive.filter((id) => `${rec(id).w}-${rec(id).l}` === k) }))
  }
  if (!pools.some((p) => p.teams.length >= 2)) return
  holdDraw(state, drawSwissRound(state, comp, round + 1, pools, played, day), auto)
}

/** Move every running competition forward: RR → playoffs → next bracket wave. */
function progressCompetitions(state: GameState, notes: string[] = [], autoPick = false): void {
  for (const comp of Object.values(state.comps)) {
    if (comp.champion) {
      settleCompetition(state, comp, notes)
      continue
    }
    if (comp.format === 'circuit') {
      if (progressCircuit(state, comp, notes)) concludeStage(state, comp, notes)
      continue
    }
    const own = state.fixtures.filter((f) => f.comp === comp.key)
    const ko = own.filter((f) => f.label.startsWith('KO:'))
    const when = state.day + WAVE_GAP
    // a draw not yet held: its ties are not written, and if it is the
    // manager's the clock is waiting on him
    if (drawsOf(state, comp.key).some((d) => !d.consumed)) continue

    // ---- Masters: the Swiss round, then the eight-team double elimination
    if (comp.format === 'masters') {
      const swiss = comp.swissSeeds ?? []
      if (!comp.bracketStarted && drawRules(state)) {
        if (own.some((f) => f.label.startsWith('SW:') && !f.played)) continue
        if (!swissDone(state, comp, swiss)) { openSwissDraw(state, comp, when, autoPick); continue }
        const { through, out } = swissOutcome(comp, swiss)
        comp.finished = out
        const pick = createPlayoffPick(state, comp, comp.byes ?? [], through, when)
        state.news.push({
          day: state.day, kind: 'league', important: [...(comp.byes ?? []), ...through].includes(state.myTeam),
          text: `${comp.name} 瑞士轮结束，${through.map((t) => state.teams[t]?.name).join('、')} 晋级。四个赛区冠军按抽出的顺序选择八强对手：${pick.pickOrder?.map((t) => state.teams[t]?.tag).join(' → ')}。`,
        })
        holdDraw(state, pick, autoPick)
        continue
      }
      if (!comp.bracketStarted) {
        const more = swissNext(state, comp, swiss, when)
        if (more.length) { state.fixtures.push(...more); continue }
        if (!swissDone(state, comp, swiss)) continue
        const { through, out } = swissOutcome(comp, swiss)
        comp.finished = out
        comp.seeds = mastersSeeds(comp.byes ?? [], through)
        comp.byes = undefined
        comp.bracketStarted = true
        state.fixtures.push(...advanceTemplate(state, comp, DOUBLE_8, doubleFor(8).places, comp.seeds, when, 3))
        state.news.push({
          day: state.day, kind: 'league', important: comp.seeds.includes(state.myTeam),
          text: `${comp.name} 瑞士轮结束，${through.map((t) => state.teams[t]?.name).join('、')} 晋级季后赛。`,
        })
        continue
      }
      if (ko.every((f) => f.played)) {
        state.fixtures.push(...advanceTemplate(state, comp, drawRules(state) ? MASTERS_8 : DOUBLE_8, doubleFor(8).places, comp.seeds ?? [], when, 3))
        if (comp.champion) concludeStage(state, comp, notes)
      }
      continue
    }

    // ---- Kickoff under vct-2026: the triple elimination, wave by wave; the
    // day it ends, the region's Stage 1 groups are drawn from its placings
    if (comp.format === 'triple') {
      if (!comp.seeds?.length) continue   // the draw has not been held
      if (ko.every((f) => f.played)) {
        state.fixtures.push(...advanceTemplate(state, comp, TRIPLE_12, TRIPLE_12_PLACES, comp.seeds, when, 3))
        if (comp.champion) {
          concludeStage(state, comp, notes)
          if (comp.region) openStage1Draw(state, comp.region, comp.finished, autoPick)
        }
      }
      continue
    }

    // ---- Champions: four GSL groups, then the same double elimination
    if (comp.format === 'champions') {
      const all = (comp.groups ?? []).flat()
      const groupsT = championsGroups()
      if (!comp.bracketStarted) {
        const more = advanceTemplate(state, comp, groupsT, null, all, when, 3, 0)
        if (more.length) { state.fixtures.push(...more); continue }
        if (!templateDone(state, comp, groupsT, 0)) continue
        const firsts: string[] = []
        const seconds: string[] = []
        const thirds: string[] = []
        const fourths: string[] = []
        for (const g of GROUPS) {
          const top = decided(state, comp, `${g}组 胜者赛`)
          const dec = decided(state, comp, `${g}组 决胜赛`)
          const low = decided(state, comp, `${g}组 败者赛`)
          if (top) firsts.push(top.w)
          if (dec) { seconds.push(dec.w); thirds.push(dec.l) }
          if (low) fourths.push(low.l)
        }
        comp.finished = [...thirds, ...fourths]
        if (drawRules(state)) {
          // drawn: each group winner against a runner-up from another group,
          // a group's two sides in different halves — held, then written
          const groupOf = (t: string) => (comp.groups ?? []).findIndex((g) => g.includes(t))
          holdDraw(state, drawChampionsPlayoffs(state, comp, firsts, seconds, groupOf, when), autoPick)
          continue
        }
        comp.seeds = championsSeeds(firsts, seconds)
        comp.bracketStarted = true
        state.fixtures.push(...advanceTemplate(state, comp, drawRules(state) ? MASTERS_8 : DOUBLE_8, doubleFor(8).places, comp.seeds, when, 3, groupsT.length))
        state.news.push({
          day: state.day, kind: 'league', important: comp.seeds.includes(state.myTeam),
          text: `${comp.name} 小组赛结束，八强：${comp.seeds.map((t) => state.teams[t]?.name).join('、')}。`,
        })
        continue
      }
      if (ko.every((f) => f.played)) {
        state.fixtures.push(...advanceTemplate(state, comp, drawRules(state) ? MASTERS_8 : DOUBLE_8, doubleFor(8).places, comp.seeds ?? [], when, 3, groupsT.length))
        if (comp.champion) concludeStage(state, comp, notes)
      }
      continue
    }

    // ---- regional: the table, then a bracket
    const rr = own.filter((f) => !f.label.startsWith('KO:'))
    if (!comp.bracketStarted && comp.grouped && comp.groups) {
      if (!rr.length || rr.some((f) => !f.played)) continue
      // eight from the two tables: winners sit out the opening round,
      // seconds and thirds cross groups in it, fourths start in the lower
      const [alpha, omega] = comp.groups.map((g) => groupTable(comp, g))
      const seeds = [alpha[0], omega[0], alpha[1], omega[1], alpha[2], omega[2], alpha[3], omega[3]].filter(Boolean)
      comp.format = 'double'
      comp.seeds = seeds
      comp.bracketStarted = true
      comp.finished = [alpha[4], omega[4], alpha[5], omega[5]].filter(Boolean)
      state.fixtures.push(...advanceTemplate(state, comp, STAGE_8, STAGE_8_PLACES, seeds, when, 3))
      state.news.push({
        day: state.day, kind: 'league',
        text: `${comp.name} 小组赛结束，季后赛八强：${seeds.map((s) => state.teams[s]?.name).join('、')}。`,
        important: seeds.includes(state.myTeam),
      })
      continue
    }
    if (!comp.bracketStarted) {
      if (!rr.length) continue
      if (rr.some((f) => !f.played)) continue
      const cut = PLAYOFF_CUT[comp.stage] ?? 8
      const table = sortStandings(comp)
      // VCT plays its playoffs double elimination — eight from a stage, four
      // from Kickoff. A short league that cannot fill four falls back to the
      // single bracket, as Challengers always does.
      const double = comp.tier === 1 && table.length >= 4
      const size = double ? (Math.min(cut, table.length) >= 8 ? 8 : 4) : Math.min(cut, table.length)
      const seeds = table.slice(0, size)
      // teams that missed the playoffs are already ranked, worst last
      comp.finished = table.slice(seeds.length)
      if (double) {
        comp.format = 'double'
        comp.seeds = seeds
        comp.bracketStarted = true
        const { template, places } = doubleFor(seeds.length)
        state.fixtures.push(...advanceTemplate(state, comp, template, places, seeds, when, 3))
      } else {
        state.fixtures.push(...startBracket(comp, seeds, comp.stage, state.day + 4, 3))
      }
      state.news.push({
        day: state.day, kind: 'league',
        text: `${comp.name} 常规赛结束，季后赛名单：${seeds.map((s) => state.teams[s]?.name).join('、')}。`,
        important: seeds.includes(state.myTeam),
      })
      continue
    }

    if (ko.length && ko.every((f) => f.played)) {
      const next = comp.format === 'double'
        ? (() => {
          const { template, places } = comp.grouped ? { template: STAGE_8, places: STAGE_8_PLACES } : doubleFor((comp.seeds ?? []).length)
          return advanceTemplate(state, comp, template, places, comp.seeds ?? [], when, 3)
        })()
        : advanceBracket(state, comp, state.day + 3, 3)
      state.fixtures.push(...next)
      if (comp.champion) {
        concludeStage(state, comp, notes)
        if (comp.grouped && comp.stage === 'stage1') openStage2Draw(state, comp, autoPick)
      }
    }
  }

  // international events unlock as their feeder stages conclude
  const kickoffDone = REGIONS.every((r) => state.comps[compKey('kickoff', r)]?.champion)
  if (kickoffDone) createMasters(state, 'masters1', MASTERS_1, 'kickoff', Math.max(state.day + 3, INTERNATIONAL_OPEN.masters1))

  const s1Done = REGIONS.every((r) => state.comps[compKey('stage1', r)]?.champion)
  if (s1Done) createMasters(state, 'masters2', MASTERS_2, 'stage1', Math.max(state.day + 3, INTERNATIONAL_OPEN.masters2))

  const s2Done = REGIONS.every((r) => state.comps[compKey('stage2', r)]?.champion)
  if (s2Done) createChampions(state, CHAMPIONS, Math.max(state.day + 4, INTERNATIONAL_OPEN.champions))
}

/**
 * A league does not start on the heels of a Masters.
 *
 * The league's rounds are laid down on fixed days when the season is set
 * up; a Masters is generated round by round as it is played, its Swiss
 * round when every Kickoff has a champion and each later round when the
 * one before is done. Nothing tied the two together. A manager's schedule
 * read 「4/1 Masters I 败者组决赛」 over 「4/1 VCT China · Stage 1 第1轮」:
 * his season had been set up on the old calendar, Stage 1 from day 89,
 * and the Masters bracket had since grown into the shape it has now,
 * ending on 92. Even a new season had only eight days between the two.
 *
 * So, every morning: if a Masters has a match scheduled — played or not —
 * the league that follows it may not open within BREAK_AFTER_INTERNATIONAL
 * days of the latest one, and its unplayed rounds are spread again from
 * that day to the end of the league's window. LEAGUE_DAYS gives twenty
 * days on a season set up today, so this fires only for a season set up
 * before the calendar changed, and it repairs that one on the next 推进.
 */
function keepBreaks(state: GameState): void {
  for (const [intl, next] of [['masters1', 'stage1'], ['masters2', 'stage2']] as const) {
    const days = state.fixtures.filter((f) => f.comp === intl).map((f) => f.day)
    if (!days.length) continue
    const floor = Math.max(...days) + BREAK_AFTER_INTERNATIONAL
    for (const region of REGIONS) {
      const rr = state.fixtures.filter((f) =>
        f.comp === compKey(next, region) && !f.played && !f.label.startsWith('KO:'))
      if (!rr.length || Math.min(...rr.map((f) => f.day)) >= floor) continue
      respaceRounds(rr, floor, Math.max(floor, LEAGUE_DAYS[next][1]))
    }
  }
}

/** A competition has just found its champion: report it, then pay out. */
function concludeStage(state: GameState, comp: Competition, notes: string[]): void {
  settleCompetition(state, comp, notes)
}

/**
 * The five who actually played for this club in this fixture.
 *
 * `starters` is the intention; `result.lineups` is what happened. They differ
 * whenever anyone was injured, and the post-match rewards were reading the
 * intention — which is how a man who never left the physio room banked the
 * win bonus.
 */
function played(
  state: GameState, f: Fixture, teamId: string, result: MatchResult,
): string[] {
  const lineup = teamId === f.teamA ? result.lineups?.a : result.lineups?.b
  return lineup ?? state.teams[teamId]?.starters ?? []
}

export interface DayReport {
  day: number
  stage: StageKey
  stageChanged: boolean
  playedMine: Fixture[]
  notes: string[]
  seasonEnded: boolean
  /** set when the manager's own match was left for them to play */
  pendingMine?: Fixture
  /** a draw is waiting on the manager — to be held, skipped, or picked (vct-2026) */
  pendingDraw?: string
}

export interface AdvanceOpts {
  /** hand the manager's own fixture back unplayed so they can watch it */
  deferMine?: boolean
  /**
   * With deferMine, a second fixture of our own due the same day waits for the
   * next morning instead of being played here without us. The career's day
   * (engine/me/week.ts) hands over one match of mine a day; a side twice on
   * one day — 2021 Japan's round-robin groups — had its second match played
   * by the engine, with the player never in it.
   */
  holdMine?: boolean
  /**
   * Play scrims automatically instead of handing them over.
   *
   * A scrim booked for tomorrow used to halt a week-long turn on its first day,
   * so the rest of the week — and everything scheduled inside it — never ran
   * until the manager clicked through. Practice matches resolve themselves when
   * a turn covers several days; the scoreboard is still there to open.
   */
  autoScrims?: boolean
  /** a Masters pick that falls to the manager is made by the coaches (headless runs) */
  autoResolveDrawDecisions?: boolean
}

/** Each fixture gets its own stream, so a result never depends on play order. */
export const fixtureRng = (state: GameState, f: Fixture) =>
  new Rng(hashStr(`match:${state.seed}:${state.year}:${f.id}`))

export const isScrim = (f: Fixture) => f.comp === 'scrim'

/** Apply a result the UI produced, then move the competition forward. */
/**
 * Record a played fixture.
 *
 * `notes` is the turn's digest when time is being advanced. Playing a match
 * live goes through here too, and finishing one can conclude a competition —
 * prize money, championship points and the board's reaction — so the caller is
 * handed those lines rather than having them vanish.
 */
/**
 * How far a practice match alone can take a map, and how soon it starts to
 * teach less. Comfortable, not mastered.
 */
const SCRIM_MAP_CEIL = 80
const SCRIM_MAP_TAPER = 25

export function commitFixture(
  state: GameState, f: Fixture, result: MatchResult, notes: string[] = [],
): void {
  const isMine = f.teamA === state.myTeam || f.teamB === state.myTeam
  if (!isMine) stripRoundLogs(result)
  f.result = result
  f.played = true
  const rng = fixtureRng(state, f)
  // how the dressing room took it, for our club only
  if (isMine) {
    // This block used to declare its own `notes`, shadowing the digest passed
    // in — so every dressing-room consequence of a defeat went to state.news
    // and nowhere else. Measured from the digest, the game looked as though it
    // had no dressing-room incidents at all; it had them, and never said so.
    const room: string[] = []
    const isA = f.teamA === state.myTeam
    // a level Bo2 is neither a win to trust nor a defeat to fall out over
    if (result.mapsWonA !== result.mapsWonB) {
      // the room's own dice: the fixture's stream goes on to both sides' fatigue
      // and injury rolls, which must not depend on which club is "ours"
      applyMatchBonds(state, result, state.myTeam, isA, new Rng(hashStr(`match:${state.seed}:${state.year}:${f.id}:bonds`)), room)
    }
    // a manager's club: his players' trust in him, and the board's view of the result (engine/desk.ts)
    deskOf(state)?.matchPlayed(state, f, result)
    for (const t of room) {
      state.news.push({ day: state.day, kind: 'club', important: true, text: t })
      notes.push(t)
    }

    // A club too short to field five sends out someone who is not fit. The
    // engine has always done this rather than play 4v5; it never mentioned it.
    const played = (isA ? result.lineups?.a : result.lineups?.b) ?? []
    const hurt = played
      .map((id) => state.players[id])
      .filter((p) => p && p.injuredUntil > state.day)
    for (const p of hurt) {
      notes.push(`⚕️ 人手不够，带伤的 ${p.ign} 还是上了场（${p.injuryNote ?? '伤病'}）。`)
    }
    // Every map played on a sheet is a rehearsal of that sheet. A scrim
    // teaches a little less than a fixture; both teach less than a week of
    // 跑图 on the map. See engine/comp.ts.
    const ours = new Set(played)
    for (const m of result.maps) {
      if (!m.agents) continue
      const sheet = Object.fromEntries(Object.entries(m.agents).filter(([id]) => ours.has(id)))
      if (Object.keys(sheet).length === 5) learnComp(state, m.map, sheet, isScrim(f) ? FAM_SCRIM : FAM_MATCH)
    }
  }
  // scrims build form and cost condition but never enter the record books
  if (isScrim(f)) {
    applyMatchFatigue(state, f.teamA, result.maps.length, rng, notes, result.lineups?.a)
    applyMatchFatigue(state, f.teamB, result.maps.length, rng, notes, result.lineups?.b)
    const aWon = result.mapsWonA > result.mapsWonB
    for (const [teamId, won] of [[f.teamA, aWon], [f.teamB, !aWon]] as [string, boolean][]) {
      // whoever actually played, not whoever was nominally a starter: an
      // injured man collected the win's morale from the treatment table while
      // the substitute who played every map got nothing
      for (const pid of played(state, f, teamId, result)) {
        const p = state.players[pid]
        if (!p) continue
        // losing used to average +0.35 form, so a defeat made a player sharper
        p.form = clamp(p.form + (won ? rng.range(0.4, 2.2) : -rng.range(0.4, 2.2)), 30, 99)
        p.morale = clamp(p.morale + (won ? rng.range(0, 2) : -rng.range(0, 1.5)), 10, 100)
      }
    }
    // Practising a map is the reason a scrim is booked on one, and until now
    // it did nothing for that map at all — the panel said so because it was
    // true. Both sides learn, win or lose, and less than a week of the 跑图
    // drill: that costs a whole team-training slot and gives about +2, this
    // costs a day and a squad's condition.
    const scrimMap = f.scrim?.map
    if (scrimMap) {
      for (const teamId of [f.teamA, f.teamB]) {
        const t = state.teams[teamId]
        if (!t) continue
        const before = t.mapPrefs[scrimMap] ?? 50
        // Diminishing, and that is the whole balance of it. A flat gain let a
        // manager book the same map every free day and reach the 95 ceiling
        // inside one season — measured at 293 scrims and +50 — which would
        // have made the 跑图 drill pointless. Practice matches take a map to
        // comfortable; going past that is what the drill and real fixtures
        // are for.
        const room = clamp((SCRIM_MAP_CEIL - before) / SCRIM_MAP_TAPER, 0, 1)
        t.mapPrefs[scrimMap] = clamp(before + rng.range(0.6, 1.0) * room, 0, 95)
        if (teamId === state.myTeam && Math.round(t.mapPrefs[scrimMap]) > Math.round(before)) {
          notes.push(`🗺 ${mapCn(scrimMap)} 熟练度提升到 ${Math.round(t.mapPrefs[scrimMap])}。`)
        }
      }
    }
    if (isMine) state.lastResults.push(f.id)
    state.news.push({
      day: state.day, kind: 'club',
      text: `训练赛｜${state.teams[f.teamA]?.tag} ${result.mapsWonA}-${result.mapsWonB} ${state.teams[f.teamB]?.tag}`,
    })
    // The pre-match sheet is now shown for scrims too, so a scrim can leave
    // one behind — and a leftover sheet outranks the plan on the 战术 screen
    // for the next real match on that map. It belongs to the game it was
    // made for, scrim or not.
    state.agentPicks = undefined
    return
  }
  applyMatchStats(state, result)
  applyMatchFatigue(state, f.teamA, result.maps.length, rng, notes, result.lineups?.a)
  applyMatchFatigue(state, f.teamB, result.maps.length, rng, notes, result.lineups?.b)

  // A veto and an agent sheet belong to the match they were made for; leaving
  // them behind would silently apply last week's plan to next week's opponent.
  state.vetoPlan = undefined
  state.agentPicks = undefined

  const comp = state.comps[f.comp]
  if (comp && !f.label.startsWith('KO:')) applyResultToStandings(comp, f)

  const aWon = result.mapsWonA > result.mapsWonB
  const drawn = result.mapsWonA === result.mapsWonB
  for (const [teamId, won] of [[f.teamA, aWon], [f.teamB, !aWon]] as [string, boolean][]) {
    for (const pid of played(state, f, teamId, result)) {
      const p = state.players[pid]
      if (p && !drawn) p.morale = clamp(p.morale + (won ? rng.range(1, 5) : -rng.range(1, 5)), 10, 100)
    }
  }

  if (isMine) state.lastResults.push(f.id)

  state.news.push({
    day: state.day,
    kind: 'match',
    // a scoreline is the densest thing in the feed; the tags are what people
    // read anyway, and the competition name already says where it happened
    text: `${comp?.name ?? f.comp}｜${state.teams[f.teamA]?.tag} ${result.mapsWonA}-${result.mapsWonB} ${state.teams[f.teamB]?.tag}`,
    important: isMine,
  })
  progressCompetitions(state, notes)
}

export function advanceDay(state: GameState, opts: AdvanceOpts = {}): DayReport {
  // A career that has ended does not keep going. The sack screen has no close
  // button so a person cannot click past it, but nothing in the engine said so:
  // driven any other way the clock ran on for another season and a half,
  // collecting honours and a promotion for a manager who had been dismissed —
  // and autosaving that state over the record of the career.
  if (state.gameOver) {
    return {
      day: state.day, stage: state.stage, stageChanged: false,
      playedMine: [], notes: [], seasonEnded: false,
    }
  }
  // A manager's save can hold the clock on a question only he can answer —
  // the five-year settlement (engine/board.ts). Without this, one more 推进
  // while the modal is up re-enters endSeason with the ask already marked
  // done, and the off-season runs out from under the verdict being read.
  if (deskOf(state)?.holdsClock(state)) {
    return {
      day: state.day, stage: state.stage, stageChanged: false,
      playedMine: [], notes: [], seasonEnded: false,
    }
  }
  // A draw that is the manager's to hold — reveal or skip, or the pick to
  // make: the clock waits for it, as it does for the five-year verdict —
  // unless a headless run has asked for every draw to be finished for him.
  if (state.pendingDrawId) {
    if (opts.autoResolveDrawDecisions) {
      let guard = 0
      while (state.pendingDrawId && guard++ < 20) {
        const ev = (state.draws ?? []).find((d) => d.id === state.pendingDrawId)
        if (!ev) { state.pendingDrawId = nextPendingDraw(state); continue }
        finishDraw(state, ev, true)
      }
    }
    if (state.pendingDrawId) {
      return {
        day: state.day, stage: state.stage, stageChanged: false,
        playedMine: [], notes: [], seasonEnded: false, pendingDraw: state.pendingDrawId,
      }
    }
  }
  const rng = new Rng(hashStr(`day:${state.seed}:${state.year}:${state.day}`))
  const prevStage = state.stage
  state.day++
  keepBreaks(state)
  // the main caller has to be someone still here; a deputy steps up if not
  ensureCaller(state, state.myTeam)

  const notes: string[] = []
  const playedMine: Fixture[] = []
  state.lastResults = []

  // Going down was announced; coming back never was. A player simply became
  // selectable again at some point and you found out by opening the squad
  // screen — which is precisely the day you would want to change your five.
  for (const pid of state.teams[state.myTeam]?.roster ?? []) {
    const p = state.players[pid]
    if (p && p.injuredUntil === state.day) {
      notes.push(`⚕️ ${p.ign} 已康复，可以重新出场。`)
      p.injuryNote = undefined
    }
  }

  deskOf(state)?.dayOpened(state, notes)

  // a club history let go goes quiet a few weeks after its last event, one at a time (engine/timeline.ts)
  const gone = historyFolds(state)
  if (gone.length) {
    state.news.push({
      day: state.day, kind: 'club',
      text: `🕯️ 宣布解散、不再参赛：${gone.slice(0, 8).join('、')}${gone.length > 8 ? ` 等 ${gone.length} 家` : ''}。`,
    })
  }
  // a club takes the name it really had today: DRX is KIWOOM DRX from 2026-03-19 (engine/names.ts)
  historyNames(state, notes)
  // 2027 on: the day after Champions, next season's leagues are announced (engine/leagues.ts)
  if (onTimeline(state)) {
    bookAheadEvents(state)
    announceLeagues(state, notes)
  }

  state.stage = stageAtIn(state.year, state.day, onTimeline(state))
  const stageChanged = state.stage !== prevStage
  if (stageChanged) {
    notes.push(`—— 进入 ${stageNameIn(state.year, state.stage, onTimeline(state))} ——`)
    // The pool rotates when a new window opens — say which maps moved, or a
    // manager walks into a veto to find a map he trained all stage is gone.
    const prevPool = activePool(state.seed + state.year, poolPhaseOf(prevStage))
    const nowPool = poolFor(state)
    const gone = prevPool.filter((m) => !nowPool.includes(m))
    const fresh = nowPool.filter((m) => !prevPool.includes(m))
    if (gone.length || fresh.length) {
      const line = `🗺️ 图池轮换：${fresh.map(mapCn).join('、')} 加入，${gone.map(mapCn).join('、')} 移出。`
      notes.push(line)
      state.news.push({ day: state.day, kind: 'league', text: line })
    }
    // a manager's save: the board's brief, job offers, the league's capsule (engine/desk.ts)
    deskOf(state)?.stageChanged(state, prevStage, notes)
  }
  deskOf(state)?.dayStarted(state, notes)

  // A club that lost a man yesterday must not walk out four-handed today.
  //
  // This backstop used to run in the weekly block, which is below the fixtures
  // — so a side stripped by a transfer, a retirement or a release played every
  // match until the next Sunday with whoever was left. Reproduced: take two
  // players off a club on day 1 and it fields THREE for six days, and the
  // group chat found it before this did — 「为什么四个人也能开比赛啊」, with a
  // scoreboard showing three.
  //
  // Daily, and before a ball is kicked. It costs a length check per club on
  // the days nothing is wrong, which is almost all of them.
  ensureMinimumRosters(state, rng)

  // ---- play today's matches
  let pendingMine: Fixture | undefined
  // Anything still unplayed from an earlier day is played now, oldest first.
  // The filter used to be an exact `=== state.day`: a match handed to the
  // manager to watch was written to the autosave as unplayed, and if the page
  // vanished before the modal resolved (a phone reclaiming the tab), the day
  // moved on and that fixture was never eligible again — the whole
  // competition sat waiting for a result that could not arrive.
  // A bracket can play two rounds in a day: 2021's Reykjavík opened with an
  // upper first round and an upper quarter-final on the same afternoon, the
  // second fed by the first. A tie written while today's games are being
  // played is today's too, so the list is read again until nothing new is
  // due. The 2026 formats always write their next round days ahead, so for
  // them the second read finds nothing.
  const tried = new Set<string>()
  for (let pass = 0; pass < 6 && !pendingMine; pass++) {
    const today = state.fixtures
      .filter((f) => f.day <= state.day && !f.played && !tried.has(f.id))
      .sort((a, b) => a.day - b.day)
    if (!today.length) break
    for (const f of today) {
      tried.add(f.id)
      const a = state.teams[f.teamA]
      const b = state.teams[f.teamB]
      if (!a || !b) {
        f.played = true
        continue
      }
      const isMine = f.teamA === state.myTeam || f.teamB === state.myTeam
      if (isMine && opts.deferMine && !(opts.autoScrims && isScrim(f))) {
        if (!pendingMine) {
          // leave it for the manager to watch or skip
          pendingMine = f
          continue
        }
        // a second of our own due today: played here without us, unless held for tomorrow
        if (opts.holdMine) continue
      }
      const result = simulateMatch(state, f.teamA, f.teamB, f.bo, fixtureRng(state, f), f.scrim)
      commitFixture(state, f, result, notes)
      if (isMine) playedMine.push(f)
    }
  }

  if (!pendingMine) progressCompetitions(state, notes, !!opts.autoResolveDrawDecisions)

  pruneMatchDetail(state)
  // a manager's save: commercial work, sponsors, the drill, staff and job answers, enquiries, bids (engine/desk.ts)
  const desk = deskOf(state)
  desk?.afterMatches(state, notes)

  // ---- weekly upkeep
  if (state.day % 7 === 0) {
    desk?.weekOpened(state, notes)
    // the managed club's players whose promise of minutes is not being kept, for its desk to hear from
    const grumbling: Player[] = []
    notes.push(...weeklyTick(state, rng, grumbling))
    weeklyBudgets(state)
    desk?.weekTrained(state, grumbling, notes)
    // the manager game's market: the AI clubs' bids and listings, and bids for his own players (engine/desk.ts)
    desk?.weekMarket(state, notes)
  }

  if (state.news.length > 400) state.news.splice(0, state.news.length - 400)

  let seasonEnded = false
  if (state.day >= SEASON_DAYS) {
    notes.push(`—— ${state.year} 赛季结束 ——`)
    endSeason(state, rng, notes)
    seasonEnded = true
  }

  return { day: state.day, stage: state.stage, stageChanged, playedMine, notes, seasonEnded, pendingMine, pendingDraw: state.pendingDrawId }
}

/**
 * Promotion, contracts, ageing, then a fresh calendar.
 *
 * `notes` is the turn's digest. The off-season is the single biggest thing
 * that happens to a squad without the manager doing anything — players age,
 * develop, decline, run down their deals and retire — and all of it used to
 * happen in silence: seasonRollover built its 📈/📉 lines and the return value
 * was dropped on the floor. Everything here that lands on the managed club
 * goes into the digest, so the season turns over in front of you.
 */
/**
 * The farewell itself: keep what is worth remembering, then let him go.
 *
 * The player object is deleted — that part has not changed — but a RetireNote
 * survives him, holding what happened IN THIS SAVE: the clubs he served here
 * (clubHist, resolved to names now, while the teams can still be asked) and
 * the titles he lifted here. Nothing from the real-world record goes into the
 * note — the card is a screenshot waiting to happen, and it must read as the
 * game's own story. `star` marks the ones whose leaving is news to everybody.
 *
 * Returns the one-line form for the league-wide news digest; his own club and
 * the stars still get their own line.
 */
function retirePlayer(state: GameState, p: Player, notes: string[]): string {
  const t = p.teamId ? state.teams[p.teamId] : null
  const mine = p.teamId === state.myTeam
  const star = p.overall >= 80 || (p.career?.mvps ?? 0) >= 8
  if (t) {
    t.roster = t.roster.filter((id) => id !== p.id)
    t.starters = t.starters.filter((id) => id !== p.id)
  }
  state.retireFeed ??= []
  state.retireFeed.push({
    id: p.id, ign: p.ign, age: p.age, year: state.year,
    clubId: p.teamId, clubName: t?.name, overall: p.overall,
    career: { ...p.career }, star,
    stints: (p.clubHist ?? []).map((s) => ({
      team: state.teams[s.team]?.name ?? s.team, from: s.from, to: s.to,
    })),
    titles: [...(p.titles ?? [])],
  })
  if (state.retireFeed.length > 24) state.retireFeed.splice(0, state.retireFeed.length - 24)
  if (mine || star) {
    state.news.push({
      day: state.day, kind: 'player', important: mine,
      text: `👋 ${p.ign} 正式挂上鼠标，结束了他的职业生涯——${p.age} 岁${t ? `，最后一站 ${t.name}` : ''}。`,
    })
  }
  if (mine) notes.push(`👋 ${p.ign} 正式退役，${p.age} 岁。他的告别卡已经备好。`)
  delete state.players[p.id]
  return mine || star ? '' : `${p.ign}（${p.age} 岁${t ? `，${t.tag}` : ''}）`
}

// ---------------------------------------------------------------- the manager game's screens, by name
//
// These are the manager's desk now: the board and the five-year settlement
// (engine/board.ts), job offers (engine/career.ts) and the retirement talk
// (engine/managerDesk.ts). The manager game's screens still import them from
// here by name. A player's career mounts no desk, and there each does nothing.

export type { StayApproach } from './desk'

/** Take a job elsewhere (engine/career.ts). */
export const acceptJob = (state: GameState, offerId: string): string =>
  deskOf(state)?.acceptJob(state, offerId) ?? '这份邀请已经失效。'

/** One conversation, eye to eye, about how a player's story ends (engine/managerDesk.ts). */
export const persuadeStay = (state: GameState, playerId: string, approach: StayApproach = 'heart'): string =>
  deskOf(state)?.persuadeStay(state, playerId, approach) ?? ''

/** The five-year settlement, taken (engine/board.ts). */
export const settleAtFive = (state: GameState): void => { deskOf(state)?.settleAtFive(state) }

/** The five-year settlement, declined (engine/board.ts). */
export const continuePastFive = (state: GameState): void => { deskOf(state)?.continuePastFive(state) }

/** What takes the board's warning off (engine/board.ts). */
export const noticeHint = (state: GameState): string => deskOf(state)?.noticeHint(state) ?? ''

function endSeason(state: GameState, rng: Rng, notes: string[] = []): void {
  // A manager's season can stop here, before a line of the off-season runs:
  // the five-year settlement asked, or the tenure over (engine/board.ts). The
  // verdict must judge the squad that played the season, not the one the
  // winter is about to dissolve.
  if (deskOf(state)?.seasonEnding(state, notes)) return

  // ---- Ascension: each region's Challengers champion swaps with the weakest tier-1 side
  for (const region of REGIONS) {
    const chal = state.comps[compKey('challengers2', region)]
    const promoted = chal?.champion ? state.teams[chal.champion] : null
    if (!promoted) continue
    const relegated = Object.values(state.teams)
      .filter((t) => t.region === region && t.tier === 1)
      .sort((a, b) => a.champPoints - b.champPoints || a.rating - b.rating)[0]
    if (!relegated || relegated.id === promoted.id) continue

    promoted.tier = 1
    promoted.league = `VCT ${region}`
    relegated.tier = 2
    relegated.league = `Challengers ${region}`

    // Sponsorship follows the league you play in. Without this a promoted club
    // kept its Challengers deals and picked up VCT running costs the same
    // week — M80 went up and was insolvent two seasons later no matter what
    // the manager did. Going up is a windfall and coming down is a cliff, and
    // both are things a manager should be told rather than discover.
    const reprice = (t: Team, factor: number) => {
      for (const sp of t.sponsors) {
        sp.perSeason = Math.round(sp.perSeason * factor)
        sp.bonus = Math.round(sp.bonus * factor)
      }
    }
    // Priced off what a sponsorship in each league is actually worth rather
    // than a flat guess. A flat 2.5x left promoted clubs structurally
    // insolvent — around $700k of sponsorship against $926k of VCT running
    // costs before a single wage — and 25 of 36 AI promotions measured over
    // four seasons ended up in the red and out of the transfer market.
    const step = sponsorWorth({ ...promoted, tier: 1 } as Team) /
      Math.max(1, sponsorWorth({ ...promoted, tier: 2 } as Team))
    reprice(promoted, step)
    reprice(relegated, 1 / step)
    deskOf(state)?.ascension(state, promoted, relegated, notes)
    state.news.push({
      day: state.day, kind: 'league', important: true,
      text: `🎫 ${promoted.name} 通过 Ascension 升入 VCT ${region}，${relegated.name} 降入次级联赛。`,
    })
    if (promoted.id === state.myTeam) notes.push(`🎫 我们通过 Ascension 升入 VCT ${region}。`)
    if (relegated.id === state.myTeam) notes.push(`🎫 我们降入 Challengers ${region}。`)
  }

  // ---- contracts tick down; expiring players leave
  const run: ContractsRun = { finalYear: [], expiring: [], walked: [] }
  const released: string[] = []
  for (const p of Object.values(state.players)) {
    if (!p.teamId) continue
    const mine = p.teamId === state.myTeam
    p.contractYears -= 1
    if (mine && p.contractYears === 1) run.finalYear.push(p.ign)
    if (p.contractYears <= 0) {
      const team = state.teams[p.teamId]
      // clubs usually renew players they still rate
      const keep = p.overall >= (team?.rating ?? 60) - 6 && rng.chance(0.72)
      if (keep && team && team.id !== state.myTeam) {
        p.contractYears = contractLength(p, rng, team.roster.map((id) => state.players[id]))
      } else if (team && team.id === state.myTeam) {
        // One winter of grace, then he actually goes. It used to be an
        // unlimited stay: he simply drew wages forever on a contract that had
        // run out.
        if (p.expiredYear != null && p.expiredYear < state.year) {
          team.roster = team.roster.filter((id) => id !== p.id)
          team.starters = team.starters.filter((id) => id !== p.id)
          p.teamId = null
          p.expiredYear = undefined
          run.walked.push(p)
        } else {
          p.expiredYear ??= state.year
          p.contractYears = 0
          run.expiring.push(p)
        }
      } else if (team) {
        team.roster = team.roster.filter((id) => id !== p.id)
        team.starters = team.starters.filter((id) => id !== p.id)
        p.teamId = null
        // one batched line, not one per man: a winter shakes dozens loose
        released.push(`${p.ign}（${team.tag}）`)
      }
    }
  }

  if (released.length) {
    state.news.push({
      day: state.day, kind: 'transfer',
      text: `合同到期成为自由人：${released.slice(0, 8).join('、')}`
        + (released.length > 8 ? ` 等 ${released.length} 人` : '') + '。',
    })
  }

  const desk = deskOf(state)
  // a manager's club: the deals running down and the men out of contract (engine/desk.ts)
  desk?.contractsRun(state, run, notes)
  // and, judged on the season that just ended, the sponsors' clauses and the league's bundle money
  desk?.seasonClosing(state, notes)
  // a new intake arrives, so a career that runs long still has somebody to
  // sign and somebody to develop
  notes.push(...seasonRollover(state, rng))

  // ---- the in-save CV: the season just played goes on every man's record
  // before anyone leaves. Year granularity; doTransfer opens mid-season lines.
  for (const p of Object.values(state.players)) {
    if (!p.teamId) continue
    p.clubHist ??= []
    const last = p.clubHist[p.clubHist.length - 1]
    if (last && last.team === p.teamId) last.to = state.year
    else p.clubHist.push({ team: p.teamId, from: state.year, to: state.year })
  }

  // ---- retirements: a year's notice, then the farewell.
  //
  // Retiring used to be a deletion — the group chat's knight signed a
  // four-year deal in the afternoon and was gone by New Year. Now a player
  // ANNOUNCES a season ahead: the flag is public (squad tags, transfer
  // screens), the manager gets one shot at talking his own man around
  // (persuadeStay), and when the day actually comes there is a farewell
  // record worth screenshotting instead of a one-line vanishing.
  //
  // First, those who said last winter this season would be their final one:
  const departed: string[] = []
  for (const p of Object.values(state.players)) {
    // never the career player: me/endings.ts decides when he hangs them up.
    // retirePlayer() deletes the Player, and every me-layer read of
    // state.players[me.id] then throws — a career that reached its
    // thirties died on a white screen instead of getting its ending.
    if (p.id === state.me?.id) continue
    if (p.retiring) {
      const line = retirePlayer(state, p, notes)
      if (line) departed.push(line)
    }
  }
  // the rest of the league's farewells make the news too, one line for all
  if (departed.length) {
    state.news.push({
      day: state.day, kind: 'player',
      text: `👋 正式退役：${departed.slice(0, 8).join('、')}`
        + (departed.length > 8 ? ` 等 ${departed.length} 人` : '') + '。',
    })
  }
  // Then the next wave gives its notice. The age curve is the old instant
  // one shifted a year younger, so careers end at the same ages they always
  // did — announced at 33, gone at 34. A man who just signed a long deal
  // signed it because he intends to play it.
  const noticed: string[] = []
  const reach = reachOf(state)
  for (const p of Object.values(state.players)) {
    if (p.id === state.me?.id) continue
    if (p.retiring) continue
    // a real person who really played on is not retiring in this world either —
    // unless he is inside the player's reach, where the world is the player's
    if ((lastYearOf(p) ?? 0) > state.year && !reach.people.has(p.id)) continue
    let announceP = p.age >= 33 ? 0.45 : p.age >= 31 ? 0.2 : p.age >= 29 ? 0.06 : 0
    if (p.contractYears >= 3) announceP = 0
    else if (p.contractYears === 2) announceP *= 0.5
    if (announceP && rng.chance(announceP)) {
      p.retiring = true
      p.persuaded = false
      const mine = p.teamId === state.myTeam
      if (mine || p.overall >= 80) {
        state.news.push({
          day: state.day, kind: 'player', important: mine,
          text: `📢 ${p.ign}（${p.age} 岁）宣布本赛季结束后退役。`,
        })
      } else if (p.teamId) {
        const tag = state.teams[p.teamId]?.tag ?? ''
        noticed.push(`${p.ign}（${tag}）`)
      }
      if (mine) deskOf(state)?.retiring(state, p, notes)
    }
  }
  if (noticed.length) {
    state.news.push({
      day: state.day, kind: 'player',
      text: `📢 宣布本赛季结束后退役：${noticed.slice(0, 8).join('、')}`
        + (noticed.length > 8 ? ` 等 ${noticed.length} 人` : '') + '。',
    })
  }
  ensureMinimumRosters(state, rng)

  // ---- team ratings follow the squads they now have
  for (const t of Object.values(state.teams)) {
    const squad = t.roster.map((id) => state.players[id]).filter(Boolean)
    if (squad.length) {
      const top5 = squad.sort((a, b) => b!.overall - a!.overall).slice(0, 5)
      t.rating = Math.round(top5.reduce((s, p) => s + p!.overall, 0) / top5.length)
    }
    t.champPoints = 0
    t.seasonPrize = 0
    if (t.starters.length < 5) t.starters = autoStarters(state, t.id)
  }

  rebaseSeasonClock(state, state.day)

  state.year += 1
  state.day = 0
  state.stage = 'preseason'
  // next year's Kickoff byes are this year's Champions field; the draws of
  // the year before last are let go so a save does not grow without bound
  state.lastChampionsTeams = (state.comps.champions
    ?? Object.values(state.comps).find((c) => c.format === 'circuit' && c.stage === 'champions' && !c.region))?.teams
    ?? state.lastChampionsTeams
  state.draws = (state.draws ?? []).filter((d) => d.year >= state.year - 1)
  state.pendingDrawId = undefined
  openYear(state, rng, notes)
}

/**
 * The new year's world, then its calendar.
 *
 * A world that entered in 2021 is first brought up to the year as history had
 * it (engine/timeline.ts) — clubs founded and gone, rosters as they opened,
 * ratings off that year's numbers — everywhere out of the player's reach. Then
 * the year's real events go on the books. The book runs through 2026, and 2026
 * is a year like the ones before it — the same world carried on, not another
 * one put in its place. Past the book the world keeps what it has: its leagues
 * play the format Riot announced for 2027 (engine/ahead.ts, engine/leagues.ts),
 * and its Challengers the last real year's shape (engine/circuit.ts projectedOf).
 */
function openYear(state: GameState, rng: Rng, notes: string[]): void {
  // what last season's placings were worth toward a partner seat, before its events are cleared
  keepScore(state, state.year - 1)
  if (isTimelineWorld(state) && bookCovers(state.year)) {
    const r = syncYear(state, state.year)
    notes.push(...r.notes)
    const gone: string[] = []
    for (const id of r.retire) {
      const p = state.players[id]
      const line = p ? retirePlayer(state, p, notes) : ''
      if (line) gone.push(line)
    }
    if (r.moved || r.founded.length) {
      state.news.push({
        day: state.day, kind: 'transfer',
        text: `📜 ${state.year} 赛季开始前，${r.moved} 名选手按真实历史换了东家`
          + (r.founded.length ? `；新俱乐部：${r.founded.slice(0, 8).join('、')}${r.founded.length > 8 ? ` 等 ${r.founded.length} 家` : ''}` : '') + '。',
      })
    }
    for (const line of r.renamed.slice(0, 8)) state.news.push({ day: state.day, kind: 'club', text: `🔁 ${line}。` })
    if (r.folded.length) {
      state.news.push({
        day: state.day, kind: 'club',
        text: `🕯️ 这一年不再参赛：${r.folded.slice(0, 8).join('、')}${r.folded.length > 8 ? ` 等 ${r.folded.length} 家` : ''}。`,
      })
    }
    if (gone.length) {
      state.news.push({
        day: state.day, kind: 'player',
        text: `👋 离开职业赛场：${gone.slice(0, 8).join('、')}${gone.length > 8 ? ` 等 ${gone.length} 人` : ''}。`,
      })
    }
    ensureMinimumRosters(state, rng)
  }
  // 2026: what the game's own 2026 files know that the book does not — coaches, and the
  // professionals below the leagues (engine/today.ts)
  if (isTimelineWorld(state) && state.year === 2026) {
    arrive2026(state, notes)
    ensureMinimumRosters(state, rng)
  }
  // 2027 on: the leagues as announced, and November's qualifiers into Kickoff
  if (isTimelineWorld(state) && !bookCovers(state.year)) turnLeagues(state, notes)
  if (isTimelineWorld(state) && !eventsOf(state.year).length) {
    state.timelinePause = `时间线目前做到 ${state.year - 1} 年底，${state.year} 年的赛历还没有排上。`
      + '存档停在这里，更新后从这一天接着打。'
    state.gameOver = state.timelinePause
    notes.push(state.timelinePause)
    return
  }
  setupSeason(state, notes)
}

/** A save that stopped at the edge of the timeline carries on from the same day once the build can play that year. */
export function resumeTimeline(state: GameState): boolean {
  // a year this build can play: every year has a calendar now — the real one, and its shape after
  if (!state.timelinePause || !eventsOf(state.year).length) return false
  state.timelinePause = undefined
  state.gameOver = undefined
  openYear(state, new Rng(hashStr(`resume:${state.seed}:${state.year}`)), [])
  return true
}

/**
 * Shift every forward-looking timer back with the calendar.
 *
 * The rollover sets `day = 0`, but everything scheduled against the old
 * calendar used to keep its absolute number — so a sponsor-pitch cooldown of
 * "day + 14" written on day 310 became "324 days from now", a pending transfer
 * bid was answered eleven months late, and an injury due to heal on day 340
 * kept a player out for a second full season. A fourteen-day wait that spans
 * New Year is still a fourteen-day wait.
 *
 * Deadlines are shifted, not clamped: a reply due on day 340 is due on day 4
 * of the new season, and a record made on day 300 lands at -36, which keeps
 * every "days since" comparison honest about how long ago it really was.
 * History — news, activity, the finance log — is left alone: those entries
 * describe last season and should not be re-dated into this one.
 */
function rebaseSeasonClock(state: GameState, shift: number): void {
  if (shift <= 0) return
  // a club told us it closes on a day of the old calendar
  if (state.foldNotice) state.foldNotice.day -= shift
  for (const p of Object.values(state.players)) {
    if (p.injuredUntil > 0) p.injuredUntil = Math.max(0, p.injuredUntil - shift)
  }
  // a manager's save: sponsors, staff, job offers, bids, the drill and the physio room (engine/desk.ts)
  deskOf(state)?.clockRebased(state, shift)
}

/**
 * Keep AI clubs at five players by signing from the free-agent pool.
 *
 * Every person in this game is a real player, so nothing is invented here: if
 * the market is empty a club simply runs short and the shortage is reported,
 * rather than conjuring a fictional prospect to paper over it.
 */

export function ensureMinimumRosters(state: GameState, rng: Rng): void {
  const short: string[] = []
  for (const team of Object.values(state.teams)) {
    if (team.id === state.myTeam || team.dormant) continue
    let guard = 0
    while (team.roster.length < 5 && guard++ < 10) {
      const free = Object.values(state.players).filter((p) => p.teamId === null && !p.retiring && p.id !== state.me?.id)
      // under the import rule a club refills from its own region first;
      // fielding five still outranks the rule when the pool runs dry
      const legal = free.filter((p) => !importBlock(state, team.id, p))
      const target = (legal.length ? legal : free)
        .sort(
          (a, b) =>
            b.overall + (b.region === team.region ? 6 : 0) -
            (a.overall + (a.region === team.region ? 6 : 0)),
        )[0]
      if (!target) break
      target.teamId = team.id
      target.contractYears = contractLength(target, rng, team.roster.map((id) => state.players[id]))
      target.salary = expectedSalary(target, team.tier)
      team.roster.push(target.id)
      // offseason emergency signings go on the record like any other move
      state.news.push({
        day: state.day, kind: 'transfer',
        text: `${team.name} 免费签下自由人 ${target.ign}（${target.overall}）。`,
      })
    }
    if (team.roster.length < 5) short.push(team.name)
    // expiries and retirements can walk a club's caller out the door too
    ensureCaller(state, team.id)
    if (team.starters.length < 5) team.starters = autoStarters(state, team.id)
  }
  if (short.length) {
    state.news.push({
      day: state.day, kind: 'system',
      text: `自由市场已无可签选手，以下战队人数不足：${short.slice(0, 6).join('、')}。`,
    })
  }
}

/** Next unplayed fixture for a club. */
export const nextFixtureFor = (state: GameState, teamId: string): Fixture | undefined =>
  state.fixtures
    .filter((f) => !f.played && (f.teamA === teamId || f.teamB === teamId))
    .sort((a, b) => a.day - b.day)[0]

/**
 * The next match that counts.
 *
 * A booked scrim used to replace the league fixture everywhere it was shown,
 * so the one thing a manager always wants in view — when do we next play for
 * real — kept disappearing behind a friendly.
 */
export const nextRealFixtureFor = (state: GameState, teamId: string): Fixture | undefined =>
  state.fixtures
    .filter((f) => !f.played && !isScrim(f) && (f.teamA === teamId || f.teamB === teamId))
    .sort((a, b) => a.day - b.day)[0]

export const nextScrimFor = (state: GameState, teamId: string): Fixture | undefined =>
  state.fixtures
    .filter((f) => !f.played && isScrim(f) && (f.teamA === teamId || f.teamB === teamId))
    .sort((a, b) => a.day - b.day)[0]

/** Matches we have played, most recent first — scrims included. */
export const recentResultsFor = (state: GameState, teamId: string, n = 6): Fixture[] =>
  state.fixtures
    .filter((f) => f.result && (f.teamA === teamId || f.teamB === teamId))
    .sort((a, b) => b.day - a.day)
    .slice(0, n)

export const fixturesFor = (state: GameState, teamId: string): Fixture[] =>
  state.fixtures
    .filter((f) => f.teamA === teamId || f.teamB === teamId)
    .sort((a, b) => a.day - b.day)

/** Fast-forward until something the manager should look at happens. */
export function advanceToNextMatch(
  state: GameState, maxDays = 40, opts: AdvanceOpts = {},
): DayReport[] {
  const reports: DayReport[] = []
  for (let i = 0; i < maxDays; i++) {
    const r = advanceDay(state, opts)
    reports.push(r)
    if (r.playedMine.length || r.pendingMine || r.pendingDraw || r.seasonEnded) break
    const next = nextFixtureFor(state, state.myTeam)
    if (next && next.day === state.day + 1) break
  }
  return reports
}

/** A scrim is arranged, not drawn: you name the opponent, the map and the format. */
export type ScrimFormat = 'first13' | 'full24'

/**
 * Would this club take the practice?
 *
 * Clubs about to face us competitively will not show their hand, and a side far
 * above us has nothing to gain from the session.
 */
export function scrimReply(
  state: GameState, oppId: string,
): { ok: boolean; reason?: string } {
  const opp = state.teams[oppId]
  const me = state.teams[state.myTeam]
  if (!opp || !me) return { ok: false, reason: '对手不存在。' }

  const soon = state.fixtures.some(
    (f) => !f.played && f.comp !== 'scrim' && f.day - state.day <= 10 &&
      ((f.teamA === state.myTeam && f.teamB === oppId) ||
       (f.teamB === state.myTeam && f.teamA === oppId)),
  )
  if (soon) return { ok: false, reason: `${opp.name} 很快要和我们打正赛，不想提前暴露战术。` }

  const gap = opp.rating - me.rating
  const rng = new Rng(hashStr(`scrim:${state.seed}:${state.day}:${oppId}`))
  if (gap >= 10 && rng.chance(0.55 + (gap - 10) * 0.03)) {
    return { ok: false, reason: `${opp.name} 认为和我们打收益不大，婉拒了。` }
  }
  if (rng.chance(0.12)) return { ok: false, reason: `${opp.name} 这几天的训练安排已经排满了。` }
  return { ok: true }
}

export function makeScrim(
  state: GameState, oppId: string, day: number, map: string, format: ScrimFormat,
): Fixture {
  const f = makeFixture(day, state.stage, 'scrim', state.myTeam, oppId, 1, '训练赛')
  f.scrim = { map, format }
  state.fixtures.push(f)
  return f
}
