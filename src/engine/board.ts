import { clamp } from './rng'
import { sortStandings } from './league'
import { endingsFor, FINAL_YEAR, MID_YEAR, tenureCn } from './endings'
import type { GameState, StageKey } from './types'

/**
 * The board: the brief it sets a manager each stage, how it judges him, and
 * how long it keeps him — the warning, the sack, the five-year settlement and
 * the end of the tenure.
 *
 * All of it the manager game's. It ran inside the world's day (engine/season.ts)
 * and now runs on the manager's desk (engine/managerDesk.ts).
 */

/** Stages the board actually judges you on. */
const JUDGED: StageKey[] = ['kickoff', 'stage1', 'stage2']

/**
 * The competition the managed club is actually in during a judged stage.
 *
 * A Challengers side does not play `stage1:China` — it plays two splits of its
 * own that straddle the tier-1 calendar. The board was setting it a target on
 * the VCT stage anyway and settleObjective then looked up a competition the
 * club is not in, found no placing, and returned. So a tier-2 objective was
 * text that could never be met: confidence could only fall, match by match,
 * with no route back up. Any Questions Gaming improved from rating 62 to 69
 * across three seasons and sat at 5% board confidence the whole way.
 */
function judgedCompKey(state: GameState, stage: StageKey): string | null {
  const me = state.teams[state.myTeam]
  if (!me) return null
  if (me.tier === 1) return `${stage}:${me.region}`
  // the two Challengers splits conclude around Stage 1 and Stage 2
  if (stage === 'stage1') return `challengers1:${me.region}`
  if (stage === 'stage2') return `challengers2:${me.region}`
  return null   // Kickoff has no Challengers equivalent
}

/** Where in its own league does the club sit by strength? */
function expectedPlace(state: GameState): { place: number; size: number } {
  const me = state.teams[state.myTeam]
  const peers = Object.values(state.teams)
    .filter((t) => t.region === me.region && t.tier === me.tier)
    .sort((a, b) => b.rating - a.rating)
  return { place: peers.findIndex((t) => t.id === me.id) + 1, size: peers.length }
}

/**
 * Ask the board what it wants from this stage.
 *
 * The target is pinned to the squad you actually have — a bottom side is asked
 * to survive, a favourite to win it — so overachieving is possible from
 * anywhere and the goal never reads as arbitrary.
 */
export function setObjective(state: GameState, notes: string[]): void {
  if (!JUDGED.includes(state.stage) || !judgedCompKey(state, state.stage)) {
    state.objective = undefined
    return
  }
  const { place, size } = expectedPlace(state)
  // What the board asks for has to be reachable with the squad it gave you.
  //
  // It used to demand a 40% improvement on your expected finish every single
  // stage — which for a club expected second meant "win it", forever. Measured
  // over ten careers that got the manager sacked six times in three seasons
  // while averaging third of twelve, which is not a failure by any reading.
  //
  // A favourite is asked to stay a favourite; everyone else is asked for a
  // real but survivable step up. Beating the brief is still what moves your
  // reputation, so there is no less to play for.
  const target = place <= 2
    ? clamp(place, 1, 2)
    : clamp(Math.ceil(place * 0.75), 2, Math.max(1, size - 2))
  const text =
    target === 1 ? '董事会要求：拿下本赛段冠军。'
      : target <= Math.ceil(size / 4) ? `董事会要求：本赛段进入前 ${target} 名。`
        : target <= Math.ceil(size / 2) ? `董事会期望：本赛段打进前 ${target} 名（季后赛区）。`
          : `董事会目标：本赛段不低于第 ${target} 名。`
  state.objective = { stage: state.stage, placeAtLeast: target, text }
  notes.push(text)
  state.news.push({ day: state.day, kind: 'club', important: true, text })
}

