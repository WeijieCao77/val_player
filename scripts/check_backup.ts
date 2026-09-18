/**
 * 导出存档 / 导入存档 (engine/me/backup.ts, me/opening.ts readBackupCareer and
 * importBackupCareer, me/save.ts installSave), headless, over one in-memory
 * localStorage the way the browser keeps it — and the new-career screen's line
 * about the last career (me/hall.ts lastCareerLine).
 *
 * Reported 2026-09-18 (an outside audit): the career lived in one
 * browser-local save with no way to copy it out, so clearing the site's data,
 * another phone or another address lost it. Here:
 *
 *  - 往返: a played career exported on one device and imported on another is
 *    the same career — the save goes in byte for byte as it was stored, the
 *    world read back serialises byte-identical to 继续 on the first device, and
 *    the career keeps its id (me.saveId); line breaks a chat app put into the
 *    code change nothing; the file is named val_player-<IGN>-<date>.json
 *  - 另一个页面: a page holding a career when a backup is taken in over it
 *    stops writing — at once when it hears the record move, and at its next
 *    write when it does not — and the imported save stays
 *  - 殿堂: the backup's 成就殿堂 is merged into this device's (every card, first
 *    unlocks kept earliest, careers counted once), never over it; twice adds nothing
 *  - 坏的输入: a code cut short, a damaged one, another game's file, the hall's
 *    own record, a backup from a newer build — each refused with its own line,
 *    and nothing written; no room for it in the browser: 'full', nothing changed
 *  - 老存档: a save from before the career id, the RMB books and the player
 *    game's own keys (raw JSON under the manager's key, desk fields in it),
 *    carried in a backup, opens as the same career 继续 opens on the first
 *    device, and gets an id
 *  - 开新生涯页那一行: how the last career began, what it rewrote, and only
 *    doors that open for the year and place picked; a career made with a full
 *    hall is the same as one made with none
 *
 *   npx tsx scripts/check_backup.ts
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { CareerOpts } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { packState, unpackState } from '../src/engine/save'
import { BACKUP_TAKE, BACKUP_V, BACKUP_WHY, exportBackup, parseBackup, readBackupFile } from '../src/engine/me/backup'
import type { Backup, BackupWhy } from '../src/engine/me/backup'
import { importBackupCareer, openSavedCareer, readBackupCareer } from '../src/engine/me/opening'
import { HALL_KEY, cleanHall, lastCareerLine, readHall } from '../src/engine/me/hall'
import type { Hall, HallCard, HallStart } from '../src/engine/me/hall'
import { ACHIEVEMENTS } from '../src/engine/me/achievements'
import { META_KEY } from '../src/engine/me/saveMeta'
import { CNY_FLAG } from '../src/engine/me/cnyMigrate'
import { buildStartSheet } from '../src/engine/me/startSheet'
import type { GameState } from '../src/engine/types'

/** one localStorage for every page; a key can be made to refuse writes, as a full browser does */
class Store {
  private map = new Map<string, string>()
  full = new Set<string>()
  get length(): number { return this.map.size }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null }
  getItem(k: string): string | null { return this.map.get(k) ?? null }
  setItem(k: string, v: string): void {
    if (this.full.has(k)) throw new Error('QuotaExceededError')
    this.map.set(k, String(v))
  }
  removeItem(k: string): void { this.map.delete(k) }
  clear(): void { this.map.clear() }
  /** every key and value, to tell whether anything was written */
  snap(): string { return JSON.stringify([...this.map.entries()].sort()) }
}

const G = globalThis as unknown as Record<string, unknown>
let store = new Store()
const fresh = (): Store => { store = new Store(); G.localStorage = store; return store }
fresh()
G.fetch = () => Promise.reject(new Error('offline'))

type SaveMod = typeof import('../src/engine/me/save')
const url = new URL('../src/engine/me/save.ts', import.meta.url).href
/** the page importing: the save module opening.ts reads, the one the home page's career goes through */
const here = await import(url) as SaveMod
/** another page of the game in the same browser: the same file, loaded again, with its own page state */
const otherTab = async (): Promise<SaveMod> => await import(`${url}?tab=${Math.random().toString(36).slice(2)}`) as SaveMod
const { SAVE_KEYS } = here
const K = SAVE_KEYS.autosave
const OWNER = SAVE_KEYS.owner

