/** Real MeScreen + GameCtx + production CSS; synthetic memory only, no saves/network. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/career-overview-mobile')
mkdirSync(output, { recursive: true })
const compiled = await build({
  stdin: { contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import MeScreen from './src/ui/me/MeScreen';
    import {GameCtx} from './src/ui/me/ctx';
    import {createCareer,emptyTalents} from './src/engine/me/career';
    import {emptyStats} from './src/engine/types';
    import './src/ui/me/base.css';
    import './src/me.css';
    const scenario=new URLSearchParams(location.search).get('case');
    const game=createCareer({name:'本地生涯总览检查',region:'China',role:'决斗者',talents:emptyTalents(),originKey:'netcafe',start:'t1',seed:7,year:2026});
    const me=game.me,p=game.players[me.id];
    p.career=emptyStats();p.season=emptyStats();
    if(scenario!=='empty'){
      me.seasons.push({year:2025,team:'历史队伍',tier:1,matches:12,starts:10,wins:6,acs:200,overallFrom:60,overallTo:65,titles:[]});
      Object.assign(me.seasonStart,{matches:5,starts:4,wins:3});
      p.career={...emptyStats(),maps:30,rounds:600,kills:450,deaths:300,assists:100,damage:85000,firstKills:70,firstDeaths:45,mvps:4};
      p.season={...emptyStats(),maps:8,rounds:160,kills:120,deaths:80,assists:25,damage:23000,firstKills:20,firstDeaths:11,mvps:1};
      me.titles=[{year:2026,title:'Champions',started:true},{year:2026,title:'Masters Shanghai',started:false},{year:2026,title:'Last Chance Qualifier',started:true},{year:2025,title:'Masters Bangkok',started:true}];
      if(scenario==='bench'){
        p.season=emptyStats();Object.assign(me.seasonStart,{starts:0,wins:0});
        me.titles=[{year:2026,title:'Masters Shanghai',started:false}];
      }
    }
    const noop=()=>{};
    const value={game,commit:noop,toast:noop,openPlayer:noop,openMatch:noop,go:route=>{document.body.dataset.route=route},startTutorial:noop};
    createRoot(document.getElementById('root')).render(<div className="app career"><div className="body"><main className="main"><GameCtx.Provider value={value}><MeScreen/></GameCtx.Provider></main></div></div>);
  `, resolveDir: root, loader: 'tsx' },
  absWorkingDir: root, bundle: true, write: false, outfile: 'app.js', platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' },
})
const files = new Map(compiled.outputFiles.map(f => [extname(f.path), f.contents]))
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'
const server = createServer((req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
  const path = new URL(req.url, 'http://localhost').pathname
  if (path === '/') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html); return }
  if (path === '/app.js' || path === '/app.css') {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css')
    res.end(files.get(extname(path))); return
  }
  res.writeHead(404); res.end()
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
const report = []
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = [], blocked = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === origin && route.request().method() === 'GET') return route.continue()
      blocked.push(url.origin + url.pathname); return route.abort()
    })
    await page.addInitScript(() => {
      localStorage.setItem('valplayer.music', JSON.stringify({ vol: 0, muted: true, off: true, open: false }))
      indexedDB.open = () => { throw Error('Must not access user saves') }
      HTMLMediaElement.prototype.play = async function () { this.muted = true }
    })
    for (const scenario of ['empty', 'active', 'bench']) {
      await page.goto(`${origin}/?case=${scenario}`)
      const overview = page.getByRole('region', { name: '实时生涯总览' })
      await overview.waitFor()
      const value = label => overview.locator('.stat').filter({ has: page.locator('.k', { hasText: new RegExp(`^${label}$`) }) }).locator('.v').innerText()
      assert.equal(await value('出场地图'), scenario === 'empty' ? '0' : '30')
      assert.equal(await value('比赛 MVP（整场）'), scenario === 'empty' ? '0' : '4')
      assert.equal(await value('出场胜率'), scenario === 'empty' ? '—' : scenario === 'bench' ? '60%' : '64%')
      const honors = overview.locator('[aria-label="当季荣誉"]')
      assert.equal(await honors.locator('li').count(), scenario === 'active' ? 2 : scenario === 'bench' ? 1 : 0)
      assert.equal(await honors.getByText('未出场 · 随队', { exact: true }).count(), scenario === 'empty' ? 0 : 1)
      assert.equal(await honors.getByText('赛事中有出场', { exact: true }).count(), scenario === 'active' ? 1 : 0)
      const layout = await overview.evaluate(el => ({
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
        panelOverflow: el.scrollWidth - el.clientWidth,
        labels: [...el.querySelectorAll('.stat .k,.stat .v,.career-current-honors li')].map(node => {
          const box = node.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(node)
          return { text: node.textContent, left: box.left, right: box.right, clipped: node.scrollWidth > node.clientWidth + 1,
            font: parseFloat(getComputedStyle(node).fontSize), outside: [...range.getClientRects()].some(r => r.left < -1 || r.right > innerWidth + 1) }
        }),
      }))
      assert.ok(layout.pageOverflow <= 1 && layout.panelOverflow <= 1, JSON.stringify(layout))
      assert.ok(layout.labels.every(x => !x.clipped && !x.outside && x.left >= 0 && x.right <= width + 1), JSON.stringify(layout))
      await page.screenshot({ path: resolve(output, `${width}-${scenario}-career.png`), animations: 'disabled' })
      await overview.getByRole('button', { name: '2026 当季', exact: true }).click()
      assert.equal(await overview.getByRole('button', { name: '2026 当季', exact: true }).getAttribute('aria-pressed'), 'true')
      assert.equal(await value('出场地图'), scenario === 'active' ? '8' : '0')
      assert.equal(await value('出场胜率'), scenario === 'active' ? '75%' : '—')
      assert.equal(await value('比赛 MVP（整场）'), scenario === 'active' ? '1' : '0')
      if (scenario !== 'active') await overview.getByText('本赛季尚无正式赛出场数据。', { exact: false }).waitFor()
      await page.screenshot({ path: resolve(output, `${width}-${scenario}-season.png`), animations: 'disabled' })
      await overview.getByRole('button', { name: '查看全部奖杯与成就 →', exact: true }).click()
      assert.equal(await page.locator('body').getAttribute('data-route'), 'awards')
      await overview.getByRole('button', { name: '查看能力 ↓', exact: true }).click()
      const abilityTop = await page.locator('#my-abilities').evaluate(el => el.getBoundingClientRect().top)
      assert.ok(abilityTop >= -1 && abilityTop < 900, `ability shortcut ${abilityTop}`)
      assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
      report.push({ width, scenario, ...layout, abilityTop, blockedRequests: [...blocked] })
      console.log(`PASS ${width}px ${scenario}: real MeScreen, career/season, honors, awards and abilities navigation; no overflow/network/save reads`)
    }
    await page.close()
  }
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  await new Promise(r => server.close(r))
}
