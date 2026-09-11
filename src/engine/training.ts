import { Rng, clamp, dayStream } from './rng'
import { INJURIES } from './content'
import { recomputeOverall, refreshValue, ageDrift, weightsFor, ceilingOf, atOwnCeiling } from './player'
import { coachOr } from './roster'
import { weeklyBonds } from './bonds'
import { growLoyalty } from './attachment'
import { deskOf } from './desk'
import type { ClubMods } from './desk'
import { ATTR_KEYS } from './types'
import type { Attrs, GameState, Player, Team } from './types'

/**
 * The neutral point of the form scale.
 *
 * match.ts has always read form as a swing around 70 — `(p.form - 70) * 0.0028`
 * — and build_world derives a new save's starting form the same way, from this
 * season against the player's own career. Everything that moves form reverts
 * to this.
 */
export const FORM_BASE = 70

/** The shared load-management line used by both automatic plans. */
export const REST_AT = 45

/**
 * The most useful individual focus for this player's actual role.
 *
 * Overall is role-weighted, so "train the lowest raw number" is not neutral:
 * it sent duelists to communication (5% of their rating) instead of aim (28%).
 * The training screen's 「按位置分配」 and every AI club use this same
 * judgement — the heaviest attribute that still has somewhere to go, and
 * among equals the one he is worse at. A manager can still override it by
 * hand. Only the caller is ever pointed at 指挥, and anyone tired, hurt or
 * already at his ceiling is rested instead.
 */
export function recommendedTrainingFocus(p: Player): keyof Attrs | 'rest' {
  if (p.potential <= p.overall || p.fatigue >= REST_AT) return 'rest'
  const weights = weightsFor(p)
  const room = ATTR_KEYS.filter((k) => (k !== 'igl' || p.isIgl) && p.attrs[k] < 97)
  if (!room.length) return 'rest'
  return room.reduce((a, b) => {
    const d = weights[b] - weights[a]
    if (Math.abs(d) > 0.001) return d > 0 ? b : a
    return p.attrs[b] < p.attrs[a] ? b : a
  })
}

/**
 * A title makes rival clubs accelerate high-upside youngsters, not every
 * veteran and unattached player in the database. The boost is deliberately
 * bounded: coaching, facilities, age, morale and headroom remain the engine.
 */
export function aiGrowthMultiplier(state: GameState, p: Player, team: Team): number {
  const eligible = team.id !== state.myTeam && p.teamId === team.id &&
    p.age <= 23 && p.potential - p.overall >= 3
  if (!eligible) return 1
  return 1 + 0.10 * Math.min(Math.max(state.rivalry ?? 0, 0), 2)
}

/**
 * One week of practice for a single player. `mods` are a manager's skills and
 * staff at his own club (engine/desk.ts ClubMods); every other club trains
 * without them.
 */
