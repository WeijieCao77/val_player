import type { GameState } from '../types'
import type { Deal, Invite } from './types'
import { pop, push } from './pending'

/**
 * 放着的报价 — a card closed without being answered.
 *
 * Reported 2026-09-14: 「转会报价的弹窗点不了关闭，如果玩家需要做一些思考再回来做决定这个关闭点不了就很不好…
 * 玩家点了关闭弹窗之后也可以在转会栏目找到这次报价」. A transfer offer, a first contract, a renewal and a tryout
 * invitation all stopped the clock until they were answered, and the card's 关闭 ✕ did nothing (ui/me/Modals.tsx
 * passed an empty onClose).
 *
 * Closing one now only takes its card off the list (me/pending.ts): the offer itself stays on the table — the
 * 转会 page lists it with 去谈 / 去答复 — until the day it runs out. Nothing set aside stops the clock, holds
 * 快进 back, or comes back as a card by itself; the week screen says a line when one is about to go, and a run
 * of several weeks hands the week back once before the week it goes in (me/auto.ts advanceUntil).
 *
 * A decision that is not an offer stays a decision: a tryout under way, an event, a cup's match day and the
 * coach's offer to call are answered, not put aside.
 */

const DAY_MS = 86_400_000
/** the absolute day the window counts in (me/window.ts absDay), kept here so this module hangs off nothing */
const absOf = (year: number, day: number): number => Math.round(Date.UTC(year, 0, 1) / DAY_MS) + day
const todayOf = (state: GameState): number => absOf(state.year, state.day)

export type AsideKind = 'deal' | 'invite'

/**
 * The year an offer's `day` and `expires` count in. `state.day` is a day of its own year and starts over every
 * New Year, while a winter offer's `expires` runs past the year's last day — an offer made in December needs its
 * own year to say how long it has left, or it would sit on the table a whole year more. A save from before this
 * kept no year: its id was written with one (me/contract.ts makeDeal, me/prepro.ts makeInvite).
 */
export function yearOf(state: GameState, x: Deal | Invite): number {
  if (typeof x.year === 'number') return x.year
  const y = Number(x.id.split(':')[1])
  return y >= 2000 && y <= 2100 ? y : state.year
}

/** Days an offer has after today: 0 is its last day, below 0 it has run out. Across a turn of the year too. */
export function daysLeft(state: GameState, x: Deal | Invite): number {
  return absOf(yearOf(state, x), x.expires) - todayOf(state)
}

/** 「14 天内」, and on the last day 「今天之内」. */
export const withinCn = (left: number): string => (left <= 0 ? '今天之内' : `${left} 天内`)

/** what the card calls itself (ui/me/Modals.tsx titles) */
export const dealWord = (d: Deal): string => (d.kind === 'renew' ? '续约' : d.kind === 'transfer' ? '转会报价' : '合同')
export const inviteWord = (i: Invite): string => (i.direct ? '报价' : '试训邀请')

export interface AsideItem {
  kind: AsideKind
  id: string
  teamId: string
  /** days after today; 0 is its last */
  left: number
  /** the absolute day it is good through, so what ran out can be told from what was signed (lapsedSince) */
  end: number
  what: string
  /** a run of several weeks has already handed the week back once for it */
  warned: boolean
}

const offerOf = (state: GameState, kind: AsideKind, id: string): Deal | Invite | undefined =>
  kind === 'deal' ? state.me?.deals.find((d) => d.id === id) : state.me?.pre.invites.find((i) => i.id === id)

/**
 * Everything on the table whose card is not in front of me: closed without an answer, or left to run out by
 * 托管 (me/auto.ts autoResolve). The invitation a tryout is being played on is not one of them — that tryout's
 * own card is up, and it is not mine to put aside.
 */
