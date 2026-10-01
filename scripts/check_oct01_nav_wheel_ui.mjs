import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), output = resolve(root, '.cache/nav-wheel-ui')
mkdirSync(output, { recursive: true })
const shell = readFileSync(resolve(root, 'src/PlayerGame.tsx'), 'utf8')
assert.ok(shell.includes('ref={navRef}') && shell.includes('data-screen={s.key}') && shell.includes('useDesktopNavWheel(screen, goScreen)'), 'production navigation binds the tested hook to its actual screens')
const compiled = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{useState,useCallback} from 'react';import{createRoot}from'react-dom/client';import{useDesktopNavWheel}from'./src/ui/me/useDesktopNavWheel';import './src/ui/me/base.css';import './src/me.css';
function App(){const[active,setActive]=useState('a'),[short,setShort]=useState(false),[modal,setModal]=useState(false);const go=useCallback(k=>{window.changes=(window.changes||0)+1;setActive(k)},[]),ref=useDesktopNavWheel(active,go);window.setShort=setShort;window.setModal=setModal;return <div className="app career"><div className="body"><nav className="nav" ref={ref} style={{height:short?90:700}}>{['a','b','c','d'].map(k=><div className="nav-bar" key={k}><button data-screen={k} className={'nav-item '+(active===k?'active':'')} onClick={()=>go(k)}>{k}</button></div>)}<div className="nav-foot"><button>theme</button></div></nav><main className="main" style={{height:700,overflow:'auto'}}><output>{active}</output><input aria-label="editing"/><button id="main-focus">content action</button><div style={{height:1800}}>Long content</div></main></div>{modal&&<div role="alertdialog">test modal</div>}</div>};createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, outfile: 'app.js', format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
const files = new Map(compiled.outputFiles.map(f => [extname(f.path), f.contents]))
const server = createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>'); return }
  res.setHeader('Content-Type', req.url?.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(files.get(extname(req.url ?? '')))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
let browser
try {
  browser = await chromium.launch({ headless: true })
  for (const width of [390, 720, 721, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }), errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    const nav = page.locator('nav'), value = () => page.locator('output').textContent()
    await nav.waitFor()
    const wheel = init => nav.evaluate((el, init) => { const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80, ...init }); el.dispatchEvent(e); return e.defaultPrevented }, init)
    if (width <= 720) {
      assert.equal(await wheel({}), false); assert.equal(await value(), 'a', 'phone navigation is untouched')
    } else {
      await page.locator('#main-focus').focus()
      assert.equal(await wheel({ deltaY: 10 }), true); assert.equal(await value(), 'a', 'tiny trackpad movement accumulates')
      await wheel({ deltaY: 30 }); await page.waitForFunction(() => document.querySelector('output').textContent === 'b')
      assert.equal(await page.evaluate(() => document.activeElement.id), 'main-focus', 'wheel never steals outside focus')
      await wheel({}); assert.equal(await value(), 'b', 'momentum does not skip screens')
      await page.waitForTimeout(280)
      await page.locator('[data-screen=b]').focus()
      await wheel({}); await page.waitForFunction(() => document.querySelector('output').textContent === 'c')
      assert.equal(await page.evaluate(() => document.activeElement.dataset.screen), 'c', 'keyboard focus follows only when it was already in the rail')
      await page.waitForTimeout(280)
      for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { deltaX: 100 }, { deltaY: 0 }]) assert.equal(await wheel(modifier), false)
      assert.equal(await value(), 'c')
      await page.getByLabel('editing').focus(); assert.equal(await wheel({}), false); assert.equal(await value(), 'c')
      await page.locator('#main-focus').focus()
      await page.evaluate(() => window.setModal(true)); await page.getByRole('alertdialog').waitFor()
      assert.equal(await wheel({}), false); assert.equal(await value(), 'c')
      await page.evaluate(() => window.setModal(false)); await page.getByRole('alertdialog').waitFor({ state: 'hidden' })
      await page.locator('.nav-foot').dispatchEvent('wheel', { deltaY: 80 }); assert.equal(await value(), 'c')
      await page.locator('.main').hover(); await page.mouse.wheel(0, 240)
      await page.waitForFunction(() => document.querySelector('.main').scrollTop > 0)
      assert.equal(await value(), 'c', 'main content wheel scrolls content normally')
      await page.evaluate(() => window.setShort(true)); await page.waitForFunction(() => document.querySelector('nav').clientHeight < 100)
      assert.equal(await wheel({}), false, 'overflowing rail preserves native scrolling')
      await nav.hover(); await page.mouse.wheel(0, 120); await page.waitForFunction(() => document.querySelector('nav').scrollTop > 0)
      assert.equal(await value(), 'c')
      await page.evaluate(() => window.setShort(false)); await page.waitForFunction(() => document.querySelector('nav').clientHeight > 600)
      await page.waitForTimeout(280); await wheel({ deltaY: 80, deltaMode: 1 }); await page.waitForFunction(() => document.querySelector('output').textContent === 'd')
      await page.waitForTimeout(280); await wheel({}); assert.equal(await value(), 'd', 'last screen clamps without wrapping')
      await wheel({ deltaY: -80 }); await page.waitForFunction(() => document.querySelector('output').textContent === 'c')
    }
    assert.deepEqual(errors, [])
    await page.screenshot({ path: resolve(output, `${width}.png`) })
    console.log(`PASS nav wheel ${width}: main/focus/phone/overflow/gesture boundaries`)
    await page.close()
  }
} finally { await browser?.close(); await new Promise(r => server.close(r)) }