function trainPlayer(state: GameState, p: Player, team: Team, rng: Rng, mods?: ClubMods): string | null {
  const focus = state.training[p.id] ?? 'rest'

  if (focus === 'rest') {
    p.fatigue = clamp(p.fatigue - rng.range(18, 30) * (mods?.rest ?? 1), 0, 100)
    p.morale = clamp(p.morale + rng.range(0.5, 2.5), 0, 100)
    p.form = clamp(p.form + rng.range(-1, 2), 30, 99)
    return null
  }

  const attr = focus as keyof Attrs
  const headroom = p.potential - p.overall
  // days spent on commercial work are days not spent practising
  const available = clamp(1 - (mods?.booked(p) ?? 0) * 0.25, 0, 1)
  if (available <= 0) {
    p.form = clamp(p.form - rng.range(0, 2), 30, 99)
    return null
  }
  if (headroom <= 0) {
    // at the ceiling: practice only holds form together
    p.fatigue = clamp(p.fatigue + rng.range(4, 9), 0, 100)
    p.form = clamp(p.form + rng.range(0, 2), 30, 99)
    return null
  }

  const coach = (coachOr(team, 'development') - 55 + (mods?.devHelp ?? 0)) / 100
  const facility = (team.facilities - 55) / 130
  const age = p.age <= 20 ? 1.35 : p.age <= 23 ? 1.1 : p.age <= 26 ? 0.8 : 0.45
  const tired = p.fatigue > 70 ? 0.5 : p.fatigue > 45 ? 0.8 : 1
  const motivated = 0.75 + p.morale / 200

  const talent = mods ? mods.talent(p) : 1
  const chasing = aiGrowthMultiplier(state, p, team)
  const gain =
    rng.range(7, 16) * age * tired * motivated * (1 + coach + facility) *
    clamp(headroom / 12, 0.25, 1.6) * available * talent * chasing

  p.xp[attr] = (p.xp[attr] ?? 0) + gain
  p.fatigue = clamp(p.fatigue + rng.range(5, 11), 0, 100)

  // a player at his own ceiling (me/bottleneck.ts) fills the bar and waits
  if (atOwnCeiling(p, attr)) {
    p.xp[attr] = Math.min(p.xp[attr] ?? 0, 100)
    return null
  }
  if ((p.xp[attr] ?? 0) >= 100) {
    p.xp[attr] = (p.xp[attr] ?? 0) - 100
    p.attrs[attr] = clamp(p.attrs[attr] + 1, 20, 99)
    const before = p.overall
    recomputeOverall(p)
    refreshValue(p)
    if (p.overall > before) return `${p.ign} 的能力值提升到 ${p.overall}。`
  }
  return null
}

/** Add progress toward an attribute, converting a full bar into a point. */
export function addXp(p: Player, k: keyof Attrs, amount: number): boolean {
  // The ceiling is checked here, not only in trainPlayer. Team drills and the
  // pair drill go through this path, and they used to walk a maxed player
  // several points past his own potential — the number the whole scouting and
  // transfer economy is priced on.
  // A player carrying his own ceilings is held by them instead: the bar fills
  // and waits, and the one number is re-derived from them (me/bottleneck.ts).
  if (p.caps) {
    if (atOwnCeiling(p, k)) {
      p.xp[k] = Math.min((p.xp[k] ?? 0) + amount, 100)
      return false
    }
  } else if (p.overall >= p.potential) {
    p.xp[k] = Math.min(p.xp[k] ?? 0, 99)
    return false
  }
  p.xp[k] = (p.xp[k] ?? 0) + amount
  if ((p.xp[k] ?? 0) < 100) return false
  p.xp[k] = (p.xp[k] ?? 0) - 100
  p.attrs[k] = clamp(p.attrs[k] + 1, 20, 99)
  recomputeOverall(p)
  refreshValue(p)
  return true
}

