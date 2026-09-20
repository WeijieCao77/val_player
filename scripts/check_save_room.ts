/**
 * The large career body lives in IndexedDB, outside localStorage's small site
 * quota. This fake implements only the IndexedDB surface saveStore.ts uses, so
 * migration and failure order stay deterministic in Node.
 *
 *   npx tsx scripts/check_save_room.ts
 */
import {
  AUTOSAVE,
  OLD_AUTOSAVE,
  WHERE_KEY,
  forgetSaveStore,
  hasSaveText,
  readSaveText,
  writeSaveText,
  writeSaveTextNow,
} from '../src/engine/me/saveStore'
import { exportBackupFromStored } from '../src/engine/me/backup'
import { readStored } from '../src/engine/me/saveCodec'

class Store {
  private map = new Map<string, string>()
  blockedRemove = new Set<string>()
  constructor(public quota = Infinity) {}
  get length(): number { return this.map.size }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null }
  getItem(k: string): string | null { return this.map.get(k) ?? null }
  setItem(k: string, v: string): void {
    const value = String(v)
    const before = this.map.has(k) ? k.length + this.map.get(k)!.length : 0
    const used = [...this.map].reduce((n, [key, val]) => n + key.length + val.length, 0)
    if (used - before + k.length + value.length > this.quota) throw new Error('QuotaExceededError')
    this.map.set(k, value)
  }
  removeItem(k: string): void {
    if (this.blockedRemove.has(k)) throw new Error('StorageBlocked')
    this.map.delete(k)
  }
  clear(): void { this.map.clear() }
}

type Handler = (() => void) | null

class FakeRequest {
  result: unknown = undefined
  error: unknown = null
  onsuccess: Handler = null
  onerror: Handler = null
}

class FakeTransaction {
  oncomplete: Handler = null
  onerror: Handler = null
  onabort: Handler = null
  constructor(private db: FakeDatabase) {}
  objectStore() {
    return {
      get: () => {
        const req = new FakeRequest()
        queueMicrotask(() => { req.result = this.db.value; req.onsuccess?.() })
        return req
      },
      put: (value: unknown) => {
        const req = new FakeRequest()
        queueMicrotask(() => {
          if (this.db.failWrites) { this.onerror?.(); return }
          this.db.value = String(value)
          this.oncomplete?.()
        })
        return req
      },
      delete: () => {
        const req = new FakeRequest()
        queueMicrotask(() => { this.db.value = null; this.oncomplete?.() })
        return req
      },
    }
  }
}

class FakeDatabase {
  value: string | null = null
  failWrites = false
  hasStore = false
  onclose: Handler = null
  onversionchange: Handler = null
  objectStoreNames = { contains: () => this.hasStore }
  createObjectStore(): object { this.hasStore = true; return {} }
  transaction(): FakeTransaction { return new FakeTransaction(this) }
  close(): void {}
}

class FakeOpenRequest extends FakeRequest {
  declare result: FakeDatabase
  onupgradeneeded: Handler = null
  onblocked: Handler = null
}

class FakeIndexedDB {
  db = new FakeDatabase()
  opened = false
  open(): FakeOpenRequest {
    const req = new FakeOpenRequest()
    queueMicrotask(() => {
      req.result = this.db
      if (!this.opened) { this.opened = true; req.onupgradeneeded?.() }
      req.onsuccess?.()
    })
    return req
  }
}

const G = globalThis as unknown as { localStorage: Storage; indexedDB: IDBFactory }
let store = new Store()
let factory = new FakeIndexedDB()
const fresh = (quota = Infinity) => {
  store = new Store(quota)
  factory = new FakeIndexedDB()
  G.localStorage = store as unknown as Storage
  G.indexedDB = factory as unknown as IDBFactory
  forgetSaveStore()
}

let bad = 0
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}

console.log('一、正文搬进 IndexedDB')
fresh()
store.setItem(AUTOSAVE, '旧进度')
store.setItem(OLD_AUTOSAVE, '更旧的经理命名空间副本')
check(await writeSaveText('新进度'), 'IndexedDB 接住新进度')
check(factory.db.value === '新进度' && store.getItem(AUTOSAVE) === null && store.getItem(OLD_AUTOSAVE) === null && store.getItem(WHERE_KEY) === 'idb',
  '整份读回验证后才移动标记、删除 localStorage 里的两份大正文')
check(hasSaveText() && await readSaveText() === '新进度', '首页同步看得到存档，继续能读出同一份')
check(writeSaveTextNow('切后台时的进度'), '切后台时能把最新快照交给已经打开的 IndexedDB')
await Promise.resolve()
check(await readSaveText() === '切后台时的进度', 'pagehide 的快照确实落进数据库')

console.log('二、刷新、清 localStorage、配额顶满')
forgetSaveStore()
check(hasSaveText() && await readSaveText() === '切后台时的进度', '像刷新后的新页面一样重新打开，存档仍在')
store.clear()
forgetSaveStore()
check(!hasSaveText(), 'localStorage 全清后，首页第一次同步探测还不知道数据库里有存档')
check(await readSaveText() === '切后台时的进度' && hasSaveText() && store.getItem(WHERE_KEY) === 'idb',
  '异步探测从 IndexedDB 找回存档并恢复位置标记')

fresh(AUTOSAVE.length + 100)
store.setItem(AUTOSAVE, '旧'.repeat(100))
check(await writeSaveText('配额满时的新进度'), 'localStorage 满到位置标记也写不下时，IndexedDB 仍能接住')
check(store.getItem(AUTOSAVE) === null && store.getItem(WHERE_KEY) === 'idb' && await readSaveText() === '配额满时的新进度',
  '验证新正文后腾掉旧正文，再写位置标记；新页面不会被旧副本遮住')

fresh(AUTOSAVE.length + 100)
store.setItem(AUTOSAVE, '旧'.repeat(100))
store.blockedRemove.add(AUTOSAVE)
check(!await writeSaveText('不能安全迁移的新进度') && store.getItem(AUTOSAVE) === '旧'.repeat(100) && factory.db.value === null,
  '位置标记写不进、旧正文也删不掉：保留旧档并明确报失败，不把新档误报成已保存')

console.log('三、降级与当前进度导出')
fresh()
factory.db.failWrites = true
check(await writeSaveText('降级存档') && store.getItem(AUTOSAVE) === '降级存档' && store.getItem(WHERE_KEY) === null,
  'IndexedDB 拒绝写入时，原 localStorage 路径照常工作')

const current = JSON.stringify({ year: 2028, day: 182, me: { id: 'me', saveId: 'current-1' }, players: { me: { ign: 'Current' } } })
store.setItem(AUTOSAVE, JSON.stringify({ year: 2026, day: 1, me: { id: 'me' }, players: { me: { ign: 'Old' } } }))
const out = await exportBackupFromStored(current, new Date(2026, 8, 20, 12, 0))
check(out.ok && out.backup.year === 2028 && out.backup.day === 182 && out.backup.ign === 'Current',
  '存档失败时导出的是页面内 2028 D182 的当前进度，不是磁盘上 2026 D1 的旧档')
check(out.ok && await readStored(out.backup.save) === current, '导出的正文和内存快照逐字一致')

if (bad) {
  console.log(`✗ IndexedDB 存档有 ${bad} 处不对。`)
  process.exit(1)
}
console.log('✓ 大存档进入 IndexedDB，刷新和位置标记丢失都能找回；数据库失败会降级，配额失败时能导出当前内存进度。')
