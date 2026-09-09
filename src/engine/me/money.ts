import { PRIZE } from '../finance'
import { stageName } from '../season'
import type { GameState, StageKey } from '../types'
import { pushLog } from './log'
import type { LedgerBook, MoneyKind } from './types'

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
 * Rule 2 needed less work than expected. engine/finance.ts's `awardPrize`
 * already reads each man's contracted `bonusShare`, already subtracts the
 * squad's cut from what the club banks, and already writes 「选手奖金分成」
 * into the club's books. The money was being taken out of the club and paid
 * to nobody. `prizeShare()` below is the same arithmetic, so the two halves
 * cannot drift, and the player finally receives what the club was already
 * being charged for.
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
  if (!me.ledger) initLedger(state, stageName(state.stage))
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
  if (!me.ledger) { initLedger(state, stageName(state.stage)); return }
  me.ledger.prev = me.ledger.cur
  me.ledger.prevLabel = me.ledger.label
  me.ledger.cur = emptyBook()
  me.ledger.label = stageName(state.stage)
}

export const ledgerSum = (o: Record<string, number> | undefined): number =>
  Object.values(o ?? {}).reduce((a, b) => a + b, 0)

/* ------------------------------------------------------------------ */
/*  奖金                                                               */
/* ------------------------------------------------------------------ */

/**
 * One man's slice of a competition's prize, by the club's own arithmetic.
 *
 * engine/finance.ts charges the club `amount * bonusShare / 100 / squadSize`
 * per player. This returns exactly that for one player, so what the club is
 * billed and what the player receives are the same number.
 */
export function prizeShare(state: GameState, stage: StageKey, place: number): number {
  const me = state.me
  if (!me) return 0
  const p = state.players[me.id]
  const team = state.teams[p?.teamId ?? '']
  const pct = p?.contract?.bonusShare ?? 0
  if (!team || !pct) return 0
  const amount = PRIZE[stage]?.[place] ?? 0
  if (!amount) return 0
  return Math.round((amount * pct) / 100 / Math.max(1, team.roster.length))
}

/**
 * Pay me for anything my club has finished and been awarded for that I have
 * not been paid for yet. Called on the weekly settle, so the money lands in
 * the same week the trophy does.
 *
 * A competition is only counted once — the key is year + competition — and
 * only if I was on that roster when it was settled, which is what
 * `finished.includes(my team)` and the club check together mean.
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
    const cut = prizeShare(state, comp.stage, place)
    if (!cut) continue
    addMoney(state, 'prize', cut)
    pushLog(state, 'money', `${comp.name} 第 ${place + 1} 名，奖金分成到账 $${cut.toLocaleString()}。`)
  }
  if (me.prizePaid.length > 60) me.prizePaid.splice(0, me.prizePaid.length - 60)
}

/** The published table, for the screen that says what a placing is worth. */
export const PRIZE_ROWS: { stage: StageKey; name: string }[] = [
  { stage: 'challengers1', name: '挑战者联赛第一赛段' },
  { stage: 'challengers2', name: '挑战者联赛第二赛段' },
  { stage: 'kickoff', name: '启航赛' },
  { stage: 'stage1', name: '第一赛段' },
  { stage: 'stage2', name: '第二赛段' },
  { stage: 'masters1', name: '第一次大师赛' },
  { stage: 'masters2', name: '第二次大师赛' },
  { stage: 'champions', name: '冠军赛' },
]

/** What the top three places pay a player on my contract, for the prize table. */
export function prizePreview(state: GameState, stage: StageKey): number[] {
  return [0, 1, 2].map((i) => prizeShare(state, stage, i))
}