/** Weekly tick: training, condition, morale drift, injury rolls. */
export function weeklyTick(state: GameState, rng: Rng, grumbling: Player[] = []): string[] {
  const notes: string[] = []
  // One club's dressing room rolls its own dice (engine/rng.ts dayStream): the
  // squad it reads changes with whoever is at that club, and every training and
  // injury roll in the world below must not move with it.
  weeklyBonds(state, dayStream(state.seed, state.year, state.day, 'bonds'), notes)
  // a manager's skills and staff, at the club he runs (engine/desk.ts)
  const mods = deskOf(state)?.clubMods(state)
  for (const team of Object.values(state.teams)) {
    const isMine = team.id === state.myTeam
    for (const pid of team.roster) {
      const p = state.players[pid]
      if (!p) continue

      if (p.injuredUntil > state.day) {
        // an injured player is resting properly — send him back recovered, or
        // he returns at the same fatigue that got him hurt and goes straight
        // back on the table
        p.fatigue = clamp(p.fatigue - 15, 0, 100)
        p.morale = clamp(p.morale - 1.5, 0, 100)
        continue
      }

      if (isMine) {
        const note = trainPlayer(state, p, team, rng, mods)
        if (note) notes.push(note)
      } else {
        // AI clubs follow the same role-aware plan the training screen offers
        // the manager, and rest the tired and the finished instead of
        // grinding every healthy player forever. It used to train whichever
        // raw number was lowest — a duelist on communication, worth a fifth of
        // a point of aim — so the world's clubs threw away half their
        // development for years. The plan is written into the same map as
        // the manager's, so a player arrives at a new club with his programme
        // visible; it is a pure function of the player, so it stays put
        // until the attribute has nowhere left to go.
        state.training[p.id] = recommendedTrainingFocus(p)
        trainPlayer(state, p, team, rng)
      }

      // A promised standing is a commitment. Bench a player you called a core
      // and the grievance builds until they want out; honour it and it fades.
      const promised = p.contract?.promisedRole
      if (promised) {
        const starting = team.starters.includes(p.id)
        const expects = promised === 'star' || promised === 'starter'
        if (expects && !starting) {
          p.grievance = clamp((p.grievance ?? 0) + (promised === 'star' ? 7 : 4.5) * (isMine ? mods?.soothe ?? 1 : 1), 0, 100)
          p.morale = clamp(p.morale - (promised === 'star' ? 3 : 2), 10, 100)
          // a manager hears about it from his own players (engine/desk.ts)
          if (isMine && (p.grievance ?? 0) > 55) grumbling.push(p)
        } else {
          p.grievance = clamp((p.grievance ?? 0) - 3, 0, 100)
        }
      }

      // Form reverts to neutral, not to ability.
      //
      // It used to be pulled toward `overall`, which quietly turned it into a
      // second copy of ability: an 86-rated player settled at form 86 and drew
      // a permanent +4.5% from effectiveRating, a 60-rated one settled at 60
      // and carried -2.8% forever. Ability was being counted twice and form
      // stopped meaning "how he is playing lately". effectiveRating has always
      // measured it against 70; so does this.
      const pull = (FORM_BASE - p.form) * 0.06
      p.form = clamp(p.form + pull + rng.range(-3.5, 3.5), 30, 99)
      p.morale = clamp(p.morale + rng.range(-2, 2), 10, 100)

      // fatigue and heavy schedules cause injuries
      // 体能: fewer injuries under a manager who manages load
      // The load term used to start at 55, which fatigue almost never reached,
      // so in practice only the flat 0.004 ever fired — 0.9 injuries a season
      // across a whole squad. It now starts inside the band a working squad
      // actually occupies (settled p50 34, p90 48).
      // Condition is the gate: under 45 fatigue a player is essentially safe,
      // and age only taxes the already-tired. Whoever just came off the
      // physio table is being watched — a quarter of the normal risk for two
      // weeks — because "he pulled the same wrist twice in a month" was the
      // single most reported way this system felt unfair.
      const load = Math.max(0, p.fatigue - 45) / 55
      const grace = p.injuredUntil > 0 && state.day - p.injuredUntil < 14 ? 0.25 : 1
      const risk = (0.001 + load * (0.018 + Math.max(0, p.age - 27) * 0.002)) * grace *
        (isMine ? mods?.injury ?? 1 : 1)
      // The career's own player is hurt by me/injury.ts instead, which knows his
      // 体质 and his week. The roll is still drawn, so nobody else's dice move.
      if (rng.chance(risk) && p.id !== state.me?.id) {
        const inj = rng.pick(INJURIES)
        const days = rng.int(inj.days[0], inj.days[1])
        p.injuredUntil = state.day + days
        p.injuryNote = inj.note
        p.morale = clamp(p.morale - 10, 0, 100)
        // An injured man rests. The training screen greys his plan out, so the
        // manager cannot set this himself — and the weekly trust tick used to
        // dock him 0.8 for "being used while hurt" regardless.
        state.training[p.id] = 'rest'
        if (isMine) notes.push(`⚕️ ${p.ign} ${inj.note}，预计缺阵 ${days} 天。`)
      }

      // Everyone recovers every week, not only the ones told to rest.
      //
      // Without this there was no equilibrium and no dial: a squad set to
      // train every week sat pinned at 100 fatigue (-16% on every player) and
      // one left resting sat at 10. Recovery scales with how tired they are, so
      // a normal plan settles in the fifties — where the injury curve and the
      // condition penalty both start to bite, and resting a man is a decision
      // rather than the only survivable setting.
      const care = isMine ? mods?.care ?? 1 : 1
      p.fatigue = clamp(p.fatigue - (p.fatigue * 0.30 + 5) * care, 0, 100)
    }
  }
  return notes
}

