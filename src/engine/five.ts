/**
 * What makes a five a five.
 *
 * The author's rule, 2026-09-20: 「一个队伍里至少要有一个指挥，一个决斗，一个先锋，
 * 一个烟位（控场），一个哨位，最后一个可以是其他的位置的自由人」 — the four jobs are
 * taken by four different men, one of the five is the caller, and the fifth man
 * is whatever the club wants (a second duelist, a floater, anybody).
 *
 * 指挥 is not a fifth job in this game: it is an appointment on top of a job
 * (engine/roster.ts callerOf, me/igl.ts), so the rule reads as "the five carry
 * the four jobs, and one of those five is the caller". Where a club has nobody
 * appointed, the world names the loudest man it has as it always did
 * (ensureCaller); nothing here invents a role for him.
 *
 * Why this file exists (reported 2026-09-20): 「玩家反映他选的哨卫，但是去 PRX 替换
 * 掉的是 something 而不是 d4v41，something 不是决斗吗？」 — the five used to be built by
 * seating the best man of each main role in turn and then filling up on rating.
 * The first pass took no notice of level, so the only man in the squad whose
 * main job was sentinel walked into the five however weak he was, and the man
 * squeezed out was simply whoever came fifth on rating — at Paper Rex the
 * second duelist. Here the four jobs are what the five is judged on and the
 * coach's reading picks inside them.
 */
import type { Player, Role } from './types'

/** The four jobs a five must carry. 自由人 is not one of them — see the note in engine/match.ts compositionScore. */
export const CORE_ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫']

const isCore = (r: string): r is Role => (CORE_ROLES as string[]).includes(r)

/**
 * The jobs a man can take in a five.
 *
 * 自由人 in the data mostly means vlr never recorded a role for him rather than
 * that he floats by trade, so a man with nothing else on his card is read as
 * able to plug any one job — worse there than a specialist, which is what the
 * match engine already charges him for (engine/match.ts GAP_COST, the `spare`
 * half-price), and far better than leaving the job open.
 */
export function jobsOf(p: Player): Role[] {
  const core = (p.roles ?? [p.role]).filter(isCore)
  return core.length ? core : CORE_ROLES
}

/**
 * The jobs that are his own rather than ones he can cover.
 *
 * His main role, and for a man the book calls 自由人 every real role written
 * beside it: the one hand-verified floater in the data plays all of them for a
 * living, and a man with nothing but 自由人 on his card has no job of his own at
 * all — he stands in wherever he is put, and pays OFF_MAIN for it.
 */
export function mainJobs(p: Player): Role[] {
  if (isCore(p.role)) return [p.role]
  return (p.roles ?? []).filter(isCore)
}

/**
 * What a five gives up for its shape, in points of the coach's reading.
 *
 * A job nobody in the five can take at all is priced out of reach: the match
 * engine charges 4 to 7 for one (engine/match.ts GAP_COST) against a man's
 * rating reaching the result through a weighted mean — roughly a sixth of his
 * number — so a hole costs the side far more than any one signing is worth, and
 * NO_ONE simply says the coach does not name such a five while he has another.
 *
 * OFF_MAIN is the smaller question: the job is covered, but by a man whose own
 * job it is not — Paper Rex fielding no sentinel and asking their smoke to hold
 * the site. The match engine prices that at nothing, because the roles on a
 * man's card are the roles he really played (roleSource 'agents'), so he can
 * genuinely take it; the club still prefers the man whose job it is, and this is
 * how much worse he is allowed to be before it stops preferring him.
 *
 * Six points of the five's summed reading, about six points of 综合 on one man.
 * It is a price and not a rule, which is the whole of the fix: a rule is what
 * the old selection had, and it walked a 70-rated career sentinel into Paper
 * Rex's 88s. Measured over both worlds' clubs (scripts/check_roles.ts): at 4 the
 * world fields fives with neither a controller nor a sentinel by trade wherever
 * that is worth three points; at 6, 8 and 12 the same 8 of 218 clubs in 2021 and
 * 1 of 197 in 2026 field a different five from the old rule's, every one of them
 * still carrying the four jobs, and the world's average five is 64.56 against
 * 64.55 — the shape is kept and no club is weakened for it.
 */
