/**
 * 信箱审核页的批量操作，真浏览器 390 px 手机宽度走一遍（作者 2026-09-25：「我无法手动操作那么多条
 * 信箱建议的采纳和修改」，而且多半是在手机上看）。
 *
 * 只用临时目录和本机回环 HTTP：box.js 的 handleBoxAdmin 直接挂在一个本地 server 上（钥匙那道门在
 * server.js，check_box.ts 另外钉着），不碰线上数据。
 *
 *  - 140 条（待审核 / 榜上 / 收起来 / 合并回执）铺满，390 px 不横向滚动；动作条固定在页底、按钮够大；
 *    每行的勾选区至少 44×44；拉到底最后一行的按钮不被动作条挡住。
 *  - 手点两条待审核 + 「收起来的」全选本组（手点的不丢）+ 动作条「展示」：一次 POST，回来页顶一行结果，
 *    勾过的都展示了，没勾的一条没动，页面上一个勾都不剩。
 *  - 中途写盘失败：只改成了前两条，页面明说「没有全部保存」，不跳成功页；重放日志和内存一致。
 *  - 页面零脚本（CSP 不许脚本），1440 px 下照样能用。
 *
 *   node scripts/check_box_bulk_ui.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { initBox, handleBoxAdmin, _boxState } from '../box.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shots = path.join(root, '.cache/box-bulk-ui')
fs.mkdirSync(shots, { recursive: true })
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'valbox-bulk-ui-'))
const append = fs.appendFileSync

/* 140 条：40 待审核、80 榜上、17 收起来、3 合并回执 */
const id = (i) => (0xa0000000 + i).toString(16)
const recs = []
for (let i = 0; i < 140; i++) {
  const s = i < 40 ? 'pending' : i < 120 ? (i % 3 === 0 ? 'taken' : i % 5 === 0 ? 'fixed' : 'shown') : i < 137 ? 'hidden' : 'merged'
  const text = i === 41 ? '希望修复文字超出格子的问题，并且让我可以点击建议查看完整的细节。'.repeat(5) : `第 ${i} 条建议：希望能改进一下这个地方的体验`
  recs.push({ o: 'set', id: id(i), t: 1758355200000 + i * 60e3, dev: `dev-${i}`, text, s, p: 0, v: [`dev-${i}`, `fan-${i % 7}`],
    ...(s === 'merged' ? { mergedTo: id(50), mergedAt: 1758400000000 } : {}) })
}
fs.writeFileSync(path.join(tmp, 'box.jsonl'), recs.map((o) => JSON.stringify(o)).join('\n') + '\n')
initBox({ dir: tmp, volatile: false })
const state = () => Object.fromEntries(_boxState().map((it) => [it.id, `${it.state}|${it.pin}|${it.votes.length}|${it.text}`]))

