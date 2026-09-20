/** Real shared Mailbox/Board, production CSS, local fixture API only. No live feedback or saves. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/mailbox-mobile')
mkdirSync(output, { recursive: true })
const texts = [
  '希望修复文字超出格子的问题，并且让我可以点击建议查看完整的细节。'.repeat(6),
  'LongUnbrokenEnglishWithoutAnySpaces'.repeat(6),
  '第一段：中文与 emoji 👨‍👩‍👧‍👦🎮🏆\n\n第二段：保留换行。\n<img src=x onerror="window.bad=1"><script>window.bad=2</script>\n最后一行。'.repeat(2),
  '短建议也可以打开。',
]
const make = (id, text, extra = {}) => ({ id, text, t: 1758355200000, votes: 12, state: 'shown', pin: 0, mine: false, voted: false, ...extra })
const items = texts.map((text, i) => make(`item-${i}`, text, i === 0 ? { pin: 1, state: 'taken' } : i === 3 ? { state: 'fixed', votes: 123456 } : {}))
const mine = [make('mine-pending', '自己的待审核建议。'.repeat(20), { mine: true, state: 'pending', voted: true, votes: 1 }), make('mine-hidden', '自己的未展示建议。', { mine: true, state: 'hidden', voted: true, votes: 1 })]
const requests = []
const compiled = await build({
  stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import Mailbox,{MailboxScreen} from './src/ui/me/Mailbox';
    import './src/ui/me/base.css';import './src/me.css';
    const home=new URLSearchParams(location.search).get('place')==='home';
    createRoot(document.getElementById('root')).render(home?<div className="app"><h1>本地首页测试</h1><Mailbox/></div>:<div className="app career"><div className="body"><main className="main"><MailboxScreen/></main></div></div>);
  `, resolveDir: root, loader: 'tsx' },
  absWorkingDir: root, bundle: true, write: false, outfile: 'app.js', platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' },
})
const files = new Map(compiled.outputFiles.map(f => [extname(f.path), f.contents]))
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if (req.method === 'POST' && path.startsWith('/api/box/')) {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw); requests.push({ path, body })
    res.setHeader('Content-Type', 'application/json')
    if (path.endsWith('/list')) res.end(JSON.stringify({ ok: true, items, mine, max: 200, full: false }))
    else if (path.endsWith('/vote')) res.end(JSON.stringify({ ok: true, on: body.on, votes: body.on ? 13 : 12 }))
    else if (path.endsWith('/new')) res.end(JSON.stringify({ ok: true, item: make('sent-new', body.text, { mine: true, state: 'pending', votes: 1, voted: true }) }))
    else { res.writeHead(404); res.end() }
    return
  }
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
  if (path === '/') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html); return }
  if (path === '/app.js' || path === '/app.css') {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(files.get(extname(path))); return
  }
  res.writeHead(404); res.end()
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
const report = []
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  for (const width of [320, 390, 1440]) for (const place of ['home', 'career']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = [], blocked = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin === origin && (req.method() === 'GET' || /^\/api\/box\/(list|vote|new)$/.test(url.pathname))) return route.continue()
      blocked.push(url.origin + url.pathname); return route.abort()
    })
    await page.addInitScript(() => {
      indexedDB.open = () => { throw Error('Mailbox harness must never read user saves') }
      HTMLMediaElement.prototype.play = async function () { this.muted = true }
    })
    await page.goto(`${origin}/?place=${place}`)
    if (place === 'home') await page.getByRole('button', { name: '玩家信箱', exact: true }).click()
    await page.locator('.mbx-preview').first().waitFor()
    assert.equal(await page.locator('.mbx-preview').count(), 4)
    const layout = await page.locator('.mbx-table').evaluate(el => ({
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      tableOverflow: el.scrollWidth - el.clientWidth,
      excerpts: [...el.querySelectorAll('.mbx-excerpt')].map(x => ({ height: x.clientHeight, scrollHeight: x.scrollHeight, clamp: getComputedStyle(x).webkitLineClamp, overflow: getComputedStyle(x).overflow })),
      rows: [...el.querySelectorAll('tbody tr')].map(row => [...row.cells].map(cell => {
        const r = cell.getBoundingClientRect(); return { left: r.left, right: r.right }
      })),
    }))
    assert.ok(layout.pageOverflow <= 1 && layout.tableOverflow <= 1, JSON.stringify(layout))
    assert.ok(layout.excerpts.slice(0, 3).every(x => x.clamp === '2' && x.overflow === 'hidden'))
    assert.ok(layout.excerpts.slice(0, 2).some(x => x.scrollHeight > x.height), 'long list text must be visually truncated')
    assert.ok(layout.rows.every(row => row.every((cell, i) => cell.left >= -1 && cell.right <= width + 1 && (!i || cell.left >= row[i - 1].right - 1))))
    await page.locator('.mbx-table').scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve(output, `${width}-${place}-list.png`), animations: 'disabled' })
    // Voting is a distinct control: never open details or steal the submit action.
    const beforeVotes = requests.filter(r => r.path.endsWith('/vote')).length
    await page.locator('.mbx-vote').first().click()
    await page.waitForFunction(() => document.querySelector('.mbx-vote')?.textContent?.trim() === '▲ 13')
    assert.equal(await page.getByRole('region', { name: '建议全文' }).count(), 0)
    assert.equal(requests.filter(r => r.path.endsWith('/vote')).length, beforeVotes + 1)
    for (let i = 0; i < texts.length; i++) {
      const opener = page.locator('.mbx-preview').nth(i)
      await opener.focus(); await page.keyboard.press('Enter')
      const detail = page.getByRole('region', { name: '建议全文' })
      await detail.waitFor()
      assert.equal(await detail.locator('.mbx-fulltext').textContent(), texts[i])
      assert.equal(await detail.locator('img,script').count(), 0, 'hostile markup stays text')
      assert.equal(await page.evaluate(() => window.bad), undefined)
      assert.equal(await opener.getAttribute('aria-expanded'), 'true')
      const full = await detail.locator('.mbx-fulltext').evaluate(el => {
        const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, overflow: el.scrollWidth - el.clientWidth, whiteSpace: getComputedStyle(el).whiteSpace }
      })
      assert.ok(full.left >= -1 && full.right <= width + 1 && full.overflow <= 1, JSON.stringify(full))
      assert.equal(full.whiteSpace, 'pre-wrap')
      if (i === 2) {
        await detail.scrollIntoViewIfNeeded()
        await page.screenshot({ path: resolve(output, `${width}-${place}-detail.png`), animations: 'disabled' })
      }
      if (i % 2) await detail.getByRole('button', { name: '收起全文 ✕' }).click()
      else await page.keyboard.press('Escape')
      assert.equal(await detail.count(), 0)
      assert.equal(await opener.evaluate(el => el === document.activeElement), true, 'close returns focus to entry')
      if (place === 'home') assert.equal(await page.getByRole('dialog', { name: '玩家信箱' }).count(), 1, 'Escape closes disclosure, not enclosing mailbox')
    }
    await page.getByRole('tab', { name: /^我的/ }).click()
    assert.equal(await page.locator('.mbx-vote:disabled').count(), 2)
    await page.locator('.mbx-preview').first().click()
    assert.match(await page.getByRole('region', { name: '建议全文' }).locator('.mbx-detail-meta').innerText(), /待审核/)
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: '最新', exact: true }).click()
    assert.equal(await page.locator('.mbx-preview').count(), 4)
    await page.locator('.mbx-preview').first().click()
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    await page.locator('.mbx-preview').first().waitFor()
    assert.equal(await page.getByRole('region', { name: '建议全文' }).count(), 0, 'refresh folds old details')
    assert.equal(await page.getByRole('button', { name: '刷新', exact: true }).evaluate(el => el === document.activeElement), true)
    await page.locator('.mbx-preview').first().click()
    await page.getByRole('button', { name: '收起全文 ✕' }).click()
    assert.equal(await page.locator('.mbx-preview').first().evaluate(el => el === document.activeElement), true, 'refresh uses the new entry for focus restoration')
    await page.locator('.mbx-preview').first().click()
    await page.getByLabel('想让游戏变成什么样？一条说一件事').fill('这是本地测试提交，不应外发。')
    await page.getByRole('button', { name: '发给作者', exact: true }).click()
    await page.getByText('收到了。作者看过之后才会展示到榜上', { exact: false }).waitFor()
    assert.equal(await page.locator('.mbx-preview').count(), 3)
    assert.equal(await page.locator('.mbx-vote:disabled').count(), 3)
    assert.equal(await page.getByRole('region', { name: '建议全文' }).count(), 0, 'send folds previous tab details')
    if (place === 'home') { await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog', { name: '玩家信箱' }).count(), 0) }
    assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
    report.push({ width, place, ...layout, blockedRequests: blocked })
    console.log(`PASS ${width}px ${place}: clamped list, full Chinese/English/newline/emoji/safe text, keyboard/refocus, isolated vote, own states, send/refresh`)
    await page.close()
  }
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
} finally {
  await browser?.close(); await new Promise(r => server.close(r))
}
