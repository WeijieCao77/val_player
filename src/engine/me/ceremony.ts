import { clamp } from '../rng'
import { onTimeline, stageNameIn } from '../era'
import type { GameState } from '../types'
import { pushLog } from './log'
import { push } from './pending'
import type { CerKind, CerTier, Ceremony } from './types'
import { compCn } from './compname'
import { NIGHTS, awardsNight, isNight, nightApply, patchNight, showmatchNight } from './nights'

/**
 * The nights that are not matches.
 *
 * Ported from 破晓's cer.ts, and the placement is the argument. 破晓 puts its
 * minigames here and nowhere else, and the reason holds for us: a minigame
 * inside the training loop is a tax you pay every week, and a training week
 * you have to *play* is the fastest way to make a career sim feel like a
 * chore. Hung on a ceremony it is the opposite — it happens four or five
 * times a career, at the moments a player already cares about, and it is the
 * one place where your own hand, not your character's numbers, decides.
 *
 * Three rules carried over unchanged:
 *
 *  1. **Skipping is silver.** Every ceremony can be walked past, and walking
 *     past it lands on the neutral middle — never a penalty. A player who
 *     does not want to play the little game is not punished for it; they just
 *     do not get the good outcome. The autopilot takes silver too.
 *  2. **The result covers a whole stage**, not a week. A ceremony that moved
 *     one week's training would not be worth stopping for.
 *  3. **The minigames use Math.random, never the seeded Rng.** Everything the
 *     simulation does has to replay identically from a seed; your reflexes on
 *     one particular night do not. Keeping the two apart is what lets the
 *     match engine stay deterministic while this stays live.
 */

/** How well it went. Skipping, and the autopilot, both land on silver. */
export const TIER_CN: Record<CerTier, string> = { gold: '金档', silver: '银档', bronze: '铜档' }

/** One option on a night decided by a choice rather than a hand (me/nights.ts). */
export interface CerPick {
  key: string
  label: string
  sub?: string
  /** only colours the log line: a choice is not a grade */
  tier: CerTier
}

export interface CerDef {
  kind: CerKind
  name: string
  /** which little game it hangs on, if any */
  game: 'focus' | 'rhythm' | 'react' | 'choice' | 'none' | 'speech' | 'ace' | 'pick'
  /** the sentence before the game */
  story: (state: GameState, about: string) => string
  /** what it does, by tier */
  blurb: Record<CerTier, string>
  /** the button into the game, where 「上」 is the wrong word */
  go?: string
  /** the button out of the result */
  done?: string
  /** the line under 「直接过去」, where 「金档」 is the wrong word */
  skipNote?: string
  /** 'pick': the sentence over the options, and the options */
  ask?: string
  picks?: (state: GameState, cer: Ceremony) => CerPick[]
  /** the result's sentence, where three fixed blurbs cannot say it */
  after?: (state: GameState, cer: Ceremony) => string
}

export const CEREMONIES: Record<CerKind, CerDef> = {
  draw: {
    kind: 'draw', name: '抽签之夜', game: 'focus',
    story: (_s, about) => `${about}的抽签在台上进行。你们队被叫到名字的时候，全场的镜头一起转过来——弹幕在你身后的大屏上滚。`,
    blurb: {
      gold: '你从头到尾没看一眼大屏。整个赛事状态 +3。',
      silver: '握手、合影、走下台。状态不变。',
      bronze: '你瞄了一眼弹幕，然后就没能再挪开。整个赛事状态 −2。',
    },
  },
  depart: {
    kind: 'depart', name: '出征', game: 'rhythm',
    story: (_s, about) => `飞${about}。落地是当地的凌晨，训练室的灯已经开着了——教练说先把生物钟掰过来，别的以后再说。`,
    blurb: {
      gold: '时差倒得干净。这项赛事期间体力回得更快。',
      silver: '倒得一般。恢复照常。',
      bronze: '睡不着，白天犯困。这项赛事期间体力回得更慢。',
    },
  },
  final: {
    kind: 'final', name: '决赛入场', game: 'react',
    story: (_s, about) => `${about}。通道里很吵，但你听不见。最后一次热身，靶场里只有你和准星。`,
    blurb: {
      gold: '手是热的。这一场每张图开局就占优，临场决策也更容易成。',
      silver: '热身正常，按平时打。',
      bronze: '找不到手感。这一场每张图开局吃亏一点。',
    },
  },
  media: {
    kind: 'media', name: '媒体日', game: 'choice',
    // one a stage is a lot of the same screen, so the question is read off
    // where the career actually is — the fork is the same three tones, but
    // what you are answering is not
    story: (state, about) => `${about}前的媒体日。背景板、三台机位、一个问题：「${mediaMoment(state).q}」`,
    blurb: {
      gold: '话说得很满。热度大涨，但话说出去了就得打回来。',
      silver: '标准答案。热度小涨，挑不出毛病。',
      bronze: '你把问题引到了别人身上。热度涨了，被你点到的人听得懂。',
    },
  },
  rehab: {
    kind: 'rehab', name: '康复训练', game: 'rhythm',
    story: (_s, about) => `${about}。理疗师给你排了一套节奏训练——不碰鼠标，只做手腕。`,
    blurb: {
      gold: '恢复比预期快，少养一周。',
      silver: '按原计划养。',
      bronze: '今天状态不好，按原计划养。',
    },
  },
  farewell: {
    kind: 'farewell', name: '最后一个赛季', game: 'none',
    story: (_s, about) => `${about}。这是你职业生涯的最后一年——从这个赛段开始，每一个赛场都会有人举着你的名字。`,
    blurb: { gold: '', silver: '', bronze: '' },
  },
  // 年度颁奖夜、表演赛之夜、版本发布会、试训第一天、退役仪式 — me/nights.ts
  ...NIGHTS,
}


