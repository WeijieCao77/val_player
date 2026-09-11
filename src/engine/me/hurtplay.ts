import { Rng, clamp, hashStr } from '../rng'
import { recomputeOverall } from '../player'
import type { Fixture, GameState } from '../types'
import type { MeMatchRecord } from './types'
import { pushLog } from './log'
import { pop, push } from './pending'
import { EDGE_NEED, TRIAL_MATCHES, coachStarters } from './coach'
import { INJURY_KINDS, durationShort, durationWord, ensureInjury, floorHits, injuryStatus, lastingHit } from './injury'

/**
 * Being hurt on a match day, and a team-mate being hurt on mine.
 *
 * Mine. On a day my club plays and the coach would start me fit, a light
 * injury is my call — play through it or sit it out — and a serious one is his:
 * he does not play me. Played through, I am on the five as I actually am (the
 * kind's toll off the named attributes, for that map only), the lay-off may get
 * longer, and a small chance leaves a mark for good (me/injury.ts). Sitting it
 * out is not asked again for that lay-off.
 *
 * The engine picks lineups by `injuredUntil`: it leaves the injured out, and
 * prices one a short club has to field at −22%. Playing through by choice is
 * neither, so the engine calls that pick or book the lineup run with me
 * counted fit, and everything is put back before they return — nothing of it
 * reaches a save.
 *
 * Theirs. Team-mates are hurt by the engine's own rolls, and the coach's weekly
 * five already leaves them out (me/coach.ts coachStarters). The week's paper
 * says so in one line, with no diagnosis of a real person's body — just the
 * lay-off and who steps in — and when the one stepping in is me, good nights
 * in his place count toward a trial, the way practice duels do.
 */

/**
 * An engine call that picks or books a lineup, run as if I were fit — and,
 * `onFloor`, as I actually am on the floor. Everything is put back.
 */
export function asFit<T>(state: GameState, fn: () => T, onFloor = false): T {
  const me = state.me
  const p = me ? state.players[me.id] : undefined
  if (!p || p.injuredUntil <= state.day) return fn()
  const until = p.injuredUntil
  const hits = onFloor ? floorHits(state) : null
  const attrs = { ...p.attrs }
  const { overall, form } = p
  p.injuredUntil = state.day
  if (hits) {
    for (const [k, v] of Object.entries(hits.attrs) as [keyof typeof attrs, number][]) p.attrs[k] = Math.max(20, p.attrs[k] + v)
    p.form = clamp(p.form + hits.form, 30, 99)
    recomputeOverall(p)
  }
  try {
    return fn()
  } finally {
    p.injuredUntil = until
    if (hits) {
      Object.assign(p.attrs, attrs)
      p.overall = overall
      p.form = form
    }
  }
}

/** Am I on the floor hurt in this one: I told the coach I would play through it, or it is a cup I entered. */
export function playsHurt(state: GameState, fixtureId: string, friendly = false): boolean {
  const me = state.me
  if (!me || !injuryStatus(state)) return false
  return friendly || me.injury?.play === fixtureId
}

/** The next map's five (me/matchplay.ts): with me on it as I am, if I am playing through. */
export function hurtMap<T>(state: GameState, fixtureId: string, friendly: boolean, fn: () => T): T {
  return playsHurt(state, fixtureId, friendly) ? asFit(state, fn, true) : fn()
}

/** The result booked (me/matchplay.ts), with me counted as having played — not as a short club's injured man. */
export function hurtBook<T>(state: GameState, fixtureId: string, fn: () => T): T {
  return playsHurt(state, fixtureId) ? asFit(state, fn) : fn()
}

/**
 * My club plays today and I am hurt (me/week.ts, next to 决赛入场). Nothing if
 * the coach would not start me fit anyway. A club that cannot field five
 * without me plays me; a serious one, the coach sits me; a light one, I am asked.
 */
