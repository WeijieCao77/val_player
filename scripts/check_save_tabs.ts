/**
 * Two pages of the game open in one browser never write over each other's
 * career (engine/me/save.ts, "Which page holds the save").
 *
 * Reported 2026-09-18, an outside audit of 6d128ed (finding 01): the save's
 * guard compared dates only. A tab left open on a 2027 career counted as
 * further along than a new 2026 career another tab had just started over it,
 * and its next press put the old career back into the one save; two tabs on
 * one save playing the same day overwrote each other in turn. Nothing said so.
 *
 * Here two pages are two copies of the real save module (the same file, loaded
 * twice) over one localStorage, as two tabs share one:
 *
 *  - 新生涯: a page holding a 2027 career, after another page starts a new 2026
 *    career, writes nothing more — not at its next save, not when it goes out
 *    of sight — and says so; hearing the other page's write (the storage
 *    event) it says so at once. The new career stays and goes on saving
 *  - 同一天不同的操作: two pages open the same save; the one opened later holds
 *    it, the other's move does not land. 「载入最新存档」 on the other page opens
 *    the move that did, and then that page holds the save and the first stops
 *  - 压缩途中: a save still being gzipped when another page takes the save does
 *    not land after it; one of this page's previous career, still being
 *    gzipped when this page opens a new one, does not either (and that is no
 *    loss of the save). A save read while the page holding it writes a newer
 *    one is read again, so what opens is the newest
 *  - 老存档: a save and record from before the career id get an id when opened,
 *    nothing else about the career changes, and the id is kept from then on; a
 *    page on an older build writing the old record takes the save from a page
 *    on this one
 *  - the record's count only ever goes up, one a save and one a claim
 *
 *   npx tsx scripts/check_save_tabs.ts
 */
import './check_save_idb_tabs'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { CareerOpts } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { packState, unpackState } from '../src/engine/save'
import { META_KEY } from '../src/engine/me/saveMeta'
import type { GameState } from '../src/engine/types'

/** one localStorage for every page; each value written under the save's key is logged */
class Store {
  private map = new Map<string, string>()
  log: string[] = []
  get length(): number { return this.map.size }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null }
  getItem(k: string): string | null { return this.map.get(k) ?? null }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v))
    if (k === 'val_player:save:autosave') this.log.push(String(v))
  }
  removeItem(k: string): void { this.map.delete(k) }
  clear(): void { this.map.clear() }
}

const G = globalThis as unknown as Record<string, unknown>
let store = new Store()
const fresh = (): Store => { store = new Store(); G.localStorage = store; return store }
fresh()
G.fetch = () => Promise.reject(new Error('offline'))

// two tabs: the save module twice, each with its own page state, over the one storage
type SaveMod = typeof import('../src/engine/me/save')
const url = new URL('../src/engine/me/save.ts', import.meta.url).href
const tabs = async (): Promise<[SaveMod, SaveMod]> => [
  await import(`${url}?tab=${Math.random().toString(36).slice(2)}`) as SaveMod,
  await import(`${url}?tab=${Math.random().toString(36).slice(2)}`) as SaveMod,
]
const plain = await import(url) as SaveMod
const { SAVE_KEYS } = plain
const K = SAVE_KEYS.autosave
const OWNER = SAVE_KEYS.owner

let bad = 0
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}
const t0 = Date.now()

const career = (name: string, year: number, seed: number): GameState =>
  createCareer({ name, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', seed, year, region: 'EMEA', start: 'chal' } as CareerOpts)

const readOwner = (): { by: string; year: number; day: number; career?: string; rev?: number } | null => {
  const raw = store.getItem(OWNER)
  return raw ? JSON.parse(raw) : null
}
/** whose career is on disk, read the way the page reads it */
const onDisk = async (m: SaveMod): Promise<GameState | null> => m.loadAutosave()
const ign = (g: GameState | null): string => (g?.me ? g.players[g.me.id].ign : 'none')
/** whose careers the logged writes were, in order */
const written = async (from: number): Promise<string[]> => {
  const out: string[] = []
  for (const v of store.log.slice(from)) out.push(ign(unpackState(await plain.readStored(v))))
  return out
}

/** the record's count, noted after every step: it only ever goes up */
let revs: number[] = []
const noteRev = () => { revs.push(readOwner()?.rev ?? 0) }
const upOnly = (label: string) => {
  const ok = revs.every((r, i) => i === 0 || r > revs[i - 1])
  check(ok, `${label}：记录的计数只增不减（${revs.join(' → ')}）`)
  revs = []
}

/**
 * The next gzip (or gunzip) made holds its output until opened: a page still
 * packing a save, or still reading one, for as long as the check needs.
 */
function holdNext(which: 'CompressionStream' | 'DecompressionStream'): { open: () => void; made: () => boolean } {
  const Native = G[which] as typeof CompressionStream
  let open!: () => void
  const gate = new Promise<void>((r) => { open = r })
  let made = false
  G[which] = class {
    readable: ReadableStream<Uint8Array>
    writable: WritableStream<BufferSource>
    constructor(format: CompressionFormat) {
      G[which] = Native
      made = true
      const c = new Native(format)
      this.writable = c.writable
      this.readable = c.readable.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ start: () => gate }))
    }
  }
  return { open, made: () => made }
}
const tick = () => new Promise((r) => setTimeout(r, 5))

