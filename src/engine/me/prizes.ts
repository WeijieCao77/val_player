import raw from '../../data/prizes_me.json'
import { eventsOf } from '../circuit'
import type { Competition, StageKey } from '../types'

/**
 * Prize money by event and placement (USD): what each event really paid.
 *
 * The author's request, 2026-09-11: 「奖金表按照真实重做」. What this replaces
 * was the manager game's table copied over, one set of numbers per stage for
 * every year — its Champions winner took $1.5M, where Champions 2023 paid its
 * winner $1M out of $2.25M. Every event now reads its own table, taken off its
 * Liquipedia page by scripts/build_prizes.ts into data/prizes_me.json and keyed
 * by the circuit event it describes:
 *
 *  - a published table pays each place what it says; one in a local currency
 *    pays the dollars Liquipedia converts it to
 *  - an event whose amounts were never published pays nothing, and the economy
 *    page says 「奖金未公开」 instead of guessing; an event written down as
 *    paying every place nothing says 「无奖金」
 *  - an event nobody has played yet (2027 on) pays what the same event paid in
 *    2026, the last season with published amounts, and says 「按 2026 年金额暂定」
 *
 * Nothing here reads or is read by the manager game.
 */

export type PrizeRow = [from: number, to: number, usd: number]
interface Entry { y: number; lp: string; status?: 'none' | 'unpublished'; cur?: string; pay?: PrizeRow[] }
const BOOK = (raw as unknown as { events: Record<string, Entry> }).events

/** The last season whose amounts are on record. A later season is paid at its rates, 暂定. */
export const PRIZE_BASIS_YEAR = 2026

export interface PrizeTable {
  /** paid: a published table · none: published as paying nothing · unpublished: no amounts on record */
  status: 'paid' | 'none' | 'unpublished'
  pay: PrizeRow[]
  /** the Liquipedia page the amounts are read from */
  lp: string | null
  /** the local currency the table was published in, when it was not dollars */
  cur?: string
  /** set when another season's amounts stand in — 2026's, for an event from 2027 on */
  basis: number | null
}

const tableOf = (e: Entry | undefined, basis: number | null): PrizeTable =>
  e ? { status: e.status ?? 'paid', pay: e.pay ?? [], lp: e.lp, cur: e.cur, basis }
    : { status: 'unpublished', pay: [], lp: null, basis }

/** The 2026 edition of an event: a league's Kickoff or stage, a Masters, Champions. */
function editionOf(stage: StageKey, league: string | null): string | undefined {
  const evs = eventsOf(PRIZE_BASIS_YEAR)
  if (stage === 'champions') return evs.find((e) => e.stage === 'champions')?.id
  if (stage === 'masters1' || stage === 'masters2') return evs.find((e) => e.stage === stage && !e.region)?.id
  return evs.find((e) => e.stage === stage && e.region === league && !e.scene && !e.projected)?.id
}

/** 2027's own events, by the part of their id that says what they are (engine/ahead.ts). */
const AHEAD_STAGE: Record<string, StageKey> = {
  kickoff: 'kickoff', cup1: 'stage1', cup2: 'stage2', masters1: 'masters1', masters2: 'masters2', champions: 'champions',
}

function eventTable(id: string): PrizeTable {
  const own = BOOK[id]
  if (own) return tableOf(own, null)
  const m = /^F\d{4}:(.+)$/.exec(id)
  if (!m) return tableOf(undefined, null)
  // an event drawn again from a real one: that one's amounts
  if (/^\d+$/.test(m[1])) {
    const base = BOOK[m[1]]
    return tableOf(base, base?.y ?? PRIZE_BASIS_YEAR)
  }
  // the new format's: the same event's 2026 edition. An Open Playoffs or open qualifier had none
  const [kind, league] = m[1].split(':')
  const stage = AHEAD_STAGE[kind]
  const ed = stage ? editionOf(stage, league ?? null) : undefined
  return tableOf(ed ? BOOK[ed] : undefined, PRIZE_BASIS_YEAR)
}

/**
 * A competition's table. On the timeline it is its real event's; a save that
 * still plays the old 2026 world's competitions (bridged) gets the same event's
 * 2026 amounts, 暂定 after 2026.
 */
export function prizeTableOf(comp: Competition, year: number): PrizeTable {
  if (comp.circuit) return eventTable(comp.circuit.id)
  const ed = editionOf(comp.stage, comp.region ?? null)
  return tableOf(ed ? BOOK[ed] : undefined, year === PRIZE_BASIS_YEAR ? null : PRIZE_BASIS_YEAR)
}

/**
 * What the club is paid for finishing `place` (1 is the winner), in USD. Sides
 * level on a place share what the places they fill paid between them — two
 * semi-final losers of an event that paid 3rd and 4th differently each take
 * the average. Nothing on record is 0.
 */
export function prizeFor(comp: Competition, place: number, year: number, level = 1): number {
  const t = prizeTableOf(comp, year)
  let sum = 0
  for (let p = place; p < place + Math.max(1, level); p++) sum += t.pay.find(([a, b]) => p >= a && p <= b)?.[2] ?? 0
  return Math.round(sum / Math.max(1, level))
}

export const prizeSourceUrl = (lp: string): string => `https://liquipedia.net/valorant/${lp.replace(/ /g, '_')}`

/**
 * The players' part of a club's prize money, split between the roster. The
 * contract used to say 10% (6% below the leagues), a manager-game number; the
 * common arrangement in the real scene is that the players take about eight in
 * ten of what the team wins, contract by contract (Esports Insider, 2024-03).
 */
export const PLAYER_PRIZE_SHARE = 80
