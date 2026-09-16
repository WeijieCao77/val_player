import { migrateWorld, packState, unpackState } from '../save'
import { resumeCup } from './cups'
import type { GameState } from '../types'
import { buildSaveMeta, readSaveMeta, writeSaveMeta } from './saveMeta'
import { migrateRuler } from './rulerMigrate'
import { migrateStaff } from './staffMigrate'
import type { SaveMeta } from './saveMeta'
import { migrateToCny } from './cnyMigrate'
import { BOARD_RISE_MAX, riseOf, standingOf } from './rank'
import { normalizePitch } from './pitchbook'
import { track } from './telemetry'

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
 *
 * How it is stored (2026-09-14: a 2021 career 「卡在」 Masters Bangkok, every
 * refresh went back there). The packed state is JSON with Chinese in it, 2.4 to
 * 5 million characters once a 2021 career is a season in. Safari, and every
 * browser on an iPhone or iPad, keeps 5 MB of localStorage for the whole site
 * and counts such a string at two bytes a character (WebKit StorageMap::setItem,
 * String::sizeInBytes), so past about 2.5 million characters the write threw,
 * the game went on in memory without a word, and a refresh went back to the
 * last save that had fit.
 *
 * So the browser gzips the JSON (CompressionStream) and the save is written as
 * base64 behind `vpz1:`, under the same key: all ASCII, one byte a character in
 * WebKit, about 22% of the JSON's length. Measured headless
 * (scripts/check_save_size.ts): a 2021 career peaks at 4.98M characters raw
 * (10 MB the WebKit way) in mid-2028 and 1.08 MB stored; Bangkok 2025 is 2.86M
 * raw, 0.65 MB stored. A save written raw (before this, by a browser without
 * CompressionStream, or the old manager-namespace copy) still reads, and the
 * next save writes it the new way.
 *
 * Gzip is asynchronous, so a commit takes the career as JSON at once and the
 * write happens after it (autosave). A write that does not go in is said on
 * screen until one does (ui/me/SaveNotice.tsx).
 */

const AUTOSAVE = 'val_player:save:autosave'
const OWNER = `${AUTOSAVE}:owner`
/** where a career used to be kept, in the manager game's namespace; left in place as a backup */
const OLD_AUTOSAVE = 'valmanager:player:save:autosave'
const OLD_OWNER = `${OLD_AUTOSAVE}:owner`
/** the keys, for scripts/check_save_size.ts */
export const SAVE_KEYS = { autosave: AUTOSAVE, owner: OWNER, oldAutosave: OLD_AUTOSAVE, oldOwner: OLD_OWNER } as const

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
  // a career kept in dollars before the four currencies: once, into RMB and its contracts' own currencies (me/cnyMigrate.ts)
  migrateToCny(state)
  const s = state as unknown as Record<string, unknown>
  for (const k of DESK_FIELDS) delete s[k]
  for (const p of Object.values(state.players)) {
    const q = p as unknown as Record<string, unknown>
    for (const k of DESK_PLAYER_FIELDS) delete q[k]
  }
  if (state.me && state.me.phase !== 'pro') state.myTeam = ''
  // 「今年不再来」 keeps its year now (me/prepro.ts declinedNow): a save from before kept the clubs alone, and those have lapsed
  if (state.me) state.me.declined = (state.me.declined ?? []).filter((d) => typeof d === 'object' && d !== null && typeof d.year === 'number')
  // The ladder is still the one score; its division, RR and board place are worked out on the day
  // (me/rank.ts), so a save from before reads the new ladder as it stands — a 「辐能战魂」 outside the
  // top 500 is 神话 3 with its place. All it needs is a score that is a score.
  const pre = state.me?.pre
  if (pre) {
    pre.ladder = Math.min(100, Math.max(0, Number.isFinite(pre.ladder) ? pre.ladder : 0))
    // the board's climb past a man who stopped playing (me/rank.ts boardWeek): a save from before it has none —
    // its score stays exactly as it was, and the place slides only from here on
    pre.rise = Math.min(BOARD_RISE_MAX, riseOf(pre))
    // the best is a place held (me/prepro.ts notePeak): never under where I stand today, and never lifted to RR that a
    // board which climbed past me reads further down — in a save from before, where I stand is the score, as it was
    pre.ladderPeak = Math.max(standingOf(state), Math.min(100, Number.isFinite(pre.ladderPeak) ? pre.ladderPeak : 0))
  }
  // 自荐's book (me/pitchbook.ts): a save from before has none and reads as a blank one; a book missing a list gets an empty one
  normalizePitch(state)
  // a coach the roster book once had as a player leaves the player pool, once per change of the data (me/staffMigrate.ts)
  if (state.me) migrateStaff(state)
  // a career from before the rating ruler is read onto it once, the player by his rank (me/rulerMigrate.ts)
  if (state.me) migrateRuler(state)
  // a cup run from before its rounds had days: today's round, then a round a week (me/cups.ts resumeCup)
  if (state.me) resumeCup(state)
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

