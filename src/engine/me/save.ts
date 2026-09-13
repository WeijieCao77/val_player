import { migrateWorld, packState, unpackState } from '../save'
import { stripToTheBone } from '../match'
import type { GameState } from '../types'
import { readSaveMeta, writeSaveMeta } from './saveMeta'
import type { SaveMeta } from './saveMeta'

/**
 * Where a player's career is kept: under the player game's own keys.
 *
 * A career used to be written by the manager game's save code, under its
 * namespace — `valmanager:player:save:autosave` — and carried the manager's
 * fields the shared engine wrote into it. It is its own game now
 * (「我们这个是完全单独的游戏」, 2026-09-11), so its save is too: the same packed
 * format (engine/save.ts packState, which is the world's), its own keys, and
 * none of the manager's desk.
 *
 * The first time this runs in a browser that has a career under the old key,
 * the career is copied across once, and the old copy is left where it is as a
 * backup.
 */

const AUTOSAVE = 'val_player:save:autosave'
const OWNER = `${AUTOSAVE}:owner`
/** where a career used to be kept, in the manager game's namespace; left in place as a backup */
const OLD_AUTOSAVE = 'valmanager:player:save:autosave'
const OLD_OWNER = `${OLD_AUTOSAVE}:owner`

/** Once: a career saved before the player game had its own keys is copied across. The old copy stays. */
function adoptOldSave(): void {
  try {
    if (localStorage.getItem(AUTOSAVE) !== null) return
    const old = localStorage.getItem(OLD_AUTOSAVE)
    if (old === null) return
    localStorage.setItem(AUTOSAVE, old)
    const owner = localStorage.getItem(OLD_OWNER)
    if (owner !== null) localStorage.setItem(OWNER, owner)
  } catch { /* storage blocked or full: loading still falls back to the old key */ }
}

/** The manager game's fields a career's save carried, written by the shared engine before the split. */
const DESK_FIELDS = [
  'managerName', 'manager', 'finances', 'honours', 'boardConfidence', 'onNotice', 'missedStreak', 'objective',
  'managerContract', 'tenures', 'tally', 'gigs', 'ventures', 'pitchCooldown', 'sponsorTalks', 'commercialDays',
  'activity', 'leagueDeal', 'leagueOffer', 'seasonGigs', 'bestPlacing', 'startingSquad', 'startTier',
  'startFacilities', 'offers', 'enquiries', 'jobOffers', 'jobApplications', 'staff', 'staffOffers',
  'staffApproaches', 'midReview', 'midReviewDone', 'actions', 'drill', 'duo', 'drillLock', 'physioOn',
  'tutorialDay', 'drillVoid',
] as const

/** And on each player: the manager's listings, his raise and rumour clocks, his talks, trust in him, a streaming deal he signed. */
const DESK_PLAYER_FIELDS = ['listed', 'listedOn', 'payAskedOn', 'rumourOn', 'persuaded', 'loyaltyHitYear', 'stream', 'trust'] as const

/**
 * A career's save as the player game keeps it, whatever wrote it.
 *
 * The world is brought forward as every save's is (engine/save.ts
 * migrateWorld). The manager game's fields go — a club's one budget stays, it
 * is the world's. The five-year settlement a save could still have been
 * holding goes with them: it was the manager's question, and the career used
 * to answer it by itself every day (「继续干下去」) before this. And a player
 * without a club keeps no club (engine/me/career.ts): a save from before, on
 * the ladder or between clubs, forgets the club it was "watching".
 */
export function migratePlayerSave(state: GameState): GameState {
  migrateWorld(state)
  const s = state as unknown as Record<string, unknown>
  for (const k of DESK_FIELDS) delete s[k]
  for (const p of Object.values(state.players)) {
    const q = p as unknown as Record<string, unknown>
    for (const k of DESK_PLAYER_FIELDS) delete q[k]
  }
  if (state.me && state.me.phase !== 'pro') state.myTeam = ''
  // 「今年不再来」 keeps its year now (me/prepro.ts declinedNow): a save from before kept the clubs alone, and those have lapsed
  if (state.me) state.me.declined = (state.me.declined ?? []).filter((d) => typeof d === 'object' && d !== null && typeof d.year === 'number')
  return state
}

