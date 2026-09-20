/**
 * The optional import rule: at most two players from outside a club's region.
 *
 * Left to itself the market globalises — managers stack a squad with the best
 * of four regions, and so does the AI, which is nothing like the circuit this
 * game is modelled on. With `state.importLimit` on, every club, the player's
 * and the AI's alike, may hold at most IMPORT_MAX players whose nationality
 * belongs to another region, bench included.
 *
 * Origin is nationality, not the `region` field — that one records where a
 * player competes, which is by definition his club's region. A player with no
 * recorded nationality counts as native: an import rule should punish
 * squad-building, never missing data. And the rule gates ACQUISITIONS only.
 * A squad already over the limit when the rule turns on keeps its players —
 * renewals are retention, not recruitment — it simply cannot add more.
 */
import { regionIn } from './era'
import type { GameState, Player, Region, Team } from './types'
import { REGION_CN } from './types'

export const IMPORT_MAX = 2

/**
 * Nationality → the VCT league a person belongs to. Mirrored in src/engine/prospects.ts, which builds the same
 * players out of prospects.json.
 *
 * 港澳台算中国 (the author, 2026-09-20): a player from Hong Kong, Macau or Taiwan is counted in the China region —
 * local at a VCT China club, and from the China league at a club anywhere else. This is the author's call for this
 * game, not a quirk of Riot's rule: Riot has such a player declare a main region on the roster sheet.
 */
const NAT_REGION: Record<string, Region> = {
  us: 'Americas', ca: 'Americas', br: 'Americas', ar: 'Americas',
  cl: 'Americas', mx: 'Americas', pe: 'Americas', co: 'Americas',
  uy: 'Americas', do: 'Americas', ec: 'Americas', bo: 'Americas',
  cn: 'China', hk: 'China', mo: 'China', tw: 'China',
  kr: 'Pacific', jp: 'Pacific', id: 'Pacific', th: 'Pacific',
  ph: 'Pacific', sg: 'Pacific', my: 'Pacific', vn: 'Pacific',
  in: 'Pacific', au: 'Pacific', nz: 'Pacific',
  gb: 'EMEA', fr: 'EMEA', de: 'EMEA', es: 'EMEA', tr: 'EMEA',
  ru: 'EMEA', pl: 'EMEA', se: 'EMEA', dk: 'EMEA', ua: 'EMEA',
  it: 'EMEA', nl: 'EMEA', be: 'EMEA', fi: 'EMEA', no: 'EMEA',
  pt: 'EMEA', cz: 'EMEA', ro: 'EMEA', gr: 'EMEA', il: 'EMEA',
  ch: 'EMEA', at: 'EMEA', hu: 'EMEA', rs: 'EMEA', bg: 'EMEA',
  kg: 'EMEA', kz: 'EMEA', az: 'EMEA', ma: 'EMEA', sa: 'EMEA',
}

/**
 * The region a player is from.
 *
 * Nationality decides when it is on record. When it is not, the player's own
 * `region` field stands in — it is set once when the world is built (from
 * nationality where known, else from the club that employed him) and no
 * transfer ever rewrites it, so it is where he entered the world. This keeps
 * the rule consistent with the screen: jakee carries no nationality but his
 * card says 美洲, and a rule that quietly called him native while the UI
 * called him American was answering a different question than it displayed.
 * A world-built squad member has region equal to his club's, so grandfathering
 * is untouched.
 */
export const originOf = (p: Player): Region =>
  NAT_REGION[(p.nat ?? '').toLowerCase()] ?? p.region

/**
 * Is this player an import for this club?
 *
 * By the LEAGUE on both sides, never by the club's own country. `originOf` answers with one of the four leagues,
 * while a club carries the region it competed in when the world was built — 'Europe', 'CIS', 'Brazil' — so the
 * plain `!==` called every man at every club of a 2021-built world an import: a Frenchman at Alliance read
 * 'EMEA' against 'Europe'. Found 2026-09-20 on the author's report that a move inside one league was being
 * counted as a move out of it (「navi 去 tl…会算成去外赛区，这不合理」). Riot's rule is a league rule as well —
 * one import means one player from outside the club's international league, whatever country the two orgs sit in.
 */
export const isImport = (p: Player, team: Team): boolean =>
  regionIn(originOf(p), 2099) !== regionIn(team.region, 2099)

/** How many imports a club currently holds, bench included. */
export const importCount = (state: GameState, teamId: string): number => {
  const team = state.teams[teamId]
  if (!team) return 0
  return team.roster.reduce((n, id) => {
    const p = state.players[id]
    return p && isImport(p, team) ? n + 1 : n
  }, 0)
}

/**
 * May this club take this player on? Null when it may; the reason when not.
 *
 * With the rule off, always yes. With it on, a native always fits, and an
 * import fits while the club holds fewer than IMPORT_MAX of them.
 */
export function importBlock(state: GameState, teamId: string, p: Player): string | null {
  if (!state.importLimit) return null
  const team = state.teams[teamId]
  if (!team || !isImport(p, team)) return null
  if (importCount(state, teamId) < IMPORT_MAX) return null
  return teamId === state.myTeam
    ? `外援名额已满（${IMPORT_MAX}/${IMPORT_MAX}）——${p.ign} 来自${regionCn(regionIn(originOf(p), 2099))}赛区，签他要先放走一名外援。`
    : `${team.name} 的外援名额已满。`
}

// was a second copy of REGION_CN; a private duplicate is exactly the thing
// that goes stale when the region list grows
const regionCn = (r: Region): string => REGION_CN[r]
