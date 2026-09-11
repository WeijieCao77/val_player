import { Rng, clamp, hashStr } from '../rng'
import { advanceDay, continuePastFive } from '../season'
import { contractLength, expectedSalary } from '../player'
import { askingPrice, clubAcceptsFee, doTransfer, playerAcceptsTerms, releasePlayer } from '../transfer'
import { defaultContract } from '../types'
import { inWindow } from './transfer'
import { recommendedTrainingFocus } from '../training'
import { ROLES } from '../types'
import type { Fixture, GameState, Player, Role, Team } from '../types'
import { ACTION_BY_KEY, AP_HURT, AP_SEASON, DUELS_PER_WEEK } from './actions'
import type { MeAction, PendingItem } from './types'
import { primaryFocus, settleTraining } from './growth'
import { bottleneckSeason, bottleneckStage, bottleneckTitle, bottleneckWeek } from './bottleneck'
import { weekReport } from './press'
import { bondCloseStage, bondNoteTitle, bondReportDepartures, bondSync } from './bond'
import { injuryTick } from './injury'
import { hurtBeforeMatch, mateInjuryWeek } from './hurtplay'
import { addMoney, ledgerRotate, prizeWeek } from './money'
import { ceremonyBeforeMatch, ceremonyTick } from './ceremony'
import { cloutStage } from './clout'
import { coachStarters, refreshMyRounds, runDuel, weeklyLineup } from './coach'
import type { DuelResult } from './coach'
import { MeMatch } from './matchplay'
import { pushLog } from './log'
import { push } from './pending'
import { AP_PRE, cupThisWeek, expireInvites, ladderWeekly, rollInvites } from './prepro'
import { offerCup, resumeCup } from './cups'
import { fanWeek } from './fans'
import { streamClauseCheck, streamTick } from './stream'
import { AGENTS } from './shop'
import { questWeek } from './quests'
import { fireEvent, tryRandomEvent } from './events'
import { checkAchievements } from './achievements'
import { noteScoutInterest, rollOffers, seasonContractCheck, windowOpensToday } from './transfer'
import { retirementTick } from './endings'
import { compCn } from './compname'
import { leaveClub } from './contract'
import { quietClub, releaseForHistory } from '../timeline'
import { rivalWeek } from './rivals'
import { compClass } from './compclass'

export type WeekStop =
  | { kind: 'match'; fixture: Fixture }
  | { kind: 'pending'; item: PendingItem }
  /** a day of a week of days went by with nothing to stop for (see weekInDays) */
  | { kind: 'day' }
  | { kind: 'week-end' }
  | { kind: 'game-over' }

export function apFor(state: GameState): number {
  const me = state.me!
  const p = state.players[me.id]
  if (p && p.injuredUntil > state.day) return AP_HURT
  return me.phase === 'pro' ? AP_SEASON : AP_PRE
}

/** The week opens: the coach names his five, the duel count resets. */
export function beginWeek(state: GameState): void {
  const me = state.me!
  me.duelsThisWeek = 0
  me.relaxUsed = 0
  if (me.phase === 'pro') {
    // who is on the roster this week — and a word for anyone who is not any more
    const before = [...(state.teams[state.myTeam]?.roster ?? [])]
    const was = [...(state.teams[state.myTeam]?.starters ?? [])]
    weeklyLineup(state)
    // a team-mate newly out hurt or back, in one line, and whoever steps in (me/hurtplay.ts)
    mateInjuryWeek(state, was)
    bondSync(state)
    bondReportDepartures(state, before)
  }
}

const PRO_ONLY: MeAction[] = ['scrim', 'duo', 'duel']

/** Put a point on (or take one off) an action. Returns a reason when it cannot be done. */
export function setPlan(state: GameState, action: MeAction, delta: 1 | -1): string | null {
  const me = state.me!
  const def = ACTION_BY_KEY[action]
  const cur = me.plan[action] ?? 0
  // the club's programme follows the hours as they are put in or taken out: in
  // a week of days that can happen after the first morning (see weekInDays)
  const follow = () => { if (me.phase === 'pro') state.training[me.id] = primaryFocus(me, state.players[me.id]) }
  if (delta < 0) {
    if (cur <= 0) return null
    me.plan[action] = cur - 1
    me.ap += def.cost
    follow()
    return null
  }
  if (action === 'duel') return '对位挑战是当场打的，用下面的按钮。'
  if (me.phase !== 'pro' && PRO_ONLY.includes(action)) return '没有队伍，做不了这件事。'
  if (me.ap < def.cost) return '行动点不够了。'
  me.plan[action] = cur + 1
  me.ap -= def.cost
  follow()
  return null
}