const writeOwner = (year: number, day: number): void => {
  try {
    localStorage.setItem(OWNER, JSON.stringify({ by: SESSION, year, day } satisfies Owner))
  } catch { /* the save itself matters more than the marker */ }
}

const progress = (year: number, day: number) => year * 400 + day

/** Another tab has written a career further along than this one at this point. */
const behind = (year: number, day: number): boolean => {
  const o = readOwner()
  return !!o && o.by !== SESSION && progress(o.year, o.day) > progress(year, day)
}

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

/** A stored save that is gzip + base64 starts with this; a raw one is JSON and starts with `{`. */
export const PACKED = 'vpz1:'
/** bytes turned into characters at a time: well under any engine's limit on a call's arguments */
const CHUNK = 0x2000

/** Can this browser gzip by itself? iOS Safari before 16.4 cannot: its saves are written raw, as before. */
export function canPack(): boolean {
  return typeof CompressionStream === 'function' && typeof Blob === 'function' && typeof Response === 'function' && typeof btoa === 'function'
}

/** The packed JSON as it goes into localStorage: `vpz1:` and the gzip as base64, every character ASCII. */
export async function packStored(json: string): Promise<string> {
  const zipped = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
  let bin = ''
  for (let i = 0; i < zipped.length; i += CHUNK) bin += String.fromCharCode(...zipped.subarray(i, i + CHUNK))
  return PACKED + btoa(bin)
}

/** ...and back to the packed JSON, whichever way it was written. */
export async function readStored(raw: string): Promise<string> {
  if (!raw.startsWith(PACKED)) return raw
  const bin = atob(raw.slice(PACKED.length))
  const zipped = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) zipped[i] = bin.charCodeAt(i)
  return new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
}

/** The career to continue, read and brought forward; null when there is none, or it cannot be read. */
export async function loadAutosave(): Promise<GameState | null> {
  // a write still on its way lands first, so what is read is the last career taken
  await flushAutosave()
  adoptOldSave()
  let raw: string | null = null
  try {
    raw = localStorage.getItem(AUTOSAVE) ?? localStorage.getItem(OLD_AUTOSAVE)
  } catch { return null }
  if (!raw) return null
  try {
    return migratePlayerSave(unpackState(await readStored(raw)))
  } catch {
    return null
  }
}

/** Say that this tab's career is the one that counts — called whenever a career is opened or started. */
export function claimAutosave(state: GameState): void {
  writeOwner(state.year, state.day)
}

/**
 * The latest progress is not in this browser: a write failed, and none has
 * landed since. Said on screen until one does (ui/me/SaveNotice.tsx).
 */
export interface SaveTrouble {
  /** where the career stood at the write that failed */
  year: number
  day: number
  /** the date of the last save of this tab's that did land ('2025年2月26日'), what a refresh goes back to; '' when none has */
  kept: string
}

let trouble: SaveTrouble | null = null
const heard = new Set<() => void>()
export const saveTrouble = (): SaveTrouble | null => trouble
export function onSaveTrouble(f: () => void): () => void {
  heard.add(f)
  return () => { heard.delete(f) }
}
function setTrouble(t: SaveTrouble | null): void {
  if (!t && !trouble) return
  trouble = t
  heard.forEach((f) => f())
}

/**
 * A save that did not go in, reported once per stretch of trouble rather than
 * once per failed write — a browser with no room left fails on every commit.
 *
 * This is how a quota problem gets noticed at all instead of waiting for
 * somebody to report it, the way the iPhone one had to be (2026-09-14: a 2021
 * career 「卡在」 Masters Bangkok). What goes out is the size in KB and which
 * half failed; never the save, which is the career itself.
 */
function noteSaveFail(what: 'pack' | 'write', year: number, day: number, kb: number): void {
  if (trouble) return
  track('save_fail', { what, kb, packed: canPack(), year, day })
}

/**
 * 'saved' went in; 'behind' was refused because another tab's career is
 * further along; 'failed' did not go in; 'stale' was dropped because a newer
 * snapshot is already on disk.
 */
export type AutosaveResult = 'saved' | 'behind' | 'failed' | 'stale'

/** A career as it stood at one commit: its JSON, where it was, and the home page's card for it. */
interface Snapshot { seq: number; json: string; year: number; day: number; meta: SaveMeta | null }

let taken = 0
/** the newest snapshot on disk */
let landed = 0
let keptDate = ''
/** the one being packed and written */
let writing: Snapshot | null = null
/** the newest taken while another was being written; an older one waiting is simply replaced */
let waiting: Snapshot | null = null
let queue: Promise<void> | null = null

/**
 * Save the career. The JSON is taken now, synchronously, so nothing the game
 * does after this call can leak into this write; the gzip and the write happen
 * after it. Writes land in order. While one is being written only the newest
 * waiting snapshot is kept. flushAutosave waits for them all.
 */
