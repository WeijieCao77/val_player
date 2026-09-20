/**
 * NOT WIRED IN YET (2026-09-20). Nothing imports this module: the game still
 * saves exactly as it did, through me/save.ts put() into localStorage. It is
 * the draft of the move to IndexedDB, written after the measurements below and
 * left here so the next hand starts from it rather than from nothing. What is
 * still to do, in order:
 *
 *   1. me/save.ts: put() → writeSaveText(), loadAutosave()/installSave() read
 *      through readSaveText(), flushAutosaveNow() → writeSaveTextNow(), and the
 *      keys imported from here rather than declared in me/saveInfo.ts
 *   2. me/saveInfo.ts: hasAutosave() → hasSaveText(); adoptOldSave() must not
 *      run once saveInIdb() is true, or it makes the big localStorage copy again
 *   3. me/backup.ts exportBackup(): read through readSaveText()
 *   4. src/App.tsx: when autosaveInfo() is null, ask IndexedDB once and redraw —
 *      so a browser whose localStorage was cleared still finds the career
 *   5. a check (check_save_room) with a fake IndexedDB: a write that does not
 *      fit leaves a readable career on disk and tells the player; an
 *      interrupted move across leaves one too. check_save_size's own
 *      assertions run with no IndexedDB at all (node has none), so they keep
 *      testing the localStorage path unchanged.
 *
 * Where a career's save is actually kept: IndexedDB, with localStorage behind it.
 *
 * Reported 2026-09-20: 「手机内存有限，会出现无法保存的情况。」 A phone runs out
 * of room and the save fails.
 *
 * localStorage is one small cupboard per site. Safari, and every browser on an
 * iPhone or iPad, keeps 5 MB of it and counts a string with any character past
 * U+00FF at two bytes a character (WebKit StorageMap::setItem); Chrome keeps
 * about the same and counts every character at two. That cupboard is shared
 * with the 成就殿堂, the home page's summary, the settings and the old
 * manager-namespace copy of a career — and a phone whose disk is nearly full
 * gets less of it than that, or none at all.
 *
 * Measured headless (.cache, the same walk scripts/check_save_size.ts does): a
 * 2021 career's packed JSON peaks at 3.31M characters in its eighth season and
 * levels off there — 6.6 MB the WebKit way, which no 5 MB cupboard takes. The
 * gzip is 0.72 MB at its widest, which does fit, so a browser that can gzip
 * (CompressionStream, iOS Safari 16.4 and up) has been getting by. A browser
 * that cannot — an iPhone kept on iOS 15, which is exactly the phone with no
 * room — writes the JSON raw and has never fitted past its first season.
 *
 * IndexedDB is the other store every one of those browsers has, and it is not
 * that cupboard: WebKit gives a site on the order of hundreds of megabytes of
 * it, Chrome a share of the disk, and neither counts a save against the 5 MB.
 * So the save's body goes there and the small records stay in localStorage —
 * the owner record the tabs guard each other with (it needs the storage event,
 * which only localStorage fires), the home page's summary, and one marker
 * saying where the body is, so the home page can still say 「上次的存档」
 * without waiting on a database.
 *
 * Never two stores holding a career and no way to tell which is the newer one:
 * the marker is moved to the store that has just taken the save, and only then
 * is the other one let go. A page stopped anywhere in between finds both, reads
 * the one the marker names, and that one is a whole career.
 *
 * Nothing here reads the world, or even the save's shape — it is text going in
 * and text coming out, so the home page can read and write a save without
 * fetching every roster book (scripts/check_boundary.ts).
 */

/** the save's body under the player game's own key, when it is in localStorage */
export const AUTOSAVE = 'val_player:save:autosave'
export const OWNER = `${AUTOSAVE}:owner`
/** where a career used to be kept, in the manager game's namespace; left in place as a backup */
export const OLD_AUTOSAVE = 'valmanager:player:save:autosave'
export const OLD_OWNER = `${OLD_AUTOSAVE}:owner`
/**
 * 'idb' while the save's body is in IndexedDB. Written before the localStorage
 * copy is let go, so it never names a store that has nothing in it, and read
 * synchronously by the home page (me/saveInfo.ts hasAutosave).
 */