/**
 * Why one more of this action cannot be planned right now, without planning
 * it. The week screen greys the card out and prints this under it: a locked
 * option is still a signpost — hide it and the player never learns it exists.
 */
export function planBlock(state: GameState, action: MeAction): string | null {
  const me = state.me!
  const def = ACTION_BY_KEY[action]
  if (action === 'duel') return null
  if (me.phase !== 'pro' && PRO_ONLY.includes(action)) return '需要先加入战队'
  if (me.ap < def.cost) return `行动点不够（需 ${def.cost}，剩 ${me.ap}）`
  // stamina is the other budget: what is already planned this week counts
  if (def.fatigue > 0) {
    const left = staminaLeft(state)
    if (left < def.fatigue) return `体力不够（需 ${def.fatigue}，剩 ${left}）`
  }
  return null
}

/** 体力 = 100 − 疲劳, minus what this week's plan will already cost */
export function staminaLeft(state: GameState): number {
  const me = state.me!
  const p = state.players[me.id]
  let planned = 0
  for (const [k, n] of Object.entries(me.plan)) {
    const d = ACTION_BY_KEY[k as MeAction]
    if (d && d.fatigue > 0) planned += d.fatigue * (n ?? 0)
  }
  return Math.max(0, Math.round(100 - p.fatigue - planned))
}

/** A practice duel happens now, not at the settlement. */
export function doDuel(state: GameState): DuelResult | string {
  const me = state.me!
  const def = ACTION_BY_KEY.duel
  if (me.phase !== 'pro') return '没有队伍，没有可以挑战的人。'
  const team = state.teams[state.myTeam]
  if (team.starters.includes(me.id)) return '你已经是首发了，不用挑战谁。'
  if (me.trial) return '你正在试用期，先把正赛打好。'
  if (me.benchLock && me.benchLock > state.day) return `教练两周内不会再看你（还有 ${me.benchLock - state.day} 天）。`
  if (me.duelsThisWeek >= DUELS_PER_WEEK) return `每周最多 ${DUELS_PER_WEEK} 次对位挑战。`
  if (me.ap < def.cost) return '行动点不够了。'
  const rng = new Rng(hashStr(`duel:${state.seed}:${state.year}:${state.day}:${me.duelsThisWeek}`))
  const r = runDuel(state, rng)
  if (!r) return '现在没有可以挑战的首发。'
  me.ap -= def.cost
  me.plan.duel = (me.plan.duel ?? 0) + 1
  return r
}

const sacked = (s: string) => s.includes('解除你的职务')
/** tax and the cost of a life, off the top of every pay packet */
export const LIVING = 0.3

/** engine digest lines worth showing a player; the manager's paperwork is not */
function keep(n: string): boolean {
  // the manager's desk: sponsors, gigs, staff, the market board, whom to rest
  if (/董事会|行动力|赞助|商务|联盟|捆绑|报价|问价|教练组|分析师|申请|工作邀请|设施|经理|来谈|轮休|状态正热|状态低迷|新挂牌/.test(n)) return false
  // a lay-off with a diagnosis and a count of days: the week says it in words instead (me/hurtplay.ts mateInjuryWeek)
  if (n.includes('⚕')) return false
  return true
}

/**
 * How this week is played: seven days to a press, or one.
 *
 * The one rule, read by the week screen, its button and whatever drives them.
 * A week that holds two or more of my club's official matches goes a day at a
 * time — the manager game's in-season turn — so a match ends on its own day
 * and the next one is a press away, instead of the match screen opening again
 * the moment the last one closed. A week with one match or none stays a week:
 * nothing in it comes back to back.
 *
 * Counted over the week's own seven days, played and still to come. So it is
 * settled the morning the week opens and only turns one way: a bracket or a
 * draw that writes my next match into the week turns the rest of it into
 * days, and short of leaving the club a week of days stays one. Nothing is
 * kept in the save for it, so a save from before it reads the same way.
 *
 * The week's economy does not change with it: the action points are the
 * week's, spent on whichever days I like, and the plan settles on the seventh
 * with the pay, as in any other week.
 */