/** Post-match wear on the players who actually played. */
/**
 * The cost of having played, charged to the people who played.
 *
 * It used to walk `starters` — the names on the teamsheet — but selectLineup
 * drops anyone injured and brings a substitute in, and nothing writes that
 * back. So a player sat out hurt was charged the fatigue of a bo5 he never
 * appeared in, while the man who actually played it was charged nothing and
 * was exempt from the injury roll besides. Being hurt made you more tired than
 * playing, and rotation was free. Measured over one season: 79 injured players
 * charged for matches they missed, 845 substitutes charged for matches they
 * played.
 */
export function applyMatchFatigue(
  state: GameState, teamId: string, mapsPlayed: number, rng: Rng,
  notes?: string[], played?: string[],
) {
  const isMine = teamId === state.myTeam
  for (const pid of played?.length ? played : state.teams[teamId]?.starters ?? []) {
    const p = state.players[pid]
    if (!p) continue
    p.fatigue = clamp(p.fatigue + mapsPlayed * rng.range(3.5, 6.5), 0, 100)

    // A squad used to see 0.9 injuries a season, because the only roll was the
    // weekly one and it did not care whether anyone had played. Playing a bo5
    // at 90 fatigue should be the risk it looks like — so the match itself now
    // rolls, and it is the tired who get hurt rather than everyone equally.
    if (p.injuredUntil > state.day) continue
    const load = Math.max(0, p.fatigue - 40) / 60           // 0 at 40, 1 at 100
    const grace = p.injuredUntil > 0 && state.day - p.injuredUntil < 14 ? 0.25 : 1
    const risk = (0.002 + load * 0.026) * (mapsPlayed / 3) * grace *
      (isMine ? deskOf(state)?.clubMods(state).injury ?? 1 : 1)
    // the career's own player: me/injury.ts (see weeklyTick)
    if (!rng.chance(risk) || p.id === state.me?.id) continue
    const inj = rng.pick(INJURIES)
    const days = rng.int(inj.days[0], inj.days[1])
    p.injuredUntil = state.day + days
    p.injuryNote = inj.note
    p.morale = clamp(p.morale - 10, 0, 100)
    state.training[p.id] = 'rest'
    if (isMine) notes?.push(`⚕️ ${p.ign} 赛后${inj.note}，预计缺阵 ${days} 天。`)
  }
}

