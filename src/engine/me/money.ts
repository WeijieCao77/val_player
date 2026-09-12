import { prizeFor, prizeTableOf } from './prizes'
import type { PrizeTable } from './prizes'
import { eventOf, isLeagueEvent } from '../circuit'
import { onTimeline, regionIn, stageNameIn, stagesOf } from '../era'
import type { Competition, GameState, Team } from '../types'
import { pushLog } from './log'
import type { LedgerBook, MoneyKind } from './types'
import { compCn } from './compname'

/**
 * Every dollar goes through one door.
 *
 * Ported from 破晓's shop.js, whose complaint about its own game was exactly
 * ours: 「钱从来不少，但一直是哑巴」. Fourteen places wrote to `me.money`
 * directly, several of them silently — the weekly pay slip already took an
 * agent's cut and 30% of living costs off the top and never said so, and the
 * competition prize pool paid the player nothing at all.
 *
 * Two rules, same as the original:
 *
 *  1. All money moves through `addMoney()`, which books it to a running
 *     ledger. It is now impossible to pay the player without it showing up.
 *  2. **奖金是制度不是彩蛋.** Not a one-off achievement for the first title —
 *     every event, every placement, every time.
 *
 * The player's part of a prize is his contracted `bonusShare` of what his club
 * won, split between the roster (`prizeShare()` below), and what his club won
 * is the event's own published table (me/prizes.ts), not the manager game's.
 */

/** Where money comes from. */
export const LEDGER_IN: [MoneyKind, string][] = [
  ['salary', '工资'],
  ['prize', '赛事奖金'],
  ['sign', '签字费'],
  ['media', '直播与内容'],
  ['inother', '其他收入'],
]
/** Where it goes. */
export const LEDGER_OUT: [MoneyKind, string][] = [
  ['agent', '经纪人抽成'],
  ['living', '生活开销'],
  ['upkeep', '家里的固定支出'],
  ['gear', '外设'],
  ['course', '课程'],
  ['relax', '放松'],
  ['life', '家人与生活'],
  ['fee', '报名费'],
  ['fine', '违约金'],
  ['outother', '其他开销'],
]

export const KIND_CN: Record<string, string> = Object.fromEntries([...LEDGER_IN, ...LEDGER_OUT])

const emptyBook = (): LedgerBook => ({ in: {}, out: {} })

export function initLedger(state: GameState, label = ''): void {
  const me = state.me!
  me.ledger = { cur: emptyBook(), prev: null, label, prevLabel: '', lifetimeIn: 0, lifetimeOut: 0 }
}

/**
 * The only way money changes hands. Positive is income, negative is spending;
 * `kind` picks the row it lands on. Returns the amount actually moved so the
 * caller can print it.
 */
export function addMoney(state: GameState, kind: MoneyKind, amount: number): number {
  const me = state.me
  if (!me) return 0
  const n = Math.round(amount || 0)
  if (!n) return 0
  if (!me.ledger) initLedger(state, stageNameIn(state.year, state.stage, onTimeline(state)))
  me.money += n
  const led = me.ledger!
  const side = n > 0 ? led.cur.in : led.cur.out
  side[kind] = (side[kind] ?? 0) + Math.abs(n)
  if (n > 0) led.lifetimeIn += n
  else led.lifetimeOut += -n
  return n
}

/** At a stage's end: this stage's book becomes last stage's, and a new one opens. */
export function ledgerRotate(state: GameState): void {
  const me = state.me!
  if (!me.ledger) { initLedger(state, stageNameIn(state.year, state.stage, onTimeline(state))); return }
  me.ledger.prev = me.ledger.cur
  me.ledger.prevLabel = me.ledger.label
  me.ledger.cur = emptyBook()
  me.ledger.label = stageNameIn(state.year, state.stage, onTimeline(state))
}

export const ledgerSum = (o: Record<string, number> | undefined): number =>
  Object.values(o ?? {}).reduce((a, b) => a + b, 0)

/* ------------------------------------------------------------------ */
/*  奖金                                                               */
/* ------------------------------------------------------------------ */

/**
 * The place the side at `index` of the finishing order took, and which rows of
 * the event's table pay it. Sides level on a place share the rows they fill.
 * Where one event is two conferences played side by side — MENA's Resilience
 * leagues, whose two winners are joint first — each conference was paid off its
 * own copy of the table, so joint first of two is each conference's 1st.
 */
function placeAt(comp: Competition, index: number, table?: PrizeTable): { place: number; row: number; span: number } {
  const place = comp.places?.[index] ?? index + 1
  const level = comp.places ? comp.places.filter((x) => x === place).length : 1
  // joint winners are conferences only where the table has one winner: a table that pays 1st and 2nd
  // alike (Korea's 2021 Challengers sent both finalists on) is one bracket whose top two were level
  const first = table?.pay[0]
  const winners = comp.places ? comp.places.filter((x) => x === 1).length : 1
  const sides = first && first[0] === 1 && first[1] === 1 ? Math.max(1, winners) : 1
  return { place, row: Math.floor((place - 1) / sides) + 1, span: Math.max(1, Math.round(level / sides)) }
}

