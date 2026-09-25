import { migrateWorld, packState, unpackState } from '../save'
import { resumeCup } from './cups'
import { refundStalePlan } from './week'
import type { GameState } from '../types'
import { buildSaveMeta, writeSaveMeta } from './saveMeta'
import { adoptOldSave } from './saveInfo'
import { OWNER, readSaveText, writeSaveTextGuarded, writeSaveTextNowGuarded } from './saveStore'
import { migrateRuler } from './rulerMigrate'
import { migrateRegionalRuler } from './regionalRulerMigrate'
import { migrateRemoved, migrateStaff } from './staffMigrate'
import { settleDetail } from './detail'
import type { SaveMeta } from './saveMeta'
import { migrateToCny } from './cnyMigrate'
import { BOARD_RISE_MAX, riseOf, standingOf } from './rank'
import { normalizePitch } from './pitchbook'
import { track } from './telemetry'
import { PACKED, canPack, packStored, readStored } from './saveCodec'
import { exportBackupFromStored } from './backup'
import type { ExportResult } from './backup'
import { repairPlayerCountries, repairPlayerTeamNames } from './playerDataRepair'
import { repairPlayerBios } from './playerBioRepair'
import { normalizeCareerEvents } from './eventMigrate'
import { rememberFMVPs } from './fmvp'
import { avatarData } from './avatar'
import { pruneClubDepartures } from './clubDepartures'
import { ensureGrowthWeek } from './growthWeek'
import { normalizePositionTraining } from './secondaryRole'

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
 *
 * One save, and only the page that last opened a career into it writes it
 * (claimAutosave, holds): see "Which page holds the save" below.
 */

/*
 * The keys, the copy across from the old ones, and the home page's card for the
 * save (hasAutosave, autosaveInfo): me/saveInfo.ts, which the home page reads
 * without fetching the world this module reaches. Said here as well.
 */
export { SAVE_KEYS, autosaveInfo, hasAutosave } from './saveInfo'
export type { AutosaveInfo } from './saveInfo'

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
  normalizeCareerEvents(state)
  migrateWorld(state)
  rememberFMVPs(state)
  if (state.me) {
    const avatar = avatarData(state.me.avatar)
    if (avatar) state.me.avatar = avatar
    else delete state.me.avatar
    pruneClubDepartures(state)
    repairPlayerCountries(state)
    repairPlayerBios(state)
    repairPlayerTeamNames(state)
  }
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
  // a man the author took out of the game leaves the pool and the save's records, once per change of the list (me/staffMigrate.ts)
  if (state.me) migrateRemoved(state)
  // a career from before the rating ruler is read onto it once, the player by his rank (me/rulerMigrate.ts)
  if (state.me) migrateRuler(state)
  if (state.me) migrateRegionalRuler(state)
  // a cup run from before its rounds had days: today's round, then a round a week (me/cups.ts resumeCup)
  if (state.me) resumeCup(state)
  // a week planned under the old board, where the hours settled on the seventh day: nothing of it is run,
  // the points go back, and the week board says so once (me/week.ts refundStalePlan, 2026-09-19)
  if (state.me) refundStalePlan(state)
  // 生涯明细只保留最近一年的 (me/detail.ts): a save from before the window carried up to 120
  // records, however far back they went. What has to outlive a year is read off them once —
  // which is all that save could see anyway — and then the older detail is let go.
  if (state.me) settleDetail(state.me, state.year, state.day)
  // An old save cannot prove its whole-week baseline; start observing here without inventing gains.
  ensureGrowthWeek(state)
  normalizePositionTraining(state)
  return state
}

/**
 * Which page holds the save. There is one save and a career can be open in
 * several tabs of one browser, so exactly one of them may write it: the one
 * that last opened a career into it (开始生涯, 继续, 载入最新存档).
 *
 * Reported 2026-09-18 (an outside audit of 6d128ed, finding 01): the guard
 * used to be the manager game's, which refused a save only when another tab's
 * career was further along by date. It could not tell two careers apart, nor
 * two moves on one day. A tab left open on a 2027 career, after another tab
 * had started a new career in 2026 over it, counted as further along, and its
 * next press put the old career back — the new one, confirmed on 开新生涯 and
 * saved, was gone, with nothing on screen. Two tabs on one save playing the
 * same day took turns overwriting each other the same way.
 *
 * So the small record beside the save says which career is in it (`career`,
 * the career's own id, me.saveId), which page holds it (`by`), and how many
 * times the save has been taken or written (`rev`, only ever counting up).
 * Opening a career writes the record in this page's name; every write first
 * checks that the record is still exactly what this page last wrote, the
 * moment before it goes in — after the gzip, which takes a while. A page that
 * finds the record changed has lost the save to another: it writes nothing
 * from then on and says so (ui/me/SaveNotice.tsx SaveTakenNotice), with
 * 「载入最新存档」 to open what the other page saved. The other pages hear of it
 * at once through the browser's storage event (PlayerGame), not only at their
 * next write.
 *
 * A page on a build from before this still writes the old record, with no
 * career and no count: to a page on this build that is a page that took the
 * save, and it stops. The old page cannot be made to stop by this one; the
 * update bar (ui/me/UpdateNudge.tsx) is what brings it onto this build.
 */
