import type { GameState, Region } from '../types'
import { duoBonded } from '../bonds'
import { regionIn } from '../era'
import type { EventDef, EventOpt } from './events'
import { pushLog } from './log'

/**
 * The two ways a choice keeps going after its card has closed.
 *
 * 伏笔 → 回响: an option plants a seed — which way it went, in its own words,
 * with the day it was said. Weeks or a season later an echo reads the seed and
 * comes back differently for each way it went (the echoes and when they may
 * come are in me/storyweek.ts). The card that echoes says what it echoes.
 *
 * Chains: a thing with a deadline, three choices long, where the weeks between
 * the choices are the point. Each answer sets a task the week's plan or the
 * matches can meet (训练赛 3 次, 和他双排一次, 两周别开播), and the next card
 * reads whether it was met. Leaving the task undone is a choice too, and it is
 * the next card that says what it cost. One chain at a time, shown as a single
 * line on the week screen while it runs.
 *
 * This file is the light half — state, the answer, the words — so events.ts can
 * call it without pulling the transfer market in behind it.
 */

export interface SeedRec {
  /** which way the choice went */
  v: string
  /** the option's own words, quoted back when it echoes */
  t: string
  day: number
  year: number
  /** career week it was planted */
  wk: number
  /** career week it echoed; -1 = let go without echoing */
  echo?: number
}

/** what the weeks between two cards are measured on */
export type Track = 'win' | 'scrim' | 'stream' | 'vod' | 'duo' | 'quiet' | 'window'
export type ChainEnd = 'ok' | 'miss' | 'drop' | 'expired'

/** What an option on a chain's card does to the chain. */
export interface ChainOp {
  /** the task for the weeks until the next card; omitted keeps the current one and its count */
  track?: Track
  need?: number
  /** weeks until the next card */
  weeks?: number
  /** credited to the task now */
  add?: number
  /** toward the outcome where the chain reads one (the overseas club) */
  score?: number
  /** the chain's own teammate, not a random one */
  mate?: number
  /** the chain is over */
  end?: ChainEnd
}

export interface ChainLive {
  id: string
  /** cards answered */
  step: number
  /** career week it opened */
  wk: number
  /** the last career week of the current task; the next card comes at that week's settlement */
  due: number
  track?: Track
  need?: number
  /** what the weeks already settled contributed */
  got?: number
  /** a 'win' task counts official matches from here */
  fromYear?: number
  fromDay?: number
  score: number
  /** the teammate a rift is with */
  mate?: string
  /** the club an overseas interest comes from */
  club?: string
  /** the seed this chain grew out of — its first card echoes it */
  from?: string
  /** a card is out and waiting on an answer */
  asked?: string
}

export const CHAIN_CN: Record<string, string> = {
  showcase: '合同年', overseas: '外区邀约', storm: '直播风波', rift: '队内矛盾',
}
const END_CN: Record<ChainEnd, string> = { ok: '有了结果', miss: '没能如愿', drop: '就此放下', expired: '不了了之' }

// ------------------------------------------------------------------ conditions the cards use

export const isPro = (s: GameState): boolean => s.me!.phase === 'pro'
export const isPre = (s: GameState): boolean => s.me!.phase !== 'pro'
export const isStarter = (s: GameState): boolean => isPro(s) && !!s.teams[s.myTeam]?.starters.includes(s.me!.id)
export const isBenched = (s: GameState): boolean => isPro(s) && !s.teams[s.myTeam]?.starters.includes(s.me!.id)
export const clubTier = (s: GameState): number => (isPro(s) ? s.teams[s.myTeam]?.tier ?? 0 : 0)

/** the scene I play in — my club's, or my own without one — as one of today's four */
export function macroOf(s: GameState): Region {
  const me = s.me!
  const r = me.phase === 'pro' ? s.teams[s.myTeam]?.region ?? me.region : me.region
  return regionIn(r, 2099)
}

/** my club is at a Masters or Champions and still in it */
export function atIntl(s: GameState): boolean {
  if (!isPro(s)) return false
  return (['masters1', 'masters2', 'champions'] as const).some((k) => {
    const c = s.comps[k]
    return !!c && !c.champion && c.teams.includes(s.myTeam) && !(c.finished ?? []).includes(s.myTeam)
  })
}