let bad = 0
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}
const t0 = Date.now()

const career = (name: string, seed: number, weeks: number, o: Partial<CareerOpts> = {}): GameState => {
  const s = createCareer({ name, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', seed, year: 2026, region: 'EMEA', start: 'chal', ...o } as CareerOpts)
  for (let i = 0; i < weeks; i++) autoWeek(s)
  return s
}
const ign = (g: GameState | null): string => (g?.me ? g.players[g.me.id].ign : 'none')
const owner = (): { by: string; career?: string; rev?: number } | null => {
  const raw = store.getItem(OWNER)
  return raw ? JSON.parse(raw) : null
}
/** a career as one tab writes it: claimed, saved, landed */
const saveAs = async (tab: SaveMod, g: GameState): Promise<void> => {
  tab.claimAutosave(g)
  tab.autosave(g)
  await tab.flushAutosave()
}
/** the career 继续 opens, as JSON, without the id the opening page gives it */
const opened = async (): Promise<{ json: string; id: string; g: GameState } | null> => {
  const g = await openSavedCareer()
  if (!g) return null
  const id = g.me!.saveId ?? ''
  delete g.me!.saveId
  const json = packState(g)
  g.me!.saveId = id || undefined
  return { json, id, g }
}
const whyOf = (text: string): BackupWhy | 'ok' => { const p = parseBackup(text); return p.ok ? 'ok' : p.why }
const readWhy = async (b: Backup): Promise<BackupWhy | 'ok'> => { const r = await readBackupCareer(b); return r.ok ? 'ok' : r.why }

// ---- a hall to carry, and one already on the other device
const A0 = ACHIEVEMENTS[0].key
const A1 = ACHIEVEMENTS[1].key
const A2 = ACHIEVEMENTS[2].key
const card = (id: string, start: HallStart, entry: number, at: string, extra: Partial<HallCard> = {}): HallCard => ({
  id, name: `P${id}`, role: '决斗者', entry, start, origin: 'netcafe', home: 'China', from: entry, to: entry + 3, seasons: 3,
  clubs: ['EDG'], titles: [], ending: { key: 'journeyman', title: '职业生涯' }, peak: 70, mvps: 0, ach: [A0], at, ...extra,
})
const mark = (id: string, year: number, at: string) => ({ id, who: `P${id}`, year, at })
const HALL_OLD: Hall = cleanHall({
  v: 1,
  cards: [card('c1', 'pre', 2026, '2026-09-01')],
  ach: { [A0]: { first: mark('c1', 2027, '2026-09-01'), n: 1, ids: ['c1'] }, [A1]: { first: mark('c1', 2028, '2026-09-02'), n: 1, ids: ['c1'] } },
  hx: {},
})
const HALL_HERE: Hall = cleanHall({
  v: 1,
  cards: [card('c9', 't1', 2021, '2026-09-05')],
  ach: { [A0]: { first: mark('c9', 2022, '2026-08-30'), n: 1, ids: ['c9'] }, [A2]: { first: mark('c9', 2023, '2026-09-05'), n: 1, ids: ['c9'] } },
  hx: {},
})

// ---- the careers
const ONE = career('Backup One', 31, 10)
const TWO = career('BackupTwo', 32, 4)
console.log(`两个生涯：Backup One 第 ${ONE.day} 天，BackupTwo 第 ${TWO.day} 天 · ${((Date.now() - t0) / 1000).toFixed(0)}s`)

// ---- 1. export on one device, import on another
let sent = ''
let sentStored = ''
{
  console.log('一、导出 → 另一台设备导入')
  fresh()
  store.setItem(HALL_KEY, JSON.stringify(HALL_OLD))
  const g = unpackState(packState(ONE))
  await saveAs(here, g)
  sentStored = store.getItem(K)!
  const first = (await opened())!
  const out = await exportBackup(new Date(2026, 8, 18, 13, 2))
  check(out.ok, '有存档就导得出来')
  if (!out.ok) throw new Error('export failed')
  sent = out.text
  const b = out.backup
  check(out.name === 'val_player-Backup_One-2026-09-18.json', `文件名：${out.name}`)
  check(b.format === 'VAL_PLAYER_SAVE' && b.v === BACKUP_V && b.saveId === g.me!.saveId && !!b.saveId && b.year === g.year && b.day === g.day && b.ign === 'Backup One',
    `文件头：格式、版本 ${b.v}、生涯编号 ${b.saveId}、${b.date}、导出时间 ${b.exportedAt}`)
  check(b.save === sentStored && b.save.startsWith(here.PACKED), `存档原样放进文件：和浏览器里存的一个字不差（${Math.round(b.save.length / 1024)} KB，gzip + base64）`)
  check(JSON.stringify(b.hall) === JSON.stringify(readHall()), '成就殿堂在同一个文件里')
  check(sent.startsWith('{"format":"VAL_PLAYER_SAVE","v":1,"saveId":'), '文件开头就是文件头，打开能看懂')

  // another device: nothing of this career, a hall of its own
  fresh()
  store.setItem(HALL_KEY, JSON.stringify(HALL_HERE))
  const p = parseBackup(sent)
  check(p.ok, '另一台设备认得这个文件')
  if (!p.ok) throw new Error('parse failed')
  const before = store.snap()
  const r = await readBackupCareer(p.backup)
  check(r.ok && r.meta.ign === 'Backup One' && r.meta.year === g.year && r.meta.day === g.day && r.meta.overall === Math.round(g.players[g.me!.id].overall),
    `导入前先认出是谁：${r.ok ? `${r.meta.ign} · ${r.meta.club?.name ?? '没有队伍'} · ${r.meta.date} · 综合 ${r.meta.overall}` : '读不出来'}`)
  check(store.snap() === before, '只是读出来看看：浏览器里一个字没写')
  if (!r.ok) throw new Error('read failed')
  check(await importBackupCareer(p.backup, r.game) === 'ok', '导入写得进去')
  check(store.getItem(K) === sentStored, '导入以后浏览器里的存档和导出的那一份一个字不差')
  const second = (await opened())!
  check(second.json === first.json, `「继续」打开的世界和原设备上「继续」打开的逐字节一样（${Math.round(second.json.length / 1024)} KB）`)
  check(second.id === g.me!.saveId && owner()?.career === g.me!.saveId, `生涯编号带过来了：${second.id}`)
  check(JSON.parse(store.getItem(META_KEY) ?? '{}').ign === 'Backup One', '首页的存档卡写的是导进来的生涯')

  // the same code through a chat app: wrapped, CRLF, spaces around it
  const wrapped = `\n  ${sent.match(/.{1,76}/g)!.join('\r\n')}  \n`
  const w = parseBackup(wrapped)
  check(w.ok && w.backup.save === sentStored, '存档码被聊天软件折成很多行、前后多了空白：照样认得，存档一个字不差')
  const f = await readBackupFile(new Blob([sent]))
  check(f.ok && whyOf(f.text) === 'ok', '选文件读进来和粘贴存档码是同一段')
}

// ---- 2. another page holding a save when a backup is taken in over it
{
  console.log('二、另一个页面开着存档')
  for (const heard of [true, false]) {
    fresh()
    const A = await otherTab()
    const two = unpackState(packState(TWO))
    await saveAs(A, two)
    const p = parseBackup(sent)
    if (!p.ok) throw new Error('parse failed')
    const r = await readBackupCareer(p.backup)
    if (!r.ok) throw new Error('read failed')
    check(await importBackupCareer(p.backup, r.game) === 'ok', `${heard ? '' : '（没听到 storage 事件）'}另一个页面开着 BackupTwo 时导入 Backup One：写进去了`)
    if (heard) A.onSaveStorage(OWNER)
    check(A.saveLost() === heard, heard ? '开着 BackupTwo 的页面一听到记录变了，马上亮「这个存档已在另一个页面更新」' : '没听到事件的页面还不知道')
    autoWeek(two)
    A.autosave(two)
    await A.flushAutosave()
    A.autosave(two)
    A.flushAutosaveNow()
    await A.flushAutosave()
    check(store.getItem(K) === sentStored && A.saveLost() && A.saveTrouble() === null,
      '它之后再存、切到后台都一次没写进去，存档还是导进来的 Backup One；它亮的是「在另一个页面更新」，不是存档失败')
    const o = (await opened())!
    check(ign(o.g) === 'Backup One' && o.id === p.backup.saveId, '「继续」打开的是导进来的生涯')
  }
}

// ---- 3. the hall: merged, never replaced
{
  console.log('三、成就殿堂合并')
  // this device's hall, and a save of its own that the backup goes in over
  fresh()
  store.setItem(HALL_KEY, JSON.stringify(HALL_HERE))
  await saveAs(await otherTab(), unpackState(packState(TWO)))
  const p0 = parseBackup(sent)
  if (!p0.ok) throw new Error('parse failed')
  const r0 = await readBackupCareer(p0.backup)
  if (!r0.ok) throw new Error('read failed')
  check(await importBackupCareer(p0.backup, r0.game) === 'ok', '导入带着殿堂的备份')
  const h = readHall()!
  const ids = h.cards.map((c) => c.id).sort().join()
  check(ids === 'c1,c9', `两边的生涯卡都在（${ids}），这台设备原来的没丢`)
  check(h.ach[A0]?.n === 2 && h.ach[A0].ids.includes('c1') && h.ach[A0].ids.includes('c9') && h.ach[A0].first.id === 'c9',
    '两边都有的成就：记 2 局，首次按更早的那次（c9，2026-08-30）')
  check(!!h.ach[A1] && h.ach[A1].first.id === 'c1' && !!h.ach[A2] && h.ach[A2].first.id === 'c9', '只有一边有的成就：各自留着')
  const once = store.getItem(HALL_KEY)
  const p = parseBackup(sent)
  if (!p.ok) throw new Error('parse failed')
  const r = await readBackupCareer(p.backup)
  if (!r.ok) throw new Error('read failed')
  await importBackupCareer(p.backup, r.game)
  check(store.getItem(HALL_KEY) === once, '同一份再导入一次：殿堂一个字不变')
  // a backup with no hall in it (a browser that stored none)
  const noHall = parseBackup(sent.replace(/"hall":\{.*?\},"save":/, '"hall":null,"save":'))
  check(noHall.ok && noHall.backup.hall === null, '备份里没有殿堂（那个浏览器存不了）也能导入')
  if (noHall.ok) {
    const r2 = await readBackupCareer(noHall.backup)
    if (r2.ok) await importBackupCareer(noHall.backup, r2.game)
    check(store.getItem(HALL_KEY) === once, '……这台设备的殿堂原样不动')
  }
}

// ---- 4. what is refused, and in which words
{
  console.log('四、坏的输入')
  fresh()
  store.setItem(HALL_KEY, JSON.stringify(HALL_HERE))
  const T = await otherTab()
  await saveAs(T, unpackState(packState(TWO)))
  const before = store.snap()
  const b = (JSON.parse(sent) as Backup)
  const mid = Math.floor(b.save.length / 2)
  const flip = (s: string, at: number) => s.slice(0, at) + (s[at] === 'A' ? 'B' : 'A') + s.slice(at + 1)
  const cases: [string, string, BackupWhy][] = [
    ['只复制了前一半', sent.slice(0, Math.floor(sent.length / 2)), 'partial'],
    ['只少了最后几个字', sent.slice(0, -3), 'partial'],
    ['存档里改了一个字', JSON.stringify({ ...b, save: flip(b.save, mid) }), 'partial'],
    ['存档短了一截，文件头照旧', JSON.stringify({ ...b, save: b.save.slice(0, mid) }), 'partial'],
    ['随便一段字', '你好，这是我的存档', 'foreign'],
    ['别的 JSON', '{"name":"Rookie","level":3}', 'foreign'],
    ['经理模式的存档文件', JSON.stringify({ format: 'VAL_MANAGER_SAVE', version: 1, state: {} }), 'foreign'],
    ['一张图片', 'PNG\r\n\n   \rIHDR', 'foreign'],
    ['成就殿堂「换设备」那一段', JSON.stringify({ format: 'VAL_PLAYER_HALL', ...HALL_OLD }), 'hall'],
    ['更新的版本导出的', JSON.stringify({ ...b, v: BACKUP_V + 1 }), 'newer'],
  ]
  for (const [what, text, want] of cases) {
    const got = whyOf(text)
    check(got === want, `${what}：${got === 'ok' ? '收下了' : BACKUP_WHY[got as BackupWhy]}`)
  }
  check(BACKUP_WHY.foreign.startsWith('不是这个游戏的存档') && BACKUP_WHY.newer.startsWith('存档来自更新的版本') && BACKUP_WHY.partial.startsWith('存档码不完整'),
    '三种说法：不是这个游戏的存档 / 存档来自更新的版本 / 存档码不完整')

  // past the header's own check: a damaged gzip with no length or hash to catch it, and a save from a newer build
  const noSum = { ...b, save: flip(b.save, mid) } as Record<string, unknown>
  delete noSum.len
  delete noSum.sum
  const p1 = parseBackup(JSON.stringify(noSum))
  check(p1.ok && await readWhy(p1.backup) === 'partial', '文件头里没有长度和校验、存档中间坏了一个字：解压时认出来，「存档码不完整」')
  // cut on a whole base64 group, so only the gzip can tell
  const body = b.save.slice(here.PACKED.length)
  const cut = { ...b, save: `${here.PACKED}${body.slice(0, Math.floor(body.length / 8) * 4)}` } as Record<string, unknown>
  delete cut.len
  delete cut.sum
  const p2 = parseBackup(JSON.stringify(cut))
  check(p2.ok && await readWhy(p2.backup) === 'partial', '存档被截断、文件头也没了校验：解压时认出来，「存档码不完整」')
  const future = unpackState(packState(TWO))
  future.version = 99
  const fs = await here.packStored(packState(future))
  const p3 = parseBackup(JSON.stringify({ ...b, save: fs, len: fs.length, sum: undefined }))
  check(p3.ok && await readWhy(p3.backup) === 'newer', '存档本身是更新版本写的：「存档来自更新的版本」')
  const notMe = await here.packStored(JSON.stringify({ year: 2026, day: 3, teams: {}, players: {}, fixtures: [] }))
  const p4 = parseBackup(JSON.stringify({ ...b, save: notMe, len: notMe.length, sum: undefined }))
  check(p4.ok && await readWhy(p4.backup) === 'foreign', '存档里没有选手生涯：「不是这个游戏的存档」')
  check(store.snap() === before, '以上每一种都没往浏览器里写一个字：原来的存档、旁边的记录、殿堂都没动')

  // no room for it
  const p = parseBackup(sent)
  if (!p.ok) throw new Error('parse failed')
  const r = await readBackupCareer(p.backup)
  if (!r.ok) throw new Error('read failed')
  store.full.add(K)
  const res = await importBackupCareer(p.backup, r.game)
  store.full.delete(K)
  check(res === 'full' && store.snap() === before && !T.saveLost(), `浏览器存不下：「${BACKUP_TAKE.full}」存档、记录、殿堂都没动，开着原存档的页面照常`)
  T.onSaveStorage(OWNER)
  check(!T.saveLost(), '……原来那个页面听到事件也照常存')
}

// ---- 5. a save from before, carried in a backup
{
  console.log('五、老存档在备份里')
  fresh()
  const legacy = unpackState(packState(ONE))
  delete legacy.me!.saveId
  delete legacy.me!.flags[CNY_FLAG]
  const L = legacy as unknown as Record<string, unknown>
  L.managerName = '老经理'
  L.finances = { balance: 1 }
  const raw = packState(legacy)
  // where the career used to live, raw, beside the old record: what 继续 on the first device reads
  store.setItem(SAVE_KEYS.oldAutosave, raw)
  store.setItem(SAVE_KEYS.oldOwner, JSON.stringify({ by: 'oldbuild', year: legacy.year, day: legacy.day }))
  const here1 = (await opened())!
  const out = await exportBackup()
  check(out.ok && out.backup.saveId === here1.id && out.backup.save.startsWith(here.PACKED),
    `老存档（管理器的键、没压缩、没有生涯编号）也导得出来：存档压缩后放进去`)
  // read it the way the first device did before anything was written: straight from the old key
  fresh()
  store.setItem(SAVE_KEYS.oldAutosave, raw)
  store.setItem(SAVE_KEYS.oldOwner, JSON.stringify({ by: 'oldbuild', year: legacy.year, day: legacy.day }))
  const out2 = await exportBackup()
  const expect = (await opened())!
  check(out2.ok && out2.backup.saveId === '', '从没打开过的老存档：文件头里生涯编号是空的')
  fresh()
  if (!out2.ok) throw new Error('export failed')
  const p = parseBackup(out2.text)
  if (!p.ok) throw new Error('parse failed')
  const r = await readBackupCareer(p.backup)
  check(r.ok && r.meta.ign === 'Backup One' && r.meta.money === Math.round(expect.g.me!.money), '导入前的卡片照「继续」读出来的样子画：名字，钱已经换成人民币')
  if (!r.ok) throw new Error('read failed')
  check(await importBackupCareer(p.backup, r.game) === 'ok', '导得进去')
  const got = (await opened())!
  const s = got.g as unknown as Record<string, unknown>
  check(got.json === expect.json, '打开的生涯和原设备上「继续」这个老存档打开的逐字节一样')
  check(!('managerName' in s) && !('finances' in s) && !!got.g.me!.flags[CNY_FLAG] && got.g.me!.money === expect.g.me!.money,
    `经理模式留下的字段去掉了，钱换成人民币（${got.g.me!.money}），和「继续」一样`)
  check(!got.id && store.getItem(K) === p.backup.save, '存档照原样写进去：还没有编号，一个字没改')
  // the career opens (PlayerGame's start): it claims the save, which gives a career from before the id its own
  here.claimAutosave(got.g)
  check(!!got.g.me!.saveId && owner()?.career === got.g.me!.saveId, `打开时拿到自己的生涯编号：${got.g.me!.saveId}`)

  // a backup made by a browser that could not gzip: the save raw inside
  fresh()
  const rawBackup = { ...(JSON.parse(sent) as Backup), save: packState(unpackState(packState(ONE))), len: undefined, sum: undefined }
  const pr = parseBackup(JSON.stringify(rawBackup))
  const rr = pr.ok ? await readBackupCareer(pr.backup) : null
  check(!!rr?.ok && pr.ok && await importBackupCareer(pr.backup, rr.game) === 'ok' && (store.getItem(K) ?? '').startsWith(here.PACKED),
    '不会压缩的浏览器导出的（存档没压缩）：认得，导入时压缩后存下')
  check(ign((await opened())?.g ?? null) === 'Backup One', '……打开照常')
}

// ---- 6. nothing to export
{
  console.log('六、导出的边角')
  fresh()
  const none = await exportBackup()
  check(!none.ok && none.why === 'none', '没有存档：说没有')
  store.setItem(K, `${here.PACKED}AAAA`)
  const broken = await exportBackup()
  check(!broken.ok && broken.why === 'unreadable', '存档坏了：说读不了，不导出一份坏的')
}

// ---- 7. the new-career screen's line about the last career
{
  console.log('七、开新生涯页那一行')
  const hall = (c: HallCard): Hall => ({ v: 1, ach: {}, cards: [card('c0', 't1', 2026, '2026-01-01'), c], hx: {} })
  const all = () => true
  const rw = card('c2', 'pre', 2026, '2026-09-10', { rw: { n: 3 } })
  const lines: [string, string, string][] = [
    ['天梯起步、三扇门都开', lastCareerLine(hall(card('c1', 'pre', 2026, '2026-09-10')), 2026, all), '上一局你从天梯起步。想换个开头，可以试试 Challengers 二队或 VCT 替补。'],
    ['天梯起步、2026 中国（没有二队）', lastCareerLine(hall(card('c1', 'pre', 2026, '2026-09-10')), 2026, (k) => k !== 'chal'), '上一局你从天梯起步。想换个开头，可以试试 VCT 替补。'],
    ['改写过奖杯', lastCareerLine(hall(rw), 2026, all), '上一局你从天梯起步，世界线改写了 3 座奖杯的归属。想换个开头，可以试试 Challengers 二队或 VCT 替补。'],
    ['2021 强队替补起步，这次看 2021', lastCareerLine(hall(card('c1', 't1', 2021, '2026-09-10')), 2021, all), '上一局你从强队替补起步。想换个开头，可以试试天梯或二线队首发。'],
    ['VCT 替补起步，别的门都不开', lastCareerLine(hall(card('c1', 't1', 2026, '2026-09-10')), 2026, (k) => k === 't1'), '上一局你从 VCT 替补起步。'],
  ]
  for (const [what, got, want] of lines) check(got === want, `${what}：${got}`)
  check(lastCareerLine({ v: 1, ach: {}, cards: [], hx: {} }, 2026, all) === '' && lastCareerLine(null, 2026, all) === '', '殿堂里没有打完的生涯：不写这一行')

  // every year and place the screen offers: never a door its button would refuse
  const sheet = buildStartSheet()
  let named = 0
  let wrong: string[] = []
  const names: Record<HallStart, (y: number) => string> = { pre: () => '天梯', chal: (y) => (y <= 2021 ? '二线队首发' : 'Challengers 二队'), t1: (y) => (y <= 2021 ? '强队替补' : 'VCT 替补') }
  for (const [y, row] of Object.entries(sheet)) {
    const year = Number(y)
    for (const [region, doors] of Object.entries(row.doors)) {
      for (const last of ['pre', 'chal', 't1'] as HallStart[]) {
        const line = lastCareerLine(hall(card('c1', last, 2026, '2026-09-10')), year, (k) => !doors![k].gate)
        const tip = line.split('可以试试')[1] ?? ''
        for (const k of ['pre', 'chal', 't1'] as HallStart[]) {
          if (k === last || !tip.includes(names[k](year))) continue
          named++
          if (doors![k].gate) wrong.push(`${year} ${region} ${k}`)
        }
      }
    }
  }
  wrong = [...new Set(wrong)]
  check(named > 0 && !wrong.length, `每一年、每个地方：提到的 ${named} 处开局没有一处是按钮会拦下的${wrong.length ? `（${wrong.slice(0, 4).join('、')}）` : ''}`)
  const cn = sheet[2026].doors.China!
  check(!!cn.chal.gate && !lastCareerLine(hall(card('c1', 'pre', 2026, '2026-09-10')), 2026, (k) => !cn[k].gate).includes('二队'), '2026 年中国没有二队：这一行不提二队')

  // the hall is words on this screen and nothing else: the career made is the same with a full hall and an empty one
  fresh()
  const make = () => createCareer({ name: 'Same', region: 'China', role: '哨卫', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 77, year: 2026 } as CareerOpts)
  const empty = packState(make())
  store.setItem(HALL_KEY, JSON.stringify(cleanHall({ ...HALL_OLD, cards: [...HALL_OLD.cards, card('c3', 't1', 2021, '2026-09-11', { rw: { n: 9 } })] })))
  const full = packState(make())
  check(empty === full, '殿堂里有卡和一张没有：开出来的生涯逐字节一样（数值不读殿堂）')
}

console.log(`\n用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`)
if (bad) {
  console.log(`✗ 存档备份有 ${bad} 处不对。`)
  process.exit(1)
}
console.log('✓ 存档导出再导入是同一个生涯（存档逐字不差、编号带过去），导入时开着旧存档的页面停下，殿堂只合并不覆盖，坏的、别家的、更新版本的都说清楚且一个字不写，老存档照样升级；开新生涯页那一行只提开得了的门。')
