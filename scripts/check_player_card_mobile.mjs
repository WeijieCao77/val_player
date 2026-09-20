/** Real PlayerCard/GameCtx/CSS, disposable synthetic careers, no saves or network.
 * node scripts/check_player_card_mobile.mjs
 * Screenshots and measurements: .cache/player-card-mobile.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/player-card-mobile')
mkdirSync(output, { recursive: true })
const compiled = await build({
  stdin: { contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import PlayerCard from './src/ui/me/PlayerCard';
    import {GameCtx} from './src/ui/me/ctx';
    import {createCareer,emptyTalents} from './src/engine/me/career';
    import './src/ui/me/base.css';
    import './src/me.css';
    const scenario=new URLSearchParams(location.search).get('case');
    const year=scenario==='2021'?2021:2026;
    const game=createCareer({name:'本地人物卡排版检查',region:'China',role:'决斗者',talents:emptyTalents(),originKey:'netcafe',start:'t1',seed:7,year});
    const p=Object.values(game.players).find(p=>p.ign.toLowerCase()==='zmjjkk');
    if(!p)throw Error('Synthetic career is missing ZmjjKK');
    // Explicitly make the historical origin disagree with the current league.
    // These are synthetic in-memory fixtures, never user saves or source data.
    p.region='Hong Kong & Taiwan';
    if(year===2026){
      const edg=Object.values(game.teams).find(t=>t.name==='EDward Gaming');
      if(!edg)throw Error('Missing EDG');
      p.teamId=edg.id;
    }
    if(scenario==='free')p.teamId=null;
    if(scenario==='long')p.realName='Eduardo Kenzo Nagahama Sato（本地长姓名排版样例）';
    document.body.dataset.person=p.id;
    document.body.dataset.realName=p.realName||'';
    document.body.dataset.birth=p.birth||'';
    document.body.dataset.historicalRegion=p.region;
    const noop=()=>{};
    const value={game,commit:noop,toast:noop,openPlayer:noop,openMatch:noop,go:noop,startTutorial:noop};
    createRoot(document.getElementById('root')).render(<div className="app career"><GameCtx.Provider value={value}><PlayerCard playerId={p.id} onClose={()=>{document.body.dataset.closed='yes'}}/></GameCtx.Provider></div>);
  `, resolveDir: root, loader: 'tsx' },
  absWorkingDir: root, bundle: true, write: false, outfile: 'app.js', platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' },
})
const files = new Map(compiled.outputFiles.map(f => [extname(f.path), f.contents]))
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'
const server = createServer((req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
  const pathname = new URL(req.url, 'http://localhost').pathname
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html); return }
  if (pathname === '/app.js' || pathname === '/app.css') {
    res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'text/css')
    res.end(files.get(extname(pathname))); return
  }
  const publicRoot = resolve(root, 'public'), target = resolve(publicRoot, '.' + decodeURIComponent(pathname))
  if (target.startsWith(publicRoot + sep) && existsSync(target) && ['.webp', '.png', '.svg'].includes(extname(target))) {
    res.setHeader('Content-Type', { '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' }[extname(target)])
    res.end(readFileSync(target)); return
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
      blocked.push(url.origin + url.pathname)
      return route.abort()
    })
    await page.addInitScript(() => {
      localStorage.setItem('valplayer.music', JSON.stringify({ vol: 0, muted: true, off: true, open: false }))
      indexedDB.open = () => { throw Error('This component harness must never read a saved game') }
      HTMLMediaElement.prototype.play = async function () { this.muted = true }
    })
    for (const scenario of ['2021', '2026', 'free', 'long']) {
      await page.goto(`${origin}/?case=${scenario}`)
      const nationality = page.getByText('国籍/地区：中国', { exact: true })
      await nationality.waitFor()
      assert.equal(await nationality.count(), 1)
      assert.equal(await page.getByText('国籍/地区：港台', { exact: true }).count(), 0)
      const competition = page.getByText(/^当前赛区：/)
      if (scenario === 'free') {
        assert.equal(await competition.count(), 0)
        assert.equal(await page.getByText('自由人', { exact: true }).count(), 1)
      } else assert.equal(await competition.innerText(), scenario === '2021' ? '当前赛区：港台' : '当前赛区：中国')
      const birth = await page.locator('body').getAttribute('data-birth')
      assert.match(birth, /^\d{4}-\d{2}-\d{2}$/)
      const age = page.locator(`.tag[title="生日 ${birth}"]`)
      await age.waitFor()
      const realName = await page.locator('body').getAttribute('data-real-name')
      const name = page.getByText(realName, { exact: true })
      const dimensions = await page.locator('.modal').evaluate(el => ({
        modalOverflow: el.scrollWidth - el.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
      }))
      const labels = []
      for (const [kind, locator] of [['nationality', nationality], ['birthday-age', age], ['real-name', name], ...(scenario === 'free' ? [] : [['competition', competition]])]) {
        await locator.scrollIntoViewIfNeeded()
        const measured = await locator.evaluate(el => {
          const r = el.getBoundingClientRect(), style = getComputedStyle(el)
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          const range = document.createRange(); range.selectNodeContents(el)
          const rects = [...range.getClientRects()].map(x => ({ left: x.left, right: x.right, top: x.top, bottom: x.bottom }))
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, font: parseFloat(style.fontSize),
            clipped: el.scrollWidth > el.clientWidth + 1, unobscured: hit === el || el.contains(hit), textRects: rects }
        })
        labels.push({ kind, ...measured })
        assert.ok(measured.font >= 12 && measured.left >= -1 && measured.right <= width + 1 && !measured.clipped && measured.unobscured,
          `${width} ${scenario} ${kind}: ${JSON.stringify(measured)}`)
        assert.ok(measured.textRects.every(r => r.left >= -1 && r.right <= width + 1), `${kind} text outside viewport`)
      }
      assert.ok(dimensions.modalOverflow <= 1 && dimensions.pageOverflow <= 1, `${width} ${scenario}: ${JSON.stringify(dimensions)}`)
      await page.locator('.modal').evaluate(el => { el.scrollTop = 0 })
      await page.screenshot({ path: resolve(output, `${width}-${scenario}.png`) })
      await page.getByRole('button', { name: '关闭 ✕', exact: true }).click()
      assert.equal(await page.locator('body').getAttribute('data-closed'), 'yes')
      assert.deepEqual(errors, [])
      report.push({ width, scenario, realName, birth, ...dimensions, labels, blockedRequests: [...blocked] })
      console.log(`PASS ${width}px ${scenario}: identity/league labels, name, birthday tooltip and close button`)
    }
    await page.close()
  }
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  await new Promise(r => server.close(r))
}