export function weekInDays(state: GameState): boolean {
  return weekMatches(state).length >= 2
}

export interface WeekMatch {
  fixture: Fixture
  /** the day of the week it lands on */
  day: number
}

/**
 * My club's official matches in this week's seven days, each on the day it
 * lands. A played one sits on the day it was played, from my own record of it:
 * a bracket often writes its next round for a day already gone, and the engine
 * plays it the morning after — counted on the day it was written for, it fell
 * out of the week it was played in, and the week ran on into the round after.
 * The rest sit on their own day, or tomorrow if that day has gone.
 */
export function weekMatches(state: GameState): WeekMatch[] {
  const me = state.me
  if (!me || me.phase !== 'pro') return []
  const club = state.myTeam
  const from = state.day - me.weekDay + 1
  const to = from + 6
  const mine = (f: Fixture) => f.comp !== 'scrim' && (f.teamA === club || f.teamB === club)
  const out: WeekMatch[] = []
  for (const m of me.matches) {
    if (m.friendly || m.year !== state.year || m.day < from || m.day > to) continue
    const f = state.fixtures.find((x) => x.id === m.fixtureId)
    if (f && mine(f)) out.push({ fixture: f, day: m.day })
  }
  const due = dueToday(state)
  for (const f of state.fixtures) {
    if (f.played || !mine(f) || f.day > to) continue
    const day = f === due ? state.day : Math.max(f.day, state.day + 1)
    if (day <= to) out.push({ fixture: f, day })
  }
  return out.sort((a, b) => a.day - b.day)
}

export interface WeekDay {
  day: number
  /** my club's official matches that day */
  matches: Fixture[]
  /** gone by */
  past: boolean
  /** the day the next press plays: tomorrow, or today while my match is still due */
  next: boolean
}

/** The week's seven days for the week screen: what is on each, what is done, which is next. */
export function weekCalendar(state: GameState): WeekDay[] {
  const me = state.me!
  const from = state.day - me.weekDay + 1
  const mine = weekMatches(state)
  const due = !!dueToday(state)
  return Array.from({ length: 7 }, (_, i) => {
    const day = from + i
    return {
      day,
      matches: mine.filter((w) => w.day === day).map((w) => w.fixture),
      past: day < state.day || (day === state.day && !due),
      next: day === (due ? state.day : state.day + 1),
    }
  })
}

/**
 * My match today that the clock stopped in front of, still to be played: a
 * ceremony, an event or an offer came first, or the week turned into days on
 * the morning of it. Only a match the engine handed me today and I have not
 * had yet. A round a bracket writes for today after my last result is not
 * this — it is played the next morning, as the engine always has, or two
 * matches would open back to back after all.
 */
export function dueToday(state: GameState): Fixture | undefined {
  const me = state.me
  if (!me?.dueFixture || me.phase !== 'pro') return undefined
  const f = state.fixtures.find((x) => x.id === me.dueFixture)
  return f && !f.played && (f.teamA === state.myTeam || f.teamB === state.myTeam) ? f : undefined
}

/**
 * Once what stopped the clock is dealt with — my match, a decision — does it
 * go on by itself? A week run as a week does, as it always has. A week of days
 * does not: that day is over and the next is my press — unless it was the
 * week's last, which closes the week, or my match is still due today.
 */
export function carriesOn(state: GameState): boolean {
  const me = state.me
  if (!me || me.pending.length || me.weekDay <= 0) return false
  if (me.weekDay >= 7 || dueToday(state)) return true
  return !weekInDays(state)
}

/**
 * Seven days, or until something needs me: my club's match, a cup, an
 * invitation, a contract, an event. A player has no board, so the manager
 * game's dismissal is undone on the spot. The headless runs go a week at a
 * time whatever the week is; the week screen's button is advanceTurn.
 */
