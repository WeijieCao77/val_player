import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), output = resolve(root, '.cache/growth-week-ui')
mkdirSync(output, { recursive: true })
const compiled = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {GameCtx} from './src/ui/me/ctx';
import WeeklyGrowth from './src/ui/me/WeeklyGrowth';import QuickAttrs from './src/ui/me/QuickAttrs';import {useNumbers} from './src/ui/me/words';
import {createCareer,emptyTalents} from './src/engine/me/career';import {doAction} from './src/engine/me/week';
import './src/ui/me/base.css';import './src/me.css';
const game=createCareer({name:'成长本地界面测试',region:'China',role:'先锋',talents:emptyTalents(),originKey:'netcafe',start:'pre',seed:741,year:2026});
doAction(game,'aim');game.me.growthWeek.complete=false;window.harnessGame=game;
const noop=()=>{};
function App(){const [open,setOpen]=useState(false),[nums,setNums]=useNumbers();return <GameCtx.Provider value={{game,commit:noop,toast:noop,openPlayer:noop,openMatch:noop,go:noop,startTutorial:noop}}><div className="app career"><div className="pinbar"><div className="pin-list"><span className="chip ap-chip">本周行动<b>剩 {game.me.ap} 点</b></span><span className="pin stamina">体力<b>62</b></span></div><button className="sm ghost attr-toggle" aria-expanded={open} aria-controls="quick-eight-attrs" onClick={()=>setOpen(!open)}>八项属性 {open?'收起':'展开'}</button><button className="sm ghost num-switch" onClick={()=>setNums(!nums)}>数值 {nums?'开':'关'}</button>{open&&<QuickAttrs player={game.players[game.me.id]} nums={nums}/>}</div><div className="body"><main className="main"><WeeklyGrowth/></main></div></div></GameCtx.Provider>};createRoot(document.getElementById('root')).render(<App/>);
` }, absWorkingDir: root, bundle: true, write: false, outfile: 'app.js', format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' } })
const files = new Map(compiled.outputFiles.map(f => [extname(f.path), f.contents]))
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
  if (path === '/') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>'); return }
  if (path === '/app.js' || path === '/app.css') { res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(files.get(extname(path))); return }
  res.writeHead(404); res.end()
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [], blocked = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', route => { if (new URL(route.request().url()).origin === origin && route.request().method() === 'GET') return route.continue(); blocked.push(route.request().url()); return route.abort() })
    await page.goto(origin)
    const toggle = page.getByRole('button', { name: '八项属性 展开', exact: true })
    await toggle.waitFor()
    assert.equal(await page.locator('.quick-attr').count(), 0)
    await toggle.click()
    assert.equal(await page.locator('.quick-attr').count(), 8)
    assert.doesNotMatch(await page.locator('.quick-eight').innerText(), /\d/)
    await page.locator('.weekly-growth > summary').click()
    assert.equal(await page.locator('.growth-cell').count(), 8)
    assert.match(await page.locator('.weekly-growth').innerText(), /旧档从本次开始记录，不代表整周/)
    assert.doesNotMatch(await page.locator('.growth-eight').innerText(), /\d/)
    assert.equal(await page.locator('.growth-eight progress').count(), 0, 'words mode hides numeric progress')
    // 2026-09-24「训练之后周增长是看得出来变化，可实际数值不变」: a bar that has not filled says the number did not move
    assert.match(await page.locator('.growth-eight').innerText(), /属性未变/)
    assert.match(await page.locator('.growth-eight').innerText(), /进度在涨，还没满一点/)
    assert.doesNotMatch(await page.locator('.growth-eight').innerText(), /有所成长/)
    assert.match(await page.locator('.weekly-growth > summary').innerText(), /属性都没变，.*在攒进度/)
    await page.getByRole('button', { name: '数值 关', exact: true }).click()
    assert.match(await page.locator('.quick-eight').innerText(), /\d/)
    assert.match(await page.locator('.growth-eight').innerText(), /本周进度 \+\d+（满 100 升一点）/)
    assert.doesNotMatch(await page.locator('.growth-eight').innerText(), /净增/)
    assert.equal(await page.locator('.growth-eight progress').count(), 8)
    assert.match(await page.locator('.growth-eight').innerText(), /下一点 .* \/ 100/)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no page overflow')
    for (const cell of await page.locator('.quick-attr, .growth-cell').all()) {
      const b = await cell.boundingBox(); assert.ok(b.x >= -1 && b.x + b.width <= width + 1)
    }
    await page.screenshot({ path: resolve(output, `${width}-expanded.png`) })
    await page.getByRole('button', { name: '八项属性 收起', exact: true }).click()
    assert.equal(await page.locator('.quick-attr').count(), 0)
    assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
    console.log('PASS growth UI', width, 'eight attrs, collapse, number preference, legacy label, no overflow/network')
    await page.close()
  }
} finally { await browser?.close(); await new Promise(r => server.close(r)) }