// ---- the careers: one a season in (2027), one new (2026)
const OLD = career('OLD_CAREER', 2026, 5)
while (OLD.year < 2027) autoWeek(OLD)
const NEW = () => career('NEW_CAREER', 2026, 9)
console.log(`两个生涯：OLD_CAREER 打到 ${OLD.year} 年第 ${OLD.day} 天，NEW_CAREER 2026 年刚开始 · ${((Date.now() - t0) / 1000).toFixed(0)}s`)

// ---- 1. a page holding a 2027 career, and a new 2026 career started in another page
{
  console.log('一、另一个页面开了新生涯')
  fresh()
  const [A, B] = await tabs()
  const old = unpackState(packState(OLD))
  A.claimAutosave(old)
  noteRev()
  A.autosave(old)
  await A.flushAutosave()
  noteRev()
  const nu = NEW()
  B.claimAutosave(nu)
  noteRev()
  B.autosave(nu)
  await B.flushAutosave()
  noteRev()
  const newId = nu.me!.saveId
  check(ign(await onDisk(B)) === 'NEW_CAREER' && readOwner()?.career === newId && !!newId && newId !== old.me!.saveId,
    '新生涯开始后存档里是新生涯，旁边的记录写着它自己的生涯编号（和旧生涯的不一样）')

  // the old page does not hear it and plays on: its next press
  const from = store.log.length
  autoWeek(old)
  A.autosave(old)
  const ok = await A.flushAutosave()
  check(store.log.length === from && ign(await onDisk(B)) === 'NEW_CAREER',
    `旧页面（${old.year} 年，日期更靠后）再点一下：一次都没写进去，存档还是新生涯（以前这里写回 OLD_CAREER）`)
  check(A.saveLost() && A.saveTrouble() === null && ok,
    '旧页面知道存档被另一个页面接走了：亮「这个存档已在另一个页面更新」，不算存档失败，回首页、刷新都不被拦')
  A.autosave(old)
  A.flushAutosaveNow()
  await A.flushAutosave()
  check(store.log.length === from && JSON.parse(store.getItem(META_KEY) ?? '{}').ign === 'NEW_CAREER',
    '旧页面之后再存、切到后台（pagehide）也一次都不写，首页卡片还是新生涯')

  // the new career goes on saving
  autoWeek(nu)
  B.autosave(nu)
  await B.flushAutosave()
  noteRev()
  const back = await onDisk(B)
  check(ign(back) === 'NEW_CAREER' && back!.day === nu.day && !B.saveLost(), '新生涯接着存得进去')
  upOnly('新生涯')

  // the same, with the storage event heard: said at once, before the old page tries anything
  fresh()
  const [C, D] = await tabs()
  const old2 = unpackState(packState(OLD))
  C.claimAutosave(old2)
  C.autosave(old2)
  await C.flushAutosave()
  const nu2 = NEW()
  D.claimAutosave(nu2)
  C.onSaveStorage(META_KEY)
  const quietOnOther = !C.saveLost()
  C.onSaveStorage(OWNER)
  const heard = C.saveLost()
  const from2 = store.log.length
  C.autosave(old2)
  await C.flushAutosave()
  D.autosave(nu2)
  await D.flushAutosave()
  check(quietOnOther && heard && store.log.length === from2 + 1 && ign(await onDisk(D)) === 'NEW_CAREER',
    '听到另一个页面写了存档旁边的记录（storage 事件）：旧页面马上亮提示，之后什么都不写；别的键变了不算')
}

// ---- 2. one save open in two pages, different moves on the same day
{
  console.log('二、同一个存档开在两个页面，同一天做了不同的事')
  fresh()
  const [A, B] = await tabs()
  const base = unpackState(packState(OLD))
  A.claimAutosave(base)
  A.autosave(base)
  await A.flushAutosave()
  noteRev()
  const money = base.me!.money
  const a = (await A.loadAutosave())!
  A.claimAutosave(a)
  noteRev()
  const b = (await B.loadAutosave())!
  B.claimAutosave(b)
  noteRev()
  check(a.me!.saveId === base.me!.saveId && b.me!.saveId === base.me!.saveId, '两个页面读的是同一个生涯（同一个编号）')
  a.me!.money = money + 111
  A.autosave(a)
  await A.flushAutosave()
  b.me!.money = money + 222
  B.autosave(b)
  await B.flushAutosave()
  noteRev()
  a.me!.money = money + 1111
  A.autosave(a)
  await A.flushAutosave()
  const disk = await onDisk(B)
  check(disk!.me!.money === money + 222 && A.saveLost() && !B.saveLost(),
    `后打开的页面的操作在存档里（+222），先打开的那个页面的两次操作一次都没盖上去（以前最后落盘的是 +1111），它亮了提示`)

  // 载入最新存档 on the page that lost it
  const again = (await A.loadAutosave())!
  A.claimAutosave(again)
  noteRev()
  B.onSaveStorage(OWNER)
  check(again.me!.money === money + 222 && !A.saveLost() && B.saveLost(),
    '「载入最新存档」读到的是另一个页面存下的那一步；这个页面接过存档，另一个页面反过来亮提示')
  again.me!.money = money + 333
  A.autosave(again)
  await A.flushAutosave()
  noteRev()
  b.me!.money = money + 444
  B.autosave(b)
  await B.flushAutosave()
  check((await onDisk(A))!.me!.money === money + 333, '接过存档的页面存得进去，交出去的那个页面存不进去')
  upOnly('同一天')
}

