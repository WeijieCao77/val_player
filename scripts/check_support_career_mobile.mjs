/** Real Support + Changelog and production CSS, synthetic home/career shells only. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/support-career-mobile')
mkdirSync(output, { recursive: true })
const compiled = await build({
  stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import Support from './src/ui/me/Support';import Changelog from './src/ui/me/Changelog';
    import './src/ui/me/base.css';import './src/me.css';
    const career=new URLSearchParams(location.search).get('place')==='career';
    createRoot(document.getElementById('root')).render(<div className={career?'app career':'app'}>
      <div className="body">{career&&<nav className="nav" aria-label="本地生涯底栏">{['总览','我的·生涯','训练','赛事','更多'].map(label=><div className="nav-bar" key={label}><button className="nav-item">{label}</button></div>)}</nav>}
        <main className="main"><h1>{career?'本地生涯页面':'本地首页'}</h1><p>仅用于角落入口的排版回归，不读取用户存档。</p></main></div>
      <Changelog/><Support career={career}/>
    </div>);
  `, resolveDir: root, loader: 'tsx' },
  absWorkingDir: root, bundle: true, write: false, outfile: 'app.js', platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' },
})
const files = new Map(compiled.outputFiles.map(f => [extname(f.path), f.contents]))
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
  if (path === '/') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html); return }
  if (path === '/app.js' || path === '/app.css') {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(files.get(extname(path))); return
  }
  res.writeHead(404); res.end()
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
const noOverlap = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
let browser
const report = []
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  for (const width of [320, 390, 1440]) for (const place of ['home', 'career']) for (const hidden of ['none', 'current', 'legacy']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = [], blocked = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin === origin && req.method() === 'GET') return route.continue()
      blocked.push(url.origin + url.pathname); return route.abort()
    })
    await page.addInitScript(hidden => {
      if (hidden !== 'none') localStorage.setItem(hidden === 'current' ? 'valplayer.support.hidden' : 'valmgr.support.hidden', '1')
      indexedDB.open = () => { throw Error('No user saves in this harness') }
      HTMLMediaElement.prototype.play = async function () { this.muted = true }
    }, hidden)
    await page.goto(`${origin}/?place=${place}`)
    const log = page.getByRole('button', { name: '更新日志', exact: true })
    await log.waitFor()
    const support = page.getByRole('button', { name: '支持作者', exact: true })
    assert.equal(await page.getByRole('dialog').count(), 0, 'support never opens automatically')
    const shown = place === 'career' || hidden === 'none'
    assert.equal(await support.count(), shown ? 1 : 0, `${width}/${place}/${hidden} visibility`)
    const rect = async locator => locator.evaluate(el => {
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, unobscured: hit === el || el.contains(hit) }
    })
    const bounds = { log: await rect(log) }
    if (shown) {
      assert.equal(await support.getAttribute('aria-label'), '支持作者', 'icon-only entry needs an explicit accessible name')
      bounds.support = await rect(support)
      assert.ok(noOverlap(bounds.log, bounds.support), JSON.stringify(bounds))
      assert.ok(bounds.support.unobscured && bounds.log.unobscured)
      assert.ok([bounds.log, bounds.support].every(r => r.left >= 0 && r.right <= width && r.top >= 0 && r.bottom <= 900))
      if (place === 'career' && width <= 720) {
        bounds.dock = await rect(page.getByRole('navigation', { name: '本地生涯底栏' }))
        assert.ok(noOverlap(bounds.support, bounds.dock) && noOverlap(bounds.log, bounds.dock), 'both entries clear the real CSS bottom dock')
      }
      await page.screenshot({ path: resolve(output, `${width}-${place}-${hidden}-closed.png`), animations: 'disabled' })
      await support.focus(); await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: '支持作者', exact: true })
      await dialog.waitFor()
      assert.equal(await page.getByRole('dialog').count(), 1, 'only support opens')
      assert.equal(await dialog.getByRole('link', { name: '打开爱发电 ↗' }).getAttribute('href'), 'https://ifdian.net/a/pighome')
      assert.equal(await dialog.getByRole('img', { name: '爱发电赞助页二维码' }).count(), 1)
      const fit = await dialog.evaluate(el => ({ overflow: el.scrollWidth - el.clientWidth, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right }))
      assert.ok(fit.overflow <= 1 && fit.left >= 0 && fit.right <= width, JSON.stringify(fit))
      if (hidden === 'none') await page.screenshot({ path: resolve(output, `${width}-${place}-open.png`), animations: 'disabled' })
      await page.keyboard.press('Escape')
      assert.equal(await dialog.count(), 0); assert.equal(await support.count(), 1)
      await support.click(); await dialog.getByRole('button', { name: '关闭 ✕' }).click()
      assert.equal(await dialog.count(), 0); assert.equal(await support.count(), 1)
      const hiddenBefore = await page.evaluate(() => localStorage.getItem('valplayer.support.hidden'))
      await support.click(); await dialog.getByRole('button', { name: place === 'career' ? '收起支持面板' : '不用了，别再提示', exact: true }).click()
      assert.equal(await dialog.count(), 0)
      assert.equal(await support.count(), place === 'career' ? 1 : 0, 'dismiss retains a voluntary career entry only')
      assert.equal(await page.evaluate(() => localStorage.getItem('valplayer.support.hidden')), place === 'career' ? hiddenBefore : '1', 'career close does not rewrite homepage dismissal preference')
    }
    await log.click()
    await page.getByRole('dialog', { name: '更新日志', exact: true }).waitFor()
    assert.equal(await page.getByRole('dialog', { name: '支持作者', exact: true }).count(), 0)
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
    report.push({ width, place, hidden, ...bounds, blockedRequests: blocked })
    console.log(`PASS ${width}px ${place} hidden=${hidden}: independent support/log entry, dock clearance, local-only link inspection, close/dismiss semantics`)
    await page.close()
  }
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
} finally {
  await browser?.close(); await new Promise(r => server.close(r))
}
