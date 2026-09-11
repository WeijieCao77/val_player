import { Rng, hashStr } from '../rng'
import type { GameState, Team } from '../types'
import { bondBetween } from '../bonds'
import { regionIn } from '../era'
import { hasPlace } from '../timeline'
import type { EffectSpec, MeAction } from './types'
import { eventOf, fireEvent } from './events'
import { applyEffect } from './fx'
import { pushLog } from './log'
import { push } from './pending'
import { makeDeal } from './contract'
import { gradeOf } from './tryout'
import { expectOf, tryoutSkill } from './prepro'
import { PLAYER_WINDOWS, nextWindow, proPerf } from './transfer'
import type { ChainLive } from './story'
import { CHAIN_CN, chainProgress, chainWeekCount, closeChain, isPro, isStarter, seedLive } from './story'

/**
 * The weekly half of me/story.ts: which seeds come back this week, where the
 * chain under way stands, and whether a new one opens. Called once from the
 * weekly settlement, before the random draw, so a week holds at most one of
 * these cards and the draw steps aside for it.
 */

// ------------------------------------------------------------------ echoes

interface EchoDef {
  key: string
  /** the ways the choice went that this echo answers */
  v: string[]
  /** weeks after planting before it can come back */
  after: number
  /** per eligible week */
  chance: number
  when: (s: GameState) => boolean
  /** a card to answer… */
  ev?: string
  /** …or just a line in the week, with what it did */
  note?: string
  e?: EffectSpec
}

/** Every seed answered differently for each way it went. */
const ECHOES: EchoDef[] = [
  { key: 'boost', v: ['took'], after: 20, chance: 0.12, when: (s) => isPro(s) && s.me!.fans >= 60, ev: 'echo_boost' },
  { key: 'boost', v: ['no'], after: 20, chance: 0.1, when: isPro,
    note: '代练工作室被封，流出来的名单里没有你——那年私信找上门的那一单，你没接。', e: { mental: 2, heat: 8 } },
  { key: 'cheat', v: ['cam'], after: 16, chance: 0.12, when: (s) => isPro(s) || s.me!.fans >= 120, ev: 'echo_cheat_cam' },
  { key: 'cheat', v: ['quiet', 'fight'], after: 16, chance: 0.12, when: (s) => isPro(s) && s.me!.fans >= 60, ev: 'echo_cheat_old' },
  { key: 'fill', v: ['off'], after: 4, chance: 0.2, when: isPro,
    note: '新队的分析师翻到一场旧训练赛录像：你替人打不熟的位置，打得不难看——就是那次临时补位。', e: { coachTrust: 5, xp: { teamwork: 6 } } },
  { key: 'fill', v: ['own'], after: 4, chance: 0.2, when: isPro,
    note: '分析师在旧录像里认出了你：那次临时补位，你只肯打自己的位置。', e: { coachTrust: -3 } },
  { key: 'notes', v: ['yes'], after: 6, chance: 0.2, when: isStarter, ev: 'echo_notes' },
  { key: 'notes', v: ['no'], after: 6, chance: 0.15, when: isStarter,
    note: '对面打了一套资料里早就标出来的战术——替补那几周，整理资料的活你推掉了。', e: { tilt: 5, coachTrust: -2 } },
  { key: 'rookie', v: ['mentor'], after: 30, chance: 0.1, when: isPro, ev: 'echo_rookie_up' },
  { key: 'rookie', v: ['press'], after: 30, chance: 0.1, when: isPro, ev: 'echo_rookie_rival' },
  { key: 'home', v: ['later'], after: 8, chance: 0.2, when: () => true, ev: 'echo_home' },
  { key: 'home', v: ['went'], after: 6, chance: 0.12, when: () => true,
    note: '家里寄来一箱吃的，纸条上写着：上次回来瘦了。', e: { mental: 1, tilt: -4 } },
  { key: 'cafe', v: ['listened'], after: 10, chance: 0.12, when: isPro,
    note: '网吧里那个说自己打过职业的老哥发来消息：「那天下午讲的东西，我在你的比赛里看见了。」', e: { mental: 2, xp: { awareness: 6 } } },
  { key: 'askpro', v: ['yes'], after: 16, chance: 0.1, when: isPro,
    note: '当年训练赛后你去请教过的那位一线选手，在采访里被问到关注哪个新人，说了你的名字。', e: { heat: 25, fans: 15 } },
]

