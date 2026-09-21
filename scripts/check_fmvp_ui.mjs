import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), output = resolve(root, '.cache/fmvp-ui')
mkdirSync(output, { recursive: true })
const compiled = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {GameCtx} from './src/ui/me/ctx';
import CareerOverview from './src/ui/me/CareerOverview';import TrophyCase from './src/ui/me/TrophyCase';import Poster from './src/ui/me/Poster';
import {createCareer,emptyTalents} from './src/engine/me/career';import {drawCareerCard} from './src/ui/me/share';
import './src/ui/me/base.css';import './src/me.css';
const game=createCareer({name:'FMVP本地界面测试',region:'China',role:'先锋',talents:emptyTalents(),originKey:'netcafe',start:'t1',seed:741,year:2026});
game.me.titles=[{year:2025,title:'2025 全球冠军赛',started:true,fmvp:true},{year:2026,title:'圣地亚哥大师赛',started:true,fmvp:true},{year:2024,title:'旧档赛区冠军',started:true}];
game.me.ending={key:'world',title:'世界冠军',text:'冠军荣誉保留。',year:2026};game.me.matches=[];
window.harnessGame=game;window.drawFMVP=()=>drawCareerCard(game);
const noop=()=>{};createRoot(document.getElementById('root')).render(<GameCtx.Provider value={{game,commit:noop,toast:noop,openPlayer:noop,openMatch:noop,go:noop,startTutorial:noop}}><div className="app career"><div className="body"><main className="main"><CareerOverview/><TrophyCase/><Poster/></main></div></div></GameCtx.Provider>);
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
  browser = await chromium.launch({ headless: true })
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [], blocked = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', route => { if (new URL(route.request().url()).origin === origin && route.request().method() === 'GET') return route.continue(); blocked.push(route.request().url()); return route.abort() })
    await page.addInitScript(() => { indexedDB.open = () => { throw Error('No real saves') }; HTMLMediaElement.prototype.play = async () => {} })
    await page.goto(origin)
    const overview = page.getByRole('region', { name: '实时生涯总览' })
    await overview.waitFor()
    const fmvp = overview.locator('.stat').filter({ has: page.locator('.k', { hasText: '决赛 MVP（FMVP）' }) }).locator('.v')
    assert.equal(await fmvp.innerText(), '2')
    assert.match(await overview.textContent(), /另有 1 座奖杯/)
    await overview.getByRole('button', { name: '2026 当季', exact: true }).click()
    assert.equal(await fmvp.innerText(), '1')
    assert.equal(await page.locator('.trc-p').filter({ hasText: 'FMVP' }).count(), 2)
    await page.locator('.trc').filter({ hasText: '2025 全球冠军赛' }).click()
    const modal = page.getByRole('dialog', { name: '奖杯', exact: true })
    await modal.waitFor()
    assert.match(await modal.textContent(), /已记入永久生涯荣誉/)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    const bounds = await modal.boundingBox()
    assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1)
    await page.screenshot({ path: resolve(output, `${width}-trophy.png`) })
    await modal.getByRole('button', { name: /关闭/ }).click()
    assert.match(await page.locator('.poster-me').textContent(), /FMVP） · 2 次已确认/)
    const drawn = await page.evaluate(() => {
      const lines = [], original = CanvasRenderingContext2D.prototype.fillText
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { lines.push(String(text)); return original.call(this, text, ...args) }
      const canvas = window.drawFMVP()
      CanvasRenderingContext2D.prototype.fillText = original
      return { lines, width: canvas?.width, height: canvas?.height }
    })
    assert.ok(drawn.lines.includes('冠军 / FMVP') && drawn.lines.includes('3 / 2'))
    assert.equal(drawn.width, 1080); assert.equal(drawn.height, 1620)
    assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
    console.log('PASS FMVP UI', width, 'overview scopes, unknown notice, permanent trophy, poster/canvas agreement, no overflow/network')
    await page.close()
  }
} finally { await browser?.close(); await new Promise(r => server.close(r)) }