/** End-of-season ageing: growth for prospects, decline for veterans. */
export function seasonRollover(state: GameState, rng: Rng): string[] {
  const notes: string[] = []
  const small: string[] = []
  // Another season served, at every club in the world. League-wide on purpose:
  // ours alone would slowly become unpoachable while everybody else's stayed
  // as easy to raid as on day one.
  growLoyalty(state)
  for (const p of Object.values(state.players)) {
    const seasonAge = p.age
    p.age += 1
    // Scouts re-rate the young every winter. A prospect who has nearly caught
    // his projection sometimes turns out to have been under-rated — that is
    // where next season's headroom comes from, for the AI's academy kids and
    // the player's alike. Rivalry makes the rest of the world's kids likelier
    // to be pushed: clubs chasing a champion coach their youth harder.
    const playedEnough = p.season.maps >= 10 || p.season.rounds >= 200
    const revisions = p.potentialRevisions ?? 0
    if (p.teamId && seasonAge <= 23 && playedEnough && revisions < 2 &&
        p.potential - p.overall < 4 && p.potential < 97) {
      const pressure = p.teamId !== state.myTeam
        ? Math.min(Math.max(state.rivalry ?? 0, 0), 2)
        : 0
      if (rng.chance(0.28 + pressure * 0.08)) {
        p.potential = clamp(p.potential + rng.int(1, 2), p.potential, 99)
        p.potentialRevisions = revisions + 1
      }
    }
    const drift = ageDrift(p)
    // Captured before a single attribute moves. It used to sit further down,
    // which was fine while recomputeOverall was called exactly once at the
    // bottom — the moment the growth loop started recomputing as it went, a
    // late reading made the winter's growth invisible in the digest, and
    // audit_feedback.ts caught it as 「2 silent days」.
    const before = p.overall

    for (const k of ATTR_KEYS) {
      if (drift > 0) {
        // Live headroom, re-read after every bump rather than measured once
        // before the loop. Nine attributes each rolling up to +2 against a
        // single stale reading walked a player straight past his own ceiling.
        if (p.overall < p.potential && rng.chance(0.55 * drift)) {
          // his own ceiling holds here too; the dice are rolled the same either way
          p.attrs[k] = clamp(p.attrs[k] + rng.int(0, 2), 20, Math.max(p.attrs[k], ceilingOf(p, k)))
          recomputeOverall(p)
        }
      } else if (rng.chance(Math.abs(drift) * 0.5)) {
        // aim and reaction go first
        const hit = k === 'aim' || k === 'reaction' ? 2 : 1
        p.attrs[k] = clamp(p.attrs[k] - rng.int(0, hit), 20, 99)
      }
    }
    // Experience keeps rising even as the mechanics fade — but not past the
    // ceiling either. This pair asked nothing about potential at all, so a
    // veteran gained 意识 (and 指挥, if he called) every winter forever: one
    // player a season finished above his own projection, which reads as
    // 「成长空间 +-1」 on the training screen and quietly bricks him, because
    // addXp refuses to work on anybody at his ceiling. Read after the decline
    // above, so a fading veteran still trades aim for reading the game.
    recomputeOverall(p)
    if (p.age >= 25 && p.overall < p.potential) {
      p.attrs.awareness = clamp(p.attrs.awareness + (rng.chance(0.4) ? 1 : 0), 20, Math.max(p.attrs.awareness, ceilingOf(p, 'awareness')))
      if (p.isIgl) p.attrs.igl = clamp(p.attrs.igl + (rng.chance(0.5) ? 1 : 0), 20, Math.max(p.attrs.igl, ceilingOf(p, 'igl')))
    }

    recomputeOverall(p)
    refreshValue(p)
    p.season = {
      maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0,
      firstKills: 0, firstDeaths: 0, damage: 0, clutches: 0, mvps: 0,
    }
    p.fatigue = clamp(p.fatigue - 40, 0, 100)
    p.injuredUntil = 0
    p.injuryNote = undefined

    if (p.teamId === state.myTeam) {
      if (p.overall - before >= 3) notes.push(`📈 ${p.ign} 赛季间进步明显：${before} → ${p.overall}`)
      else if (before - p.overall >= 3) notes.push(`📉 ${p.ign} 状态下滑：${before} → ${p.overall}`)
      else if (p.overall !== before) small.push(`${p.ign} ${before}→${p.overall}`)
    }
  }
  // A one-point move is not worth a line of its own, but a winter in which
  // seven players quietly shifted is worth knowing about — it was invisible
  // before, and the squad screen shows no history to compare against.
  if (small.length) notes.push(`📊 其余小幅变化：${small.join('、')}`)
  return notes
}

/** What one physio session costs. Money, not action points — it is upkeep. */
export const PHYSIO_COST = 8000

// ---------------------------------------------------------------- the manager game's training screen, by name
//
// The team drill, the pair work and the physio room are the manager's
// (engine/drill.ts), reached through his desk. His training screen still
// imports these from here by name; with no desk mounted each does nothing.

/** What one settled 复盘 is worth to the caller (engine/drill.ts). */
export const reviewIglXp = (state: GameState, p: Player): number =>
  deskOf(state)?.reviewIglXp(state, p) ?? 0

/** Why this player cannot see the physio this week, or null (engine/drill.ts). */
export const physioBlock = (state: GameState, pid: string): string | null =>
  deskOf(state)?.physioBlock(state, pid) ?? '没有理疗室。'

/** A paid physio session (engine/drill.ts). */
export const doPhysio = (state: GameState, pid: string): string | null =>
  deskOf(state)?.doPhysio(state, pid) ?? null