export function advanceWeek(state: GameState): WeekStop {
  return runDays(state, 7, false)
}

/** One press of the week screen's button: a day of a match week, the rest of any other (see weekInDays). */
export function advanceTurn(state: GameState): WeekStop {
  return weekInDays(state) ? runDays(state, 1, false) : runDays(state, 7, true)
}

/** Up to `days` more of the week; `turn` stops the run on the day it becomes a week of days. */
function runDays(state: GameState, days: number, turn: boolean): WeekStop {
  const me = state.me!
  const p = state.players[me.id]
  // a cup entered on a save from before its card stayed up: back in front, to be played out
  resumeCup(state)
  if (me.pending.length) return { kind: 'pending', item: me.pending[0] }
  if (me.phase === 'retired' || state.gameOver) return { kind: 'game-over' }
  // a match the week stopped on that nobody played: play it the steady way
  if (me.pendingFixture) {
    const f = state.fixtures.find((x) => x.id === me.pendingFixture)
    if (f && !f.played) new MeMatch(state, f).runOut()
    me.pendingFixture = undefined
  }
  // My match today that the clock stopped in front of is played today. Left to
  // the next morning's engine run it was played a day late: a day behind the
  // calendar, and in a week of days a match the strip shows on one day and
  // the button opens on the next.
  const due = dueToday(state)
  me.dueFixture = undefined
  if (due) {
    me.pendingFixture = due.id
    return { kind: 'match', fixture: due }
  }
  if (me.weekDay === 0) {
    if (me.phase === 'pro') state.training[me.id] = primaryFocus(me, p)
    me.weekNotes = []
  }
  let ran = 0
  while (me.weekDay < 7 && ran++ < days) {
    if (state.midReview) continuePastFive(state)
    const yearBefore = state.year
    const pro = me.phase === 'pro'
    // one match of mine a day: a second due the same day is mine tomorrow, not the engine's today
    const r = advanceDay(state, { deferMine: pro, holdMine: pro, autoScrims: true, autoResolveDrawDecisions: true })
    me.weekDay++
    for (const n of r.notes) if (keep(n)) me.weekNotes.push(n)
    if (state.gameOver && sacked(state.gameOver)) {
      state.gameOver = undefined
      state.onNotice = false
      state.missedStreak = 0
      state.boardConfidence = 55
    }
    const rng = new Rng(hashStr(`me:day:${state.seed}:${state.year}:${state.day}`))
    if (r.stageChanged) onStageChange(state, rng)
    if (pro && windowOpensToday(state)) rollOffers(state, rng)
    syncTitles(state)
    closingClub(state)
    if (r.seasonEnded || state.year !== yearBefore) onSeasonEnd(state, yearBefore, rng)
    if (state.gameOver && !sacked(state.gameOver)) return { kind: 'game-over' }
    // A final is worth stopping for before the doors open. This has to be
    // queued *before* the generic pending check, not after: anything else
    // raised the same day would return first and the fixture would slip past
    // — which is exactly why it fired zero times the first time round. The
    // match is not lost by stopping for the ceremony: it is kept for today,
    // and the next run plays it (dueToday).
    const today = r.pendingMine && pro ? r.pendingMine : undefined
    if (today) {
      ceremonyBeforeMatch(state, today.label, state.comps[today.comp]?.name ?? today.comp)
      // hurt on a day the coach would start me: play through it or sit it out (me/hurtplay.ts)
      hurtBeforeMatch(state, today)
    }
    if (me.pending.length) {
      if (today) me.dueFixture = today.id
      return { kind: 'pending', item: me.pending[0] }
    }
    // A draw or a bracket has put a second match of mine into a week being run
    // as a week — often during this very day's games, for today. Stop here, in
    // front of today's match if there is one, and the rest of the week goes a
    // day at a time; run on, and it would open the moment the last one closed.
    if (turn && weekInDays(state) && (me.weekDay < 7 || today)) {
      if (today) me.dueFixture = today.id
      return { kind: 'day' }
    }
    if (today) {
      me.pendingFixture = today.id
      return { kind: 'match', fixture: today }
    }
  }
  if (me.weekDay < 7) return { kind: 'day' }
  settleWeek(state)
  return { kind: 'week-end' }
}

