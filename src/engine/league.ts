import { Rng } from './rng'
import type { Competition, Fixture, GameState, StageKey, StandingRow } from './types'

export const newRow = (teamId: string): StandingRow => ({
  teamId, w: 0, l: 0, mapW: 0, mapL: 0, roundW: 0, roundL: 0, pts: 0,
})

export function newStandings(teams: string[]): Record<string, StandingRow> {
  const out: Record<string, StandingRow> = {}
  for (const t of teams) out[t] = newRow(t)
  return out
}

/** Circle-method round robin. Returns one array of pairings per round. */
export function roundRobin(ids: string[], rng: Rng): [string, string][][] {
  const list = rng.shuffle(ids)
  if (list.length % 2 === 1) list.push('__BYE__')
  const n = list.length
  const rounds: [string, string][][] = []
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = []
    for (let i = 0; i < n / 2; i++) {
      const a = list[i]
      const b = list[n - 1 - i]
      if (a !== '__BYE__' && b !== '__BYE__') {
        // alternate home/away so the veto first-pick rotates
        pairs.push(r % 2 === 0 ? [a, b] : [b, a])
      }
    }
    rounds.push(pairs)
    list.splice(1, 0, list.pop()!)
  }
  return rounds
}

/**
 * Fixture ids, counted per world.
 *
 * A fixture is `F` and a number that starts again at 0 each season
 * (setupSeason), and a match is played off its id (season.ts fixtureRng), so
 * the count is part of the world. It used to be one counter for the whole
 * module, moved only by setupSeason: a save loaded on a fresh page numbered its
 * next fixtures from F0 again, beside the F0… already on its books. A 2021
 * career reloaded at day 112 held seven ids twice a week later, a lookup by id
 * (me/week.ts dueToday, me/hurtplay.ts) could find the wrong match, and every
 * match from there on was played off another stream than in the same career
 * never reloaded. Two careers in one process moved each other's count as well.
 *
 * So each world keeps its own count — beside it, not in it: the save is as it
 * was. A world this process has not numbered yet (read from a save, imported,
 * built by a script) counts on from the highest id this season holds, which is
 * where its count stood: nothing is taken off the books mid-season but a
 * play-in decider dropped the moment it is made, and that one never is
 * (circuit.ts begin). scripts/check_reload.ts holds a career against itself
 * saved and loaded, week by week.
 */
const fixtureSeqs = new WeakMap<GameState, number>()

const fixtureNo = (id: string | undefined): number => {
  const m = /^F(\d+)$/.exec(id ?? '')
  return m ? Number(m[1]) : -1
}

/**
 * The highest fixture number this season holds: its fixtures, my matches of
 * this year, a qualifier's play-in decider. A reference that carries no season
 * (me.pendingFixture, me.dueFixture, a hurt card's match) is not counted: it
 * points at a fixture on the books, or at last season's, whose number this
 * season's count reaches again with or without a reload.
 */
export function highestFixtureNo(state: GameState): number {
  let top = -1
  for (const f of state.fixtures ?? []) top = Math.max(top, fixtureNo(f.id))
  for (const m of state.me?.matches ?? []) if (m.year === state.year) top = Math.max(top, fixtureNo(m.fixtureId))
  for (const c of Object.values(state.comps ?? {})) top = Math.max(top, fixtureNo(c.circuit?.playin?.fixture))
  return top
}

/** A new season's books: its fixtures start again at F0 (setupSeason). */
export function resetFixtureSeq(state: GameState): void {
  fixtureSeqs.set(state, 0)
}

/** Count on from what the world holds now: read from a save (save.ts migrateWorld), or put back in place (ui/Tutorial.tsx). */
export function syncFixtureSeq(state: GameState): void {
  fixtureSeqs.set(state, highestFixtureNo(state) + 1)
}

/** The number the world's next fixture takes. */
export function nextFixtureNo(state: GameState): number {
  let n = fixtureSeqs.get(state)
  if (n === undefined) {
    n = highestFixtureNo(state) + 1
    fixtureSeqs.set(state, n)
  }
  return n
}

export function makeFixture(
  state: GameState, day: number, stage: StageKey, comp: string,
  teamA: string, teamB: string, bo: 1 | 2 | 3 | 5, label: string,
): Fixture {
  const n = nextFixtureNo(state)
  fixtureSeqs.set(state, n + 1)
  return {
    id: `F${n}`, day, stage, comp, teamA, teamB, bo, label, played: false,
  }
}

/**
 * How many times a league plays itself through.
 *
 * A twelve-team league needs one pass to give everyone eleven games. A small
 * Challengers league of three would only get two, which is not a season — so
 * small leagues cycle several times, the way real lower divisions do.
 */
export function cyclesFor(teamCount: number, targetGames = 10): number {
  const perCycle = Math.max(1, teamCount - 1)
  return Math.max(1, Math.ceil(targetGames / perCycle))
}