// ------------------------------------------------------------------ seeds

export function plantSeed(state: GameState, key: string, v: string, t: string): void {
  const me = state.me!
  const seeds = (me.seeds ??= {})
  const old = seeds[key]
  // the same choice made again keeps its first date — and once it has come back, it does not come back twice
  if (old && old.v === v) return
  seeds[key] = { v, t, day: state.day, year: state.year, wk: me.week }
}

export const seedOf = (state: GameState, key: string): SeedRec | undefined => state.me?.seeds?.[key]

/** planted, this way (any way if v is omitted), and not come back yet */
export function seedLive(state: GameState, key: string, v?: string[]): SeedRec | undefined {
  const s = seedOf(state, key)
  return s && s.echo == null && (!v || v.includes(s.v)) ? s : undefined
}

const monthOf = (s: { year: number; day: number }): number => new Date(Date.UTC(s.year, 0, 1 + s.day)).getUTCMonth() + 1

// ------------------------------------------------------------------ chains

export const chainIs = (state: GameState, id: string): boolean => state.me?.chain?.id === id

export function closeChain(state: GameState, end: ChainEnd, line?: string): void {
  const me = state.me!
  const c = me.chain
  if (!c) return
  me.chain = undefined
  const done = (me.chainsDone ??= [])
  done.push({ id: c.id, wk: me.week, end, steps: c.step })
  if (done.length > 16) done.splice(0, done.length - 16)
  me.flags.chainEnd = me.week
  pushLog(state, end === 'ok' ? 'good' : end === 'miss' ? 'bad' : 'event', line ?? `「${CHAIN_CN[c.id] ?? '那件事'}」${END_CN[end]}。`)
}

/** this week's plan, as it counts toward the task — booked at the settlement */
export function chainWeekCount(state: GameState, c: ChainLive): number {
  const me = state.me!
  const plan = me.plan
  switch (c.track) {
    case 'scrim': return plan.scrim ?? 0
    case 'stream': case 'quiet': return plan.stream ?? 0
    case 'vod': return plan.vod ?? 0
    case 'duo': return (plan.duo ?? 0) > 0 && me.duoWith === c.mate ? plan.duo ?? 0 : 0
  }
  return 0
}

/** where the task stands, this week's plan included */
export function chainProgress(state: GameState, c: ChainLive): number {
  const me = state.me!
  if (c.track === 'win') {
    const y = c.fromYear ?? 0
    const d = c.fromDay ?? 0
    return (c.got ?? 0) + me.matches.filter((m) => !m.friendly && m.started && m.won && (m.year > y || (m.year === y && m.day >= d))).length
  }
  return (c.got ?? 0) + chainWeekCount(state, c)
}

export function chainMet(state: GameState, c: ChainLive): boolean {
  const n = chainProgress(state, c)
  return c.track === 'quiet' ? n <= (c.need ?? 0) : n >= (c.need ?? 1)
}

/**
 * Whatever an answer plants or moves. Called by resolveEvent after the
 * option's own effects; returns lines for the result card.
 */
export function storyChoice(state: GameState, ev: EventDef, opt: EventOpt): string[] {
  const me = state.me!
  const out: string[] = []
  if (opt.seed) {
    const i = opt.seed.indexOf(':')
    plantSeed(state, opt.seed.slice(0, i), opt.seed.slice(i + 1), opt.t)
  }
  const c = me.chain
  if (!c || !ev.chain || ev.chain !== c.id) return out
  const op = opt.ch
  c.asked = undefined
  c.step++
  if (op?.mate && c.mate && state.players[c.mate]) {
    duoBonded(state, me.id, c.mate, op.mate)
    out.push(`和 ${state.players[c.mate].ign} 的关系 ${op.mate > 0 ? '+' : ''}${op.mate}`)
  }
  if (op?.score) c.score += op.score
  if (!op || op.end) {
    closeChain(state, op?.end ?? 'drop')
    return out
  }
  if (op.track) {
    c.track = op.track
    c.need = op.need ?? (op.track === 'quiet' ? 0 : 1)
    c.got = 0
    c.fromYear = state.year
    c.fromDay = state.day
  }
  if (op.add) c.got = (c.got ?? 0) + op.add
  // a window's weeks are the market's to say; storyweek.ts fills them in
  c.due = c.track === 'window' ? me.week : me.week + Math.max(1, op.weeks ?? 2) - 1
  return out
}

