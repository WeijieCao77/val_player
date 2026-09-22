// DeepSeek browser draft; reviewed fixes for fixture exposure, render timing and strict mutation checks.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/duel-relation-ui')
mkdirSync(output, { recursive: true })

const compiled = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React, { useReducer } from 'react'
import { createRoot } from 'react-dom/client'
import { GameCtx } from './src/ui/me/ctx'
import DuelPlay from './src/ui/me/DuelPlay'
import { useNumbers } from './src/ui/me/words'
import { createCareer, emptyTalents } from './src/engine/me/career'
import { duelBlock, startDuel } from './src/engine/me/duel'
import './src/ui/me/base.css'
import './src/me.css'

const game = createCareer({
  name: '本地对位界面测试',
  region: 'Europe',
  role: '决斗者',
  talents: emptyTalents(),
  originKey: 'netcafe',
  start: 't1',
  seed: 7,
  year: 2026,
})

window.game = game
window.setup = (kind) => {
  const me = game.me
  const mine = game.players[me.id]
  const team = game.teams[game.myTeam]
  const ids = team.roster.filter(id => id !== me.id).slice(0, 5)
  team.starters = [...ids]
  const players = ids.map(id => game.players[id])
  for (const p of players) {
    p.role = '控场'
    p.roles = ['控场']
    p.isIgl = false
    p.injuredUntil = 0
  }
  const first = players[0]
  if (kind === 'same') {
    first.role = '决斗者'
    first.roles = ['决斗者']
  } else if (kind === 'secondary') {
    first.role = '先锋'
    first.roles = ['先锋', '决斗者']
  }
  delete me.duelLive
  me.ap = 10
  me.duelsThisWeek = 0
  me.phase = 'pro'
  me.trial = undefined
  me.benchLock = 0
  mine.injuredUntil = 0
  const why = duelBlock(game)
  if (why !== null) throw new Error(why)
  const result = startDuel(game)
  if (result !== null) throw new Error(result)
  window.snapshot = JSON.stringify(game)
  window.refresh()
}

function App() {
  const [, bump] = useReducer(x => x + 1, 0)
  const [nums, setNums] = useNumbers()
  window.refresh = bump
  window.setNumbers = setNums
  return (
    <GameCtx.Provider value={{ game, commit: bump, toast: () => {}, openPlayer: () => {}, openMatch: () => {}, go: () => {}, startTutorial: () => {} }}>
      <div className="app career">
        <div className="body">
          <main className="main">
            <button onClick={() => setNums(!nums)}>{nums ? '数值 开' : '数值 关'}</button>
            <DuelPlay onDone={() => {}} />
          </main>
        </div>
      </div>
    </GameCtx.Provider>
  )
}
createRoot(document.getElementById('root')).render(<App />)
`
  },
  absWorkingDir: root,
  bundle: true,
  write: false,
  outfile: 'app.js',
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  define: {
    'import.meta.env.BASE_URL': '"/"',
    'import.meta.env.DEV': 'false',
    'process.env.NODE_ENV': '"production"',
  },
})

const files = new Map(compiled.outputFiles.map(f => [extname(f.path), f.contents]))
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if (req.method !== 'GET') {
    res.writeHead(405); res.end(); return
  }
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html;charset=utf-8')
    res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>')
    return
  }
  if (path === '/app.js' || path === '/app.css') {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css')
    res.end(files.get(extname(path)))
    return
  }
  res.writeHead(404); res.end()
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

let browser
try {
  browser = await chromium.launch({ headless: true })

  for (const width of [320, 390, 1440]) {
    for (const kind of ['same', 'secondary', 'cross']) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } })
      const errors = []
      const blocked = []
      page.on('pageerror', e => errors.push(e.message))
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.origin === origin && route.request().method() === 'GET') return route.continue()
        blocked.push(route.request().url())
        return route.abort()
      })

      await page.goto(origin)
      await page.waitForFunction(() => typeof window.setup === 'function' && typeof window.refresh === 'function')
      await page.evaluate(kind => window.setup(kind), kind)

      // Check title
      const title = page.getByRole('heading', { name: /训练赛/ })
      await title.waitFor()
      const titleText = await title.innerText()
      if (kind === 'same' || kind === 'secondary') {
        assert.ok(titleText.includes('对位挑战'), `title should contain 对位挑战 for ${kind}`)
      } else {
        assert.ok(titleText.includes('首发名额挑战'), `title should contain 首发名额挑战 for cross`)
      }

      // Check explanation
      const explanationLocator = page.locator('.tiny.muted', { hasText: /岗位|首发|兼任|跨岗位/ }).first()
      await explanationLocator.waitFor()
      const explanationText = await explanationLocator.innerText()
      assert.ok(explanationText.length > 10, 'explanation should be non-empty')
      if (kind === 'same') {
        assert.ok(explanationText.includes('当前也打'), 'same explanation')
      } else if (kind === 'secondary') {
        assert.ok(explanationText.includes('兼任'), 'secondary explanation')
      } else {
        assert.ok(explanationText.includes('跨岗位'), 'cross explanation')
      }

      // Hidden numeric success probability with nums off
      const numericPattern = /\d+%/
      const bodyTextNumsOff = await page.locator('body').innerText()
      assert.ok(!numericPattern.test(bodyTextNumsOff), `numeric probabilities should be hidden when nums off for ${kind} at ${width}`)

      // Toggle numbers on via exposed setter
      await page.evaluate(() => window.setNumbers(true))
      await page.waitForFunction(() => {
        const body = document.body.innerText
        return /\d+%/.test(body)
      })

      const bodyTextNumsOn = await page.locator('body').innerText()
      assert.ok(numericPattern.test(bodyTextNumsOn), `numeric probabilities should be present when nums on for ${kind} at ${width}`)

      // Compare snapshot before click
      await page.waitForFunction(() => window.snapshot !== undefined)
      const snapshotBeforeClick = await page.evaluate(() => window.snapshot)
      assert.equal(await page.evaluate(() => JSON.stringify(window.game)), snapshotBeforeClick, 'render and number switch must not mutate game')
      await page.screenshot({ path: resolve(output, `${width}-${kind}-before.png`) })

      // Click a scene option button
      const optionButton = page.locator('.node-opt button').first()
      await optionButton.waitFor()
      await optionButton.click()
      await page.waitForFunction(() => window.game.me.duelLive.rounds.length === 1)
      assert.equal(await page.evaluate(() => window.game.me.duelLive.round), 2)
      assert.equal(await title.innerText(), titleText, 'classification remains after real scene choice')

      // Ensure game state snapshot unchanged except engine mutations from click
      const snapshotAfterClick = await page.evaluate(() => JSON.stringify(window.game))
      assert.notEqual(snapshotBeforeClick, snapshotAfterClick, 'startDuel snapshot should change after scene choice')

      // No page errors or network requests
      assert.deepEqual(errors, [], `page errors for ${kind} at ${width}`)
      assert.deepEqual(blocked, [], `blocked network requests for ${kind} at ${width}`)

      // Overflow check
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      assert.ok(overflow <= 1, `horizontal overflow ${overflow}px for ${kind} at ${width}`)
      assert.equal(await page.locator('.modal').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'modal content must not be clipped horizontally')
      for (const side of await page.locator('.score-line .t').all()) {
        assert.equal(await side.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'scoreboard player column must fit')
      }

      await page.screenshot({ path: resolve(output, `${width}-${kind}.png`) })

      console.log(`PASS duel relation UI width=${width} kind=${kind}`)
      await page.close()
    }
  }
} finally {
  await browser?.close()
  await new Promise(r => server.close(r))
}
