/**
 * 赛前 / 赛后采访 on screen (engine/me/interview.ts, ui/me/Interview.tsx): the real PlayerGame on a synthetic
 * career, at 390 and 1440. The pre-match card (question, situation, the real line from the same point of the same
 * event, three answers with what each does), 狠 answered and its result card; the post-match 打脸 card with
 * 认错 / 嘴硬 / 甩锅; the × answering with the first, costless answer. Nothing leaves the page's own origin.
 *
 *   node scripts/check_interviews_ui.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/interviews'); mkdirSync(output, { recursive: true })
const compiled = await build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import PlayerGame from './src/PlayerGame';
  import {createCareer,emptyTalents} from './src/engine/me/career';
  import {interviewBeforeMatch,interviewAfterMatch,ivAnswer} from './src/engine/me/interview';
  import './src/ui/me/base.css'; import './src/me.css';
  const q=new URLSearchParams(location.search);
  const game=createCareer({name:'采访界面',region:'China',role:'决斗者',talents:emptyTalents(),originKey:'netcafe',start:'t1',seed:3,year:2025});
  const me=game.me, t=game.teams[game.myTeam];
  if(!t.starters.includes(me.id))t.starters=[me.id,...t.starters.filter(id=>id!==me.id).slice(0,4)];
  me.pending=[];me.moments=[];me.pendingEvent=undefined;me.fans=500;me.heat=100;
  me.seasonStart.starts=3;me.flags.ivDebut=game.year;me.flags.ivIntl=game.year;
  if(me.achState)me.achState.seen=me.achievements.length;
  // the year's second Masters, its grand final: in 2025 that is Toronto's, where history has a line
  let comp=Object.values(game.comps).find(c=>c.stage==='masters2');
  if(!comp){comp={key:'masters2',name:'多伦多大师赛',stage:'masters2',format:'masters',teams:[],finished:[],standings:{}};game.comps.masters2=comp}
  const opp=Object.values(game.teams).find(x=>x.id!==game.myTeam&&x.tier===1&&x.starters.length>=5);
  const f={id:'UIFX',day:game.day,stage:'masters2',comp:comp.key,teamA:game.myTeam,teamB:opp.id,bo:5,label:'KO:6:总决赛',played:false};
  game.fixtures.push(f);
  interviewBeforeMatch(game,f);
  if(q.get('case')==='post'){
    ivAnswer(game,'pre:UIFX',1);
    interviewAfterMatch(game,{fixtureId:'UIFX',started:true,won:false,mvp:false,score:'2-3',friendly:false});
  }
  window.harnessGame=game;
  createRoot(document.getElementById('root')).render(<PlayerGame opened={game} onHome={()=>{}}/>);
`, resolveDir: root, loader: 'tsx' }, absWorkingDir: root, bundle: true, write: false, outfile: 'app.js', format: 'esm', platform: 'browser', jsx: 'automatic',
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' } })
const files = new Map(compiled.outputFiles.map((f) => [extname(f.path), f.contents]))
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if (path.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true,"items":[],"mine":[]}'); return }
  if (path === '/') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>'); return }
  if (path === '/app.js' || path === '/app.css') { res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(files.get(extname(path))); return }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

/** the dialog sits inside the viewport and nothing makes the page scroll sideways */
async function fits(page, dialog, width) {
  const box = await dialog.boundingBox()
  assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1, `dialog ${JSON.stringify(box)} at ${width}`)
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert.ok(over <= 1, `page scrolls sideways by ${over}px at ${width}`)
  for (const b of await dialog.locator('.node-opt button').all()) {
    const r = await b.boundingBox()
    assert.ok(r && r.x >= -1 && r.x + r.width <= width + 1 && r.height >= 40, `answer button ${JSON.stringify(r)}`)
  }
}

