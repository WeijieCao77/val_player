/** Real Chromium IndexedDB, two same-origin pages and controlled async gates.
 * No careers are simulated, no production requests, and no generated files.
 * npx tsx scripts/check_save_idb_tabs.ts
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { build } from 'esbuild'
import { chromium, type Page } from 'playwright'

const built = await build({
  stdin: { contents: `import * as save from './src/engine/me/save'; import * as store from './src/engine/me/saveStore'; window.audit = {save,store};`, resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent', define: { 'import.meta.env': '{}' },
})
const bundle = built.outputFiles[0].text
const server = http.createServer((req, res) => {
  res.setHeader('content-type', req.url === '/bundle.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8')
  res.end(req.url === '/bundle.js' ? bundle : '<script src="/bundle.js"></script>')
})
await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
const port = (server.address() as import('node:net').AddressInfo).port
const browser = await chromium.launch({ headless: true })
const K = 'val_player:save:autosave:owner'

const make = (label: string) => ({ year: 2026, day: label === 'A' ? 1 : 2, fixtures: [], players: {}, me: { saveId: label }, label })
async function begin(p: Page, label: string) {
  await p.evaluate(s => { const w = window as any; w.state = s; w.audit.save.claimAutosave(s); w.audit.save.autosave(s); w.done = w.audit.save.flushAutosave() }, make(label))
}
async function finish(p: Page) { await p.evaluate(() => (window as any).done) }
async function result(p: Page) {
  return p.evaluate(async k => {
    const w = window as any
    const raw = await w.audit.store.readSaveText()
    return { label: raw && JSON.parse(await w.audit.save.readStored(raw)).label, owner: JSON.parse(localStorage.getItem(k)!).career }
  }, K)
}
async function pages() {
  const context = await browser.newContext()
  await context.addInitScript(() => { (window as any).__name = (f: unknown) => f; (window as any).CompressionStream = undefined })
  const a = await context.newPage(), b = await context.newPage()
  a.on('pageerror', e => console.error(e.message)); b.on('pageerror', e => console.error(e.message))
  await Promise.all([a.goto(`http://127.0.0.1:${port}`), b.goto(`http://127.0.0.1:${port}`)])
  return { context, a, b }
}
// Hold a genuine database transaction open by issuing another request from each
// request callback. Other pages' transactions must queue behind this one.
async function block(p: Page) {
  await p.evaluate(async () => {
    const w = window as any
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('val_player', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const tx = db.transaction('save', 'readwrite')
    w.blocked = true
    w.unblocked = new Promise<void>(r => { tx.oncomplete = () => { db.close(); r() } })
    const step = () => { const r = tx.objectStore('save').get('autosave'); r.onsuccess = () => { if (w.blocked) step() } }
    step()
  })
}
async function unblock(p: Page) { await p.evaluate(() => { const w = window as any; w.blocked = false; return w.unblocked }) }

try {
  {
    const { context, a, b } = await pages()
    await a.evaluate(() => {
      const w = window as any
      const real = indexedDB.open.bind(indexedDB)
      indexedDB.open = ((...args: Parameters<IDBFactory['open']>) => {
        const req = real(...args)
        let success: any
        Object.defineProperty(req, 'onsuccess', { set(f) { success = f }, get() { return success } })
        req.addEventListener('success', e => { w.releaseOpen = () => success.call(req, e) })
        return req
      }) as IDBFactory['open']
    })
    await begin(a, 'A')
    await a.waitForFunction(() => !!(window as any).releaseOpen)
    await begin(b, 'B'); await finish(b)
    await a.evaluate(() => (window as any).releaseOpen()); await finish(a)
    assert.deepEqual(await result(b), { label: 'B', owner: 'B' })
    assert.equal(await a.evaluate(() => (window as any).audit.save.saveLost()), true)
    await context.close()
    console.log('✓ Delayed DB opening cannot overwrite a newer career or reclaim OWNER')
  }
  {
    const { context, a, b } = await pages()
    await begin(a, 'A'); await finish(a)
    await block(b)
    await begin(a, 'A')
    await begin(b, 'B')
    await unblock(b); await Promise.all([finish(a), finish(b)])
    assert.deepEqual(await result(b), { label: 'B', owner: 'B' })
    await context.close()
    console.log('✓ Queued old transaction checks ownership after acquiring the store')
  }
  {
    const { context, a, b } = await pages()
    await begin(a, 'A'); await finish(a)
    await a.evaluate(() => {
      const w = window as any
      const real = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
        IDBObjectStore.prototype.put = real
        const req = real.apply(this, args)
        const store = this
        w.putHeld = true
        const step = () => { const r = store.get('autosave'); r.onsuccess = () => { if (w.putHeld) step() } }
        step()
        return req
      }
    })
    await begin(a, 'A'); await a.waitForFunction(() => !!(window as any).putHeld)
    await begin(b, 'B')
    await a.evaluate(() => { (window as any).putHeld = false })
    await Promise.all([finish(a), finish(b)])
    assert.deepEqual(await result(b), { label: 'B', owner: 'B' })
    await context.close()
    console.log('✓ Claim during an already-written transaction prevents stale metadata and cleanup')
  }
  {
    const { context, a, b } = await pages()
    await begin(a, 'A'); await finish(a)
    await block(b)
    await a.evaluate(() => {
      const w = window as any
      w.audit.save.autosave(w.state)
      w.audit.save.flushAutosaveNow()
      w.done = w.audit.save.flushAutosave()
    })
    await begin(b, 'B')
    await unblock(b); await Promise.all([finish(a), finish(b)])
    assert.deepEqual(await result(b), { label: 'B', owner: 'B' })
    await context.close()
    console.log('✓ pagehide queued writes cannot overwrite another tab or claim a premature success')
  }
  {
    const { context, a, b } = await pages()
    await begin(b, 'B'); await finish(b)
    await block(b)
    await a.evaluate(s => { const w = window as any; w.done = w.audit.save.installSave(JSON.stringify(s), s) }, make('A'))
    await a.waitForFunction(k => JSON.parse(localStorage.getItem(k)!).career === 'A', K)
    await begin(b, 'B')
    await unblock(b); await Promise.all([finish(a), finish(b)])
    assert.deepEqual(await result(b), { label: 'B', owner: 'B' })
    assert.equal(await a.evaluate(() => (window as any).done), false)
    await context.close()
    console.log('✓ Interrupted import cannot restore the previous OWNER over a newer claim')
  }
  {
    const { context, a, b } = await pages()
    await begin(a, 'A'); await finish(a)
    await block(b)
    await a.evaluate(() => {
      const w = window as any
      w.audit.save.autosave({ ...w.state, label: 'old queued snapshot' })
      w.audit.save.autosave({ ...w.state, label: 'newest snapshot' })
      w.ownerBeforeHide = localStorage.getItem('val_player:save:autosave:owner')
      w.audit.save.flushAutosaveNow()
      w.done = w.audit.save.flushAutosave()
    })
    assert.equal(await a.evaluate(k => localStorage.getItem(k) === (window as any).ownerBeforeHide, K), true,
      'Handing a write to IDB is not a committed save')
    await unblock(b); await finish(a)
    assert.deepEqual(await result(a), { label: 'newest snapshot', owner: 'A' })
    assert.equal(await a.evaluate(() => (window as any).audit.save.saveLost()), false)
    await context.close()
    console.log('✓ pagehide/drain keep the newest snapshot and settle only after commit')
  }
  {
    const { context, a, b } = await pages()
    await begin(a, 'A'); await finish(a)
    await block(b)
    await a.evaluate(() => {
      const w = window as any
      w.audit.save.autosave({ ...w.state, label: 'before reopening' })
      w.audit.save.claimAutosave(w.state)
      w.audit.save.autosave({ ...w.state, label: 'same career reopened' })
      w.done = w.audit.save.flushAutosave()
    })
    await unblock(b); await finish(a)
    assert.deepEqual(await result(a), { label: 'same career reopened', owner: 'A' })
    assert.equal(await a.evaluate(() => (window as any).audit.save.saveLost()), false)
    await context.close()
    console.log('✓ Reopening the same career in one page invalidates its earlier queued write')
  }
  {
    const { context, a, b } = await pages()
    await begin(a, 'A'); await finish(a)
    await block(b)
    await a.evaluate(() => {
      const w = window as any
      const one = { ...w.state, label: 'first import' }, two = { ...w.state, label: 'second import' }
      w.first = w.audit.save.installSave(JSON.stringify(one), one)
      w.second = w.audit.save.installSave(JSON.stringify(two), two)
      w.done = Promise.all([w.first, w.second])
    })
    await unblock(b)
    assert.deepEqual(await a.evaluate(() => (window as any).done), [false, true])
    assert.deepEqual(await result(a), { label: 'second import', owner: 'A' })
    await context.close()
    console.log('✓ Same-career overlapping imports retain the newer claim and imported body')
  }
} finally {
  await browser.close()
  await new Promise<void>(r => server.close(() => r()))
}
