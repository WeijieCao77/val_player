/**
 * 话语权 on the team page at 390 and 1440 (2026-09-26): the four asks — 推荐替补首发 and 提出换人 to the coach,
 * 提议补强 and 点名要人 to the manager — are all on the panel, a closed one greyed with its reason rather than
 * hidden; 提议补强 lists every position with the man found or why not, my own position greyed; a yes or a no
 * comes back in words; nothing spills sideways on a phone.
 *
 * Run: node scripts/check_recruit_ui.mjs
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const t0 = Date.now()
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const compiled = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React, { useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import { GameCtx } from './src/ui/me/ctx';
import TeamScreen from './src/ui/me/TeamScreen';
import { createCareer, emptyTalents } from './src/engine/me/career';
import { reinforceGate, reinforceOptions, pushGate } from './src/engine/me/recruit';
import './src/ui/me/base.css';
import './src/me.css';

globalThis.fetch = () => Promise.reject(new Error('offline'));
const game = createCareer({ name: '界面', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2021, teamId: 'V21T1120' });
game.day = 30;
game.me.pending = [];
game.me.ap = game.me.apMax;
game.me.gmTrust = 50;
game.me.coachTrust = 50;
game.teams[game.myTeam].budget = 5000000;
window.game = game;
window.api = { reinforceGate: () => reinforceGate(game), reinforceOptions: () => reinforceOptions(game).map((o) => ({ role: o.role, pick: o.pick?.id ?? null, why: o.why ?? null })), pushGate: () => pushGate(game) };
window.toasts = [];
function App() {
  const [, bump] = useReducer((x) => x + 1, 0);
  window.refresh = bump;
  const ctx = { game, commit: () => bump(), toast: (m) => { window.toasts.push(m) }, openPlayer: () => {}, openMatch: () => {}, go: () => {}, startTutorial: () => {} };
  return <GameCtx.Provider value={ctx}><div className="app career"><div className="body"><main className="main"><TeamScreen /></main></div></div></GameCtx.Provider>;
}
createRoot(document.getElementById('root')).render(<App />);
`,
  },
  absWorkingDir: root, bundle: true, write: false, outfile: 'app.js', platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' },
  logLevel: 'error',
})
const files = new Map(compiled.outputFiles.map((f) => [extname(f.path), f.contents]))
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html;charset=utf-8')
    return res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')
  }
  if (path === '/app.js' || path === '/app.css') {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css')
    return res.end(files.get(extname(path)))
  }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

let browser
let checks = 0
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('dialog', (d) => d.accept())
    await page.route('**/*', (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()))
    await page.addInitScript(() => {
      localStorage.setItem('valplayer.music', JSON.stringify({ vol: 0, muted: true, loop: 'all', track: 0, off: true, open: false }))
      localStorage.setItem('val_player.numbers', '0')
      HTMLMediaElement.prototype.play = async () => {}
    })
    await page.goto(origin)
    const panel = page.locator('.panel').filter({ has: page.locator('.panel-head > h2', { hasText: '话语权' }) })
    await panel.waitFor()
    const btn = (name) => panel.getByRole('button', { name, exact: true })

    // all four on the panel; the closed ones greyed, each with its reason
    for (const name of ['推荐替补首发', '提出换人', '提议补强', '点名要人']) assert.equal(await btn(name).count(), 1, `${name} is on the panel`)
    assert.equal(await btn('提议补强').isDisabled(), true)
    const text0 = await panel.innerText()
    assert.ok(text0.includes('提议补强：经理还不够信任你'), text0)
    assert.ok(text0.includes('推荐替补首发：教练还不够信任你'), text0)
    assert.ok(text0.includes('托管不会替你提'), text0)
    checks++

    // the manager trusts me: 提议补强 opens, every position listed, mine greyed with the reason
    await page.evaluate(() => { window.game.me.gmTrust = 70; window.refresh() })
    assert.equal(await btn('提议补强').isDisabled(), false, JSON.stringify(await page.evaluate(() => window.api.reinforceGate())))
    await btn('提议补强').click()
    const rows = panel.locator('.clout-row')
    assert.equal(await rows.count(), 4, 'the four positions')
    const own = rows.filter({ hasText: '决斗者' })
    assert.ok((await own.innerText()).includes('自己的位置'))
    assert.equal(await own.getByRole('button').isDisabled(), true)
    const opts = await page.evaluate(() => window.api.reinforceOptions())
    for (const o of opts) {
      const row = rows.filter({ hasText: o.role }).first()
      assert.equal(await row.getByRole('button').isDisabled(), !o.pick, `${o.role}: greyed exactly when nobody fits`)
      if (!o.pick) assert.ok((await row.innerText()).includes(o.why), `${o.role}: the reason is on the row`)
    }
    checks++

    // ask: the answer in words, 2 AP gone, and the button greyed for the period with that reason
    const open = opts.find((o) => o.pick)
    assert.ok(open, 'some position has a man')
    const ap = await page.evaluate(() => window.game.me.ap)
    await rows.filter({ hasText: open.role }).first().getByRole('button').click()
    await page.waitForFunction(() => window.toasts.length > 0)
    const said = await page.evaluate(() => window.toasts.at(-1))
    assert.ok(said.includes('经理'), said)
    assert.equal(await page.evaluate(() => window.game.me.ap), ap - 2)
    assert.equal(await btn('提议补强').isDisabled(), true)
    assert.ok((await panel.innerText()).includes('这个转会期已经提过'))
    checks++

    // the coach trusts me: 推荐替补首发 opens; a man at my position is greyed with the reason
    await page.evaluate(() => { window.game.me.coachTrust = 80; window.refresh() })
    if ((await page.evaluate(() => window.api.pushGate())).ok) {
      await btn('推荐替补首发').click()
      await panel.getByText('跟教练推荐一个替补').waitFor()
      const pr = panel.locator('.clout-row')
      const n = await pr.count()
      const bench = await page.evaluate(() => { const t = window.game.teams[window.game.myTeam]; return t.roster.filter((id) => !t.starters.includes(id) && id !== window.game.me.id).length })
      assert.equal(n, bench, 'every man on the bench is listed')
      if (!n) assert.ok((await panel.innerText()).includes('替补席上现在没有人'))
      for (let i = 0; i < n; i++) {
        const row = pr.nth(i)
        const txt = await row.innerText()
        if (txt.includes('同一个位置')) assert.equal(await row.getByRole('button').isDisabled(), true)
      }
      checks++
    }

    // a phone: nothing wider than the screen
    const spill = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(spill <= 1, `${width}: spills ${spill}px sideways`)
    await page.screenshot({ path: resolve(root, `.cache/recruit_ui_${width}.png`), fullPage: false })
    assert.deepEqual(errors, [])
    console.log(`OK ${width}px`)
    await page.close()
  }
} finally {
  await browser?.close()
  server.close()
}
console.log(`✓ ${checks} checks · ${((Date.now() - t0) / 1000).toFixed(1)} s`)