export function hurtBeforeMatch(state: GameState, f: Fixture): void {
  const me = state.me!
  if (me.phase !== 'pro') return
  const cur = injuryStatus(state)
  const inj = cur ? ensureInjury(state) : undefined
  if (!cur || !inj || inj.sit || inj.play === f.id || me.pending.some((x) => x.kind === 'hurt')) return
  if (!asFit(state, () => coachStarters(state)).includes(me.id)) return
  const team = state.teams[state.myTeam]
  const fit = team.roster.filter((id) => id !== me.id && (state.players[id]?.injuredUntil ?? 0) <= state.day)
  if (fit.length < 5) {
    inj.play = f.id
    team.starters = asFit(state, () => coachStarters(state))
    pushLog(state, 'bad', `队里凑不齐五个人，你带着${cur.note}上。`)
    return
  }
  if (cur.serious) {
    if (!inj.benched) {
      inj.benched = true
      pushLog(state, 'bad', `${cur.note}还重，教练不让你上，先养着。`)
    }
    return
  }
  push(state, { kind: 'hurt', id: f.id })
}

/** The card's words: what it is, who we play, what playing through risks. */
export function hurtAsk(state: GameState, fixtureId: string): { line: string; vs: string; risk: string } | null {
  const cur = injuryStatus(state)
  if (!cur) return null
  const f = state.fixtures.find((x) => x.id === fixtureId)
  const opp = f ? state.teams[f.teamA === state.myTeam ? f.teamB : f.teamA] : undefined
  return {
    line: cur.line,
    vs: `${opp ? `今天打 ${opp.tag}，` : ''}教练让你自己拿主意。`,
    risk: `带伤上：发挥打折扣，伤可能加重${INJURY_KINDS[cur.kind].lasting > 0 ? '，小概率落下病根' : ''}。`,
  }
}

/** Play through it, or sit out until it heals. */
export function answerHurt(state: GameState, fixtureId: string, play: boolean): void {
  pop(state, 'hurt', fixtureId)
  const cur = injuryStatus(state)
  const inj = ensureInjury(state)
  if (!cur || !inj) return
  if (play) {
    inj.play = fixtureId
    state.teams[state.myTeam].starters = asFit(state, () => coachStarters(state))
    pushLog(state, 'info', `你跟教练说能上：带着${cur.note}打这一场。`)
  } else {
    inj.sit = true
    pushLog(state, 'info', `你跟教练说先养伤，好了再上。`)
  }
}

/** The autopilot does not play on anything serious, nor on anything that can leave a mark (me/auto.ts). */
export function autoSitsOut(state: GameState): boolean {
  const cur = injuryStatus(state)
  return !!cur && (cur.serious || !INJURY_KINDS[cur.kind].autoPlays)
}

/** The autopilot's answer: a cold or tired eyes, played through; anything that can leave a mark, sat out. */
export function autoHurt(state: GameState, fixtureId: string): string {
  const cur = injuryStatus(state)
  const play = !!cur && !autoSitsOut(state)
  answerHurt(state, fixtureId, play)
  return cur ? (play ? `带着${cur.note}上了` : `${cur.note}，没上`) : ''
}

/**
 * After one of my matches (me/matchplay.ts): what playing through did, or —
 * healthy, in for an injured team-mate — what a good night in his place is worth.
 */
export function injuryAfterMatch(state: GameState, rec: MeMatchRecord): void {
  const me = state.me!
  const p = state.players[me.id]
  const inj = me.injury
  const cur = injuryStatus(state)
  const through = !!cur && !!inj && rec.started && (!!rec.friendly || inj.play === rec.fixtureId)
  if (inj?.play === rec.fixtureId) inj.play = undefined
  if (through && cur && inj) {
    inj.played++
    me.flags.injPlayed = (me.flags.injPlayed ?? 0) + 1
    const def = INJURY_KINDS[cur.kind]
    const rng = new Rng(hashStr(`hurt:${state.seed}:${state.year}:${rec.day}:${rec.fixtureId}`))
    const worse = rng.chance((cur.serious ? 0.5 : 0.3) + Math.min(0.2, rec.maps * 0.04))
    if (worse) p.injuredUntil += rng.int(2, 5)
    const mark = def.lasting > 0 && rng.chance(def.lasting * (cur.serious ? 1.5 : 1) * (inj.played > 1 ? 1.3 : 1))
    pushLog(state, worse ? 'bad' : 'info', worse
      ? `带伤打完，${cur.note}加重了，${durationWord(p.injuredUntil - state.day)}。`
      : `带伤打完，${cur.note}没有加重。`)
    if (mark) lastingHit(state, cur.kind)
    // back out of the five: the next match is asked again
    if (!rec.friendly && me.phase === 'pro') state.teams[state.myTeam].starters = coachStarters(state)
    return
  }
  if (!rec.friendly && rec.started && !cur) coverNight(state, rec)
}

