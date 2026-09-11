import type { Competition, Fixture, GameState, MatchResult, Player, StageKey, Team } from './types'

/**
 * The manager's desk, mounted from outside the world.
 *
 * The world is the same for everybody: days and fixtures, the leagues and the
 * real calendar, training, contracts running down, the winter. The manager game
 * puts a desk on top of it for the one club a person runs — a finance ledger and
 * a board, sponsors and commercial days, a coaching staff, job offers, bids for
 * his players, players asking him for a raise or for their minutes. None of that
 * belongs to the world, and a player's career has no desk at all
 * (「我们这个是完全单独的游戏」, 2026-09-11).
 *
 * So the world imports none of it. It calls these hooks where those systems used
 * to run, and only for a save whose club a person manages (`managedClub`); the
 * manager game mounts its desk when its screen loads (src/ManagerGame.tsx →
 * engine/managerDesk.ts). With nothing mounted, or on a player's save, there is
 * no desk and the world runs on its own.
 */

/**
 * The club a person manages: the manager game's own club. A player's career has
 * none — he is one player at a club nobody in the save runs.
 */
export const managedClub = (state: Pick<GameState, 'me' | 'myTeam'>): string | null =>
  (state.me ? null : state.myTeam || null)

/** What the manager's skills and staff do for his own club. Every other club plays without them. */
export interface ClubMods {
  /** how much more of a rest week a man gets back */
  rest: number
  /** the coaching staff's help on development, on top of the head coach */
  devHelp: number
  /** the manager's own training and youth skills, for this player */
  talent: (p: Player) => number
  /** days this player spent on commercial work this week */
  booked: (p: Player) => number
  /** the injury-risk multiplier; under 1 is safer */
  injury: number
  /** how much of the week's fatigue comes back */
  care: number
  /** how fast a promise of minutes not kept turns into a grievance */
  soothe: number
  /** how fast a feud heals */
  bondsHeal: number
  /** the manager's read of the game and his opponent analyst, per map */
  coach: number
  /** his economy analyst, per map */
  utility: number
}

/** The winter's contracts at the managed club, for the manager to be told about. */
export interface ContractsRun {
  /** a deal with one season left */
  finalYear: string[]
  /** out of contract, with one season to renew */
  expiring: Player[]
  /** a season of grace gone unrenewed: he has left */
  walked: Player[]
}

/** What the manager puts on the table when a player announces retirement. */
export type StayApproach = 'heart' | 'raise' | 'bench' | 'transfer' | 'accept'

export interface ManagerDesk {
  // ---- the world's day, in the order it runs
  /** a season is being set up: the manager's contract for it, and the market's first listings */
  seasonSetup(state: GameState, notes?: string[]): void
  /** the clock waits on a question only the manager can answer (the five-year settlement) */
  holdsClock(state: GameState): boolean
  /** the day opens, before its fixtures */
  dayOpened(state: GameState, notes: string[]): void
  /** a new stage has begun: the board's brief, job offers, the league's capsule */
  stageChanged(state: GameState, prevStage: StageKey, notes: string[]): void
  /** after the stage check, before the fixtures */
  dayStarted(state: GameState, notes: string[]): void
  /** one of the managed club's matches, scrims included, is on the books */
  matchPlayed(state: GameState, f: Fixture, result: MatchResult): void
  /** a competition has its champion and its prize money */
  competitionSettled(state: GameState, comp: Competition, notes: string[]): void
  /** after the day's fixtures: commercial work, sponsors, the drill, staff and job answers, enquiries, bids */
  afterMatches(state: GameState, notes: string[]): void
  /** the week's upkeep, before training */
  weekOpened(state: GameState, notes: string[]): void
  /** after training and every club's weekly books; `grumbling` are the managed club's players with a broken promise of minutes */
  weekTrained(state: GameState, grumbling: Player[], notes: string[]): void
  /** weekly, after the clubs' books: the manager game's market — the AI clubs' bids and listings, bids for his players */
  weekMarket(state: GameState, notes: string[]): void
  /** the season has ended, before the winter; true when the season stops here */
  seasonEnding(state: GameState, notes: string[]): boolean
  /** Ascension moved clubs up and down */
  ascension(state: GameState, promoted: Team, relegated: Team, notes: string[]): void
  /** the winter's contracts at the managed club */
  contractsRun(state: GameState, run: ContractsRun, notes: string[]): void
  /** a player at the managed club says this season is his last */
  retiring(state: GameState, p: Player, notes: string[]): void
  /** before the rollover: sponsor clauses, the league's bundle, the season's counters */
  seasonClosing(state: GameState, notes: string[]): void
  /** the calendar was rebased to a new year: the desk's own timers move with it */
  clockRebased(state: GameState, shift: number): void
  /** the manager's skills and staff on his own club */
  clubMods(state: GameState): ClubMods

  // ---- the manager game's screens, which still import these by name from world modules
  /** a manager game's new save: his name and books, the board, the squad as he found it (engine/world.ts createNewGame) */
  initManager(state: GameState, managerName: string, manager?: GameState['manager']): void
  acceptJob(state: GameState, offerId: string): string
  persuadeStay(state: GameState, playerId: string, approach: StayApproach): string
  settleAtFive(state: GameState): void
  continuePastFive(state: GameState): void
  noticeHint(state: GameState): string
  reviewIglXp(state: GameState, p: Player): number
  physioBlock(state: GameState, playerId: string): string | null
  doPhysio(state: GameState, playerId: string): string | null
}

let mounted: ManagerDesk | null = null

/** The manager game mounts its desk once, when its screen loads. A player's career never does. */
export function mountDesk(desk: ManagerDesk | null): void {
  mounted = desk
}

/** The desk behind this save's club: there when a person manages it and the manager game is loaded. */
export const deskOf = (state: Pick<GameState, 'me' | 'myTeam'>): ManagerDesk | null =>
  (managedClub(state) ? mounted : null)