const SESSION = Math.random().toString(36).slice(2, 10)

interface Owner {
  by: string
  year: number
  day: number
  /** the career in the save (me.saveId); none on a record from before 2026-09-18 */
  career?: string
  /** how many times the save has been taken or written; none on a record from before 2026-09-18 */
  rev?: number
}

const readOwner = (): Owner | null => {
  try {
    const raw = localStorage.getItem(OWNER)
    const o = raw ? JSON.parse(raw) as Owner : null
    return o && typeof o === 'object' ? o : null
  } catch { return null }
}

/** the record exactly as stored: what a read compares before and after, to know nothing was written meanwhile */
const ownerMark = (): string => {
  try { return localStorage.getItem(OWNER) ?? '' } catch { return '' }
}

const writeOwner = (o: Owner): boolean => {
  try {
    localStorage.setItem(OWNER, JSON.stringify(o))
    return true
  } catch { return false /* the save itself matters more than the marker */ }
}

const revOf = (o: Owner | null): number => (o && typeof o.rev === 'number' && Number.isFinite(o.rev) ? o.rev : 0)

/** A career's own id: made the first time it is opened into the save, and kept in it. */
function newSaveId(): string {
  try {
    const b = new Uint8Array(8)
    crypto.getRandomValues(b)
    return 'k' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  } catch {
    return 'k' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  }
}

/** The save this page holds: its career, and the count the record had when this page last wrote it. null until a career is opened. */
let held: { career: string; rev: number } | null = null
/** Distinguishes reopening even the same career in this page while I/O is pending. */
let claims = 0
/** Another page has taken the save from this one: nothing is written from here until a career is opened again. */
let lost = false

/**
 * May a save of this career be written now? 'ok'; 'old' when it is not the
 * career this page holds any more (a write of the career before, still on its
 * way after this page opened another); 'taken' when another page holds the save.
 *
 * A page that never opened a career (the checks, which save a state
 * directly) may write an empty slot, or one it wrote itself.
 */
function holds(career: string): 'ok' | 'old' | 'taken' {
  if (lost) return 'taken'
  const o = readOwner()
  if (!held) return !o || o.by === SESSION ? 'ok' : 'taken'
  if (career !== held.career) return 'old'
  // no record at all: the site's storage was cleared under the page, and nobody holds the save
  if (!o) return 'ok'
  return o.by === SESSION && o.career === held.career && revOf(o) === held.rev ? 'ok' : 'taken'
}

/**
 * Does this page still hold the save? Asked when another page writes the
 * record (the storage event, PlayerGame) and when this page comes back into
 * view, so the notice is up at once rather than at the next write.
 */
export function checkSaveHeld(): boolean {
  if (held && !lost && holds(held.career) === 'taken') setLost()
  return !lost
}

/** The browser's storage event: a key another page wrote. Only the holder's record (or storage cleared) can take the save away. */
export function onSaveStorage(key: string | null): void {
  if (key === null || key === OWNER) checkSaveHeld()
}

/** This page no longer writes the save: anything waiting goes, and a save that failed here no longer matters. */
function setLost(): void {
  if (lost) return
  lost = true
  waiting = null
  trouble = null
  heard.forEach((f) => f())
}

/** Another page has taken the save: said on screen until a career is opened here again (ui/me/SaveNotice.tsx). */
export const saveLost = (): boolean => lost

/*
 * The save as text — `vpz1:` and the gzip as base64, or the JSON raw — is written and read by me/saveCodec.ts, which a
 * backup made on the home page reads too (me/backup.ts) without fetching the world this module reaches. Said here as well.
 */
export { PACKED, canPack, packStored, readStored } from './saveCodec'

/**
 * Rescue the career exactly as it exists in memory. This deliberately does
 * not read the autosave: when the latest write failed, the autosave is the old
 * progress the player is trying not to lose.
 */