/**
 * History closes my club (engine/timeline.ts historyFolds). The club tells us two
 * or three weeks ahead; on the day the club is gone, the contract with it, and I
 * am on the market. It is not mine to stop: I am one player on a club that is ending.
 */
function closingClub(state: GameState): void {
  const me = state.me!
  const n = state.foldNotice
  if (!n) return
  const t = state.teams[n.club]
  if (!t || state.myTeam !== n.club || me.phase !== 'pro') { state.foldNotice = undefined; return }
  if (!n.told) {
    n.told = true
    pushLog(state, 'bad', `${t.name} 管理层通知全队：${n.reason}。离解散还有 ${Math.max(0, n.day - state.day)} 天。`)
    push(state, { kind: 'folding' })
    return
  }
  if (state.day < n.day) return
  leaveClub(state, '解散了')
  for (const pid of [...t.roster]) releaseForHistory(state, state.players[pid])
  quietClub(t)
  state.news.push({ day: state.day, kind: 'club', important: true, text: `🕯️ ${t.name} 宣布解散。` })
  push(state, { kind: 'released', id: 'fold' })
  state.foldNotice = undefined
}

/** The engine credits titles to the champion's roster; a title is mine only if I was on the floor that stage. */
function syncTitles(state: GameState): void {
  const me = state.me!
  const p = state.players[me.id]
  for (const t of p.titles ?? []) {
    if (me.titles.some((x) => x.year === t.year && x.title === t.title)) continue
    const started = me.startedThisStage > 0 || me.seasonStart.starts >= 4
    me.titles.push({ year: t.year, title: t.title, started })
    // whoever was in the room shares it
    bondNoteTitle(state, t.title)
    // and a trophy I was on the floor for loosens a ceiling (me/bottleneck.ts)
    if (started) bottleneckTitle(state, t.title)
    pushLog(state, 'good', `冠军：${compCn(t.title)}${started ? '' : '（你没有出场）'}。`)
    if (me.phase === 'pro') fireEvent(state, 'after_title')
  }
}

function onStageChange(state: GameState, rng: Rng): void {
  const me = state.me!
  streamClauseCheck(state)
  // the stage's books close with the stage
  ledgerRotate(state)
  cloutStage(state)
  // a stage at a strong club or beside a veteran loosens a ceiling; read before noteScoutInterest clears the stage's counts
  bottleneckStage(state)
  if (me.phase !== 'pro') return
  // Champions has just been settled? then whoever lost the final is written down
  // on the timeline Champions is 「2026 全球冠军赛」, not a comp keyed 'champions': the old lookup never found it, so 无冕之王 never came
  const champs = Object.values(state.comps).find((c) => !!c.champion && compClass(c.name) === 'champions' && c.finished?.[1] === state.myTeam)
  if (champs && me.startedThisStage > 0) me.flags.champFinalLost = 1
  noteScoutInterest(state, rng)
  // a stage's worth of evidence is enough to say who was carrying whom
  bondCloseStage(state)
  if (me.traits.includes('star')) me.coachTrust = clamp(me.coachTrust - 2, 0, 100)
}