export const OFF_MAIN = 6
const NO_ONE = 1000

/** How a group of players can take the four jobs between them, at the least cost. */
export interface Shape {
  /** jobs nobody in the group can take */
  gaps: Role[]
  /** jobs taken by a man whose own job it is not */
  off: number
  /** what the shape costs the five, in points of the coach's reading */
  cost: number
}

/** as many men as it is worth weighing for an assignment — a squad is five to seven */
const ASSIGN_MAX = 12

/**
 * Who takes which job, at the least cost: a man's own job free, a job he
 * covers at OFF_MAIN, a job nobody can take at NO_ONE. One man one job, so a
 * five that reads 「有控场也有哨卫」 only because the same player is written down
 * twice is not a five.
 */
export function shapeOf(group: Player[]): Shape {
  const men = group.slice(0, ASSIGN_MAX)
  const n = men.length
  const cost = men.map((p) => {
    const jobs = jobsOf(p)
    const mine = mainJobs(p)
    return CORE_ROLES.map((r) => (mine.includes(r) ? 0 : jobs.includes(r) ? OFF_MAIN : NO_ONE))
  })
  // least-cost assignment of the four jobs to distinct men, job by job; leaving a job open costs NO_ONE
  const jobs = CORE_ROLES.length
  const size = 1 << n
  const best: number[][] = Array.from({ length: jobs + 1 }, () => new Array<number>(size).fill(Infinity))
  const took: number[][] = Array.from({ length: jobs + 1 }, () => new Array<number>(size).fill(-1))
  best[0][0] = 0
  for (let job = 0; job < jobs; job++) {
    for (let mask = 0; mask < size; mask++) {
      const v0 = best[job][mask]
      if (v0 === Infinity) continue
      if (v0 + NO_ONE < best[job + 1][mask]) { best[job + 1][mask] = v0 + NO_ONE; took[job + 1][mask] = -1 }
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) continue
        const next = mask | (1 << i)
        const v = v0 + cost[i][job]
        if (v < best[job + 1][next]) { best[job + 1][next] = v; took[job + 1][next] = i }
      }
    }
  }
  let end = 0
  for (let mask = 1; mask < size; mask++) if (best[jobs][mask] < best[jobs][end]) end = mask
  const gaps: Role[] = []
  let off = 0
  let mask = end
  for (let job = jobs; job > 0; job--) {
    const i = took[job][mask]
    if (i < 0) { gaps.push(CORE_ROLES[job - 1]); continue }
    const c = cost[i][job - 1]
    if (c >= NO_ONE) gaps.push(CORE_ROLES[job - 1])
    else if (c > 0) off++
    mask &= ~(1 << i)
  }
  gaps.reverse()
  return { gaps, off, cost: gaps.length * NO_ONE + off * OFF_MAIN }
}

/** The jobs this group cannot take between them, one man one job. */
export const roleGaps = (group: Player[]): Role[] => shapeOf(group).gaps

/** How many men we are willing to weigh against each other; a squad is five to seven, and this is the guard. */
const POOL_MAX = 9

/**
 * The five a club puts out: the strongest it can name that still carries the
 * four jobs, with the caller in it.
 *
 * In this order, because that is the order the game already prices them in. A
 * job nobody takes comes first — where the roster simply has no controller the
 * five is as close as the roster allows, and the missing job is what the club
 * shops for (me/selfpitch.ts needOf). The caller is next: the sim prices a side
 * with nobody calling at −4 either way and −3 mid-round, which is why a club
 * used to field FNATIC's five without Boaster in it. Then the coach's reading,
 * with the shape's own price (OFF_MAIN) taken off it.
 *
 * `score` is how this caller reads a player — engine/world.ts confidentRating
 * for the world's own clubs, me/coach.ts coachView at mine. Put an injured man
 * far down it rather than out of the pool: a squad with nobody fit must field
 * somebody.
 */