let browser
const t0 = Date.now()
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  for (const width of [390, 1440]) {
    for (const scenario of ['pre', 'close', 'post']) {
      const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 } })
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.route('**/*', (r) => (new URL(r.request().url()).origin === origin ? r.continue() : r.abort()))
      await page.addInitScript(() => {
        HTMLMediaElement.prototype.play = async () => {}
        localStorage.setItem('valplayer.music', JSON.stringify({ vol: 0, muted: true, loop: 'all', track: 0, off: true, open: false }))
        localStorage.setItem('val_player.tour.off', '1')
      })
      await page.goto(`${origin}/?case=${scenario === 'post' ? 'post' : 'pre'}`)
      await page.locator('.app.career').waitFor()
      if (scenario === 'post') {
        const card = page.getByRole('dialog', { name: '赛后采访' })
        await card.waitFor()
        const text = await card.innerText()
        assert.ok(text.includes('打脸'), 'the claim that fell over is said')
        assert.ok(text.includes('赛前你说'), 'what was said before comes back')
        for (const tag of ['认错', '嘴硬', '甩锅']) assert.ok(text.includes(tag), tag)
        await fits(page, card, width)
        await page.screenshot({ path: resolve(output, `${width}-post.png`) })
        await card.locator('.node-opt button').nth(0).click()
        const done = page.getByRole('dialog', { name: '赛后采访' })
        await done.getByRole('button', { name: '继续', exact: true }).click()
        assert.equal(await page.evaluate(() => window.harnessGame.me.pending.filter((x) => x.kind === 'interview').length), 0)
        assert.ok(await page.evaluate(() => !!window.harnessGame.me.iv.best), 'the line is kept for the career page')
      } else {
        const card = page.getByRole('dialog', { name: '赛前采访' })
        await card.waitFor()
        const text = await card.innerText()
        assert.ok(text.includes('总决赛'), 'the situation is said')
        assert.ok(text.includes('真实历史里'), 'the real line from the same point of the same event')
        assert.ok(text.includes('f0rsakeN'), 'attributed')
        assert.equal(await card.locator('.node-opt button').count(), 3)
        assert.ok(text.includes('按推荐') && text.includes('没有风险'), 'the first answer is the safe one')
        await fits(page, card, width)
        if (scenario === 'pre') {
          await page.screenshot({ path: resolve(output, `${width}-pre.png`) })
          const fans = await page.evaluate(() => window.harnessGame.me.fans)
          await card.locator('.node-opt button').nth(1).click()
          const result = page.getByRole('dialog', { name: '赛前采访' })
          await result.getByText('你说：「').waitFor()
          await page.screenshot({ path: resolve(output, `${width}-pre-result.png`) })
          await result.getByRole('button', { name: '继续', exact: true }).click()
          const iv = await page.evaluate(() => window.harnessGame.me.iv)
          assert.equal(iv.pre.tone, 'bold')
          assert.equal(iv.edge.fx, 'UIFX')
          assert.ok(await page.evaluate(() => window.harnessGame.me.fans) >= fans, '狠 costs nothing before the match')
        } else {
          // the × is the first answer, which costs nothing
          const was = await page.evaluate(() => ({ fans: window.harnessGame.me.fans, heat: window.harnessGame.me.heat, mental: window.harnessGame.me.mental }))
          await card.getByRole('button', { name: '关闭 ✕' }).click()
          await page.getByRole('dialog', { name: '赛前采访' }).getByRole('button', { name: '继续', exact: true }).click()
          const now = await page.evaluate(() => ({ tone: window.harnessGame.me.iv.pre.tone, edge: window.harnessGame.me.iv.edge, fans: window.harnessGame.me.fans, heat: window.harnessGame.me.heat, mental: window.harnessGame.me.mental }))
          assert.equal(now.tone, 'steady')
          assert.equal(now.edge, undefined)
          assert.ok(now.fans >= was.fans && now.heat >= was.heat && now.mental >= was.mental)
        }
      }
      assert.deepEqual(errors, [])
      console.log('PASS', width, scenario)
      await page.close()
    }
  }
} finally {
  await browser?.close()
  await new Promise((r) => server.close(r))
}
console.log(`PASS interview cards at 390 and 1440 · ${((Date.now() - t0) / 1000).toFixed(0)}s`)
