import { hashStr } from '../rng'
import { AUTOSAVE, OLD_AUTOSAVE, OWNER, adoptOldSave } from './saveInfo'
import { PACKED, canPack, packStored, readStored } from './saveCodec'
import { cleanHall, readHall } from './hall'
import type { Hall } from './hall'
import type { SaveMeta } from './saveMeta'

/**
 * 导出存档 / 导入存档: a career carried out of this browser and back in.
 *
 * Reported 2026-09-18 (an outside audit): the one save lives in this
 * browser's localStorage and nowhere else. Clearing the site's data, another
 * phone, another browser, the site at another address — the career is gone,
 * and there was no way to keep a copy.
 *
 * A backup is one file of JSON, and the 存档码 is the same text, for a browser
 * that cannot download (WeChat's): a small header, the 成就殿堂's record
 * (val_player.hall), and the save exactly as it is stored — `vpz1:` and the
 * gzip as base64 (me/saveCodec.ts), about 0.2–1.1 MB. A save a browser wrote
 * raw is gzipped on the way out, where this browser can.
 *
 *   { "format": "VAL_PLAYER_SAVE", "v": 1, "saveId": "k…", "ign": "…",
 *     "year": 2026, "day": 63, "date": "2026年3月5日",
 *     "exportedAt": "2026-09-18T13:02:11.000Z",
 *     "len": 812345, "sum": "1a2b3c4d", "hall": { … }, "save": "vpz1:…" }
 *
 * `len` and `sum` are the save's length and FNV-1a hash (engine/rng.ts
 * hashStr): a code cut short in the copying, or a file damaged, is said as
 * such before anything is decoded. The gzip's own check catches the rest.
 *
 * This module is the home page's (src/App.tsx): it reads the save as text and
 * never the world, so the page still fetches no roster book to make or check a
 * backup (scripts/check_boundary.ts). Decoding the career, bringing an old one
 * forward and writing it in are the career's (me/opening.ts readBackupCareer,
 * importBackupCareer), fetched when a backup is read.
 */

export const BACKUP_FORMAT = 'VAL_PLAYER_SAVE'
/** the backup's own format: a backup from a build that writes a higher one is refused, not misread */
export const BACKUP_V = 1
/** the hall's record under 换设备 (me/hall.ts exportHall): pasted here, it is said what it is */
const HALL_FORMAT = 'VAL_PLAYER_HALL'
/** well past any career's backup: a file this size is not one */
const MAX_BYTES = 64 * 1024 * 1024

export interface Backup {
  format: typeof BACKUP_FORMAT
  v: number
  /** the career's own id (me.saveId); '' for a save from before the id, which gets one when it is opened */
  saveId: string
  ign: string
  /** where the career stood, as the save says */
  year: number
  day: number
  /** 2026年3月5日 */
  date: string
  /** when the backup was made, ISO */
  exportedAt: string
  /** the save's length and hash, to tell a code cut short from a whole one */
  len: number
  sum: string
  /** this device's 成就殿堂 when the backup was made; null where the browser stored none */
  hall: Hall | null
  /** the save as stored: `vpz1:` + gzip as base64, or the JSON raw */
  save: string
}

/** Why a backup is refused, each said in one line (BACKUP_WHY). */
export type BackupWhy = 'foreign' | 'newer' | 'partial' | 'hall'

export const BACKUP_WHY: Record<BackupWhy, string> = {
  foreign: '不是这个游戏的存档。请选「导出存档」存下的文件，或者粘贴它的存档码。',
  newer: '存档来自更新的版本。刷新一下页面，等游戏更新到最新再导入。',
  partial: '存档码不完整：可能只复制了一部分，或者文件坏了。重新导出一份再试。',
  hall: '这是成就殿堂的记录，不是存档：到「成就殿堂」最下面的「换设备」里合并。',
}

const sumOf = (s: string): string => hashStr(s).toString(16).padStart(8, '0')
const pad = (n: number) => String(n).padStart(2, '0')
/** a season day as the game writes the date (engine/calendar.ts dateLabel) */
const dayLabel = (year: number, day: number): string => {
  const d = new Date(Date.UTC(year, 0, 1))
  d.setUTCDate(d.getUTCDate() + day)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}