/** Judge the stage that just ended, and move board confidence accordingly. */
export function settleObjective(state: GameState, endedStage: StageKey, notes: string[]): void {
  const obj = state.objective
  if (!obj || obj.settled || obj.stage !== endedStage) return
  const key = judgedCompKey(state, endedStage)
  const comp = key ? state.comps[key] : undefined
  if (!comp) return

  const order = comp.finished.length ? comp.finished : sortStandings(comp)
  const place = order.indexOf(state.myTeam) + 1
  if (place <= 0) return

  obj.settled = true
  obj.met = place <= obj.placeAtLeast
  // Symmetric around the brief. It used to pay +6 for meeting the target and
  // charge -8 for missing it by a single place, so a club landing on its brief
  // about half the time drifted downward: 0.5*6 + 0.5*-8 = -1 a stage, on top
  // of the -0.1 a .500 record already bleeds match by match. Doing exactly what
  // was asked should not be a slow route to the sack, and it was — a squad
  // trained from 75 to 80 got fired for finishing 8th while a squad left alone
  // sat comfortably at 75% confidence.
  const swing = obj.met
    ? Math.min(16, 6 + (obj.placeAtLeast - place) * 3)
    : -Math.min(18, 2 + (place - obj.placeAtLeast) * 3)
  state.boardConfidence = clamp(state.boardConfidence + swing, 0, 100)
  state.missedStreak = obj.met ? 0 : (state.missedStreak ?? 0) + 1
  // beating the brief moves your standing; missing it costs you a little
  if (state.manager) {
    const growth = state.manager.growth
    const raw = obj.met ? (1 + (obj.placeAtLeast - place) * 0.5) * growth : -1.5
    const delta = raw > 0 ? damped(state.manager.reputation, raw) : raw
    state.manager.reputation = clamp(state.manager.reputation + delta, 5, 96)
  }

  const msg = obj.met
    ? `✅ 赛段目标达成：第 ${place} 名（要求前 ${obj.placeAtLeast}）。董事会满意。`
    : `❌ 赛段目标未达成：第 ${place} 名（要求前 ${obj.placeAtLeast}）。董事会不满。`
  notes.push(msg)
  state.news.push({ day: state.day, kind: 'club', important: true, text: msg })

  judgeTenure(state, place, obj.met, notes)
}

/**
 * How much of the board's patience a manager has to win back.
 *
 * Deliberately above the 20% that issues a warning, and deliberately below the
 * 45% the withdrawal used to want: a warning that cannot be worked off is not
 * a warning, it is a permanent penalty on every contract talk and job offer.
 * One good stage from the confidence floor gets close; two clears it.
 */
export const NOTICE_LIFT = 35

/**
 * What it will take to get the warning withdrawn, in the board's own terms.
 *
 * One sentence, shared by the news line, the agenda and the dashboard, because
 * a warning that does not say how it comes off is the thing that was reported.
 * It adapts: a manager warned for two missed briefs may already be well above
 * the confidence bar, and telling him to climb back to 35% from 43% reads as
 * nonsense.
 */
export function noticeHint(state: GameState): string {
  return state.boardConfidence >= NOTICE_LIFT
    ? '达成一个赛段目标就会撤回'
    : `达成赛段目标、并把信任度拉回 ${NOTICE_LIFT}% 以上（现在 ${Math.round(state.boardConfidence)}%）就会撤回`
}

/**
 * Whether the board keeps us.
 *
 * A career needs a way to end badly or its successes mean nothing. The board
 * warns first — it never fires without having said so — and only acts on a
 * stage boundary, where a verdict belongs.
 *
 * Everything here is judged against the brief the board actually set, which is
 * the whole point of having one. It was not, and the group chat found both
 * halves of that:
 *
 *   The warning was withdrawn only on a top-four finish. A mid-table club is
 *   asked for top eight, so a manager could meet the brief four stages
 *   running, watch confidence climb from 40% to 88%, and still be carrying a
 *   warning that costs 45 points of odds on every renewal and job offer. It
 *   never came off, and nothing on screen said what would take it off.
 *
 *   And the sack could fire on a stage that PASSED, because the confidence
 *   floor did not ask. The manager was then told he had 「又交了一个不合格
 *   的赛段」 about a stage he had just been congratulated for. The warning
 *   says one more failed stage; only a failed stage may act on it.
 *
 * Exported so a check can put a board through every one of these paths without
 * having to rig a season's standings to reach them.
 */