function echoTick(state: GameState, rng: Rng): boolean {
  const me = state.me!
  if (!me.seeds) return false
  for (const d of ECHOES) {
    const s = me.seeds[d.key]
    if (!s || s.echo != null || !d.v.includes(s.v)) continue
    const age = me.week - s.wk
    if (age < d.after) continue
    // five years on it is not coming back; nor is a card that has run out
    const def = d.ev ? eventOf(d.ev) : undefined
    if (age > 260 || (def && (me.eventCounts[def.id] ?? 0) >= def.max)) { s.echo = -1; continue }
    let ok = false
    try { ok = d.when(state) } catch { ok = false }
    if (!ok || !rng.chance(d.chance)) continue
    if (d.ev) {
      if (me.pendingEvent || !fireEvent(state, d.ev)) continue
    } else {
      const lines = applyEffect(state, d.e ?? {}, rng)
      pushLog(state, 'event', `回响：${d.note}${lines.length ? `（${lines.join('，')}）` : ''}`)
      me.weekNotes.push(`回响：${d.note}`)
    }
    s.echo = me.week
    me.flags.echoes = (me.flags.echoes ?? 0) + 1
    return true
  }
  return false
}

// ------------------------------------------------------------------ chains

interface ChainDef {
  id: string
  /** per career */
  max: number
  /** can it open now — and with whom, from where; null = not now */
  setup: (s: GameState, rng: Rng) => Partial<ChainLive> | null
  /** per eligible week */
  chance: (s: GameState, c: Partial<ChainLive>) => number
  opener: (s: GameState, c: ChainLive) => string
  /** the card after a task: `c.step` cards answered so far; null = the chain settles itself */
  next: (s: GameState, c: ChainLive, met: boolean) => string | null
  /** does it still make sense */
  valid: (s: GameState, c: ChainLive) => boolean
  gone?: string
  onOpen?: (s: GameState, c: ChainLive) => void
}

/** weeks between the end of one chain and the start of the next */
export const CHAIN_GAP = 14

const aged = (s: GameState, key: string, v: string[], weeks: number): boolean => {
  const r = seedLive(s, key, v)
  return !!r && s.me!.week - r.wk >= weeks
}

/** a club in another of the four, within reach, that could use me — a first-tier one, or any if I am second-tier */
function pickForeign(state: GameState, rng: Rng): Team | null {
  const me = state.me!
  const mine = state.teams[state.myTeam]
  const p = state.players[me.id]
  if (!mine || !p) return null
  const home = regionIn(mine.region, 2099)
  const pool = Object.values(state.teams).filter((t) => t.id !== mine.id && (t.tier === 1 || mine.tier === 2) && !t.dormant && hasPlace(state, t)
    && regionIn(t.region, 2099) !== home && t.roster.length <= 7 && !me.declined.includes(t.id)
    // a bar around my own level, read the way a tryout reads it — not my club's: a weak
    // player on a strong second-tier club is scouted as the player he is
    && expectOf(t) <= tryoutSkill(state) + 6 && expectOf(t) >= tryoutSkill(state) - 10)
  if (!pool.length) return null
  return rng.weighted(pool, pool.map((t) => Math.max(1, t.rating - 60)))
}