export async function exportCurrentBackup(state: GameState, now: Date = new Date()): Promise<ExportResult> {
  let json: string
  try { json = packState(state) } catch { return { ok: false, why: 'unreadable' } }
  return exportBackupFromStored(json, now)
}

/**
 * The career to continue, read and brought forward; null when there is none, or it cannot be read.
 *
 * Reading a packed save takes a moment (the gunzip). Another page that still
 * holds the save can write it meanwhile; then what was read is already old,
 * and opening it would take the save from that page one move behind it. So
 * the record beside the save is compared before and after, and the save is
 * read again when it moved.
 */
export async function loadAutosave(): Promise<GameState | null> {
  // a write still on its way lands first, so what is read is the last career taken
  await flushAutosave()
  adoptOldSave()
  for (let tries = 0; ; tries++) {
    let raw: string | null = null
    let mark: string
    try {
      mark = ownerMark()
      raw = await readSaveText()
    } catch { return null }
    if (!raw) return null
    let state: GameState
    try {
      state = migratePlayerSave(unpackState(await readStored(raw)))
    } catch {
      return null
    }
    if (ownerMark() === mark || tries >= 3) return state
  }
}

/**
 * This page's career is the one in the save from now on — called whenever a
 * career is opened here: a new one (开始生涯), or the save read back (继续,
 * 载入最新存档). A career gets its own id the first time (a save from before
 * the id gets one here, and carries it from its next write); the record is
 * written in this page's name with the count one on, which is what tells any
 * other page holding the save that it no longer does.
 */
export function claimAutosave(state: GameState): void {
  claims++
  const career = state.me ? (state.me.saveId ||= newSaveId()) : newSaveId()
  const rev = revOf(readOwner()) + 1
  held = { career, rev }
  if (!writeOwner({ by: SESSION, year: state.year, day: state.day, career, rev })) {
    // not even this small record goes in (storage full): an empty record is one no page is kept from writing,
    // rather than one still naming the page the save was just taken from
    try { localStorage.removeItem(OWNER) } catch { /* storage blocked: no save goes in either */ }
  }
  if (lost) {
    lost = false
    heard.forEach((f) => f())
  }
}

/**
 * A backup brought in on the home page (导入存档, me/backup.ts) becomes the
 * save: its stored text exactly as it was exported, so the career read back is
 * the one that was exported, byte for byte. The home page then opens it the way
 * 继续 does (me/opening.ts openSavedCareer).
 *
 * The save is taken in this page's name first (claimAutosave, with the career
 * the backup holds), and only then written: a page that still holds the career
 * this overwrites hears the record move and stops (the storage event,
 * PlayerGame), and a write of its that was still being gzipped does not land
 * over the imported one (writeSnapshot checks the record again right before it
 * writes). Nothing waits between the two: a raw save is gzipped before the claim.
 *
 * false when it does not fit in this browser: then the save on disk is untouched,
 * and the record goes back to what it was unless another page has written it since.
 */
