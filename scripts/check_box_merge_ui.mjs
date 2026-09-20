/** Real Mailbox components/CSS, isolated local synthetic API. Never touches production or user saves. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/box-merge-ui')
mkdirSync(output, { recursive: true })
const original = '这是我原先提交的建议，合并后仍然应完整保留。'.repeat(8) + '\n原文末尾 🎮🏆'
const targetText = '合并建议的中文正文。'.repeat(12) + '\nLongUnbrokenEnglishWithoutSpaces'.repeat(8)
  + '\n👨‍👩‍👧‍👦🎮🏆\n<img src=x onerror="window.mergeBad=1"><script>window.mergeBad=2</script>\n最终一行'
const chainedText = '连续合并后的最终目标，不再是第一次的目标。'.repeat(9) + '\nFinalTargetLongEnglishWithoutSpaces'.repeat(5) + '\n🧭'
const ordinaryText = '普通建议仍可以点赞和展开全文。'.repeat(8)
const make = (id, text, extra = {}) => ({ id, text, t: 1758355200000, votes: 0, state: 'merged', pin: 0, mine: true, voted: false, ...extra })
const ordinary = make('ordinary-public', ordinaryText, { votes: 12, state: 'shown', mine: false })
let target, privateExtra, missingExtra, publicExtras
const payload = () => ({ ok: true, max: 200, full: false, items: [ordinary, ...publicExtras], mine: [
  make('merged-public', original, { merge: { availability: 'public', target } }),
  make('merged-private', '私密合并的原建议仍归作者本人可见。', { merge: { availability: 'private', ...privateExtra } }),
  make('merged-missing', '目标删除后，原提交与合并回执仍应保留。', { merge: { availability: 'missing', ...missingExtra } }),
] })
const requests = []
const compiled = await build({
  stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import Mailbox,{MailboxScreen} from './src/ui/me/Mailbox';
    import './src/ui/me/base.css';import './src/me.css';
    const home=new URLSearchParams(location.search).get('place')==='home';
    createRoot(document.getElementById('root')).render(home?<div className="app"><h1>本地合并回执测试</h1><Mailbox/></div>:<div className="app career"><div className="body"><main className="main"><MailboxScreen/></main></div></div>);
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
    if (path.endsWith('/list')) res.end(JSON.stringify(payload()))
    else if (path.endsWith('/vote')) res.end(JSON.stringify({ ok: true, on: body.on, votes: body.on ? 13 : 12 }))
    else { res.writeHead(400); res.end(JSON.stringify({ ok: false, why: 'unexpected mutation' })) }
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
const report = []
let browser
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  for (const width of [320, 390, 1440]) for (const place of ['home', 'career']) {
    target = { id: 'target-first', text: targetText, state: 'shown', votes: 31 }
    privateExtra = undefined; missingExtra = undefined; publicExtras = []
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = [], blocked = [], layouts = [], shots = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin === origin && (req.method() === 'GET' || /^\/api\/box\/(list|vote)$/.test(url.pathname))) return route.continue()
      blocked.push(url.origin + url.pathname); return route.abort()
    })
    await page.addInitScript(() => {
      indexedDB.open = () => { throw Error('Merge UI harness must never read user saves') }
      HTMLMediaElement.prototype.play = async function () { this.muted = true }
    })
    const layoutCheck = async label => {
      const read = await page.locator('.mbx-table').evaluate(el => ({
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
        tableOverflow: el.scrollWidth - el.clientWidth,
        texts: [...el.querySelectorAll('.mbx-fulltext,.mbx-merge,.mbx-detail')].filter(x => x.getClientRects().length).map(x => {
          const r = x.getBoundingClientRect(); return { left: r.left, right: r.right, overflow: x.scrollWidth - x.clientWidth }
        }),
        rows: [...el.querySelectorAll('tbody tr:not(.mbx-detail-row)')].map(row => [...row.cells].map(cell => {
          const r = cell.getBoundingClientRect(); return { left: r.left, right: r.right }
        })),
      }))
      assert.ok(read.pageOverflow <= 1 && read.tableOverflow <= 1, `${label}: ${JSON.stringify(read)}`)
      assert.ok(read.texts.every(x => x.left >= -1 && x.right <= width + 1 && x.overflow <= 1), `${label}: text overflow`)
      assert.ok(read.rows.every(row => row.every((cell, i) => cell.left >= -1 && cell.right <= width + 1 && (!i || cell.left >= row[i - 1].right - 1))), `${label}: overlapping columns`)
      layouts.push({ label, ...read })
    }
    const screenshot = async label => {
      const path = resolve(output, `${width}-${place}-${label}.png`)
      await page.screenshot({ path, animations: 'disabled' }); shots.push(path)
    }
    const readOriginal = async () => {
      const opener = page.locator('.mbx-preview').first()
      await opener.focus(); await page.keyboard.press('Enter')
      const detail = page.getByRole('region', { name: '建议全文', exact: true })
      await detail.waitFor()
      assert.equal(await detail.locator(':scope > .mbx-fulltext').textContent(), original)
      assert.match(await detail.locator('.mbx-detail-meta').first().innerText(), /已合并/)
      return { opener, detail, receipt: detail.getByRole('region', { name: '建议合并回执', exact: true }) }
    }
    const refresh = async () => {
      const before = requests.length
      const response = page.waitForResponse(r => r.url() === `${origin}/api/box/list`)
      await page.getByRole('button', { name: '刷新', exact: true }).click()
      await response; await page.locator('.mbx-preview').first().waitFor()
      assert.equal(requests.length, before + 1)
      assert.ok(requests.at(-1).path.endsWith('/list'))
      assert.equal(await page.getByRole('region', { name: '建议全文', exact: true }).count(), 0)
    }
    await page.goto(`${origin}/?place=${place}`)
    if (place === 'home') await page.getByRole('button', { name: '玩家信箱', exact: true }).click()
    await page.locator('.mbx-preview').first().waitFor()
    assert.equal(await page.locator('.mbx-preview').count(), 1)
    for (const name of ['最热', '最新']) {
      await page.getByRole('tab', { name, exact: true }).click()
      assert.equal(await page.locator('.mbx-preview').count(), 1)
      assert.equal(await page.locator('.mbx-excerpt').textContent(), ordinaryText)
      assert.equal(await page.locator('.mbx-tag.s-merged').count(), 0, `${name}: merged sources are owner-only`)
      assert.ok(!(await page.locator('.mbx-table').innerText()).includes(original))
      assert.ok(!payload().items.some(it => it.id === target.id), 'target lookup must not depend on public board membership')
    }
    const beforeVote = requests.length
    await page.locator('.mbx-vote').click()
    await page.waitForFunction(() => document.querySelector('.mbx-vote')?.textContent?.trim() === '▲ 13')
    assert.equal(requests.length, beforeVote + 1)
    assert.deepEqual(requests.at(-1).body.id, ordinary.id)
    await page.locator('.mbx-preview').click()
    assert.equal(await page.getByRole('region', { name: '建议全文', exact: true }).locator('.mbx-fulltext').textContent(), ordinaryText)
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: /^我的/ }).click()
    assert.equal(await page.locator('.mbx-preview').count(), 3)
    assert.equal(await page.locator('.mbx-vote').count(), 0, 'merged receipts cannot cast a duplicate vote')
    assert.equal(await page.locator('.mbx-tag.s-merged').count(), 3)
    assert.equal(await page.locator('.mbx-excerpt').first().textContent(), original)
    await layoutCheck('mine-list'); await page.locator('.mbx-table').scrollIntoViewIfNeeded(); await screenshot('list')

    const stateNames = { shown: '已展示', taken: '已采纳', fixed: '已修复' }
    for (const state of ['shown', 'taken', 'fixed', 'chained']) {
      if (state !== 'shown') {
        target = state === 'chained' ? { id: 'target-final', text: chainedText, state: 'fixed', votes: 78 }
          : { ...target, state, votes: state === 'taken' ? 44 : 52 }
        await refresh()
      }
      const mark = requests.length
      assert.match(await page.locator('tbody tr:not(.mbx-detail-row)').first().innerText(), new RegExp(`合并后：${stateNames[target.state]}`))
      const { opener, detail, receipt } = await readOriginal()
      await receipt.waitFor()
      assert.match(await receipt.innerText(), new RegExp(`当前处理进度：${stateNames[target.state]}`))
      assert.match(await receipt.innerText(), new RegExp(`${target.votes} 赞`))
      const details = receipt.locator('details'), summary = receipt.locator('summary')
      assert.equal(await details.getAttribute('open'), null)
      await summary.focus(); await page.keyboard.press('Enter')
      assert.equal(await details.evaluate(el => el.open), true)
      assert.equal(await details.locator('.mbx-fulltext').textContent(), target.text)
      assert.equal(await details.locator('.mbx-detail-meta').textContent(), `建议编号 #${target.id}`)
      assert.equal(await detail.locator('script,img').count(), 0)
      assert.equal(await page.evaluate(() => window.mergeBad), undefined)
      if (state === 'chained') assert.ok(!(await receipt.innerText()).includes('target-first'))
      await layoutCheck(state)
      if (state === 'shown' || state === 'chained') { await receipt.scrollIntoViewIfNeeded(); await screenshot(state) }
      await summary.focus(); await page.keyboard.press('Space')
      assert.equal(await details.evaluate(el => el.open), false)
      await page.keyboard.press('Escape')
      assert.equal(await detail.count(), 0)
      assert.equal(await opener.evaluate(el => document.activeElement === el), true)
      assert.equal(requests.length, mark, 'opening target uses receipt data, not an extra POST')
      if (place === 'home') assert.equal(await page.getByRole('dialog', { name: '玩家信箱' }).count(), 1)
    }
    for (const [index, availability, message] of [[1, 'private', '暂未公开'], [2, 'missing', '已移除或暂时不可用']]) {
      assert.equal(payload().mine[index].merge.availability, availability)
      assert.equal(Object.hasOwn(payload().mine[index].merge, 'target'), false, 'private/missing API has no target fields')
      const mark = requests.length
      await page.locator('.mbx-preview').nth(index).click()
      const detail = page.getByRole('region', { name: '建议全文', exact: true })
      const receipt = detail.getByRole('region', { name: '建议合并回执' })
      assert.equal(await detail.locator(':scope > .mbx-fulltext').textContent(), payload().mine[index].text)
      assert.match(await receipt.innerText(), new RegExp(message))
      assert.equal(await receipt.locator('details,summary,a,button').count(), 0)
      assert.equal(await receipt.locator('.mbx-fulltext,.mbx-detail-meta').count(), 0)
      assert.ok(!(await receipt.innerText()).includes(target.id))
      await layoutCheck(availability)
      if (availability === 'private') { await receipt.scrollIntoViewIfNeeded(); await screenshot('private') }
      await page.keyboard.press('Escape')
      assert.equal(requests.length, mark)
    }
    // Defence in depth: even a malformed private response carrying a target must be stripped client-side.
    privateExtra = { target: { id: 'DO_NOT_LEAK_ID', text: 'DO_NOT_LEAK_PRIVATE_TEXT', state: 'shown', votes: 999 } }
    missingExtra = { target: { id: 'DO_NOT_LEAK_DELETED_ID', text: 'DO_NOT_LEAK_DELETED_TEXT', state: 'fixed', votes: 888 } }
    await refresh()
    for (const index of [1, 2]) {
      await page.locator('.mbx-preview').nth(index).click()
      assert.ok(!(await page.locator('.mbx').innerText()).includes('DO_NOT_LEAK'))
      assert.equal(await page.getByRole('region', { name: '建议合并回执' }).locator('details').count(), 0)
      await page.keyboard.press('Escape')
    }
    // Public-board whitelist also defends against accidentally misfiled private records.
    publicExtras = ['merged', 'pending', 'hidden'].map(state => make(`misfiled-${state}`, `DO_NOT_PUBLISH_${state}`, { state, mine: false }))
    await page.getByRole('tab', { name: '最热', exact: true }).click(); await refresh()
    for (const name of ['最热', '最新']) {
      await page.getByRole('tab', { name, exact: true }).click()
      assert.equal(await page.locator('.mbx-vote').count(), 1)
      assert.equal(await page.locator('.mbx-preview').count(), 1)
      assert.ok(!(await page.locator('.mbx-table').innerText()).includes('DO_NOT_PUBLISH'))
    }
    if (place === 'home') {
      await page.keyboard.press('Escape')
      assert.equal(await page.getByRole('dialog', { name: '玩家信箱' }).count(), 0)
      assert.equal(await page.getByRole('button', { name: '玩家信箱', exact: true }).evaluate(el => document.activeElement === el), true)
    }
    assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
    report.push({ width, place, states: ['shown', 'taken', 'fixed', 'chained', 'private', 'missing', 'malformed-private', 'malformed-missing', 'public-whitelist'], layouts, shots, errors, blocked })
    console.log(`PASS ${width}px ${place}: merged receipt, state refresh/chain, private/missing guards, safe text/layout, keyboard/focus, ordinary voting, no extra requests`)
    await page.close()
  }
  assert.ok(requests.every(r => r.path.endsWith('/list') || r.path.endsWith('/vote') && r.body.id === ordinary.id))
  writeFileSync(resolve(output, 'report.json'), JSON.stringify({ cases: report, requests: requests.map(r => ({ path: r.path, id: r.body.id })) }, null, 2))
  console.log(`PASS ${report.length} viewports/surfaces; ${report.reduce((n, c) => n + c.shots.length, 0)} screenshots; ${output}`)
} finally {
  await browser?.close(); await new Promise(r => server.close(r))
}