export interface MediaMoment {
  q: string
  /** the same three tones, as answers to this question */
  lines: Record<'bold' | 'steady' | 'blame', string>
  /** who 「指向别人」 points at */
  pointsAt: string
}

/**
 * What the room asks, given where the career actually is — and what each tone
 * sounds like as an answer to that question. The answers used to be one fixed
 * set: a man on the bench, asked about his minutes, was offered
 * 「冠军。别的没什么好说的。」 (reported 2026-09-11, verified in this file).
 */
export function mediaMoment(state: GameState): MediaMoment {
  const talk = (q: string, bold: string, steady: string, blame: string, pointsAt = '队友们'): MediaMoment =>
    ({ q, lines: { bold, steady, blame }, pointsAt })
  const general = talk('你们这个赛段的目标是什么？', '「冠军。别的没什么好说的。」', '「一场一场打，先进季后赛。」', '「我个人状态没问题。」')
  const me = state.me
  if (!me) return general
  const p = state.players[me.id]
  const team = state.teams[p?.teamId ?? '']
  const starter = !!team?.starters.includes(me.id)
  const last3 = me.matches.slice(-3)
  const lost3 = last3.length === 3 && last3.every((m) => !m.won)
  const won3 = last3.length === 3 && last3.every((m) => m.won)
  if (!starter) {
    return talk('你这个赛段上场时间不多，怎么看？',
      '「给我机会，我会让所有人闭嘴。」', '「每天都在练，教练需要我的时候，我准备好了。」', '「谁上场是教练组定的，我能做的都做了。」', '教练组')
  }
  if (me.titles.length && me.tenure <= 1) {
    return talk('换了一个环境，能把上一座奖杯带过来吗？',
      '「我来这里，就是为了再拿一座。」', '「新队伍要先磨合，一场一场来。」', '「我没问题，就看队伍跟不跟得上。」')
  }
  if (lost3) {
    return talk('三连败了。问题出在哪里？',
      '「下一场我们会赢，而且会赢得很好看。」', '「回去复盘，问题我们自己清楚。」', '「我个人状态没问题。」')
  }
  if (won3) {
    return talk('连胜中。你们现在是夺冠热门吗？',
      '「冠军。别的没什么好说的。」', '「一场一场打，还没到说这个的时候。」', '「我打得不错，队伍还要更稳一点。」')
  }
  if (me.titles.length >= 3) {
    return talk('已经拿过这么多，还有什么在推着你？',
      '「再拿一座，然后再拿一座。」', '「每个赛段都是新的，先把眼前这场打好。」', '「我还想赢，就看身边的人是不是也一样想。」')
  }
  if (me.seasons.length <= 1) {
    return talk('新人赛季，你对自己的期待是什么？',
      '「今年就要打出名字。」', '「先站稳位置，多学多打。」', '「我准备好了，就看队伍用不用我。」')
  }
  return general
}

/* ------------------------------------------------------------------ */
/*  The state machine                                                  */
/* ------------------------------------------------------------------ */

/** Put a ceremony in front of the player. */
export function cerStart(state: GameState, kind: CerKind, about: string): void {
  const me = state.me!
  me.cer = { kind, step: 0, about }
  push(state, { kind: 'ceremony', id: kind })
}

