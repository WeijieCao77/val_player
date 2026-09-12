import raw from '../../data/prizes_me.json'
import estimates from '../../data/prize_estimates_me.json'
import { OQ_POOLS } from '../ahead'
import { eventsOf } from '../circuit'
import type { Competition, StageKey } from '../types'

/**
 * Prize money by event and placement (USD): what each event really paid, and
 * an estimate labelled as one where the amounts were never published.
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
 *  - an event whose amounts were never published pays an estimate — the
 *    author, 2026-09-12: 「每个赛段都应该有奖金比如打进季后赛，拿下冠军等等」.
 *    Each is a real table of the same kind of event scaled by a written rule
 *    (scripts/build_prize_estimates.ts into data/prize_estimates_me.json, which
 *    names the page it is drawn from), and the economy page says
 *    「估算：奖金未公开，按 … 推算」. Where no real table of its kind exists it
 *    still pays nothing and says 「奖金未公开」; an event written down as paying
 *    every place nothing says 「无奖金」
 *  - an event nobody has played yet (2027 on) pays what the same event paid in
 *    2026, or its 2026 estimate, and says 「按 2026 年金额暂定」 or
 *    「估算，按 2026 年暂定」. The new format's open qualifiers and Open
 *    Playoffs, which 2026 did not have, pay an estimate of their own: under
 *    every Challengers stage of their league, place by place
 *
 * Nothing here reads or is read by the manager game.
 */

export type PrizeRow = [from: number, to: number, usd: number]
interface Entry { y: number; lp: string; status?: 'none' | 'unpublished'; cur?: string; pay?: PrizeRow[] }
interface Estimate { y: number; lp: string | null; rule: string; from: string; fromCn: string; k: number; pay: PrizeRow[] }
const BOOK = (raw as unknown as { events: Record<string, Entry> }).events
const EST = (estimates as unknown as { events: Record<string, Estimate> }).events

/** The last season whose amounts are on record. A later season is paid at its rates, 暂定. */
export const PRIZE_BASIS_YEAR = 2026

export interface PrizeTable {
  /**
   * paid: a published table · est: never published, estimated from a real one ·
   * none: published as paying nothing · unpublished: no amounts on record and no estimate
   */
  status: 'paid' | 'est' | 'none' | 'unpublished'
  pay: PrizeRow[]
  /** the Liquipedia page the amounts are read from — for an estimate, the event's own page, if it has one */
  lp: string | null
  /** the local currency the table was published in, when it was not dollars */
  cur?: string
  /** set when another season's amounts stand in — 2026's, for an event from 2027 on */
  basis: number | null
  /** an estimate: the real table it is drawn from (page, short name), its rule (prize_estimates_me.json `rules`) and scale */
  from?: { lp: string; cn: string; rule: string; k: number }
}

/** An event's table by its id in the books: its published one, else its estimate. */
function tableOf(id: string | undefined, basis: number | null): PrizeTable {
  const e = id ? BOOK[id] : undefined
  if (e && e.status !== 'unpublished') return { status: e.status ?? 'paid', pay: e.pay ?? [], lp: e.lp, cur: e.cur, basis }
  const x = id ? EST[id] : undefined
  if (x) return { status: 'est', pay: x.pay, lp: e?.lp ?? x.lp, basis, from: { lp: x.from, cn: x.fromCn, rule: x.rule, k: x.k } }
  return { status: 'unpublished', pay: [], lp: e?.lp ?? null, basis }
}

/** The 2026 edition of an event: a league's Kickoff or stage, a Masters, Champions, China's Ascension. */
function editionOf(stage: StageKey, league: string | null): string | undefined {
  const evs = eventsOf(PRIZE_BASIS_YEAR)
  if (stage === 'champions') return evs.find((e) => e.stage === 'champions')?.id
  if (stage === 'masters1' || stage === 'masters2') return evs.find((e) => e.stage === stage && !e.region)?.id
  if (stage === 'ascension') return evs.find((e) => e.stage === 'ascension' && e.region === league && !e.plan)?.id
  return evs.find((e) => e.stage === stage && e.region === league && !e.scene && !e.projected)?.id
}

/** A 2026 edition's table: its own, or — China's Ascension, drawn from 2025's — the one it is drawn from. */
const editionTable = (id: string | undefined, basis: number | null): PrizeTable =>
  tableOf(id && !BOOK[id] && !EST[id] ? (/^F\d{4}:(\d+)$/.exec(id)?.[1] ?? id) : id, basis)

/** 2027's own events, by the part of their id that says what they are (engine/ahead.ts). */
const AHEAD_STAGE: Record<string, StageKey> = {
  kickoff: 'kickoff', cup1: 'stage1', cup2: 'stage2', masters1: 'masters1', masters2: 'masters2', champions: 'champions', ascension: 'ascension',
}
/**
 * The new format's events 2026 did not have — open qualifiers, the Pacific's qualifier finals, the Open Playoffs:
 * their league's own estimate, under every Challengers stage of that league. An open qualifier's id names its pool.
 */
const NEW_FORMAT: Record<string, (key: string | undefined) => string> = {
  oq: (pool) => `new:oq:${OQ_POOLS.find((p) => p.key === pool)?.league ?? pool}`,
  oqFinal: (league) => `new:oqFinal:${league}`,
  open: (league) => `new:open:${league}`,
}

function eventTable(id: string): PrizeTable {
  if (BOOK[id] || EST[id]) return tableOf(id, null)
  const m = /^F\d{4}:(.+)$/.exec(id)
  if (!m) return tableOf(undefined, null)
  // an event drawn again from a real one: that one's amounts, or its estimate
  if (/^\d+$/.test(m[1])) return tableOf(m[1], BOOK[m[1]]?.y ?? EST[m[1]]?.y ?? PRIZE_BASIS_YEAR)
  // the new format's: the same event's 2026 edition. An open qualifier or Open Playoffs had none
  const [kind, league] = m[1].split(':')
  const stage = AHEAD_STAGE[kind]
  if (stage) return editionTable(editionOf(stage, league ?? null), PRIZE_BASIS_YEAR)
  return tableOf(NEW_FORMAT[kind.replace(/\d$/, '')]?.(league), null)
}

/**
 * A competition's table. On the timeline it is its real event's; a save that
 * still plays the old 2026 world's competitions (bridged) gets the same event's
 * 2026 amounts, 暂定 after 2026.
 */
export function prizeTableOf(comp: Competition, year: number): PrizeTable {
  if (comp.circuit) return eventTable(comp.circuit.id)
  return editionTable(editionOf(comp.stage, comp.region ?? null), year === PRIZE_BASIS_YEAR ? null : PRIZE_BASIS_YEAR)
}

/**
 * What the amounts rest on, when they are not the event's own published table —
 * short enough for the line under an event's name on a phone.
 */
export function prizeNote(t: PrizeTable): string {
  if (t.status === 'est') return t.basis ? `估算，按 ${t.basis} 年暂定` : `估算：奖金未公开，按 ${t.from?.cn ?? '同类赛事'}推算`
  return t.status === 'paid' && t.basis ? `按 ${t.basis} 年金额暂定` : ''
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