export function asideItems(state: GameState): AsideItem[] {
  const me = state.me
  if (!me) return []
  const carded = (kind: AsideKind, id: string): boolean => me.pending.some((x) => x.kind === kind && x.id === id)
  const out: AsideItem[] = []
  for (const d of me.deals) {
    if (carded('deal', d.id)) continue
    out.push({ kind: 'deal', id: d.id, teamId: d.teamId, left: daysLeft(state, d), end: absOf(yearOf(state, d), d.expires), what: dealWord(d), warned: !!d.warned })
  }
  for (const i of me.pre.invites) {
    if (carded('invite', i.id) || me.tryout?.inviteId === i.id) continue
    out.push({ kind: 'invite', id: i.id, teamId: i.teamId, left: daysLeft(state, i), end: absOf(yearOf(state, i), i.expires), what: inviteWord(i), warned: !!i.warned })
  }
  return out.sort((a, b) => a.left - b.left)
}

/**
 * 关闭 ✕ on an offer's card: the card comes off the list without being answered, and the offer waits on the
 * 转会 page. Returns the line said on screen — where it went, and how long it has.
 */
export function setAside(state: GameState, kind: AsideKind, id: string): string {
  const x = offerOf(state, kind, id)
  pop(state, kind, id)
  if (!x) return ''
  const when = withinCn(daysLeft(state, x))
  if (kind === 'deal') return `这份${dealWord(x as Deal)}放在「转会」页，${when}回来谈。`
  return `${(x as Invite).direct ? '这份报价' : '试训邀请'}放在「转会」页，${when}回复。`
}

/** 去谈 / 去答复: its card back in front of everything (ui/me/TransferScreen.tsx), and only ever one of it. */
export function reopen(state: GameState, kind: AsideKind, id: string): void {
  const me = state.me
  if (!me) return
  push(state, { kind, id })
  const i = me.pending.findIndex((x) => x.kind === kind && x.id === id)
  if (i > 0) me.pending.unshift(...me.pending.splice(i, 1))
}

/** 「DetonatioN FocusMe 的转会报价明天过期」, 「… 5 天后过期」 */
export function asideLine(state: GameState, x: AsideItem): string {
  const name = state.teams[x.teamId]?.name ?? '那家俱乐部'
  return `${name} 的${x.what}${x.left <= 0 ? '明天过期' : ` ${x.left + 1} 天后过期`}`
}

/**
 * The week screen's reminder: whatever is set aside and runs out before this week is over — one press of
 * 推进一周 would carry the clock past it — and so, at the latest, the day before it goes. A line over the
 * button, never a card: an offer I put aside does not get to stop the week again.
 */
export function asideReminders(state: GameState): string[] {
  const me = state.me
  if (!me) return []
  const ahead = Math.max(1, 7 - me.weekDay)
  return asideItems(state).filter((x) => x.left + 1 <= ahead).map((x) => asideLine(state, x))
}

/**
 * A run of several weeks hands the week back once for a set-aside offer, at the start of the week it runs out
 * in — a fortnight of 快进 should not quietly lose a renewal I meant to come back to, and losing a renewal is
 * losing the club. Once only: it is marked as it is said, so the next press runs straight on and the offer
 * lapses on its own day. The week I set it aside in never stops — the reminder line is already over the button.
 * The dials have nothing to do with this: 托管 never answers what I put aside, so there is no dial to hand it to.
 */
export function asideStop(state: GameState): string | undefined {
  const x = asideItems(state).find((a) => !a.warned && a.left + 1 <= 7)
  if (!x) return undefined
  const o = offerOf(state, x.kind, x.id)
  if (o) o.warned = 1
  return `${asideLine(state, x)}（放在「转会」页，还没答复）`
}

/** What ran out while the clock ran, for a run's summary (me/auto.ts advanceUntil) — not what a signature cleared. */
export function lapsedSince(state: GameState, before: AsideItem[]): string[] {
  const today = todayOf(state)
  return before
    .filter((x) => !offerOf(state, x.kind, x.id) && x.end < today)
    .map((x) => `${state.teams[x.teamId]?.name ?? '那家俱乐部'} 的${x.what}过期了`)
}