export async function installSave(stored: string, state: GameState): Promise<boolean> {
  // this page's own write still on its way (a career closed for the home page) lands before the save changes hands
  await flushAutosave()
  let text = stored
  if (!stored.startsWith(PACKED) && canPack()) {
    try { text = await packStored(stored) } catch { /* the gzip failed: written raw, as a save can be */ }
  }
  const before = ownerMark()
  const had = held
  const wasLost = lost
  claimAutosave(state)
  const claim = claims
  const mine = ownerMark()
  const career = held!.career
  const result = await writeSaveTextGuarded(text, () => claims === claim && holds(career) === 'ok')
  if (result === 'saved' && claims === claim && holds(career) === 'ok') {
    // the home page's card for it, so it says whose career this is at once
    writeSaveMeta(buildSaveMeta(state))
    return true
  }
  if (result === 'taken' || claims !== claim || holds(career) !== 'ok') {
    checkSaveHeld()
    return false
  }
  if (ownerMark() === mine) {
    try {
      if (before) localStorage.setItem(OWNER, before)
      else localStorage.removeItem(OWNER)
    } catch { /* storage blocked: nothing went in either */ }
  }
  held = had
  lost = wasLost
  return false
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
/** told when the trouble changes, and when another page takes the save (saveLost) */
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
 * 'saved' went in; 'taken' was refused because another page holds the save;
 * 'failed' did not go in; 'stale' was dropped because a newer snapshot is
 * already on disk, or it is of a career this page has since closed.
 */
export type AutosaveResult = 'saved' | 'taken' | 'failed' | 'stale'

/** A career as it stood at one commit: which career, its JSON, where it was, and the home page's card for it. */
interface Snapshot { seq: number; claim: number; career: string; json: string; year: number; day: number; meta: SaveMeta | null }

const holdsSnapshot = (snap: Snapshot): 'ok' | 'old' | 'taken' => snap.claim === claims ? holds(snap.career) : 'old'

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
 *
 * Nothing at all once another page has taken the save: this page's career goes
 * on in memory, and the notice says so.
 */
export function autosave(state: GameState): void {
  if (lost) return
  let snap: Snapshot
  try {
    snap = { seq: ++taken, claim: claims, career: state.me?.saveId ?? '', json: packState(state), year: state.year, day: state.day, meta: buildSaveMeta(state) }
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
    const before = holdsSnapshot(snap)
    if (before !== 'ok') return settle(snap, before === 'old' ? 'stale' : 'taken')
    let stored = snap.json
    if (canPack()) {
      try { stored = await packStored(snap.json) } catch { /* the gzip failed: written raw, as before */ }
    }
    // the page went out of sight while this was packed and a newer one was written at once (flushAutosaveNow)
    if (snap.seq < landed) return 'stale'
    // ...or the save changed hands while this was packed: another page opened a career into it or wrote it, and a
    // snapshot taken before that must not land after it. The store checks again
    // once its readwrite transaction actually acquires the IndexedDB store.
    const now = holdsSnapshot(snap)
    if (now !== 'ok') return settle(snap, now === 'old' ? 'stale' : 'taken')
    const result = await writeSaveTextGuarded(stored, () => snap.seq >= landed && holdsSnapshot(snap) === 'ok')
    if (snap.seq < landed) return 'stale'
    const after = holdsSnapshot(snap)
    return settle(snap, after !== 'ok' ? (after === 'old' ? 'stale' : 'taken') : result)
  } catch {
    return settle(snap, 'failed')
  }
}

function settle(snap: Snapshot, result: AutosaveResult): AutosaveResult {
  if (result === 'saved') {
    landed = Math.max(landed, snap.seq)
    // the record, one on: any other page that reads it now knows the save moved
    const rev = (held ? held.rev : revOf(readOwner())) + 1
    if (writeOwner({ by: SESSION, year: snap.year, day: snap.day, career: held?.career ?? snap.career, rev }) && held) held.rev = rev
    // the home page's card, so it never has to read the save to say whose career this is — only once the save is really there
    writeSaveMeta(snap.meta)
    keptDate = snap.meta?.date ?? keptDate
    setTrouble(null)
  } else if (result === 'taken') {
    // not a save that failed: another page holds the save, and 再试一次 could not change that. Said once, and this page stops.
    setTrouble(null)
    if (held) setLost()
  } else if (result === 'failed' && snap.seq > landed) {
    noteSaveFail('write', snap.year, snap.day, Math.round(snap.json.length / 1024))
    setTrouble({ year: snap.year, day: snap.day, kept: keptDate })
  }
  return result
}

/**
 * Wait until every snapshot taken so far has been written or has failed to be:
 * before a reload (ui/me/UpdateNudge.tsx), before the career closes for the home
 * page, before a save is read. true when the latest progress is on disk, or
 * when another page holds the save and this one no longer writes it.
 */
export async function flushAutosave(): Promise<boolean> {
  while (queue) await queue
  return !trouble
}

/**
 * The page is going out of sight or away (pagehide, visibilitychange), and it
 * may be frozen or gone before a gzip finishes. Best effort: hand the newest
 * snapshot to the already-open store without waiting for compression. IDB must
 * still acquire its transaction lock and commit before this counts as saved.
 * The packed write carries on if the page lives; an older snapshot cannot
 * land over a newer snapshot that already committed.
 */
export function flushAutosaveNow(): void {
  const snap = waiting ?? writing
  if (!snap || snap.seq <= landed) return
  // only while this page still holds the save (holds): a page going out of sight writes nothing over another's
  const may = holdsSnapshot(snap)
  if (may !== 'ok') { if (may === 'taken') settle(snap, 'taken'); return }
  writeSaveTextNowGuarded(snap.json, () => snap.seq >= landed && holdsSnapshot(snap) === 'ok', (result) => {
    if (snap.seq < landed) return
    const after = holdsSnapshot(snap)
    settle(snap, after !== 'ok' ? (after === 'old' ? 'stale' : 'taken') : result)
  })
}