/** Move on to the next screen of the current ceremony. */
export function cerNext(state: GameState): void {
  const me = state.me!
  if (me.cer) me.cer.step++
}

/** The little game is over; show the result. */
export function cerFinish(state: GameState, tier: CerTier, detail?: Ceremony['detail']): void {
  const me = state.me!
  if (!me.cer) return
  me.cer.tier = tier
  me.cer.detail = detail
  me.cer.step = 2
}

/**
 * Walk past it. This is deliberately not a penalty — it lands on silver, the
 * same as the autopilot, and the same as playing the game and doing fine.
 */
export function cerSkip(state: GameState): void {
  cerApply(state, 'silver', true)
}

/** Close it out at whatever tier was reached. */
export function cerClose(state: GameState): void {
  const me = state.me!
  cerApply(state, me.cer?.tier ?? 'silver', !me.cer?.tier)
}

const kindOf = (state: GameState): CerKind | null => state.me?.cer?.kind ?? null

/**
 * The consequences, and the line for the record.
 *
 * Everything here is scoped to a whole stage or a whole series — a ceremony
 * that changed one week would not be worth stopping for.
 */
export function cerApply(state: GameState, tier: CerTier, skipped: boolean): void {
  const me = state.me!
  const kind = kindOf(state)
  const cer = me.cer
  me.cer = undefined
  const pop = me.pending.findIndex((x) => x.kind === 'ceremony')
  if (pop >= 0) me.pending.splice(pop, 1)
  if (!kind) return
  // the last five keep their own books
  if (isNight(kind)) { nightApply(state, kind, tier, skipped, cer); return }
  const def = CEREMONIES[kind]
  const p = state.players[me.id]

  switch (kind) {
    case 'draw': {
      const d = tier === 'gold' ? 3 : tier === 'bronze' ? -2 : 0
      if (d && p) p.form = clamp(p.form + d, 30, 99)
      break
    }
    case 'depart': {
      // faster or slower recovery for the length of the tournament
      const mul = tier === 'gold' ? 1.3 : tier === 'bronze' ? 0.8 : 1
      if (mul !== 1) me.cerRest = { until: state.day + 35, mul }
      break
    }
    case 'final': {
      const nudge = tier === 'gold' ? 2 : tier === 'bronze' ? -1 : 0
      const node = tier === 'gold' ? 0.05 : tier === 'bronze' ? -0.03 : 0
      if (nudge || node) me.cerMatch = { fixture: cer?.about ?? '', nudge, node, until: state.day + 3 }
      break
    }
    case 'media': {
      const tone = cer?.detail?.tone ?? 'steady'
      const heat = tone === 'bold' ? 15 : tone === 'blame' ? 10 : 5
      me.heat += heat
      if (tone === 'blame') me.coachTrust = clamp(me.coachTrust - 3, 0, 100)
      if (tone === 'bold') me.flags.mediaBold = state.day
      break
    }
    case 'rehab': {
      if (tier === 'gold' && p && p.injuredUntil > state.day + 7) {
        p.injuredUntil -= 7
        me.flags.injurySaid = p.injuredUntil
      }
      break
    }
    case 'farewell':
      me.flags.farewellYear = state.year
      break
  }

  const text = kind === 'farewell'
    ? `<b>最后一个赛季。</b>${def.story(state, cer?.about ?? '')}`
    : kind === 'media'
      ? `${def.name}：${def.blurb[tier]}`
      : skipped
        ? `${def.name}：你没参加那个环节。${def.blurb.silver}`
        : `${def.name}的${def.game === 'focus' ? '专注' : def.game === 'rhythm' ? '节奏' : '反应'}挑战 <b>${TIER_CN[tier]}</b>：${def.blurb[tier]}`
  pushLog(state, tier === 'gold' ? 'good' : tier === 'bronze' ? 'bad' : 'info', text)
}

/* ------------------------------------------------------------------ */
/*  When they fire                                                     */
/* ------------------------------------------------------------------ */

const INTL = new Set(['masters1', 'masters2', 'champions'])

/**
 * At most one ceremony a week, checked at the weekly settle. The order is the
 * priority: a body that is broken comes before a trophy that is not won yet.
 */