const server = http.createServer((req, res) => {
  if (new URL(req.url, 'http://x').pathname === '/dash/box') void handleBoxAdmin(req, res, '/dash/box')
  else { res.writeHead(404); res.end() }
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`

let browser
const report = []
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${base}/dash/box`)
  assert.equal(await page.locator('script').count(), 0, '审核页零脚本')

  /* ---- 390 px 的样子 ---- */
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth)
  assert.ok(scrollW <= 390, `390 px 不横向滚动（scrollWidth ${scrollW}）`)
  const bar = page.locator('form#bulk')
  const bb = await bar.boundingBox()
  assert.ok(bb && bb.y + bb.height <= 844 + 1 && bb.y > 844 / 2, `动作条固定在页底（y=${bb?.y}, h=${bb?.height}）`)
  assert.ok(bb.height <= 170, `动作条不占掉半屏（${bb.height}px）`)
  for (const b of await bar.locator('button').all()) {
    const r = await b.boundingBox()
    assert.ok(r.height >= 44 && r.width >= 80, `动作条按钮够大（${await b.innerText()} ${r.width}×${r.height}）`)
  }
  const labels = await bar.locator('button').allInnerTexts()
  assert.deepEqual(labels, ['展示', '不展示', '已采纳', '已修复', '置顶', '取消置顶'], '动作条就这六个，没有批量删除')
  const firstPick = page.locator(`tr.s-pending label.pk`).first()
  const pk = await firstPick.boundingBox()
  assert.ok(pk.width >= 44 && pk.height >= 44, `勾选区至少 44×44（${pk.width}×${pk.height}）`)
  assert.equal(await page.locator('tr.s-merged input.pick').count(), 0, '合并回执没有勾选框')
  assert.equal(await page.locator('input.pick').count(), 137, '其余 137 条每条一个勾')
  const dim = async () => bar.locator('button').first().evaluate((el) => getComputedStyle(el).opacity)
  assert.equal(await dim(), '0.45', '一条没勾时动作条按钮是灰的')
  await page.screenshot({ path: path.join(shots, '390-top.png') })
  report.push(`390: 页宽 ${scrollW}，动作条 ${bb.height}px 高，勾选区 ${pk.width}×${pk.height}`)

  /* ---- 手点两条待审核 ---- */
  const before = state()
  const tapIds = [id(0), id(1)]
  for (const x of tapIds) await page.locator(`tr:has(input.pick[value="${x}"]) label.pk`).tap()
  for (const x of tapIds) assert.ok(await page.locator(`input.pick[value="${x}"]`).isChecked(), `点一下就勾上 ${x}`)
  assert.equal(await dim(), '1', '勾了之后动作条按钮亮起来')

  /* ---- 「收起来的」全选本组：刚才手点的不丢 ---- */
  await Promise.all([page.waitForURL(/[?&]sel=away/), page.locator('#g-away button[name="sel"]').tap()])
  const away = recs.filter((r) => r.s === 'hidden').map((r) => r.id)
  for (const x of [...tapIds, ...away]) assert.ok(await page.locator(`input.pick[value="${x}"]`).isChecked(), `全选本组后 ${x} 勾着`)
  assert.equal(await page.locator('input.pick:checked').count(), 2 + away.length, '勾着的正好是手点的两条 + 收起来的一组')
  const inView = await page.locator('#g-away').boundingBox()
  assert.ok(inView && inView.y >= -2 && inView.y < 844, '全选之后页面跳回那一组，不用从头再翻')
  await page.screenshot({ path: path.join(shots, '390-selected.png') })

  /* ---- 「全不选」这一组，再全选回来 ---- */
  await Promise.all([page.waitForURL(/unsel=away/), page.locator('#g-away button[name="unsel"]').tap()])
  assert.equal(await page.locator('input.pick:checked').count(), 2, `全不选只去掉这一组，手点的两条还勾着（${page.url().slice(-60)}）`)
  await Promise.all([page.waitForURL(/[?&]sel=away/), page.locator('#g-away button[name="sel"]').tap()])

  /* ---- 动作条「展示」 ---- */
  await Promise.all([page.waitForURL(/done=/), bar.locator('button[value="shown"]').tap()])
  const banner = await page.locator('.ok').innerText()
  assert.ok(banner.includes(`批量「展示」做完了：改了 ${2 + away.length} 条`), `页顶一行结果：${banner}`)
  assert.equal(await page.locator('input.pick:checked').count(), 0, '做完之后一个勾都不剩')
  const after = state()
  for (const x of [...tapIds, ...away]) assert.ok(after[x].startsWith('shown|'), `${x} 展示了`)
  for (const [x, v] of Object.entries(before)) {
    if (!tapIds.includes(x) && !away.includes(x)) assert.equal(after[x], v, `没勾的 ${x} 一个字没动`)
    else assert.equal(after[x].split('|').slice(1).join('|'), v.split('|').slice(1).join('|'), `${x} 的票数、置顶和正文没变`)
  }
  await page.screenshot({ path: path.join(shots, '390-done.png') })
  report.push(`390: 手点 2 + 全选一组 ${away.length} → 一次「展示」改了 ${2 + away.length} 条`)

  /* ---- 拉到底：最后一行的按钮不被动作条挡住 ---- */
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const lastBtn = await page.locator('tr').last().locator('.acts button').last().boundingBox()
  const barTop = (await bar.boundingBox()).y
  assert.ok(lastBtn.y + lastBtn.height <= barTop, `拉到底最后一行的按钮露在动作条上面（${lastBtn.y + lastBtn.height} ≤ ${barTop}）`)
  await page.screenshot({ path: path.join(shots, '390-bottom.png') })

  /* ---- 中途写不进去：不许装成功 ---- */
  await page.goto(`${base}/dash/box`)
  const failIds = [id(2), id(3), id(4), id(5)]
  for (const x of failIds) await page.locator(`tr:has(input.pick[value="${x}"]) label.pk`).tap()
  let calls = 0
  fs.appendFileSync = (...a) => { if (++calls > 2) throw Object.assign(new Error('disk full (test)'), { code: 'ENOSPC' }); return append(...a) }
  const pre = state()
  const resp = await Promise.all([page.waitForNavigation(), bar.locator('button[value="fixed"]').tap()]).then(([r]) => r)
  fs.appendFileSync = append
  assert.equal(resp.status(), 503, '中途写不进去：503，不是 303 成功页')
  const why = await page.locator('body').innerText()
  assert.ok(why.includes('没有全部保存') && why.includes('前面 2 条已经改好') && why.includes('剩下的 2 条都没有执行'), `说清楚改成了几条：${why.slice(0, 60)}…`)
  const mid = state()
  assert.ok(mid[id(2)].startsWith('fixed|') && mid[id(3)].startsWith('fixed|'), '前两条真的改了')
  assert.equal(mid[id(4)], pre[id(4)], '第三条没改')
  assert.equal(mid[id(5)], pre[id(5)], '第四条没改')
  initBox({ dir: tmp, volatile: false })
  assert.deepEqual(state(), mid, '重放日志：和内存里一模一样（写失败那条没有半截落进去）')
  report.push('390: 第三次写盘失败 → 503「前面 2 条已经改好，剩下的 2 条都没有执行」，重放一致')

  /* ---- 1440 px ---- */
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${base}/dash/box`)
  const wide = await page.locator('form#bulk').boundingBox()
  assert.ok(wide.height <= 80 && wide.y + wide.height <= 901, `1440 下动作条一行（${wide.height}px）`)
  assert.equal(await page.locator('tr.hd').first().isVisible(), true, '1440 下还是原来的表格，表头在')
  await page.screenshot({ path: path.join(shots, '1440.png') })
  assert.deepEqual(errors, [], '页面没有报错')
  await ctx.close()
} finally {
  fs.appendFileSync = append
  await browser?.close()
  server.close()
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* Windows 偶尔占着 */ }
}
for (const r of report) console.log(`  · ${r}`)
console.log('PASS 信箱批量：390 px 能勾、能全选本组（手点的不丢）、一次 POST 改完、结果一行、没勾的不动、写失败不装成功、零脚本')