export function autosave(state: GameState): void {
  let snap: Snapshot
  try {
    snap = { seq: ++taken, json: packState(state), year: state.year, day: state.day, meta: buildSaveMeta(state) }
  } catch {
    noteSaveFail('pack', state.year, state.day, 0)
    setTrouble({ year: state.year, day: state.day, kept: keptDate })
    return
  }
  waiting = snap
  queue ??= drain()
}

async function drain(): Promise<void> {
  try {
    while (waiting) {
      const snap = waiting
      waiting = null
      writing = snap
      await writeSnapshot(snap)
      writing = null
    }
  } finally {
    writing = null
    queue = null
  }
}

async function writeSnapshot(snap: Snapshot): Promise<AutosaveResult> {
  try {
    if (behind(snap.year, snap.day)) return settle(snap, 'behind')
    let stored = snap.json
    if (canPack()) {
      try { stored = await packStored(snap.json) } catch { /* the gzip failed: written raw, as before */ }
    }
    // the page went out of sight while this was packed and a newer one was written at once (flushAutosaveNow)
    if (snap.seq < landed) return 'stale'
    // ...or another tab wrote a career further along meanwhile
    if (behind(snap.year, snap.day)) return settle(snap, 'behind')
    return settle(snap, put(stored) ? 'saved' : 'failed')
  } catch {
    return settle(snap, 'failed')
  }
}

function settle(snap: Snapshot, result: AutosaveResult): AutosaveResult {
  if (result === 'saved') {
    landed = Math.max(landed, snap.seq)
    writeOwner(snap.year, snap.day)
    // the home page's card, so it never has to read the save to say whose career this is — only once the save is really there
    writeSaveMeta(snap.meta)
    keptDate = snap.meta?.date ?? keptDate
    setTrouble(null)
  } else if (result === 'behind') {
    // the guard doing its job, not a save that failed: what is on disk is further along, and 再试一次 could not change that
    setTrouble(null)
  } else if (result === 'failed' && snap.seq > landed) {
    noteSaveFail('write', snap.year, snap.day, Math.round(snap.json.length / 1024))
    setTrouble({ year: snap.year, day: snap.day, kept: keptDate })
  }
  return result
}

/**
 * Into localStorage. A write that does not fit gets one more try, with the
 * room the old manager-namespace copy of a career (adoptOldSave) was holding:
 * it counts against the same site quota, and a 2021 career's copy can be most
 * of Safari's 5 MB by itself.
 *
 * When the career is already adopted under the new key, that copy is only the
 * backup adoptOldSave left behind, so it is removed for good. When it is not
 * (Safari could not fit the copy beside the original, so the career has been
 * read from the old key all along), the old key is the only save on disk: it is
 * removed for the retry and put back if the retry fails too, so a failed write
 * never leaves the browser with no save at all.
 */
function put(stored: string): boolean {
  try {
    localStorage.setItem(AUTOSAVE, stored)
    return true
  } catch { /* full, or blocked */ }
  let old: string | null
  let oldOwner: string | null
  let adopted: boolean
  try {
    old = localStorage.getItem(OLD_AUTOSAVE)
    if (old === null) return false
    oldOwner = localStorage.getItem(OLD_OWNER)
    adopted = localStorage.getItem(AUTOSAVE) !== null
    localStorage.removeItem(OLD_AUTOSAVE)
    localStorage.removeItem(OLD_OWNER)
  } catch { return false }
  try {
    localStorage.setItem(AUTOSAVE, stored)
    return true
  } catch { /* no room even so */ }
  if (!adopted) {
    try {
      localStorage.setItem(OLD_AUTOSAVE, old)
      if (oldOwner !== null) localStorage.setItem(OLD_OWNER, oldOwner)
    } catch { /* the room was just freed: this does not happen short of another tab filling it meanwhile */ }
  }
  return false
}

/**
 * Wait until every snapshot taken so far has been written or has failed to be:
 * before a reload (ui/me/UpdateNudge.tsx), before the career closes for the home
 * page, before a save is read. true when the latest progress is on disk (or a
 * further-along career from another tab is).
 */
export async function flushAutosave(): Promise<boolean> {
  while (queue) await queue
  return !trouble
}

/**
 * The page is going out of sight or away (pagehide, visibilitychange), and it
 * may be frozen or gone before a gzip finishes. Best effort, synchronously: the
 * newest snapshot not yet on disk is written raw. Where the browser takes that
 * (a desktop browser, or a save still small), the latest progress is in; where
 * it does not (Safari past 5 MB), nothing on disk is touched. Either way the
 * packed write carries on if the page lives, and an older snapshot still being
 * packed is dropped rather than landing over the newer one.
 */
export function flushAutosaveNow(): void {
  const snap = waiting ?? writing
  if (!snap || snap.seq <= landed || behind(snap.year, snap.day)) return
  try {
    localStorage.setItem(AUTOSAVE, snap.json)
  } catch { return }
  settle(snap, 'saved')
}
