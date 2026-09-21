import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

// DeepSeek draft reviewed against actual component exports and game fixtures.
// Local synthetic state, no real saves or external network.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), output = resolve(root, '.cache/transfer-roster-ui')
mkdirSync(output, { recursive: true })
const compiled = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {GameCtx} from './src/ui/me/ctx';
import TransferScreen from './src/ui/me/TransferScreen';import Standings from './src/ui/me/Standings';
import TeamPeekButton from './src/ui/me/TeamPeek';import {setNumbers} from './src/ui/me/words';
import {createCareer,emptyTalents} from './src/engine/me/career';import {pitchTargets} from './src/engine/me/selfpitch';
import {makeDeal} from './src/engine/me/contract';import {Rng} from './src/engine/rng';
import {progressCircuit} from './src/engine/circuit';
import './src/ui/me/base.css';import './src/me.css';
let game; const app=createRoot(document.getElementById('root'));
window.rowClicks=0;window.commits=0;window.setNumbers=setNumbers;
window.setup=(start='pre',lang=false,screen='transfer',offers=false)=>{
  game=createCareer({name:'转会本地测试',region:'China',role:'先锋',talents:emptyTalents(),originKey:'netcafe',start,seed:741,year:2026});
  game.me.flags.lang=lang;const target=pitchTargets(game).rows.find(r=>!r.abroad)?.team; if(!target)throw Error('fixture missing');
  if(screen==='standings'){game.day=40;for(const c of Object.values(game.comps))if(c.format==='circuit')progressCircuit(game,c,[]);}
  target.name='测试俱乐部 Beijing';target.tag='TST';window.targetId=target.id;
  if(target.roster[0])game.players[target.roster[0]].ign='超长选手名PlayerABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if(offers){game.me.deals.push(makeDeal(game,target.id,'sign','B',new Rng(7)));game.me.pre.invites.push({id:'fixture-invite',teamId:target.id,via:'scout',day:game.day,year:game.year,expires:game.day+21,direct:false});}
  const prototype=Object.values(game.teams)[0];game.teams.dormant={...prototype,id:'dormant',name:'沉睡队',tag:'DOR',dormant:true,roster:[],starters:[]};
  window.harnessGame=game;window.expectedTargets=pitchTargets(game).rows.map(r=>({id:r.team.id,name:r.team.name,tag:r.team.tag,abroad:r.abroad,why:r.why}));
  const noop=()=>{};app.render(<GameCtx.Provider value={{game,commit:()=>window.commits++,toast:noop,openPlayer:()=>window.rowClicks++,openMatch:noop,go:noop,startTutorial:noop}}>
    <div className="app career"><div className="body"><main className="main">
      <div id="fixture-controls"><table><tbody><tr onClick={()=>window.rowClicks++}><td><TeamPeekButton id={target.id} label="测试嵌套按钮"/></td></tr></tbody></table>
        <TeamPeekButton id="missing" label="缺失俱乐部"/><TeamPeekButton id="dormant" label="沉睡俱乐部"/></div>
      {screen==='transfer'?<TransferScreen key={start+lang+offers}/>:<Standings key={start+lang}/>}
    </main></div></div></GameCtx.Provider>);
};window.setup();
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
    const search = page.getByRole('searchbox', { name: '搜索自荐俱乐部' })
    await search.waitFor()
    const all = await page.locator('.sp-row').count()
    assert.ok(all > 0)
    for (const query of ['tst', ' ＴＳＴ ', '测试俱乐部']) {
      await search.fill(query)
      assert.equal(await page.locator('.sp-row').count(), 1)
      await page.locator('.sp-row .team-peek-trigger').waitFor({ state: 'visible' })
    }
    await search.fill('无此俱乐部never')
    assert.equal(await page.locator('.sp-row').count(), 0)
    assert.match(await page.locator('main').textContent(), /没有匹配的俱乐部/)
    await page.locator('.team-search').filter({ has: search }).getByRole('button', { name: '清除', exact: true }).click()
    assert.equal(await page.locator('.sp-row').count(), all)
    // Without language, a foreign query never widens the original engine list.
    const lockedName = await page.evaluate(() => {
      const listed=new Set(window.expectedTargets.map(r=>r.id));return Object.values(window.harnessGame.teams).find(t=>t.region==='Europe'&&!listed.has(t.id)&&!t.dormant)?.name
    })
    assert.ok(lockedName);await search.fill(lockedName);assert.equal(await page.locator('.sp-row').count(), 0)
    await search.fill('tst')
    const btn = page.locator('.sp-row .team-peek-trigger')
    for (const nums of [false, true]) {
      await page.evaluate(v => window.setNumbers(v), nums)
      const before = await page.evaluate(() => JSON.stringify(window.harnessGame))
      await btn.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      const level = await page.evaluate(() => window.harnessGame.teams[window.targetId].tier === 1 ? '一级联赛' : '次级联赛')
      assert.ok((await dialog.locator('.team-peek-meta').textContent()).includes(level))
      const expected = await page.evaluate(() => {
        const g=window.harnessGame,t=g.teams[window.targetId];return [...new Set(t.roster)].filter(id=>g.players[id]?.teamId===t.id).sort()
      })
      const ids = await dialog.locator('[data-player]').evaluateAll(els => els.map(el => el.getAttribute('data-player')).sort())
      assert.deepEqual(ids, expected)
      const abilities = await dialog.locator('.team-peek-ability').allTextContents()
      assert.equal(abilities.length, expected.length)
      assert.ok(abilities.every(v => nums ? /^\d+$/.test(v) : !/\d/.test(v)))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      const bounds = await dialog.boundingBox();assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1)
      await page.screenshot({ path: resolve(output, `${width}-${nums ? 'numbers' : 'words'}-roster.png`) })
      await dialog.getByRole('button', { name: /关闭/ }).click()
      assert.equal(await page.evaluate(() => JSON.stringify(window.harnessGame)), before)
      assert.ok(await btn.evaluate(el => el === document.activeElement))
    }
    await page.getByRole('button', { name: '测试嵌套按钮', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: /关闭/ }).click()
    assert.equal(await page.evaluate(() => window.rowClicks), 0, 'React portal clicks cannot open enclosing player/match rows')
    for (const [label, content] of [['缺失俱乐部', /没有这家俱乐部的资料/], ['沉睡俱乐部', /本赛季没有参赛记录/]]) {
      await page.getByRole('button', { name: label, exact: true }).click()
      assert.match(await page.getByRole('dialog').textContent(), content)
      await page.getByRole('dialog').getByRole('button', { name: /关闭/ }).click()
    }
    const threshold = page.getByRole('searchbox', { name: '搜索门槛俱乐部' })
    await threshold.fill('ＴＳＴ')
    const panel = page.locator('.panel').filter({ has: threshold })
    assert.equal(await panel.locator('tbody tr').count(), 1)
    await panel.locator('.team-peek-trigger').click()
    await page.getByRole('dialog').getByRole('button', { name: /关闭/ }).click()
    // Language opens precisely the old allowed pool; searching doesn't erase why/disabled state.
    await page.evaluate(() => window.setup('pre', true))
    await search.waitFor()
    const far = await page.evaluate(() => window.expectedTargets.find(r=>r.abroad))
    assert.ok(far);await search.fill(far.name)
    const farRow=page.locator('.sp-row').filter({has:page.getByRole('button',{name:far.name,exact:true})})
    await farRow.locator('.team-peek-trigger').waitFor({state:'visible'})
    const gated = await page.evaluate(() => window.expectedTargets.find(r=>r.why))
    if (gated) {
      await search.fill(gated.name)
      const row=page.locator('.sp-row').filter({has:page.getByRole('button',{name:gated.name,exact:true})})
      assert.ok(await row.locator('button').last().isDisabled());assert.match(await row.textContent(), new RegExp(gated.why.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
    }
    // Real professional contact list and 2023+ event/points table paths.
    await page.evaluate(() => window.setup('t1', true))
    await page.getByText('挑一家接触', { exact: true }).click()
    const contact=page.getByRole('searchbox',{name:'搜索接触俱乐部'});await contact.fill('tst')
    await page.locator('.sp-row .team-peek-trigger').click()
    await page.getByRole('dialog').getByRole('button',{name:/关闭/}).click()
    await page.evaluate(() => window.setup('pre', false, 'transfer', true))
    for(const title of ['桌上的报价','邀请']) {
      const offerPanel=page.locator('.panel').filter({has:page.getByRole('heading',{name:title,exact:true})})
      const before=await page.evaluate(()=>JSON.stringify(window.harnessGame))
      await offerPanel.locator('.team-peek-trigger').click()
      await page.getByRole('dialog').getByRole('button',{name:/关闭/}).click()
      assert.equal(await page.evaluate(()=>JSON.stringify(window.harnessGame)),before,'inspection cannot reopen/respond to offer')
    }
    await page.evaluate(() => window.setup('t1', false, 'standings'))
    const tableButton=page.locator('main .panel table .team-peek-trigger').first();await tableButton.waitFor()
    const standingBefore=await page.evaluate(()=>JSON.stringify(window.harnessGame))
    await tableButton.click();await page.getByRole('dialog').getByRole('button',{name:/关闭/}).click()
    assert.equal(await page.evaluate(()=>JSON.stringify(window.harnessGame)),standingBefore)
    const circuitButton=page.locator('main .panel[id^="ev-"] table .team-peek-trigger').first()
    await circuitButton.waitFor();await circuitButton.click()
    await page.getByRole('dialog').getByRole('button',{name:/关闭/}).click()
    assert.equal(await page.evaluate(()=>JSON.stringify(window.harnessGame)),standingBefore,'2023+ event-table inspection is also read-only')
    assert.equal(await page.evaluate(()=>window.commits),0)
    assert.deepEqual(errors, []);assert.deepEqual(blocked, [])
    console.log('PASS transfer roster UI', width, 'search+locks, words/numbers, roster, focus, portals, no mutation, contact, 2026 standings')
    await page.close()
  }
} finally { await browser?.close(); await new Promise(r => server.close(r)) }