/**
 * Which tab wrote the autosave last, and how far along it was — the manager
 * game's guard, the same rule: an autosave is refused only when ANOTHER tab has
 * written a career that is further along than the one being saved.
 */
const SESSION = Math.random().toString(36).slice(2, 10)

interface Owner { by: string; year: number; day: number }

const readOwner = (): Owner | null => {
  try {
    const raw = localStorage.getItem(OWNER)
    return raw ? (JSON.parse(raw) as Owner) : null
  } catch { return null }
}

const writeOwner = (state: GameState): void => {
  try {
    localStorage.setItem(OWNER, JSON.stringify({ by: SESSION, year: state.year, day: state.day } satisfies Owner))
  } catch { /* the save itself matters more than the marker */ }
}

const progress = (year: number, day: number) => year * 400 + day

/** Is there a career to continue? */
export function hasAutosave(): boolean {
  adoptOldSave()
  try {
    return localStorage.getItem(AUTOSAVE) !== null || localStorage.getItem(OLD_AUTOSAVE) !== null
  } catch { return false }
}

export interface AutosaveInfo {
  /** the summary written beside the save (me/saveMeta.ts); null for a save from before it, or one that does not match the save */
  meta: SaveMeta | null
  /** how far along the save is, off its small owner record: what a save with no summary can still say without being read */
  year: number | null
  day: number | null
}

/**
 * The career to continue, as the home page draws it — without reading the
 * career. A summary is trusted only when it is for the same day as the save
 * beside it: a tab on an older build that saved over the career wrote no
 * summary, and the one left from before says nothing about what is there now.
 */
export function autosaveInfo(): AutosaveInfo | null {
  if (!hasAutosave()) return null
  const owner = readOwner()
  const meta = readSaveMeta()
  const ok = !!meta && (!owner || (meta.year === owner.year && meta.day === owner.day))
  return { meta: ok ? meta : null, year: owner?.year ?? null, day: owner?.day ?? null }
}

/** The career to continue, read and brought forward; null when there is none, or it cannot be read. */
export function loadAutosave(): GameState | null {
  adoptOldSave()
  let raw: string | null = null
  try {
    raw = localStorage.getItem(AUTOSAVE) ?? localStorage.getItem(OLD_AUTOSAVE)
  } catch { return null }
  if (!raw) return null
  try {
    return migratePlayerSave(unpackState(raw))
  } catch {
    return null
  }
}

/** Say that this tab's career is the one that counts — called whenever a career is opened or started. */
export function claimAutosave(state: GameState): void {
  writeOwner(state)
}

export type AutosaveResult = 'saved' | 'behind' | 'shrunk'

/**
 * Write the career, and if the browser will not take it, make it smaller and
 * write it again: old match paperwork goes (engine/match.ts stripToTheBone),
 * everything the career asks questions of stays. If the second write fails too
 * the caller gets the exception.
 */
export function autosave(state: GameState): AutosaveResult {
  const owner = readOwner()
  if (owner && owner.by !== SESSION && progress(owner.year, owner.day) > progress(state.year, state.day)) {
    return 'behind'
  }
  try {
    localStorage.setItem(AUTOSAVE, packState(state))
  } catch {
    // in place, deliberately: the point is that the NEXT save is small too
    stripToTheBone(state)
    localStorage.setItem(AUTOSAVE, packState(state))
    writeOwner(state)
    writeSaveMeta(state)
    return 'shrunk'
  }
  writeOwner(state)
  // the home page's card, so it never has to read 2 MB to say whose career this is
  writeSaveMeta(state)
  return 'saved'
}