const CHAINS: ChainDef[] = [
  {
    // a contract's last year: six weeks the manager is watching
    id: 'showcase', max: 4,
    setup: (s) => {
      const p = s.players[s.me!.id]
      if (!isPro(s) || !p || p.contractYears > 1 || s.day < 35 || s.day > 230) return null
      if (s.me!.flags.showYear === s.year || s.me!.flags.renewPending) return null
      return {}
    },
    chance: () => 0.07,
    opener: () => 'ch_show_open',
    next: (_s, c, met) => (c.step === 1 ? 'ch_show_mid' : met ? 'ch_show_ok' : 'ch_show_miss'),
    valid: (s) => isPro(s),
    gone: '「合同年」没等到结果：你已经不在这支队了。',
    onOpen: (s) => { s.me!.flags.showYear = s.year },
  },
  {
    // a club abroad asks; the answer comes when the window opens
    id: 'overseas', max: 2,
    setup: (s, rng) => {
      const me = s.me!
      if (!isPro(s) || me.abroad || me.tenure < 1) return null
      const w = nextWindow(s).weeks
      if (w < 5 || w > 16) return null
      const t = pickForeign(s, rng)
      if (!t) return null
      return { club: t.id, from: aged(s, 'intlfriend', ['yes', 'card'], 8) ? 'intlfriend' : undefined }
    },
    chance: (s, c) => (c.from ? (s.me!.seeds?.intlfriend?.v === 'yes' ? 0.3 : 0.15) : proPerf(s) >= 4 ? 0.04 : 0),
    opener: (_s, c) => (c.from ? 'ch_abroad_friend' : 'ch_abroad_open'),
    next: (_s, c, met) => (c.step === 1 ? (met ? 'ch_abroad_call' : 'ch_abroad_cold') : null),
    valid: (s, c) => isPro(s) && !s.me!.abroad && !!c.club && !!s.teams[c.club] && s.myTeam !== c.club,
    gone: '「外区邀约」不了了之：你的处境变了，那边也没再来消息。',
  },
  {
    // a clip from the stream, and what to do about it
    id: 'storm', max: 2,
    setup: (s) => {
      const me = s.me!
      if (me.stream.total < 3 || me.fans < 80) return null
      return { from: aged(s, 'benchtalk', ['said'], 1) ? 'benchtalk' : undefined }
    },
    chance: (_s, c) => (c.from ? 0.35 : 0.02),
    opener: () => 'ch_storm_open',
    next: (_s, c, met) => (c.step === 1 ? (met ? 'ch_storm_calm' : 'ch_storm_flare') : met ? 'ch_storm_ok' : 'ch_storm_bad'),
    valid: () => true,
  },
  {
    // a teammate and a round neither of you has let go
    id: 'rift', max: 3,
    setup: (s, rng) => {
      const me = s.me!
      if (!isPro(s)) return null
      const team = s.teams[s.myTeam]
      const mates = (team?.roster ?? []).filter((id) => id !== me.id && s.players[id])
      if (mates.length < 4) return null
      const sorted = mates.sort((a, b) => bondBetween(s, me.id, a) - bondBetween(s, me.id, b))
      return { mate: sorted[rng.int(0, 1)], from: aged(s, 'blame', ['fight'], 1) ? 'blame' : undefined }
    },
    chance: (_s, c) => (c.from ? 0.3 : 0.025),
    opener: () => 'ch_rift_open',
    next: (_s, c, met) => (c.step === 1 ? (met ? 'ch_rift_thaw' : 'ch_rift_boil') : met ? 'ch_rift_ok' : 'ch_rift_bad'),
    valid: (s, c) => isPro(s) && !!c.mate && !!s.teams[s.myTeam]?.roster.includes(c.mate),
    gone: '「队内矛盾」没来得及解开：他已经不在队里了。',
  },
]
const CHAIN_BY_ID: Record<string, ChainDef> = Object.fromEntries(CHAINS.map((c) => [c.id, c]))

/** whether the task was met, with this week's plan already booked into `got` */
function metNow(state: GameState, c: ChainLive): boolean {
  const n = c.track === 'win' ? chainProgress(state, c) : (c.got ?? 0)
  return c.track === 'quiet' ? n <= (c.need ?? 0) : n >= (c.need ?? 1)
}

/** A club that said it would come with terms at the window, coming — or not. */
function windowTick(state: GameState, c: ChainLive, rng: Rng): boolean {
  const me = state.me!
  const open = PLAYER_WINDOWS.some(([a, b]) => state.day >= a && state.day <= b)
  if (!open) {
    c.due = me.week + nextWindow(state).weeks
    return false
  }
  const t = c.club ? state.teams[c.club] : undefined
  const keen = c.score >= 1 || rng.chance(0.45)
  if (t && keen && !t.dormant && hasPlace(state, t) && !me.declined.includes(t.id) && t.id !== state.myTeam) {
    const deal = makeDeal(state, t.id, 'transfer', gradeOf(tryoutSkill(state) - expectOf(t) + 4 + c.score * 3), rng)
    me.deals.push(deal)
    push(state, { kind: 'deal', id: deal.id })
    closeChain(state, 'ok', `外区邀约：转会窗开了，${t.name} 按之前谈的开出了报价。`)
    me.weekNotes.push(`${t.name} 按之前谈的开出了报价。`)
    return true
  }
  closeChain(state, 'miss', `外区邀约：转会窗开了，${t?.name ?? '那家俱乐部'} 最后签了别人。`)
  return false
}

