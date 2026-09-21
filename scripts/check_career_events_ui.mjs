/** Real GameCtx/Week/PendingModal/Poster, synthetic local career, no live saves or network. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/career-events-ui')
mkdirSync(output, { recursive: true })
const compiled = await build({ stdin: { contents: `
  import React,{useReducer} from 'react';import {createRoot} from 'react-dom/client';
  import {GameCtx} from './src/ui/me/ctx';import PendingModal from './src/ui/me/Modals';
  import Week from './src/ui/me/Week';import Poster from './src/ui/me/Poster';
  import {Held,heldNow} from './src/ui/me/hold';
  import {createCareer,emptyTalents} from './src/engine/me/career';
  import {fireEvent} from './src/engine/me/events';
  import './src/ui/me/base.css';import './src/me.css';
  const game=createCareer({name:'本地事件测试',region:'China',role:'先锋',talents:emptyTalents(),originKey:'netcafe',start:'t1',seed:771901,year:2026});
  game.me.pending=[];game.me.moments=[];game.me.pendingEvent=undefined;game.day=50;game.me.week=60;
  game.players[game.me.id].overall=90;
  game.me.seasons=[{year:2025,team:game.myTeam,tier:1,matches:24,starts:24,wins:12,acs:210,overallFrom:87,overallTo:90,titles:[]}];
  game.me.titles=[{year:2025,title:'2025 全球冠军赛',started:true}];
  if(!fireEvent(game,'career_diagnosis'))throw new Error('fixture could not fire diagnosis');
  window.harnessGame=game;window.harnessCommits=0;
  const noop=()=>{};
  function Harness(){
    const[,bump]=useReducer(x=>x+1,0);
    const commit=()=>{window.harnessCommits++;bump()};
    const item=game.me.pending.find(x=>x.kind==='event');
    return <GameCtx.Provider value={{game,commit,toast:noop,openPlayer:noop,openMatch:noop,go:noop,startTutorial:noop}}>
      <div className="app career"><div className="body"><main className="main">
        {game.me.phase==='retired'?<Poster/>:<Week onAdvance={noop} onAdvanceUntil={noop}/>}
      </main></div></div>
      {item&&!heldNow()&&<PendingModal item={item} onDone={bump}/>}
      <Held/>
    </GameCtx.Provider>
  }
  createRoot(document.getElementById('root')).render(<Harness/>);
`, resolveDir: root, loader: 'tsx' }, absWorkingDir: root, bundle: true, write: false, outfile: 'app.js', format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' } })
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
async function noOverflow(page, stage) {
  const layout = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth, dialogs: [...document.querySelectorAll('[role="dialog"]')].map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, inner: el.scrollWidth - el.clientWidth } }) }))
  assert.ok(layout.page <= layout.width + 1, `${stage}: ${JSON.stringify(layout)}`)
  assert.ok(layout.dialogs.every(d => d.left >= -1 && d.right <= layout.width + 1 && d.inner <= 1), `${stage}: ${JSON.stringify(layout)}`)
}
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  for (const width of [320, 390, 1440]) for (const choice of ['safe', 'retire']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [], blocked = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin === origin && req.method() === 'GET') return route.continue()
      blocked.push(url.origin + url.pathname); return route.abort()
    })
    await page.addInitScript(() => {
      indexedDB.open = () => { throw Error('UI harness must not read saved careers') }
      HTMLMediaElement.prototype.play = async function () { this.muted = true }
      localStorage.setItem('val_player.tour.off', '1')
    })
    await page.goto(origin)
    const irreversible = page.getByRole('button', { name: /^以健康为重，宣布医疗退役/ })
    await irreversible.waitFor()
    const before = await page.evaluate(() => JSON.stringify(window.harnessGame))
    await irreversible.click()
    const confirm = page.getByRole('alert', { name: '重大选择确认' })
    await confirm.waitFor()
    assert.equal(await page.evaluate(() => JSON.stringify(window.harnessGame)), before, 'opening confirmation must not change any game state')
    assert.equal(await page.evaluate(() => window.harnessCommits), 0)
    await noOverflow(page, `${width} confirmation`)
    await page.screenshot({ path: resolve(output, `${width}-${choice}-confirmation.png`) })
    await confirm.getByRole('button', { name: '返回重新考虑', exact: true }).click()
    assert.equal(await confirm.count(), 0)
    assert.equal(await page.evaluate(() => JSON.stringify(window.harnessGame)), before, 'cancel must be non-mutating')
    if (choice === 'safe') {
      await page.getByRole('button', { name: /^接受治疗，休养十六周后再回来/ }).click()
      await page.waitForFunction(() => window.harnessGame.me.careerEvents.absence?.reason === 'illness')
      assert.equal(await page.evaluate(() => window.harnessGame.me.phase), 'pro')
      assert.equal(await page.evaluate(() => !!window.harnessGame.finished), false)
      assert.equal(await page.evaluate(() => window.harnessGame.me.careerEvents.medicalRetirement), undefined)
      await page.getByRole('button', { name: '继续', exact: true }).click()
      const status = page.getByRole('status').filter({ hasText: '长期治疗休养' })
      await status.waitFor()
      assert.match(await status.textContent(), /缺席至/)
      await page.getByText('最近的生涯经历', { exact: true }).click()
      const history = page.locator('details[open]').filter({ hasText: '最近的生涯经历' })
      assert.match(await history.textContent(), /长期治疗休养/)
      await noOverflow(page, `${width} leave/history`)
      await status.scrollIntoViewIfNeeded()
      await page.screenshot({ path: resolve(output, `${width}-leave-history.png`) })
    } else {
      await irreversible.click()
      await confirm.getByRole('button', { name: '确认：以健康为重，宣布医疗退役', exact: true }).click()
      await page.waitForFunction(() => window.harnessGame.me.phase === 'retired')
      assert.equal(await page.evaluate(() => window.harnessGame.me.ending.key), 'world')
      assert.equal(await page.evaluate(() => window.harnessGame.me.careerEvents.medicalRetirement.atPeak), true)
      await page.getByRole('button', { name: '继续', exact: true }).click()
      const poster = page.locator('.poster-me')
      await poster.waitFor()
      assert.match(await poster.textContent(), /世界冠军/)
      assert.match(await poster.textContent(), /生涯印记 · 高开低走/)
      await noOverflow(page, `${width} retirement poster`)
      await page.screenshot({ path: resolve(output, `${width}-retirement-poster.png`) })
    }
    assert.deepEqual(errors, [], 'no React/browser exceptions')
    assert.ok(blocked.every(url => new URL(url).origin === origin), 'no external services requested')
    console.log('PASS', width, choice, 'confirmation/cancel, safe choice/retirement, layout, history/mark')
    await page.close()
  }
} finally { await browser?.close(); await new Promise(r => server.close(r)) }