export function settleWeek(state: GameState): void {
  const me = state.me!
  const p = state.players[me.id]
  const rng = new Rng(hashStr(`me:${state.seed}:${state.year}:${state.day}`))
  const notes: string[] = []
  const pro = me.phase === 'pro'
  settleTraining(state, rng, notes)
  // the plan is still on the board: count it against whatever sits at its ceiling
  bottleneckWeek(state)

  // The pay slip, itemised. The net is unchanged — the agent's cut and the
  // 30% that goes on living have always come off the top — but they used to
  // come off in silence, so the ledger now books all three separately and the
  // player can see where a third of the wage goes.
  if (pro) {
    const cut = AGENTS[me.agentTier]?.cut ?? 0
    const gross = Math.round(p.salary / 52)
    const net = Math.round((p.salary / 52) * (1 - cut - LIVING))
    const agentFee = Math.round((p.salary / 52) * cut)
    // living takes the rounding, so gross − agent − living is exactly the old net
    addMoney(state, 'salary', gross)
    if (agentFee) addMoney(state, 'agent', -agentFee)
    if (gross - agentFee - net) addMoney(state, 'living', -(gross - agentFee - net))
  }
  if (me.upkeep) addMoney(state, 'upkeep', -me.upkeep)
  prizeWeek(state)
  if (me.money < 0 && !me.flags.brokeWarned) {
    me.flags.brokeWarned = 1
    notes.push('存款见底了。')
  }
  if (me.money >= 0) me.flags.brokeWarned = 0

  fanWeek(state)
  streamTick(state)
  questWeek(state)
  injuryTick(state)
  ceremonyTick(state)
  if (!pro) {
    ladderWeekly(state, (me.plan.ranked ?? 0) > 0)
    rollInvites(state, rng)
    expireInvites(state)
    const cup = cupThisWeek(state)
    if (cup) offerCup(state, cup.key)
  } else {
    // the coach's regard settles back toward neutral; a substitute he never sees drifts down
    me.coachTrust = clamp(me.coachTrust + (60 - me.coachTrust) * 0.03, 0, 100)
    const starter = state.teams[state.myTeam].starters.includes(me.id)
    if (!starter && !(me.plan.scrim ?? 0) && !(me.plan.duel ?? 0)) me.coachTrust = clamp(me.coachTrust - 1, 0, 100)
    if (me.benchLock && me.benchLock <= state.day) me.benchLock = undefined
    if (p.form >= 84) fireEvent(state, 'hot_week')
    else if (p.form <= 56) fireEvent(state, 'cold_week')
    clubUpkeep(state, rng)
  }
  tryRandomEvent(state, rng)
  checkAchievements(state)
  // who took my place, which losses ended a run, and the cooling (me/rivals.ts)
  rivalWeek(state)

  // a player has no board behind him
  state.boardConfidence = Math.max(state.boardConfidence, 45)
  state.onNotice = false
  state.jobOffers = []

  for (const n of notes) me.weekNotes.push(n)
  // the week's paper: my results, who moved where, who got stronger, what is next
  me.weekNotes.unshift(...weekReport(state))
  me.week++
  me.weekDay = 0
  me.plan = {}
  me.duoWith = undefined
  me.ap = apFor(state)
  me.apMax = me.ap
  refreshMyRounds(state)
  beginWeek(state)
}

/** The winter: my season on the record, the contract question, and whether there is a next one. */
function onSeasonEnd(state: GameState, year: number, rng: Rng): void {
  const me = state.me!
  const p = state.players[me.id]
  const team = state.teams[state.myTeam]
  const pro = me.phase === 'pro'
  const s = me.seasonStart
  const titles = me.titles.filter((h) => h.year === year).map((h) => h.title)
  me.seasons.push({
    year, team: pro ? (team?.name ?? '?') : '自由身', tier: pro ? team.tier : 0,
    matches: s.matches, starts: s.starts, wins: s.wins,
    acs: s.starts ? Math.round(s.acsSum / s.starts) : 0,
    overallFrom: s.overall, overallTo: p.overall, titles,
  })
  if (pro) {
    pushLog(state, 'season', `${year} 赛季结束：出场 ${s.starts}/${s.matches}，首发胜 ${s.wins} 场，综合 ${s.overall} → ${p.overall}${titles.length ? `，冠军：${titles.join('、')}` : ''}。`)
    if (me.abroad) me.flags.abroadSeasons = (me.flags.abroadSeasons ?? 0) + 1
  } else {
    pushLog(state, 'season', `${year} 年过去了：天梯最高 ${Math.round(me.pre.ladderPeak)}，杯赛 ${me.pre.cups.filter((c) => c.year === year).length} 项，综合 ${s.overall} → ${p.overall}。${me.phase === 'pre' ? '还没有合同。' : '还是自由身。'}`)
    me.pre.year++
    if (me.phase === 'free') me.freeYears++
  }
  bottleneckSeason(state, pro && s.matches > 0)
  me.seasonStart ={ year: state.year, overall: p.overall, matches: 0, starts: 0, wins: 0, acsSum: 0 }
  me.benchedStages = 0
  me.pre.scoutSeen = Math.round(me.pre.scoutSeen * 0.5)
  // scrimmage rounds the coach saw last year are last year's news
  me.scrimRounds = Math.round(me.scrimRounds * 0.5)
  if (pro) {
    if (me.flags.renewPending) me.flags.renewPending = 0
    seasonContractCheck(state, rng)
    if (me.phase === 'pro') { clubTrim(state); clubUpkeep(state, new Rng(hashStr(`gm:${state.seed}:${state.year}`))) }
  }
  retirementTick(state, rng)
  if (me.phase !== 'retired') push(state, { kind: 'season', id: String(year) })
}