function chainTick(state: GameState, rng: Rng): boolean {
  const me = state.me!
  const c = me.chain!
  const def = CHAIN_BY_ID[c.id]
  if (!def) { closeChain(state, 'expired'); return false }
  if (!def.valid(state, c)) { closeChain(state, 'expired', def.gone ?? `「${CHAIN_CN[c.id]}」不了了之。`); return false }
  // a card of this chain is out: wait for the answer; a card that went missing takes the chain with it
  if (c.asked) {
    if (me.pendingEvent === c.asked) return false
    closeChain(state, 'expired')
    return false
  }
  if (me.week - c.wk > 45) { closeChain(state, 'expired'); return false }
  if (c.track === 'window') return windowTick(state, c, rng)
  if (c.track && c.track !== 'win') c.got = (c.got ?? 0) + chainWeekCount(state, c)
  if (me.week < c.due) return false
  // something else is on screen: the card comes next week, and so does one more week of the task
  if (me.pendingEvent) return false
  const met = c.track ? metNow(state, c) : true
  const id = def.next(state, c, met)
  if (!id) { closeChain(state, met ? 'ok' : 'miss'); return false }
  if (!fireEvent(state, id)) { closeChain(state, 'expired'); return false }
  c.asked = id
  return true
}

/** Open a chain now: its first card goes in front of me. Also what the probe uses to force one. */
export function openChain(state: GameState, id: string, rng: Rng, setup?: Partial<ChainLive> | null): boolean {
  const me = state.me!
  const def = CHAIN_BY_ID[id]
  if (!def || me.chain || me.pendingEvent) return false
  const s = setup ?? def.setup(state, rng)
  if (!s) return false
  const c: ChainLive = { id, step: 0, wk: me.week, due: me.week, score: 0, ...s }
  me.chain = c
  const opener = def.opener(state, c)
  if (!fireEvent(state, opener)) { me.chain = undefined; return false }
  c.asked = opener
  me.flags[`chain_${id}`] = (me.flags[`chain_${id}`] ?? 0) + 1
  // a chain grown from a seed is that seed's echo
  const seed = c.from ? me.seeds?.[c.from] : undefined
  if (seed) { seed.echo = me.week; me.flags.echoes = (me.flags.echoes ?? 0) + 1 }
  def.onOpen?.(state, c)
  return true
}

function chainStart(state: GameState, rng: Rng): boolean {
  const me = state.me!
  if (me.pendingEvent || me.week < 4) return false
  if (me.week - (me.flags.chainEnd ?? -99) < CHAIN_GAP) return false
  for (const def of rng.shuffle(CHAINS)) {
    if ((me.flags[`chain_${def.id}`] ?? 0) >= def.max) continue
    let setup: Partial<ChainLive> | null = null
    try { setup = def.setup(state, rng) } catch { setup = null }
    if (!setup || !rng.chance(def.chance(state, setup))) continue
    if (openChain(state, def.id, rng, setup)) return true
  }
  return false
}

/**
 * The week's story beat, from the weekly settlement: the chain under way first,
 * then a seed coming back, then perhaps a new chain. At most one card.
 */
export function storyWeek(state: GameState): void {
  const me = state.me
  if (!me || me.phase === 'retired') return
  const rng = new Rng(hashStr(`story:${state.seed}:${state.year}:${state.day}:${me.week}`))
  if (me.chain && chainTick(state, rng)) return
  if (echoTick(state, rng)) return
  if (!me.chain) chainStart(state, rng)
}

/**
 * 按推荐 keeps a live chain's task in the week: the hours it needs, or the
 * stream it must not have. `set` is week.ts setPlan, passed in so this file
 * does not import the week it is called from.
 */
export function storyPlan(state: GameState, set: (k: MeAction, d: 1 | -1) => boolean): void {
  const me = state.me
  const c = me?.chain
  if (!me || !c?.track || c.asked || c.track === 'win' || c.track === 'window') return
  const plan = me.plan
  if (c.track === 'quiet') {
    // a signed platform's minimum is a contract; the chain can lose to it
    const owed = !!me.stream.deal && me.stream.thisStage < me.stream.deal.minPerStage
    let guard = 0
    if (!owed) while ((plan.stream ?? 0) > 0 && guard++ < 8 && set('stream', -1)) { /* taken back */ }
    guard = 0
    while (me.ap > 0 && guard++ < 8 && set('ranked', 1)) { /* the hours go to the ladder instead */ }
    return
  }
  if ((c.need ?? 1) - chainProgress(state, c) <= 0) return
  const key = c.track as MeAction
  if (!(plan[key] ?? 0)) {
    // room first: the week's least important hours make way
    for (const k of ['ranked', 'stream', 'content', 'aim', 'util', 'vod', 'rest'] as MeAction[]) {
      if (set(key, 1)) break
      if (k !== key && (plan[k] ?? 0) > 0) set(k, -1)
    }
  }
  if (key === 'duo' && (plan.duo ?? 0) > 0) me.duoWith = c.mate
}
