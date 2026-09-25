/** Local-only component smoke test. Real MatchModal + career CSS, synthetic match.
 * No production requests, saves, music, or telemetry. Screenshots in .cache.
 * Run: node scripts/check_match_mobile.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/match-mobile')
mkdirSync(output, { recursive: true })
const compiled = await build({
  stdin: { contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import MatchModal from './src/ui/me/MatchModal';
    import MatchPlay from './src/ui/me/MatchPlay';
    import {GameCtx} from './src/ui/me/ctx';
    import {createCareer,emptyTalents} from './src/engine/me/career';
    import {simulateMatch} from './src/engine/match';
    import {Rng} from './src/engine/rng';
    import './src/ui/me/base.css';
    import './src/me.css';
    const game = createCareer({name:'本地排版检查',region:'China',role:'决斗者',talents:emptyTalents(),originKey:'netcafe',start:'t1',seed:7});
    const clubs=Object.keys(game.teams).filter(id=>game.teams[id].roster.length>=5).sort();
    const teamA=clubs[0],teamB=clubs[1];
    game.myTeam=teamA;
    const bo=new URLSearchParams(location.search).get('bo')==='1'?1:3;
    const result=simulateMatch(game,teamA,teamB,bo,new Rng(703));
    if (new URLSearchParams(location.search).get('legacy') === '1') for (const map of result.maps) delete map.performanceVersion;
    const fixture={id:'local-layout',comp:'本地记分板验收',teamA,teamB,bo,label:'决赛',result};
    const noop=()=>{};
    const value={game,commit:noop,toast:noop,openPlayer:(id)=>{document.body.dataset.opened=id},openMatch:noop,go:noop,startTutorial:noop};
    const legacy=new URLSearchParams(location.search).get('legacy')==='1';
    const post=new URLSearchParams(location.search).get('post')==='1';
    // A completed local-only record with MVP explicitly false: the actual
    // MatchPlay screen must still explain why the player did not win it.
    const mm={fixture,myTeamId:teamA,oppTeamId:teamB,mineIsA:true,done:true,map:null,
      sim:{maps:result.maps.map(m=>m.map),played:result.maps},runOut:noop,
      record:{started:true,won:false,score:'0-2',maps:result.maps.length,kills:23,deaths:28,assists:12,
        rating:.98,rank:3,mvp:false,carried:false,nodes:[],performanceVersion:legacy?undefined:1}};
    const close=()=>{document.body.dataset.closed='yes'};
    createRoot(document.getElementById('root')).render(<div className="app career"><GameCtx.Provider value={value}>{post?<MatchPlay mm={mm} onDone={close}/>:<MatchModal fixture={fixture} onClose={close}/>}</GameCtx.Provider></div>);
  `, resolveDir: root, loader: 'tsx' },
  absWorkingDir: root, bundle: true, write: false, outfile: 'app.js',
  platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' },
})
const files = new Map(compiled.outputFiles.map(f => [extname(f.path), f.contents]))
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html); return }
  if (pathname === '/app.js' || pathname === '/app.css') {
    res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'text/css')
    res.end(files.get(extname(pathname))); return
  }
  const publicRoot = resolve(root, 'public')
  const target = resolve(publicRoot, '.' + decodeURIComponent(pathname))
  if (target.startsWith(publicRoot + sep) && existsSync(target) && ['.webp', '.png', '.svg'].includes(extname(target))) {
    res.setHeader('Content-Type', {'.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'}[extname(target)])
    res.end(readFileSync(target)); return
  }
  res.writeHead(404); res.end()
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
const measurements = []
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  for (const width of [320, 390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await page.addInitScript(() => localStorage.setItem('valplayer.music', JSON.stringify({vol:0,muted:true,off:true,open:false})))
    for (const legacy of [false, true]) for (const bo of [1, 3]) {
      await page.goto(`${origin}/?bo=${bo}&legacy=${legacy ? 1 : 0}`)
      const note = page.locator('p').filter({ hasText: legacy ? 'MVP 看的是' : 'MVP 按' })
      await note.waitFor()
      assert.equal(await note.count(), 1)
      assert.match(await note.innerText(), legacy ? (bo === 3 ? /每张图的 ACS 平均/ : /这张图的 ACS/) : (bo === 3 ? /全部地图累计回合的.*贡献评分/ : /本图的.*贡献评分/))
      await note.scrollIntoViewIfNeeded()
      const dimensions = await note.evaluate(el => {
        const rect = el.getBoundingClientRect(), modal = document.querySelector('.modal')
        return { left: rect.left, right: rect.right, font: parseFloat(getComputedStyle(el).fontSize),
          inTable: !!el.closest('.table-wrap'), overflow: modal.scrollWidth - modal.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - innerWidth }
      })
      assert.ok(dimensions.left >= -1 && dimensions.right <= width + 1, JSON.stringify(dimensions))
      assert.ok(!dimensions.inTable && dimensions.font >= 12 && dimensions.overflow <= 1 && dimensions.pageOverflow <= 1, JSON.stringify(dimensions))
      await page.screenshot({ path: resolve(output, `${width}-bo${bo}-${legacy ? 'legacy' : 'contribution'}.png`) })
      // Scrolling the stats table must not move the explanatory paragraph.
      const table = page.locator('.panel .table-wrap').last()
      await table.evaluate(el => { el.scrollLeft = el.scrollWidth })
      assert.equal(await note.evaluate(el => el.getBoundingClientRect().left), dimensions.left)
      if (bo === 3) {
        const mapTabs = page.locator('.seg').filter({ has: page.getByRole('button', {name:'全部地图',exact:true}) })
        await mapTabs.getByRole('button').nth(1).click()
        assert.match(await note.innerText(), legacy ? /这张图的 ACS/ : /本图的.*贡献评分/)
        await mapTabs.getByRole('button', {name:'全部地图',exact:true}).click()
        assert.match(await note.innerText(), legacy ? /每张图的 ACS 平均/ : /全部地图累计回合的.*贡献评分/)
      }
      await page.getByRole('button', {name:'关闭 ✕',exact:true}).click()
      assert.equal(await page.locator('body').getAttribute('data-closed'), 'yes')
      measurements.push({ width, bo, legacy, ...dimensions })
      console.log(`PASS ${width}px BO${bo} ${legacy ? 'legacy' : 'contribution'}: MVP explanation readable; map tabs and close work`)
    }
    for (const legacy of [false, true]) {
      await page.goto(`${origin}/?bo=3&post=1&legacy=${legacy ? 1 : 0}`)
      await page.getByRole('button', { name: '快进到结果', exact: true }).click()
      const own = page.locator('.panel.own')
      assert.match(await own.innerText(), /队内第 3/)
      assert.doesNotMatch(await own.locator('p').first().innerText(), /MVP/)
      const note = own.locator('p').filter({ hasText: legacy ? 'MVP 看的是' : 'MVP 按' })
      await note.waitFor()
      // the note's words moved with the rating on 2026-09-25 (kills and damage first, the winners' nod 0.08 → 0.15)
      if (!legacy) assert.match(await note.innerText(), /击杀和伤害为主.*助攻.*首杀减首死.*残局.*死亡扣分.*胜方另加 0\.15/)
      await note.scrollIntoViewIfNeeded()
      const dimensions = await note.evaluate(el => {
        const rect = el.getBoundingClientRect(), modal = el.closest('.modal')
        return { left: rect.left, right: rect.right, font: parseFloat(getComputedStyle(el).fontSize),
          overflow: modal.scrollWidth - modal.clientWidth, pageOverflow: document.documentElement.scrollWidth - innerWidth }
      })
      assert.ok(dimensions.left >= -1 && dimensions.right <= width + 1 && dimensions.font >= 12 && dimensions.overflow <= 1 && dimensions.pageOverflow <= 1, JSON.stringify(dimensions))
      await page.screenshot({ path: resolve(output, `${width}-non-mvp-${legacy ? 'legacy' : 'contribution'}.png`) })
      await page.getByRole('button', { name: '继续这一周', exact: true }).click()
      assert.equal(await page.locator('body').getAttribute('data-closed'), 'yes')
      measurements.push({ width, legacy, post: true, ...dimensions })
      console.log(`PASS ${width}px non-MVP postmatch ${legacy ? 'legacy' : 'contribution'}: explanation visible; no overflow; continue works`)
    }
    assert.deepEqual(errors, [])
    await page.close()
  }
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(measurements, null, 2))
} finally {
  await browser?.close()
  await new Promise(r => server.close(r))
}