/** what a file name can carry of an IGN: anything but the characters a file system refuses, and no spaces */
const fileSafe = (s: string): string => s.replace(/[\\/:*?"<>|\s.]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)

export type ExportResult =
  | { ok: true; text: string; name: string; bytes: number; backup: Backup }
  | { ok: false; why: 'none' | 'unreadable' }

interface Peek { year?: unknown; day?: unknown; me?: { id?: unknown; saveId?: unknown } | null; players?: Record<string, { ign?: unknown } | undefined> }

/**
 * The save on disk, as a backup: the text of the file, and the file's name
 * (val_player-<IGN>-<today>.json). Read the way 继续 reads it — the owner
 * record compared before and after, so a save another page wrote meanwhile is
 * read again — and decoded once to be sure it is a career, and to name it.
 */
export async function exportBackup(now: Date = new Date()): Promise<ExportResult> {
  adoptOldSave()
  let raw: string | null = null
  let peek: Peek | null = null
  for (let tries = 0; ; tries++) {
    let mark: string
    try {
      mark = localStorage.getItem(OWNER) ?? ''
      raw = localStorage.getItem(AUTOSAVE) ?? localStorage.getItem(OLD_AUTOSAVE)
    } catch { return { ok: false, why: 'unreadable' } }
    if (!raw) return { ok: false, why: 'none' }
    try { peek = JSON.parse(await readStored(raw)) as Peek } catch { return { ok: false, why: 'unreadable' } }
    let after = mark
    try { after = localStorage.getItem(OWNER) ?? '' } catch { /* read as unchanged */ }
    if (after === mark || tries >= 3) break
  }
  const me = peek?.me
  if (!peek || typeof peek !== 'object' || !me || typeof me !== 'object' || typeof peek.year !== 'number' || typeof peek.day !== 'number') {
    return { ok: false, why: 'unreadable' }
  }
  let save = raw
  if (!save.startsWith(PACKED) && canPack()) {
    try { save = await packStored(save) } catch { /* the gzip failed: carried raw, as the browser keeps it */ }
  }
  const ign = typeof me.id === 'string' && typeof peek.players?.[me.id]?.ign === 'string' ? String(peek.players[me.id]!.ign) : ''
  const saveId = typeof me.saveId === 'string' ? me.saveId : ''
  const backup: Backup = {
    format: BACKUP_FORMAT,
    v: BACKUP_V,
    saveId,
    ign,
    year: peek.year,
    day: peek.day,
    date: dayLabel(peek.year, peek.day),
    exportedAt: now.toISOString(),
    len: save.length,
    sum: sumOf(save),
    hall: readHall(),
    save,
  }
  const text = JSON.stringify(backup)
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const name = `val_player-${fileSafe(ign) || saveId || 'career'}-${today}.json`
  return { ok: true, text, name, bytes: new Blob([text]).size, backup }
}

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null)
const B64 = /^[A-Za-z0-9+/]*={0,2}$/

/**
 * A file's text or a pasted 存档码, checked before anything is decoded: what
 * it is, whether this build can read it, whether all of it is here. Line breaks
 * a chat app put into a long code are taken out first — the code has none of
 * its own. Nothing is written.
 */
export function parseBackup(text: string): { ok: true; backup: Backup } | { ok: false; why: BackupWhy } {
  // trim takes a byte-order mark off the front as well (it is white space to JavaScript)
  const flat = text.replace(/[\r\n]+/g, '').trim()
  let raw: unknown
  try {
    raw = JSON.parse(flat)
  } catch {
    // a code or a file cut short still starts like one
    return { ok: false, why: flat.includes(BACKUP_FORMAT) || flat.includes(`"save":"${PACKED}`) ? 'partial' : 'foreign' }
  }
  const o = obj(raw)
  if (!o) return { ok: false, why: 'foreign' }
  if (o.format === HALL_FORMAT) return { ok: false, why: 'hall' }
  if (o.format !== BACKUP_FORMAT) return { ok: false, why: 'foreign' }
  const v = typeof o.v === 'number' && Number.isInteger(o.v) ? o.v : 0
  if (v > BACKUP_V) return { ok: false, why: 'newer' }
  if (v < 1) return { ok: false, why: 'foreign' }
  let save = typeof o.save === 'string' ? o.save : ''
  // base64 carries no spaces of its own; a raw save is JSON, whose strings can
  if (save.startsWith(PACKED)) save = save.replace(/\s+/g, '')
  if (!save) return { ok: false, why: 'partial' }
  if (typeof o.len === 'number' && o.len !== save.length) return { ok: false, why: 'partial' }
  if (typeof o.sum === 'string' && o.sum !== sumOf(save)) return { ok: false, why: 'partial' }
  const body = save.slice(PACKED.length)
  if (save.startsWith(PACKED) ? body.length % 4 !== 0 || !B64.test(body) : !save.startsWith('{')) return { ok: false, why: 'partial' }
  const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  const str = (x: unknown, max: number): string => (typeof x === 'string' ? x.slice(0, max) : '')
  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      v,
      saveId: str(o.saveId, 40),
      ign: str(o.ign, 24),
      year: num(o.year),
      day: num(o.day),
      date: str(o.date, 24),
      exportedAt: str(o.exportedAt, 40),
      len: save.length,
      sum: sumOf(save),
      // washed as every hall read back is (me/hall.ts cleanHall); merged into this device's on the way in, never over it
      hall: obj(o.hall) ? cleanHall(o.hall) : null,
      save,
    },
  }
}

/** A file picked for 导入存档, read as text; a file far past any backup's size is not one. */
export async function readBackupFile(f: Blob): Promise<{ ok: true; text: string } | { ok: false; why: BackupWhy }> {
  if (f.size > MAX_BYTES) return { ok: false, why: 'foreign' }
  try { return { ok: true, text: await f.text() } } catch { return { ok: false, why: 'partial' } }
}

/** What happened when a backup was taken in and opened (App.tsx, me/opening.ts importBackupCareer). */
export type BackupTake = 'ok' | 'full' | 'unopened'

export const BACKUP_TAKE: Record<Exclude<BackupTake, 'ok'>, string> = {
  full: '这个浏览器存不下这个存档（网站存储满了）。这台设备上原来的存档没动。',
  unopened: '存档已经导进来了，但没能打开。刷新页面，再点「继续」。',
}

/**
 * A backup decoded and ready to go in, as the home page sees it: the career's
 * card (me/saveMeta.ts, the one 上次的存档 draws), and taking it in. Or why not.
 */
export type BackupPreview =
  | { ok: true; meta: SaveMeta; take: () => Promise<BackupTake> }
  | { ok: false; why: BackupWhy }