/** Spread round-robin rounds across the days available in a stage window. */
export function scheduleRegularSeason(
  state: GameState, comp: Competition, stage: StageKey, startDay: number, endDay: number,
  bo: 1 | 2 | 3 | 5, rng: Rng, labelPrefix = '常规赛', targetGames = 10,
): Fixture[] {
  // An odd league gives one club a bye every round, so a schedule cut off
  // part-way through a cycle leaves whoever has not had their bye yet a game
  // ahead of the field — Challengers Pacific and China both play seven. Only a
  // whole cycle is fair, so an odd league rounds to the nearest one instead.
  const odd = comp.teams.length % 2 === 1
  const perCycle = Math.max(1, comp.teams.length - 1)
  const cycles = odd
    ? Math.max(1, Math.round(targetGames / perCycle))
    : cyclesFor(comp.teams.length, targetGames)
  let rounds: [string, string][][] = []
  for (let c = 0; c < cycles; c++) {
    // reversing every other pass keeps home/away alternating across cycles
    for (const pairs of roundRobin(comp.teams, rng)) {
      rounds.push(c % 2 === 0 ? pairs : pairs.map(([a, b]) => [b, a] as [string, string]))
    }
  }
  // a short group phase plays only part of the way round, so a Kickoff is not
  // as long as a full stage
  if (!odd && rounds.length > targetGames) rounds = rounds.slice(0, targetGames)
  if (!rounds.length) return []
  // Rounds spread evenly over the window, to the day. A whole-number step
  // used to round eleven rounds over five weeks down to one game every three
  // days, or up to one every six — a league that plays Thursday and Sunday
  // lands on a 3-4-3-4 rhythm, which only a fractional step can produce.
  const span = Math.max(1, endDay - startDay)
  const step = Math.max(2, span / Math.max(1, rounds.length - 1))
  const out: Fixture[] = []
  rounds.forEach((pairs, i) => {
    const day = startDay + Math.round(i * step)
    pairs.forEach(([a, b]) => {
      out.push(makeFixture(state, day, stage, comp.key, a, b, bo, `${labelPrefix} 第${i + 1}轮`))
    })
  })
  return out
}

/**
 * Spread rounds that have not been played over new days, in their order.
 *
 * The same to-the-day spacing as scheduleRegularSeason, applied to what is
 * left of a league: the rounds keep their pairings and their order, only
 * the days move. Used to hold the break after a Masters (keepBreaks in
 * season.ts). If the window is too short for a game every second day the
 * tail runs past `endDay`; the playoffs are made from whenever the last
 * round is played, so they follow.
 */
export function respaceRounds(unplayed: Fixture[], startDay: number, endDay: number): void {
  // Alpha's and Omega's round 3 are one round on one day: the group suffix
  // is not part of the round
  const roundOf = (f: Fixture) => f.label.replace(/ · .*$/, '')
  const rounds = new Map<string, Fixture[]>()
  for (const f of [...unplayed].sort((a, b) => a.day - b.day)) {
    rounds.set(roundOf(f), [...(rounds.get(roundOf(f)) ?? []), f])
  }
  const n = rounds.size
  if (!n) return
  const step = Math.max(2, Math.max(1, endDay - startDay) / Math.max(1, n - 1))
  let i = 0
  for (const fs of rounds.values()) {
    const day = startDay + Math.round(i++ * step)
    for (const f of fs) f.day = day
  }
}

/**
 * One drawn group's single round robin — five rounds for six sides —
 * spread over the same window as the other group's, so Alpha and Omega
 * play the same days. Labels carry the group so the schedule can say which.
 */
export function scheduleGroupSeason(
  state: GameState, comp: Competition, group: string[], groupName: string, stage: StageKey,
  startDay: number, endDay: number, bo: 1 | 2 | 3 | 5, rng: Rng,
): Fixture[] {
  const rounds = roundRobin(group, rng)
  if (!rounds.length) return []
  const span = Math.max(1, endDay - startDay)
  const step = Math.max(2, span / Math.max(1, rounds.length - 1))
  const out: Fixture[] = []
  rounds.forEach((pairs, i) => {
    const day = startDay + Math.round(i * step)
    for (const [a, b] of pairs) out.push(makeFixture(state, day, stage, comp.key, a, b, bo, `常规赛 第${i + 1}轮 · ${groupName}`))
  })
  return out
}

/** A group's table: the competition's standings restricted to its members. */
export function groupTable(comp: Competition, group: string[]): string[] {
  const set = new Set(group)
  return sortStandings(comp).filter((id) => set.has(id))
}

/** Order a table: wins, then map diff, then round diff. */
export function sortStandings(comp: Competition): string[] {
  return Object.values(comp.standings)
    .slice()
    .sort((x, y) =>
      y.pts - x.pts ||
      y.w - x.w ||
      y.mapW - y.mapL - (x.mapW - x.mapL) ||
      y.roundW - y.roundL - (x.roundW - x.roundL) ||
      y.mapW - x.mapW)
    .map((r) => r.teamId)
}