export function ceremonyTick(state: GameState): void {
  const me = state.me!
  if (me.cer || me.pending.some((x) => x.kind === 'ceremony')) return
  if (me.phase === 'retired') return
  const p = state.players[me.id]
  if (!p) return
  const pro = me.phase === 'pro'
  me.cerSeen ??= []
  const once = (key: string): boolean => {
    if (me.cerSeen!.includes(key)) return false
    me.cerSeen!.push(key)
    if (me.cerSeen!.length > 160) me.cerSeen!.splice(0, me.cerSeen!.length - 160)
    return true
  }

  // 1. hurt, with enough of the lay-off left that a week off it means something
  if (pro && p.injuredUntil > state.day + 7 && once(`rehab:${p.injuredUntil}`)) {
    cerStart(state, 'rehab', p.injuryNote ?? '伤病')
    return
  }

  // 2. the last season, told once a career. `retireAsk` is only 「you may
  //    hang them up if you want」 and stays true from the fifth season on —
  //    reading it as 「this is the last one」 announced a farewell every year.
  //    The engine retires at 33, so 32 is when it is actually true.
  if (pro && p.age >= 32 && once('farewell')) {
    cerStart(state, 'farewell', `${state.year} 赛季`)
    return
  }

  // 3. the year's first big patch — with a club or without one, everybody plays it
  if (patchNight(state)) return
  if (!pro) return

  // 4. an international my club is in, before its first ball is thrown
  for (const comp of Object.values(state.comps)) {
    if (!INTL.has(comp.stage) || comp.champion) continue
    if (!comp.teams.includes(p.teamId ?? '')) continue
    const played = state.fixtures.some((f) => f.comp === comp.key && f.played)
    if (played) continue
    if (comp.city && once(`depart:${state.year}:${comp.key}`)) {
      cerStart(state, 'depart', comp.city)
      return
    }
    if (once(`draw:${state.year}:${comp.key}`)) {
      cerStart(state, 'draw', compCn(comp.name))
      return
    }
  }

  // 5. the year's awards night, for a season that put my name on a list; a
  //    showmatch on the Champions weekend, for a name whose club is not there
  if (awardsNight(state) || showmatchNight(state)) return

  // 6. media day: a domestic stage my club is about to play in, and not on top
  //    of the last one. 「Once a stage」 came to six or seven a season — most
  //    of a year's nights — and the internationals already have 抽签 and 出征.
  if (mediaDue(state) && once(`media:${state.year}:${state.stage}`)) {
    me.flags.mediaAt = state.year * 400 + state.day
    cerStart(state, 'media', stageNameIn(state.year, state.stage, onTimeline(state)))
  }
}

/** the fewest days between two media days — seven weeks */
export const MEDIA_GAP = 49

function mediaDue(state: GameState): boolean {
  const me = state.me!
  const club = state.myTeam
  // nothing to play yet, or any more
  if (state.stage === 'preseason' || state.stage === 'offseason') return false
  // an international my club is in has nights of its own; one it is not in is
  // only a window on the calendar, and a Challengers club plays straight through it
  if (INTL.has(state.stage) && Object.values(state.comps).some((c) => c.stage === state.stage && c.teams.includes(club))) return false
  const soon = state.fixtures.some((f) => !f.played && f.comp !== 'scrim'
    && (f.teamA === club || f.teamB === club) && f.day >= state.day && f.day <= state.day + 14)
  if (!soon) return false
  const last = me.flags.mediaAt
  return last === undefined || state.year * 400 + state.day - last >= MEDIA_GAP
}

/** A final I am about to play: worth stopping the clock for. */
export function ceremonyBeforeMatch(state: GameState, label: string, comp: string): void {
  const me = state.me!
  if (me.cer || me.phase !== 'pro') return
  // A fixture's `label` is the bracket key — 「KO:6:总决赛」 — not the words
  // the player sees; matching the raw string found nothing at all. And
  // 「决赛」 on its own is not the final either: the bracket also runs
  // 胜者组决赛, 败者组决赛 and 中段组决赛, and stopping for every one of
  // those turned a rare night into a fortnightly one.
  const name = (label.split(':').pop() ?? '').trim()
  if (!/^(总决赛|决赛|Grand Final|Final)$/i.test(name)) return
  me.cerSeen ??= []
  const key = `final:${state.year}:${comp}:${name}`
  if (me.cerSeen.includes(key)) return
  me.cerSeen.push(key)
  cerStart(state, 'final', `${compCn(comp)} ${name}`)
}

/** The pre-match bonus, if tonight is the night it was won. */
export function cerMatchEdge(state: GameState): { nudge: number; node: number } {
  const m = state.me?.cerMatch
  if (!m || m.until < state.day) return { nudge: 0, node: 0 }
  return { nudge: m.nudge, node: m.node }
}

/** How much faster (or slower) the body comes back this week. */
export function cerRestMul(state: GameState): number {
  const r = state.me?.cerRest
  if (!r || r.until < state.day) return 1
  return r.mul
}