export const WHERE_KEY = 'val_player:save:where'

const DB_NAME = 'val_player'
const DB_VERSION = 1
const STORE = 'save'
const ROW = 'autosave'

/** Which store holds the save, as this page knows it — its own answer first, the marker for a page that has not written yet. */
let here: 'idb' | 'ls' | null = null

function marker(): 'idb' | 'ls' {
  if (here) return here
  try { return localStorage.getItem(WHERE_KEY) === 'idb' ? 'idb' : 'ls' } catch { return 'ls' }
}

/** Say where the save is. false when even this much cannot be written: then this page remembers it and the other store is left alone. */
function mark(w: 'idb' | 'ls'): boolean {
  here = w
  try {
    if (w === 'idb') localStorage.setItem(WHERE_KEY, 'idb')
    else localStorage.removeItem(WHERE_KEY)
    return true
  } catch { return false }
}

/* ------------------------------------------------------------------ */
/*  IndexedDB                                                           */
/* ------------------------------------------------------------------ */

/** the open connection, kept so a page going out of sight can write without waiting for one (writeSaveTextNow) */
let open: IDBDatabase | null = null
let opening: Promise<IDBDatabase | null> | null = null

/**
 * The database, opened once. null where there is none to open: a browser
 * without IndexedDB, one that refuses it (some private windows, storage turned
 * off), or one that neither answers nor refuses — that last is why there is a
 * clock on it, since everything waits on this and a career must never hang on
 * 回到首页.
 */
function db(): Promise<IDBDatabase | null> {
  if (open) return Promise.resolve(open)
  if (opening) return opening
  opening = new Promise<IDBDatabase | null>((resolve) => {
    let req: IDBOpenDBRequest
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) { resolve(null); return }
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch { resolve(null); return }
    // it never answered: this write goes to localStorage instead, and the next one asks again
    const clock = setTimeout(() => { opening = null; resolve(null) }, 4000)
    const give = (d: IDBDatabase | null) => { clearTimeout(clock); resolve(d) }
    req.onupgradeneeded = () => {
      try { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE) } catch { /* the open fails below */ }
    }
    req.onsuccess = () => {
      open = req.result
      // another tab is upgrading, or the browser dropped the database: opened again next time
      open.onclose = () => { open = null; opening = null }
      open.onversionchange = () => { try { open?.close() } catch { /* going anyway */ } open = null; opening = null }
      give(open)
    }
    req.onerror = () => { opening = null; give(null) }
    req.onblocked = () => { opening = null; give(null) }
  })
  return opening
}

async function idbGet(): Promise<string | null> {
  const d = await db()
  if (!d) return null
  return new Promise<string | null>((resolve) => {
    let req: IDBRequest
    try { req = d.transaction(STORE, 'readonly').objectStore(STORE).get(ROW) } catch { resolve(null); return }
    req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null)
    req.onerror = () => resolve(null)
  })
}

/** true only once the transaction has committed: a write that did not fit fails here, as a full localStorage does. */
async function idbPut(text: string): Promise<boolean> {
  const d = await db()
  if (!d) return false
  return new Promise<boolean>((resolve) => {
    let tx: IDBTransaction
    try { tx = d.transaction(STORE, 'readwrite') } catch { resolve(false); return }
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => resolve(false)
    tx.onabort = () => resolve(false)
    try { tx.objectStore(STORE).put(text, ROW) } catch { resolve(false) }
  })
}

async function idbDel(): Promise<void> {
  const d = await db()
  if (!d) return
  await new Promise<void>((resolve) => {
    let tx: IDBTransaction
    try { tx = d.transaction(STORE, 'readwrite') } catch { resolve(); return }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
    try { tx.objectStore(STORE).delete(ROW) } catch { resolve() }
  })
}

/* ------------------------------------------------------------------ */
/*  localStorage                                                        */
/* ------------------------------------------------------------------ */