/** In for an injured team-mate and it went well: it counts toward a trial, and enough of it is one. */
function coverNight(state: GameState, rec: MeMatchRecord): void {
  const me = state.me!
  if (me.phase !== 'pro' || me.trial) return
  const team = state.teams[state.myTeam]
  const mine = state.players[me.id]
  const out = team.roster.map((id) => state.players[id]).filter((q) => !!q && q.id !== me.id && q.injuredUntil > state.day)
  // named for this week in his place, or sent on today because a starter could not go
  if (!out.length || !(me.flags.coverWk === me.week || !team.starters.includes(me.id))) return
  if (!rec.won && rec.rank > 2) return
  me.edge += rec.won && rec.rank === 1 ? 1.5 : 1
  me.coachTrust = clamp(me.coachTrust + 1.5, 0, 100)
  if (me.edge < EDGE_NEED) {
    pushLog(state, 'team', '顶上首发的这场打出来了，教练记下了。')
    return
  }
  const him = out.find((q) => (q.roles ?? [q.role]).includes(mine.role)) ?? out[0]
  me.trial = { left: TRIAL_MATCHES, displaced: him.id, forgiven: false }
  me.edge = 0
  team.starters = coachStarters(state)
  pushLog(state, 'good', `顶上的几场都打出来了。教练说：接下来 ${TRIAL_MATCHES} 场你先打，赢下来，${him.ign} 回来也不一定拿得回位置。`)
}

/**
 * The week opens (me/week.ts beginWeek): team-mates newly out hurt and newly
 * back, in one line, and whoever the coach's five put in — me included.
 * `was` is last week's five. A new club, or a save from before this, is looked
 * at once in silence, so a lay-off already running is not news.
 */
export function mateInjuryWeek(state: GameState, was: string[]): void {
  const me = state.me!
  const team = me.phase === 'pro' ? state.teams[state.myTeam] : undefined
  if (!team) { me.mateHurt = undefined; return }
  const hurt = team.roster.filter((id) => id !== me.id && (state.players[id]?.injuredUntil ?? 0) > state.day)
  const before = me.mateHurt?.club === team.id ? me.mateHurt.ids : null
  me.mateHurt = { club: team.id, ids: hurt }
  if (!before) return
  const fresh = hurt.filter((id) => !before.includes(id))
  const back = before.filter((id) => !hurt.includes(id) && team.roster.includes(id))
  if (!fresh.length && !back.length) return
  const ign = (id: string) => state.players[id]?.ign ?? '?'
  const parts: string[] = []
  if (fresh.length) {
    const came = fresh.some((id) => was.includes(id)) ? team.starters.filter((id) => !was.includes(id)) : []
    let tail = ''
    if (came.includes(me.id)) {
      tail = '：这周你顶上首发'
      me.flags.coverWk = me.week
    } else if (came.length) tail = `：${came.map(ign).join('、')} 顶上首发`
    parts.push(`队友 ${fresh.map((id) => `${ign(id)} 伤停，${durationWord(state.players[id].injuredUntil - state.day)}`).join('；')}${tail}`)
  }
  if (back.length) parts.push(`${fresh.length ? '' : '队友 '}${back.map(ign).join('、')} 伤愈归队`)
  const line = `${parts.join('；')}。`
  pushLog(state, 'team', line)
  me.weekNotes.push(line)
}

/** A roster row's mark (ui/me/TeamScreen): out hurt and for about how long, nothing more. */
export function mateMark(state: GameState, id: string): string | null {
  const q = state.players[id]
  if (!q || q.injuredUntil <= state.day) return null
  return `伤停·${durationShort(q.injuredUntil - state.day)}`
}