/** A club prize as my part of it: my contracted share, split between the roster. */
function myCut(state: GameState, amount: number): number {
  const me = state.me
  if (!me || !amount) return 0
  const p = state.players[me.id]
  const team = state.teams[p?.teamId ?? '']
  const pct = p?.contract?.bonusShare ?? 0
  if (!team || !pct) return 0
  return Math.round((amount * pct) / 100 / Math.max(1, team.roster.length))
}

/**
 * One man's slice of what his club won at a competition: the event's own table
 * at the place the club took, his contracted share of it, split between the
 * roster. `index` is the club's position in `comp.finished`.
 */
export function prizeShare(state: GameState, comp: Competition, index: number): number {
  const { row, span } = placeAt(comp, index, prizeTableOf(comp, state.year))
  return myCut(state, prizeFor(comp, row, state.year, span))
}

/**
 * Pay me for anything my club has finished and been awarded for that I have
 * not been paid for yet. Called on the weekly settle, so the money lands in
 * the same week the trophy does.
 *
 * A competition is only counted once — the key is year + competition — and
 * only if I was on that roster when it was settled, which is what
 * `finished.includes(my team)` and the club check together mean. An event
 * whose amounts were never published pays its estimate, and the line says
 * 「（估算）」; one with no estimate pays nothing.
 */
export function prizeWeek(state: GameState): void {
  const me = state.me!
  if (me.phase !== 'pro') return
  const p = state.players[me.id]
  if (!p?.teamId) return
  me.prizePaid ??= []
  for (const comp of Object.values(state.comps)) {
    if (!comp.awarded) continue
    const place = comp.finished.indexOf(p.teamId)
    if (place < 0) continue
    const key = `${state.year}:${comp.key}`
    if (me.prizePaid.includes(key)) continue
    me.prizePaid.push(key)
    const cut = prizeShare(state, comp, place)
    if (!cut) continue
    addMoney(state, 'prize', cut)
    const est = prizeTableOf(comp, state.year).status === 'est' ? '（估算）' : ''
    pushLog(state, 'money', `${compCn(comp.name)} 第 ${placeAt(comp, place).place} 名，奖金分成到账 $${cut.toLocaleString()}${est}。`)
  }
  if (me.prizePaid.length > 60) me.prizePaid.splice(0, me.prizePaid.length - 60)
}

/* ------------------------------------------------------------------ */
/*  the economy page: what the events in front of me pay               */
/* ------------------------------------------------------------------ */

export interface PrizeLine {
  key: string
  name: string
  table: PrizeTable
  /** my own part of 1st, 2nd and 3rd */
  mine: number[]
  /** under way, with my club in it */
  now: boolean
}

/** What 1st, 2nd and 3rd at a competition would come to for me, on my contract. */
export function prizePreview(state: GameState, comp: Competition): number[] {
  return [1, 2, 3].map((place) => myCut(state, prizeFor(comp, place, state.year)))
}

/**
 * Could my club end up at this event? Only for choosing what the economy page
 * lists — the circuit decides who really plays. A league club: its league's
 * events and the internationals. A Challengers club: its own scene, its
 * league's Ascension and open events. Before 2023: its region's circuit.
 */
function inReach(state: GameState, comp: Competition, team: Team): boolean {
  const y = state.year
  if (!comp.circuit) return comp.region ? comp.region === team.region && (comp.tier ?? team.tier) === team.tier : team.tier === 1
  const ev = eventOf(comp.circuit.id)
  if (!ev) return false
  if (!ev.region) return y <= 2022 || team.tier === 1
  const home = ev.region === team.region || !!ev.layer?.includes(team.region)
  if (y <= 2022) return home
  if (ev.scene) return team.tier === 2 && (team.scene ? team.scene === ev.scene : home)
  const league = regionIn(team.region, y) === ev.region
  // 2023: China had no league, and its FGC acts were its clubs' events
  if (y === 2023 && ev.region === 'China') return league || home
  const kind = ev.plan?.kind
  // 2027 on: the Open Playoffs take a league's bottom four and the open qualifiers' best
  if (kind === 'open') return league
  if (kind === 'kickoff' || kind === 'cup' || (!kind && isLeagueEvent(y, ev))) return team.tier === 1 && league
  return team.tier === 2 && (league || home)
}

const startOf = (state: GameState, comp: Competition): number =>
  comp.circuit?.start ?? stagesOf(state.year, onTimeline(state)).find((s) => s.key === comp.stage)?.start ?? 0

/** The events under way with my club in them, then the next ones it can reach, soonest first. */
export function prizeRows(state: GameState, limit = 5): PrizeLine[] {
  const me = state.me
  const team = state.teams[state.players[me?.id ?? '']?.teamId ?? '']
  if (!me || !team) return []
  return Object.values(state.comps)
    .filter((c) => !c.awarded && !c.champion && !c.circuit?.done)
    .map((c) => ({ c, start: startOf(state, c), entered: c.teams.includes(team.id) }))
    .filter((x) => (x.start <= state.day ? x.entered : x.entered || inReach(state, x.c, team)))
    .sort((a, b) => a.start - b.start)
    .slice(0, limit)
    .map(({ c, start }) => ({ key: c.key, name: c.name, table: prizeTableOf(c, state.year), mine: prizePreview(state, c), now: start <= state.day }))
}
