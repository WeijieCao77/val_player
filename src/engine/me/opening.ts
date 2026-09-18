import type { GameState } from '../types'
import { resumeTimeline } from '../season'
import { SAVE_VERSION, unpackState } from '../save'
import { installSave, loadAutosave, migratePlayerSave } from './save'
import { readStored } from './saveCodec'
import { buildSaveMeta } from './saveMeta'
import type { SaveMeta } from './saveMeta'
import { ensureCeilings } from './bottleneck'
import { mergeHallFrom, noteHall } from './hall'
import type { Backup, BackupWhy } from './backup'
import { track } from './telemetry'

/**
 * Opening a career from the home page: the save read back (继续), and what a
 * save from before the summary leaves in the hall (开新生涯). The home page
 * (src/App.tsx) reaches these only through src/game.ts, fetched when a career is
 * opened — with the world this module reads (reported 2026-09-18, an outside
 * audit: the home page downloaded about 8 MB before any career was opened).
 */

/**
 * How far into a career the clock has got, as numbers and enumerated words —
 * what a turn and a resume report (engine/me/telemetry.ts). The tier is the
 * rung, never the club: 1 是 VCT，2 是 Challengers，0 是还没有俱乐部。
 */
export const turnShape = (g: GameState) => ({
  day: g.day,
  year: g.year,
  phase: g.me?.phase ?? 'pre',
  tier: g.me?.phase === 'pro' ? g.teams[g.myTeam]?.tier ?? 0 : 0,
})

/** The save, read and brought forward to play on; null when there is none, or it cannot be read. */
export async function openSavedCareer(): Promise<GameState | null> {
  const g = await loadAutosave()
  if (!g?.me) return null
  // a save that stopped at the edge of the timeline carries on from the same day once this build can play the year
  // a save from before the eight ceilings gets them now, not at the end of its first week
  resumeTimeline(g)
  ensureCeilings(g)
  // a career came back, and how far in it already is — the other half of
  // 「有没有人第二天又回来了」
  track('career_resume', {
    ...turnShape(g),
    pro_seasons: g.me!.seasons.filter((s) => s.tier > 0).length,
    age: g.players[g.me!.id]?.age ?? 0,
  })
  return g
}

/**
 * A save from before the home page's summary may never have been opened by a
 * build with the hall: what it unlocked goes in before a new career overwrites
 * it (破晓 seeds its hall from the save on its cover, save.ts hallSeedFrom).
 */
export async function seedHallFromSave(): Promise<void> {
  try {
    const g = await loadAutosave()
    if (g?.me) noteHall(g, true)
  } catch { /* unreadable: nothing to note */ }
}

/**
 * 导入存档, first half: the backup's save decoded and brought forward exactly
 * as 继续 brings the save forward (me/save.ts migratePlayerSave — a save from
 * before the career id, the four currencies, the rating ruler… reads as one
 * from now), and its card drawn the way 上次的存档 is (me/saveMeta.ts). Nothing
 * is written: the home page shows the card and asks before anything is overwritten.
 */
export async function readBackupCareer(b: Backup): Promise<{ ok: true; game: GameState; meta: SaveMeta } | { ok: false; why: BackupWhy }> {
  let state: GameState
  try {
    state = unpackState(await readStored(b.save))
  } catch {
    // the gzip's own check, or JSON cut off: what came in is not all of what went out
    return { ok: false, why: 'partial' }
  }
  if (!state || typeof state !== 'object' || !state.me || typeof state.me !== 'object' || !state.players || !state.teams) {
    return { ok: false, why: 'foreign' }
  }
  if (typeof state.version === 'number' && state.version > SAVE_VERSION) return { ok: false, why: 'newer' }
  try {
    migratePlayerSave(state)
  } catch {
    return { ok: false, why: 'partial' }
  }
  const meta = buildSaveMeta(state)
  return meta ? { ok: true, game: state, meta } : { ok: false, why: 'foreign' }
}

/**
 * 导入存档, second half, once the player has said yes: the backup's save goes
 * in as the save, byte for byte as it was exported, taken in this page's name
 * so any other page that held a save stops writing it (me/save.ts installSave);
 * then the backup's 成就殿堂 is folded into this device's, never over it
 * (me/hall.ts mergeHallFrom). The home page opens it next with openSavedCareer,
 * as 继续 does. 'full' when this browser has no room for it: nothing changed.
 */
export async function importBackupCareer(b: Backup, game: GameState): Promise<'ok' | 'full'> {
  if (!(await installSave(b.save, game))) return 'full'
  if (b.hall) mergeHallFrom(b.hall)
  return 'ok'
}