// ---- 3. a save still being gzipped when the save changes hands
{
  console.log('三、还在压缩的存档')
  fresh()
  const [A, B] = await tabs()
  const old = unpackState(packState(OLD))
  A.claimAutosave(old)
  A.autosave(old)
  await A.flushAutosave()
  noteRev()
  autoWeek(old)
  const held = holdNext('CompressionStream')
  A.autosave(old)
  check(held.made(), 'A 页面的这次存档正在压缩（压缩停在半路）')
  const nu = NEW()
  B.claimAutosave(nu)
  noteRev()
  B.autosave(nu)
  await B.flushAutosave()
  noteRev()
  const from = store.log.length
  held.open()
  await A.flushAutosave()
  check(store.log.length === from && ign(await onDisk(B)) === 'NEW_CAREER' && A.saveLost(),
    '压缩开始时 A 还占着存档，压缩完时存档已经被 B 的新生涯接走：A 这次没有写进去，存档还是新生涯，A 亮提示')
  upOnly('压缩途中')

  // this page's own previous career, still being packed when it opens a new one (再来一局): dropped, and no notice
  fresh()
  const [C] = await tabs()
  const one = unpackState(packState(OLD))
  C.claimAutosave(one)
  C.autosave(one)
  await C.flushAutosave()
  const h2 = holdNext('CompressionStream')
  autoWeek(one)
  C.autosave(one)
  const two = NEW()
  C.claimAutosave(two)
  C.autosave(two)
  const from2 = store.log.length
  h2.open()
  await C.flushAutosave()
  const after = await written(from2)
  check(after.join() === 'NEW_CAREER' && !C.saveLost() && C.saveTrouble() === null,
    `同一个页面开了新生涯，上一个生涯还在压缩的那次存档不再写进去，也不算被别的页面接走（写进去的：${after.join('、')}）`)

  // a save read while the page holding it writes a newer one: read again
  fresh()
  const [E, F] = await tabs()
  const s = unpackState(packState(OLD))
  E.claimAutosave(s)
  E.autosave(s)
  await E.flushAutosave()
  const gun = holdNext('DecompressionStream')
  const reading = F.loadAutosave()
  for (let i = 0; i < 400 && !gun.made(); i++) await tick()
  s.me!.money += 555
  E.autosave(s)
  await E.flushAutosave()
  gun.open()
  const got = await reading
  check(got?.me?.money === s.me!.money, 'F 页面读档读到一半，占着存档的 E 页面又存了一次：F 重新读一遍，打开的是最新的那一次')
}

// ---- 4. saves and records from before the career id
{
  console.log('四、老存档')
  fresh()
  const [A, B] = await tabs()
  const legacy = unpackState(packState(OLD))
  delete legacy.me!.saveId
  store.setItem(K, packState(legacy))
  store.setItem(OWNER, JSON.stringify({ by: 'oldbuild', year: legacy.year, day: legacy.day }))
  const g = (await A.loadAutosave())!
  const before = packState(g)
  A.claimAutosave(g)
  const id = g.me!.saveId
  delete g.me!.saveId
  const same = packState(g) === before
  g.me!.saveId = id
  check(!!id && same && readOwner()?.career === id && readOwner()?.rev === 1,
    '没有生涯编号的老存档：打开时给一个，记录里写上它和计数 1，生涯别的地方一点没变')
  A.autosave(g)
  await A.flushAutosave()
  const again = (await B.loadAutosave())!
  check(again.me!.saveId === id, '下一次存档起编号就存在存档里，再读出来还是同一个')

  // a page on an older build writes the old record: this page stops
  store.setItem(OWNER, JSON.stringify({ by: 'oldbuild', year: g.year, day: g.day + 1 }))
  A.onSaveStorage(OWNER)
  const from = store.log.length
  A.autosave(g)
  await A.flushAutosave()
  check(A.saveLost() && store.log.length === from, '旧版本的页面按老样子写了记录：这个页面当作存档被接走，不再写')
}

console.log(`\n用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`)
if (bad) {
  console.log(`✗ 多页面存档有 ${bad} 处不对。`)
  process.exit(1)
}
console.log('✓ 两个页面不会互相覆盖存档：丢了存档的页面不再写、马上知道；还在压缩的旧存档不会落在新存档之后；老存档照样读、拿到自己的编号。')
