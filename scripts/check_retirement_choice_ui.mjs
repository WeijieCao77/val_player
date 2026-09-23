import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/retirement-choice-ui')
mkdirSync(output, { recursive: true })
const compiled = await build({
  stdin: { contents: `
    import React,{useReducer} from 'react';import {createRoot} from 'react-dom/client';
    import {GameCtx} from './src/ui/me/ctx';import PendingModal from './src/ui/me/Modals';
    import Week from './src/ui/me/Week';import Poster from './src/ui/me/Poster';
    import {WORLD_END} from './src/engine/era';window.harnessWorldEnd=WORLD_END;
    import {Held,heldNow} from './src/ui/me/hold';
    import {createCareer,emptyTalents} from './src/engine/me/career';
    import './src/ui/me/base.css';import './src/me.css';
    const game=createCareer({name:'退役选择测试',region:'China',role:'先锋',talents:emptyTalents(),originKey:'netcafe',start:'t1',seed:771901,year:2026});
    game.me.pending=[];game.me.moments=[];game.me.pendingEvent=undefined;game.day=50;game.me.week=60;
    game.players[game.me.id].overall=90;game.players[game.me.id].age=31;
    game.me.seasons=[{year:2025,team:game.myTeam,tier:1,matches:24,starts:24,wins:12,acs:210,overallFrom:87,overallTo:90,titles:[]}];
    game.me.titles=[{year:2025,title:'2025 全球冠军赛',started:true}];
    game.me.retireAsk=true;
    game.me.pending.push({kind:'season',id:String(game.year),day:game.day});
    window.harnessGame=game;window.harnessCommits=0;
    const noop=()=>{};
    function Harness(){
      const[,bump]=useReducer(x=>x+1,0);
      const commit=()=>{window.harnessCommits++;bump()};
      const item=game.me.pending[0];
      return <GameCtx.Provider value={{game,commit,toast:noop,openPlayer:noop,openMatch:noop,go:noop,startTutorial:noop}}>
        <div className="app career"><div className="body"><main className="main">
          {game.me.phase==='retired'?<Poster/>:<Week onAdvance={noop} onAdvanceUntil={noop}/>}
        </main></div></div>
        {item&&!heldNow()&&<PendingModal item={item} onDone={bump}/>}
        <Held/>
      </GameCtx.Provider>
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  `, resolveDir: root, loader: 'tsx' },
  absWorkingDir: root,
  bundle: true,
  write: false,
  outfile: 'app.js',
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' }
})
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
  for (const width of [320, 390, 1440]) {
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

    const seasonModal = page.getByRole('dialog')
    await seasonModal.waitFor()

    // 初始详情折叠，不显示生涯结束条件内容
    const details = seasonModal.locator('details')
    assert.equal(await details.count(), 1, 'details should exist')
    assert.equal(await details.locator('summary').isVisible(), true, 'summary visible')
    assert.equal(await details.locator('p').isVisible(), false, 'details content initially hidden')

    // 打开详情，应显示 WORLD_END-1 和实际年龄
    await details.locator('summary').click()
    const detailsText = await details.textContent()
    assert.ok(detailsText.includes(`世界线到 ${await page.evaluate(() => window.harnessWorldEnd - 1)} 赛季`), 'actual world horizon')
    assert.match(detailsText, /31 岁/, 'horizon line should mention actual age')

    await noOverflow(page, `${width} expanded conditions`)
    // 退役面板存在，初始为折叠状态「退役…」按钮
    const retirePanel = seasonModal.locator('.panel.alert')
    await retirePanel.waitFor()
    const retireButton = retirePanel.getByRole('button', { name: '退役…' })
    await retireButton.waitFor()
    const before = await page.evaluate(() => JSON.stringify(window.harnessGame))
    // 点击初始退役按钮，应显示确认退役和再想想，不改变 game state
    await retireButton.click()
    const confirmRetireButton = retirePanel.getByRole('button', { name: '确认退役' })
    await confirmRetireButton.waitFor()
    const thinkAgainButton = retirePanel.getByRole('button', { name: '再想想' })
    await thinkAgainButton.waitFor()
    assert.equal(await page.evaluate(() => JSON.stringify(window.harnessGame)), before, 'opening confirm should not mutate game')
    assert.equal(await page.evaluate(() => window.harnessCommits), 0, 'no commit on opening')

    // 点击「再想想」应回到初始，无变化
    await thinkAgainButton.click()
    await retireButton.waitFor()
    assert.equal(await page.evaluate(() => JSON.stringify(window.harnessGame)), before, 'cancel should not mutate')

    // 再次打开并确认退役
    await retireButton.click()
    await confirmRetireButton.waitFor()
    await noOverflow(page, `${width} confirmation`)
    await page.screenshot({ path: resolve(output, `${width}-confirmation.png`) })
    await confirmRetireButton.click()
    await page.waitForFunction(() => window.harnessGame.me.phase === 'retired')
    assert.equal(await page.evaluate(() => window.harnessCommits), 1, 'commit should be called once on confirm')
    // 确认后不应有 season pending，ending pending 存在
    assert.equal(await page.evaluate(() => window.harnessGame.me.pending.some(x => x.kind === 'season')), false, 'season pending removed')
    assert.equal(await page.evaluate(() => window.harnessGame.me.pending.some(x => x.kind === 'ending')), true, 'ending pending added')
    // 检查没有重复 pending（同 kind 同 id）
    const pendingKinds = await page.evaluate(() => window.harnessGame.me.pending.map(x => x.kind + ':' + x.id))
    assert.equal(new Set(pendingKinds).size, pendingKinds.length, 'no duplicates')
    // 确认结束后显示 Poster
    const poster = page.locator('.poster-me')
    await poster.waitFor()
    assert.match(await poster.textContent(), /世界冠军/, 'ending should be world champion')

    // 截图：320 宽度确认退役后的画面
    if (width === 320) {
      await page.screenshot({ path: resolve(output, '320-ending.png') })
    }

    // 关闭页面
    await page.close()

    // 测试「下一年」流程不会退役
    const page2 = await browser.newPage({ viewport: { width, height: 900 } })
    const errors2 = [], blocked2 = []
    page2.on('pageerror', e => errors2.push(e.message))
    await page2.route('**/*', route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin === origin && req.method() === 'GET') return route.continue()
      blocked2.push(url.origin + url.pathname); return route.abort()
    })
    await page2.addInitScript(() => {
      indexedDB.open = () => { throw Error('UI harness must not read saved careers') }
      HTMLMediaElement.prototype.play = async function () { this.muted = true }
      localStorage.setItem('val_player.tour.off', '1')
    })
    await page2.goto(origin)
    const seasonModal2 = page2.getByRole('dialog')
    await seasonModal2.waitFor()
    const nextYearButton = seasonModal2.getByRole('button', { name: '下一年' })
    await nextYearButton.click()
    await page2.waitForFunction(() => !window.harnessGame.me.pending.some(x => x.kind === 'season'))
    assert.equal(await page2.evaluate(() => window.harnessGame.me.phase), 'pro', 'phase remains pro')
    assert.equal(await page2.evaluate(() => window.harnessGame.me.pending.some(x => x.kind === 'season')), false, 'season removed')
    assert.equal(await page2.evaluate(() => !!window.harnessGame.finished), false, 'game not finished')
    assert.equal(await page2.evaluate(() => window.harnessGame.me.ending), undefined, 'no ending')
    // 不应卡住，Week 或 Poster 正常显示
    await page2.waitForSelector('.main')
    await noOverflow(page2, `${width} next year`)
    await page2.close()

    assert.deepEqual(errors, [], 'no React/browser exceptions on retire flow')
    assert.deepEqual(errors2, [], 'no React/browser exceptions on next year flow')
    assert.ok(blocked.every(url => new URL(url).origin === origin), 'no external services requested (retire)')
    assert.ok(blocked2.every(url => new URL(url).origin === origin), 'no external services requested (next year)')
    console.log('PASS', width, 'retirement confirmation/cancel, single confirmation, next year no retire')
  }
} finally { await browser?.close(); await new Promise(r => server.close(r)) }