export function bestFive(squad: Player[], score: (p: Player) => number, keep?: Player | null): Player[] {
  const ranked = squad.slice().sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))
  if (ranked.length <= 5) return ranked.slice(0, 5)
  // never weigh a whole academy against itself: the men below this line cannot reach the five on any of the terms
  let pool = ranked.slice(0, POOL_MAX)
  if (keep && !pool.includes(keep) && ranked.includes(keep)) pool = [...pool.slice(0, POOL_MAX - 1), keep]

  let best: Player[] | null = null
  let bestKey: [number, number, number] | null = null
  const n = pool.length
  const five = new Array<Player>(5)
  for (let a = 0; a < n - 4; a++) {
    five[0] = pool[a]
    for (let b = a + 1; b < n - 3; b++) {
      five[1] = pool[b]
      for (let c = b + 1; c < n - 2; c++) {
        five[2] = pool[c]
        for (let d = c + 1; d < n - 1; d++) {
          five[3] = pool[d]
          for (let e = d + 1; e < n; e++) {
            five[4] = pool[e]
            const shape = shapeOf(five)
            const key: [number, number, number] = [
              shape.gaps.length,
              keep && five.includes(keep) ? 0 : 1,
              shape.off * OFF_MAIN - five.reduce((s, p) => s + score(p), 0),
            ]
            if (!bestKey || key[0] < bestKey[0]
              || (key[0] === bestKey[0] && (key[1] < bestKey[1]
                || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
              bestKey = key
              best = five.slice()
            }
          }
        }
      }
    }
  }
  return best ?? ranked.slice(0, 5)
}

/**
 * Whose place a man takes when he is put into a five that is already full —
 * the answer 对位挑战, the coach's own five and the 转会 page all have to give.
 *
 * His own job first, as the report asked: a sentinel takes the sentinel's
 * place, not the second duelist's — the man whose own job it is before the man
 * who merely covers it. Never a swap that leaves a job open, and never the man
 * the club calls through. Between two of the same job, the one this caller
 * reads lowest.
 */
export function placeFor(
  five: Player[], p: Player, score: (x: Player) => number,
  spare: (x: Player) => boolean = () => false,
): Player | null {
  const pool = five.filter((x) => x.id !== p.id && !spare(x))
  if (!pool.length) return null
  const rest = five.filter((x) => x.id !== p.id)
  const was = shapeOf(rest).gaps.length
  const holds = (out: Player) => shapeOf(rest.filter((x) => x !== out).concat(p)).gaps.length <= was
  const rank = (x: Player) => (holds(x) ? 0 : 4) + jobRank(x, p.role)
  return pool.slice().sort((a, b) => rank(a) - rank(b) || score(a) - score(b) || a.id.localeCompare(b.id))[0]
}

/** How much a job is this man's: 0 his own, 1 one he covers, 2 not his at all. */
const jobRank = (x: Player, role: Role): number =>
  (mainJobs(x).includes(role) ? 0 : jobsOf(x).includes(role) ? 1 : 2)

/**
 * Who comes in when a man steps out of the five: his own job first, and the
 * five still has to carry the four. The mirror of placeFor — a substitute's
 * contract standing him down, an injury, a suspension.
 */
export function standInFor(
  five: Player[], out: Player, bench: Player[], score: (x: Player) => number,
): Player | null {
  if (!bench.length) return null
  const rest = five.filter((x) => x.id !== out.id)
  const was = shapeOf(five).gaps.length
  const holds = (x: Player) => shapeOf(rest.concat(x)).gaps.length <= was
  const rank = (x: Player) => (holds(x) ? 0 : 4) + jobRank(x, out.role)
  return bench.slice().sort((a, b) => rank(a) - rank(b) || score(b) - score(a) || a.id.localeCompare(b.id))[0]
}
