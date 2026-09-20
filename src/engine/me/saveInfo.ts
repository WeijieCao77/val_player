import { readSaveMeta } from './saveMeta'
import type { SaveMeta } from './saveMeta'
import { AUTOSAVE, OLD_AUTOSAVE, OLD_OWNER, OWNER, hasSaveText, saveInIdb } from './saveStore'

/**
 * Where a career's save is kept, and what the home page can say about it
 * without reading it. me/save.ts is the save itself and re-exports all of
 * this; it lives apart because me/save.ts reaches the whole world (a save is
 * brought forward on every read, engine/save.ts migrateWorld), and the home
 * page must not fetch every roster book and every circuit to draw one card
 * (reported 2026-09-18, an outside audit: the home page downloaded about 8 MB
 * before any career was opened). Nothing here reads the save itself.
 */

export { AUTOSAVE, OLD_AUTOSAVE, OLD_OWNER, OWNER } from './saveStore'
/** the keys, for scripts/check_save_size.ts and scripts/check_save_tabs.ts */
export const SAVE_KEYS = { autosave: AUTOSAVE, owner: OWNER, oldAutosave: OLD_AUTOSAVE, oldOwner: OLD_OWNER } as const

/** Once: a career saved before the player game had its own keys is copied across. The old copy stays. */
export function adoptOldSave(): void {
  try {
    // Once the body moved to IndexedDB, recreating the old multi-megabyte
    // localStorage copy would put the quota problem straight back.
    if (saveInIdb()) return
    if (localStorage.getItem(AUTOSAVE) !== null) return
    const old = localStorage.getItem(OLD_AUTOSAVE)
    if (old === null) return
    localStorage.setItem(AUTOSAVE, old)
    const owner = localStorage.getItem(OLD_OWNER)
    if (owner !== null) localStorage.setItem(OWNER, owner)
  } catch { /* storage blocked or full: loading still falls back to the old key */ }
}

/** Is there a career to continue? */
export function hasAutosave(): boolean {
  adoptOldSave()
  return hasSaveText()
}

/**
 * How far along the save is, as the small record beside it says (me/save.ts
 * writes it with every save that lands, and guards the save with it). Only where
 * the career stands is read here.
 */
function ownerAt(): { year: number; day: number } | null {
  try {
    const raw = localStorage.getItem(OWNER)
    const o = raw ? JSON.parse(raw) as { year: number; day: number } : null
    return o && typeof o === 'object' ? o : null
  } catch { return null }
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
  const owner = ownerAt()
  const meta = readSaveMeta()
  const ok = !!meta && (!owner || (meta.year === owner.year && meta.day === owner.day))
  return { meta: ok ? meta : null, year: owner?.year ?? null, day: owner?.day ?? null }
}