/** how many the club keeps on the books: a five, plus me */
const CLUB_FLOOR = 6

/**
 * The general manager the engine gives every AI club, done for mine.
 *
 * ensureMinimumRosters skips the human's club because in the manager game
 * signing is the human's job. Here it is nobody's, so when a contract runs out
 * or a man retires the club refills from the free-agent pool the way its
 * rivals do — the missing job first, then the best available. The team-mates'
 * own training programme is the coach's too: the engine only writes one for
 * AI clubs, and a club whose players rest all year falls out of the league.
 */
export function clubUpkeep(state: GameState, rng: Rng): void {
  const me = state.me!
  const team = state.teams[state.myTeam]
  if (!team || me.phase !== 'pro') return
  // The engine renews an AI club's expiring players itself and leaves the
  // human's club's to the manager — a winter of grace, then they walk. With
  // nobody in that chair every contract at my club ran out: measured over
  // 240 club-seasons, one Masters and no Champions. Same rule as the AI.
  for (const id of team.roster) {
    if (id === me.id) continue
    const q = state.players[id]
    if (!q || q.expiredYear == null) continue
    const keep = q.overall >= team.rating - 6 && q.age < 31 && rng.chance(0.72)
    if (!keep) continue
    q.contractYears = contractLength(q, rng, team.roster.map((x) => state.players[x]).filter((x): x is Player => !!x))
    q.salary = expectedSalary(q, team.tier)
    q.expiredYear = undefined
    pushLog(state, 'team', `俱乐部和 ${q.ign}（${q.overall}）续约 ${q.contractYears} 年。`)
  }
  let guard = 0
  while (team.roster.length < CLUB_FLOOR && guard++ < 6) {
    const others = team.roster.filter((id) => id !== me.id).map((id) => state.players[id]).filter((p): p is Player => !!p)
    const have = new Set(others.flatMap((p) => p.roles ?? [p.role]))
    const missing = ROLES.filter((r) => r !== '自由人' && !have.has(r))
    const free = Object.values(state.players).filter((p) => p.teamId === null && !p.retiring && p.id !== me.id)
    if (!free.length) break
    const score = (p: Player) =>
      p.overall + (p.region === team.region ? 6 : 0) +
      ((p.roles ?? [p.role]).some((r) => missing.includes(r)) ? 12 : 0)
    const target = free.sort((a, b) => score(b) - score(a))[0]
    target.teamId = team.id
    target.contractYears = contractLength(target, rng, others)
    target.salary = expectedSalary(target, team.tier)
    target.joinedYear = state.year
    team.roster.push(target.id)
    const line = `俱乐部签下自由人 ${target.ign}（${target.role} ${target.overall}）补进名单。`
    state.news.push({ day: state.day, kind: 'transfer', text: `${team.name} 免费签下自由人 ${target.ign}（${target.overall}）。` })
    pushLog(state, 'team', line)
    me.weekNotes.push(line)
  }
  for (const id of team.roster) {
    if (id === me.id) continue
    const q = state.players[id]
    if (q && q.injuredUntil <= state.day) state.training[id] = recommendedTrainingFocus(q)
  }
  clubShop(state, team, rng)
  if (team.starters.length < 5 || !team.starters.every((id) => team.roster.includes(id))) {
    team.starters = coachStarters(state)
  }
}