// ------------------------------------------------------------------ words

const TASK_CN = (t: Track, need: number, weeks: number): string => {
  switch (t) {
    case 'win': return `${weeks} 周内首发赢 ${need} 场正赛`
    case 'scrim': return `${weeks} 周内训练赛 ${need} 次`
    case 'stream': return `${weeks} 周内直播 ${need} 次`
    case 'vod': return `${weeks} 周内复盘 ${need} 次`
    case 'duo': return `${weeks} 周内和他双排 ${need} 次`
    case 'quiet': return `${weeks} 周内不开播`
    case 'window': return '等转会窗开'
  }
}

/** What an option does to the story, after its effects on the button. */
export function storyHint(opt: EventOpt): string {
  const out: string[] = []
  const op = opt.ch
  if (op) {
    if (op.mate) out.push(`和他的关系 ${op.mate > 0 ? '+' : ''}${op.mate}`)
    if (op.add) out.push(`进度 +${op.add}`)
    if (op.end === 'drop') out.push('就此放下')
    else if (op.track) out.push(TASK_CN(op.track, op.need ?? 1, op.weeks ?? 2))
    else if (!op.end && op.weeks) out.push(`再给 ${op.weeks} 周`)
  }
  if (opt.seed) out.push('伏笔')
  return out.filter(Boolean).join(' · ')
}

/** The lines over a card that belongs to a story: what it echoes, which chain and which step. */
export function storyTag(state: GameState, ev: EventDef): string[] {
  const me = state.me
  if (!me) return []
  const out: string[] = []
  const c = me.chain
  const key = ev.echo ?? (ev.chain && c?.id === ev.chain && c.step === 0 ? c.from : undefined)
  const s = key ? me.seeds?.[key] : undefined
  if (s) out.push(`↩ 回响 · ${s.year}年${monthOf(s)}月，你选了「${s.t}」`)
  if (ev.chain && c?.id === ev.chain) {
    const who = c.mate ? state.players[c.mate]?.ign : undefined
    const club = c.club ? state.teams[c.club]?.name : undefined
    out.push(`⏳ ${CHAIN_CN[c.id]}${who ? ` · 和 ${who}` : club ? ` · ${club}` : ''} · 第 ${c.step + 1} 步`)
  }
  return out
}

/** The one line the week screen shows while a chain runs. Short enough for a phone. */
const TRACK_SHORT: Record<string, string> = { win: '首发赢', scrim: '训练赛', stream: '直播', vod: '复盘' }

/**
 * The one line the week screen shows while a chain runs. The time left comes
 * first, so on a narrow phone it is the name of the task that gets cut, not
 * the deadline; a long IGN is shortened for the same reason.
 */
export function chainLine(state: GameState): string | null {
  const me = state.me
  const c = me?.chain
  if (!me || !c) return null
  const name = CHAIN_CN[c.id] ?? '悬而未决'
  if (c.asked || !c.track) return `⏳ ${name} · 等你拿主意`
  if (c.track === 'window') {
    const left = c.due - me.week
    return `⏳ ${left > 0 ? `剩 ${left} 周` : '这周'} · ${name} · 等转会窗`
  }
  const left = c.due - me.week + 1
  const got = chainProgress(state, c)
  const need = c.need ?? 1
  const ign = (c.mate && state.players[c.mate]?.ign) || '他'
  const who = ign.length > 6 ? `${ign.slice(0, 5)}…` : ign
  const task = c.track === 'quiet'
    ? (got ? `说好不播，播了 ${got} 次` : '别开播')
    : c.track === 'duo'
      ? `和 ${who} 双排 ${Math.min(got, need)}/${need}`
      : `${TRACK_SHORT[c.track] ?? ''} ${Math.min(got, need)}/${need}`
  return `⏳ ${left > 1 ? `剩 ${left} 周` : '本周见分晓'} · ${name} · ${task}`
}