const readLocal = (): string | null => {
  try { return localStorage.getItem(AUTOSAVE) ?? localStorage.getItem(OLD_AUTOSAVE) } catch { return null }
}

/**
 * Into localStorage. A write that does not fit gets one more try, with the
 * room the old manager-namespace copy of a career (me/saveInfo.ts adoptOldSave)
 * was holding: it counts against the same site quota, and a 2021 career's copy
 * can be most of Safari's 5 MB by itself.
 *
 * When the career is already adopted under the new key, that copy is only the
 * backup adoptOldSave left behind, so it is removed for good. When it is not
 * (Safari could not fit the copy beside the original, so the career has been
 * read from the old key all along), the old key is the only save on disk: it is
 * removed for the retry and put back if the retry fails too, so a failed write
 * never leaves the browser with no save at all.
 */
function putLocal(stored: string): boolean {
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

/* ------------------------------------------------------------------ */
/*  the save                                                            */
/* ------------------------------------------------------------------ */

/** Is there a career to continue? Answered without waiting, for the home page's card. */
export function hasSaveText(): boolean {
  if (marker() === 'idb') return true
  try { return localStorage.getItem(AUTOSAVE) !== null || localStorage.getItem(OLD_AUTOSAVE) !== null } catch { return false }
}

/** Has the save been moved into IndexedDB? Only so the old copy is not made again (adoptOldSave). */
export const saveInIdb = (): boolean => marker() === 'idb'

/**
 * The save as text, from the store the marker names. The other is asked after
 * it, for the moment in a move when only one of them has been written yet, and
 * for a browser that lost one of the two.
 */
export async function readSaveText(): Promise<string | null> {
  if (marker() === 'idb') {
    const text = await idbGet()
    if (text !== null) return text
    const local = readLocal()
    // the database went away under the marker (the site's data cleared, a browser that keeps nothing):
    // whatever localStorage still holds is the save, and the marker stops naming an empty store
    mark('ls')
    return local
  }
  const local = readLocal()
  if (local !== null) return local
  // no marker, but a save in the database: it was written there and the marker could not be (storage read-only)
  const text = await idbGet()
  if (text !== null) mark('idb')
  return text
}

/**
 * The save written. IndexedDB first, and the first time it lands there the save
 * is read back whole before the localStorage copy is let go — an interrupted
 * move leaves both, and the marker still naming the one that is certainly a
 * career.
 *
 * false when neither store would take it: then nothing on disk was touched, and
 * the career on screen is the only copy of the latest progress (me/save.ts says
 * so, and offers 导出存档).
 */
export async function writeSaveText(text: string): Promise<boolean> {
  if (await idbPut(text)) {
    if (marker() === 'idb') return true
    // the move across: read it back before anything is removed
    if (await idbGet() === text) {
      if (mark('idb')) {
        try { localStorage.removeItem(AUTOSAVE) } catch { /* it stays; the marker says which is the save */ }
      }
      return true
    }
    // it did not come back the way it went in: leave the save where it is
    await idbDel()
  }
  const ok = putLocal(text)
  // the database held the save and will not any more: the marker moves first, then the copy there goes
  if (ok && marker() === 'idb') {
    mark('ls')
    await idbDel()
  }
  return ok
}

/**
 * The page is going out of sight and may be frozen or gone in a moment
 * (me/save.ts flushAutosaveNow). Best effort, without waiting: the write is
 * handed to the store this page already has open, and the browser commits it if
 * it can. false when there was nothing to hand it to.
 */
export function writeSaveTextNow(text: string): boolean {
  if (marker() === 'idb') {
    if (!open) return false
    try {
      open.transaction(STORE, 'readwrite').objectStore(STORE).put(text, ROW)
      return true
    } catch { return false }
  }
  try {
    localStorage.setItem(AUTOSAVE, text)
    return true
  } catch { return false }
}

/** For the checks: this page forgets which store it decided on, the way a fresh page would. */
export function forgetSaveStore(): void {
  here = null
  open = null
  opening = null
}