export function judgeTenure(
  state: GameState, place: number, met: boolean, notes: string[],
): void {
  const club = state.teams[state.myTeam]?.name ?? '俱乐部'

  const doomed = !met && (
    state.boardConfidence <= 6 ||
    (state.onNotice && (state.missedStreak ?? 0) >= 2) ||
    (state.onNotice && state.boardConfidence <= 18))

  if (doomed && state.onNotice) {
    // Say what actually ended it. There are three routes here and the message
    // only ever described one of them, so a manager fired on a confidence
    // floor was told "连续 1 个赛段没有达成目标" — a sentence that reads as a
    // mistake because a streak of one is not a streak.
    const streak = state.missedStreak ?? 0
    const conf = Math.round(state.boardConfidence)
    const why = streak >= 2
      ? `连续 ${streak} 个赛段没有达成目标，信任度已经跌到 ${conf}%。`
      : `被警告之后又交了一个不合格的赛段（本赛段第 ${place} 名），信任度只剩 ${conf}%。`
    state.gameOver = `${club} 董事会决定解除你的职务。${why}`
    notes.push(`🚪 ${state.gameOver}`)
    state.news.push({ day: state.day, kind: 'club', important: true, text: state.gameOver })
    return
  }

  if (!state.onNotice && (state.boardConfidence <= 20 || (state.missedStreak ?? 0) >= 2)) {
    state.onNotice = true
    // say what takes it off, or 「已被警告」 reads as a permanent mark
    const warn = `⚠ 董事会正式警告：再有一个赛段交不出成绩，就会换人。`
      + `（当前信任度 ${Math.round(state.boardConfidence)}%——${noticeHint(state)}）`
    notes.push(warn)
    state.news.push({ day: state.day, kind: 'club', important: true, text: warn })
    return
  }

  // a good stage buys back some patience — measured against the brief, not
  // against a placing the brief never asked for
  if (state.onNotice && met && state.boardConfidence >= NOTICE_LIFT) {
    state.onNotice = false
    const ok = `董事会撤回了此前的警告（第 ${place} 名，达成目标；信任度 ${Math.round(state.boardConfidence)}%），你坐稳了位置。`
    notes.push(ok)
    state.news.push({ day: state.day, kind: 'club', important: true, text: ok })
  }
}

/**
 * Reputation gets harder to earn the more of it you have.
 *
 * Without this a manager who wins one season is already the biggest name in the
 * sport, and every remaining season has nothing left to climb toward.
 */
export function damped(current: number, gain: number): number {
  return gain * clamp((96 - current) / 42, 0.12, 1)
}

/** What lifting a trophy is worth to the manager's own name. */
export const TITLE_REP_WORTH = { regional: 2.5, international: 6 } as const

/**
 * The end of a season, before its winter.
 *
 * The five-year settlement is asked BEFORE anything else touches the state:
 * the verdict must judge the squad that played the season, not the one the
 * off-season is about to dissolve, and the clock holds until it is answered.
 * `>=`, not `===`: the settlement shipped into a game people had already been
 * playing for weeks, and a save already in 2031 would never have matched 2030.
 *
 * Then the manager's own pay for the season is banked, and at FINAL_YEAR the
 * tenure ends on its own terms — also before a line of the off-season runs, so
 * the endings judge the last season's squad rather than the one the winter
 * would have left. True when the season stops here.
 */
export function seasonEnding(state: GameState, notes: string[]): boolean {
  if (state.year >= MID_YEAR && state.year < FINAL_YEAR && !state.midReviewDone) {
    state.midReview = true
    notes.push(`⏳ ${tenureCn(state.year)}年之期已到——是就此收官拿一个结局，还是继续带到 2036？`)
    return true
  }
  state.tally ??= { signed: 0, hired: 0, earned: 0, commercial: 0 }
  state.tally.earned += state.managerContract?.salary ?? 0
  if (state.year >= FINAL_YEAR) {
    const earned = endingsFor(state)
    state.finished = true
    state.gameOver = earned[0]
      ? `十年任期结束——${earned[0].title}`
      : '十年任期结束。'
    notes.push(`🏁 ${state.gameOver}`)
    state.news.push({ day: state.day, kind: 'club', important: true, text: state.gameOver })
    return true
  }
  return false
}

/**
 * Take the five-year verdict and go: the career ends here, graded, with the
 * squad that earned it still intact. The season was worked, so the year's
 * salary is banked exactly as the finale path banks it.
 */
export function settleAtFive(state: GameState): void {
  if (!state.midReview) return
  state.midReview = false
  state.midReviewDone = true
  state.tally ??= { signed: 0, hired: 0, earned: 0, commercial: 0 }
  state.tally.earned += state.managerContract?.salary ?? 0
  const earned = endingsFor(state)
  state.finished = true
  state.gameOver = earned[0]
    ? `${tenureCn(state.year)}年之约到期，你选择功成身退——${earned[0].title}`
    : `${tenureCn(state.year)}年之约到期，你选择功成身退。`
  state.news.push({ day: state.day, kind: 'club', important: true, text: state.gameOver })
}

/** Decline the settlement and play on: 2036 stays the hard end of the story. */
export function continuePastFive(state: GameState): void {
  if (!state.midReview) return
  state.midReview = false
  state.midReviewDone = true
  state.news.push({
    day: state.day, kind: 'club', important: true,
    text: '你谢绝了功成身退的机会——这份工作干到 2036 年为止。',
  })
}