function weakestRole(state: GameState, team: Team): { role: Role; strength: number } | null {
  const starters = team.starters.map((id) => state.players[id]).filter((p): p is Player => !!p)
  let worst: { role: Role; strength: number } | null = null
  for (const role of ROLES) {
    if (role === '自由人') continue
    const best = starters.filter((p) => (p.roles ?? [p.role]).includes(role)).reduce((m, p) => Math.max(m, p.overall), 0)
    if (!worst || best < worst.strength) worst = { role, strength: best }
  }
  return worst
}

/**
 * The engine's aiTransferTick, for my club. The engine leaves the human's club
 * out of its shopping because the human is the manager; here nobody is, and
 * a club that never buys for ten years falls out of the league — measured:
 * two ten-season careers at Gen.G and 100 Thieves, zero titles, rosters
 * refilled with 49-rated free agents. Same odds, same rules, same fees.
 */
function clubShop(state: GameState, team: Team, rng: Rng): void {
  const me = state.me!
  if (!inWindow(state) || !rng.chance(0.35)) return
  const squad = team.roster.map((id) => state.players[id]).filter((p): p is Player => !!p)
  const wages = squad.reduce((s, p) => s + p.salary, 0)
  const room = team.budget - wages * 0.6
  const need = weakestRole(state, team)
  if (!need) return
  if (need.role === state.players[me.id].role && team.starters.includes(me.id) && me.proven) return
  const value = (p: Player) => p.overall + Math.max(0, p.potential - p.overall) * 0.5
  if (squad.length < 7 && rng.chance(0.5)) {
    const free = Object.values(state.players)
      .filter((p) => p.teamId === null && !p.retiring && p.id !== me.id && (p.roles ?? [p.role]).includes(need.role))
      .filter((p) => p.overall > need.strength - 4 && expectedSalary(p, team.tier) < Math.max(40000, room * 0.25))
      .sort((a, b) => value(b) - value(a))[0]
    if (free) {
      const terms = defaultContract(Math.round(expectedSalary(free, team.tier) * rng.range(1.0, 1.15)), contractLength(free, rng, squad))
      if (playerAcceptsTerms(state, free, team, terms, rng).ok && doTransfer(state, free, team.id, 0, terms)) {
        pushLog(state, 'team', `俱乐部签下自由人 ${free.ign}（${free.role} ${free.overall}）。`)
        return
      }
    }
  }
  if (room < 300000) return
  const target = Object.values(state.players)
    .filter((p) => p.teamId && p.teamId !== team.id && !p.retiring && p.id !== me.id &&
      (p.roles ?? [p.role]).includes(need.role) && p.overall > need.strength + 3 &&
      (p.listed || p.morale < 45 || rng.chance(0.05)))
    .sort((a, b) => value(b) - value(a))[0]
  if (!target) return
  const fee = Math.round(askingPrice(target) * rng.range(0.9, 1.25))
  if (fee > room || !clubAcceptsFee(target, fee, rng)) return
  const terms = defaultContract(Math.round(expectedSalary(target, team.tier) * rng.range(1.0, 1.2)), Math.max(2, contractLength(target, rng, squad)))
  if (!playerAcceptsTerms(state, target, team, terms, rng).ok) return
  const fromName = state.teams[target.teamId!]?.name ?? '?'
  if (doTransfer(state, target, team.id, fee, terms)) {
    pushLog(state, 'team', `俱乐部从 ${fromName} 买来 ${target.ign}（${target.role} ${target.overall}），转会费 $${fee.toLocaleString()}。`)
    if ((target.roles ?? [target.role]).includes(state.players[me.id].role)) pushLog(state, 'info', '他打的位置和你一样。')
  }
}

/** The winter clear-out: a full bench that nobody plays is let go, the way AI clubs let go. */
export function clubTrim(state: GameState): void {
  const me = state.me!
  const team = state.teams[state.myTeam]
  if (!team || me.phase !== 'pro' || team.roster.length < 7) return
  const bench = team.roster.filter((id) => id !== me.id && !team.starters.includes(id)).map((id) => state.players[id]).filter((p): p is Player => !!p)
  const worst = bench.sort((a, b) => a.overall - b.overall)[0]
  if (worst && worst.overall < team.rating - 10) {
    releasePlayer(state, worst)
    pushLog(state, 'team', `俱乐部放走了 ${worst.ign}（${worst.overall}）。`)
  }
}