export function applyResultToStandings(comp: Competition, f: Fixture): void {
  if (!f.result) return
  const a = comp.standings[f.teamA]
  const b = comp.standings[f.teamB]
  if (!a || !b) return
  const { mapsWonA, mapsWonB, maps } = f.result
  if (mapsWonA === mapsWonB) {
    // a level Bo2: a point each, as 2021's groups scored it
    a.d = (a.d ?? 0) + 1
    b.d = (b.d ?? 0) + 1
    a.pts += 1
    b.pts += 1
  } else if (mapsWonA > mapsWonB) {
    a.w++
    b.l++
    a.pts += 3
  } else {
    b.w++
    a.l++
    b.pts += 3
  }
  a.mapW += mapsWonA
  a.mapL += mapsWonB
  b.mapW += mapsWonB
  b.mapL += mapsWonA
  for (const m of maps) {
    a.roundW += m.scoreA
    a.roundL += m.scoreB
    b.roundW += m.scoreB
    b.roundL += m.scoreA
  }
}

// ---------------------------------------------------------------- knockout brackets

const ROUND_LABEL = (remaining: number): string => {
  switch (remaining) {
    case 2: return '决赛'
    case 4: return '半决赛'
    case 8: return '四分之一决赛'
    case 16: return '八分之一决赛'
    default: return `${remaining}强`
  }
}

/** Standard 1v8 / 2v7 seeding. */
export function pairSeeds(seeds: string[]): [string, string][] {
  const out: [string, string][] = []
  const n = seeds.length
  for (let i = 0; i < n / 2; i++) out.push([seeds[i], seeds[n - 1 - i]])
  return out
}

/**
 * Generate the next knockout round for a competition, if one is due.
 * Returns new fixtures (possibly empty).
 */
export function advanceBracket(
  state: GameState, comp: Competition, day: number, bo: 1 | 2 | 3 | 5,
): Fixture[] {
  const bracketFixtures = state.fixtures.filter(
    (f) => f.comp === comp.key && f.label.startsWith('KO:'),
  )
  if (!bracketFixtures.length) return []
  const unplayed = bracketFixtures.filter((f) => !f.played)
  if (unplayed.length) return []

  // find the most recent round and who survived it
  const lastRound = Math.max(...bracketFixtures.map((f) => Number(f.label.split(':')[1] || 0)))
  const lastFixtures = bracketFixtures.filter((f) => Number(f.label.split(':')[1] || 0) === lastRound)
  const winners: string[] = []
  const losers: string[] = []
  for (const f of lastFixtures) {
    if (!f.result) continue
    const aWon = f.result.mapsWonA > f.result.mapsWonB
    winners.push(aWon ? f.teamA : f.teamB)
    losers.push(aWon ? f.teamB : f.teamA)
  }

  // record eliminated teams from best to worst as the bracket unwinds
  comp.finished = [...losers.reverse(), ...comp.finished]

  // seeds that sat out round 1 join here
  const advancing = [...(comp.byes ?? []), ...winners]
  comp.byes = undefined

  if (advancing.length <= 1) {
    comp.champion = advancing[0]
    if (advancing[0]) comp.finished = [advancing[0], ...comp.finished]
    return []
  }

  const pairs = pairSeeds(advancing)
  const label = ROUND_LABEL(advancing.length)
  // the final is a BO5 whatever the bracket default — a title decided in a
  // BO3 is over in forty minutes, and no real circuit plays it that way
  const roundBo = advancing.length === 2 ? 5 : bo
  return pairs.map(([a, b]) =>
    makeFixture(state, day, comp.stage, comp.key, a, b, roundBo, `KO:${lastRound + 1}:${label}`),
  )
}

/**
 * Kick off a knockout stage from a seeded list. Fields that aren't a power of
 * two give the top seeds a bye into round 2.
 */
export function startBracket(
  state: GameState, comp: Competition, seeds: string[], stage: StageKey, day: number, bo: 1 | 2 | 3 | 5,
): Fixture[] {
  comp.bracketStarted = true
  const n = seeds.length
  if (n < 2) {
    comp.champion = seeds[0]
    comp.finished = seeds.slice()
    return []
  }
  const pow2 = 1 << Math.ceil(Math.log2(n))
  const byeCount = pow2 - n
  const byes = seeds.slice(0, byeCount)
  const playing = seeds.slice(byeCount)
  comp.byes = byes.length ? byes : undefined

  const label = ROUND_LABEL(playing.length)
  // a two-team field opens straight onto the final, so it opens as a BO5
  const roundBo = playing.length === 2 ? 5 : bo
  return pairSeeds(playing).map(([a, b]) =>
    makeFixture(state, day, stage, comp.key, a, b, roundBo, `KO:1:${label}`),
  )
}

/** Championship-point awards for a completed competition. */
// the real circuit's shape: a regional top four, a Masters top six
export const CHAMP_POINTS: Record<string, number[]> = {
  kickoff: [6, 4, 3, 2],
  stage1: [9, 7, 5, 4, 3, 3, 2, 2],
  stage2: [9, 7, 5, 4, 3, 3, 2, 2],
  masters1: [12, 9, 7, 5, 4, 4],
  masters2: [12, 9, 7, 5, 4, 4],
}
