import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), output = resolve(root, '.cache/real-scenarios-ui')
mkdirSync(output, { recursive: true })
const compiled = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import NewCareer from './src/ui/me/NewCareer';
import './src/ui/me/base.css';import './src/me.css';
function App(){return <NewCareer save={location.search.includes('saved')?{meta:null,year:2026,day:0}:null} onStart={async opts=>{window.captured=opts;return false}} onContinue={async()=>false} onSeedHall={async()=>{window.seeded=true}} onReadBackup={async()=>null}/>}
window.h={};
createRoot(document.getElementById('root')).render(<App/>);
` }, absWorkingDir: root, bundle: true, write: false, outfile: 'app.js', format: 'esm', platform: 'browser', jsx: 'automatic',
plugins:[{name:'test-start-sheet',setup(b){b.onResolve({filter:/^virtual:start-sheet$/},()=>({path:'virtual:start-sheet',namespace:'test-sheet'}));b.onLoad({filter:/.*/,namespace:'test-sheet'},()=>({resolveDir:root,contents:"import {buildStartSheet} from './src/engine/me/startSheet';export default buildStartSheet()",loader:'ts'}))}}],
define: { 'import.meta.env.BASE_URL':'\"/\"','import.meta.env.DEV':'false','process.env.NODE_ENV':'\"production\"' } })
const files = new Map(compiled.outputFiles.map(f => [extname(f.path), f.contents]))
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if(req.method!=='GET'){res.writeHead(405);res.end();return}
  if(path==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><link rel=\"stylesheet\" href=\"/app.css\"><div id=\"root\"></div><script type=\"module\" src=\"/app.js\"></script></html>');return}
  if(path==='/app.js'||path==='/app.css'){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');res.end(files.get(extname(path)));return}
  res.writeHead(404);res.end()
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin = `http://127.0.0.1:${server.address().port}`
let browser, checks = 0
const check = (value, label) => { assert.ok(value, label); checks++; console.log('PASS ' + label) }
try {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } }), errors = [], blocked = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => { if(new URL(route.request().url()).origin === origin && route.request().method()==='GET') return route.continue(); blocked.push(route.request().url()); return route.abort() })
  await page.addInitScript(() => { indexedDB.open = () => { throw Error('No actual saves') }; HTMLMediaElement.prototype.play = async () => {} })
  await page.goto(origin)
  await page.locator('.newcareer').waitFor()

  // Default mode is 自创 (self-created), with full form panels.
  check(await page.getByRole('button', { name: '自创' }).getAttribute('class')?.then(c => c.includes('on')), 'mode defaults to 自创')
  check(await page.getByRole('button', { name: '真人' }).count() === 1, '真人 mode button exists')

  // Initially in 自创 mode, the form is visible and start button requires 出身.
  check(await page.getByRole('button', { name: '先选一个出身' }).isDisabled(), '自创 start disabled without 出身')
  check(await page.getByRole('heading', { name: '你是谁' }).count() === 1, '自创 shows 你是谁 panel')
  check(await page.getByRole('heading', { name: '出身' }).count() === 1, '自创 shows 出身 panel')
  check(await page.getByRole('heading', { name: /天赋/ }).count() === 1, '自创 shows 天赋 panel')

  // Switch to 真人: real cards show, start is immediately enabled.
  await page.getByRole('button', { name: '真人' }).click()
  check(await page.getByRole('button', { name: 'ZmjjKK' }).count() === 1, '真人 card ZmjjKK visible')
  check(await page.getByRole('button', { name: 'Demon1' }).count() === 1, '真人 card Demon1 visible')
  check(await page.getByRole('button', { name: 'Boaster' }).count() === 1, '真人 card Boaster visible')
  check(await page.getByRole('button', { name: '自创' }).getAttribute('class')?.then(c => !c.includes('on')), '自创 button not active after switching')
  check(await page.getByRole('button', { name: '真人' }).getAttribute('class')?.then(c => c.includes('on')), '真人 button active after switching')
  check(await page.getByRole('heading', { name: '你是谁' }).count() === 0, '真人 hides 你是谁 panel')
  check(await page.getByRole('heading', { name: '出身' }).count() === 0, '真人 hides 出身 panel')
  check(await page.getByRole('heading', { name: /天赋/ }).count() === 0, '真人 hides 天赋 panel')
  check(await page.getByRole('button', { name: '开始生涯', exact: true }).isDisabled() === false, '真人 start enabled without 出身/天赋')

  // Each real card submits its actual start, independent of the hidden ordinary form.
  for (const [name, scenario, year, region, role] of [['ZmjjKK', 'zmjjkk-2024', 2024, 'China', '决斗者'], ['Demon1', 'demon1-2023', 2023, 'Americas', '决斗者'], ['Boaster', 'boaster-2023', 2023, 'EMEA', '控场']]) {
    await page.getByRole('button', { name, exact: false }).click()
    await page.getByRole('button', { name: '开始生涯', exact: true }).click()
    await page.waitForFunction(() => !!window.captured)
    check(await page.evaluate(s => window.captured.scenario === s, scenario), `real card ${name} sets scenario ${scenario}`)
    check(await page.evaluate(y => window.captured.year === y, year), `actual year for ${name}`)
    check(await page.evaluate(r => window.captured.region === r, region), `actual region for ${name}`)
    check(await page.evaluate(r => window.captured.role === r, role), `actual role for ${name}`)
    check(await page.evaluate(n => window.captured.name === n && window.captured.originKey === 'real' && window.captured.start === 't1' && Object.values(window.captured.talents).every(v => v === 0), name), `actual identity and neutral talent for ${name}`)
    check(await page.evaluate(() => 'realKey' in window.captured === false && 'mode' in window.captured === false), `captured does not expose realKey/mode for ${name}`)
    await page.evaluate(() => { window.captured = undefined })
  }

  // Back to 自创: full form returns, start disabled again without 出身.
  await page.getByRole('button', { name: '自创' }).click()
  check(await page.getByRole('heading', { name: '你是谁' }).count() === 1, '自创 restores 你是谁 panel')
  check(await page.getByRole('heading', { name: '出身' }).count() === 1, '自创 restores 出身 panel')
  check(await page.getByRole('heading', { name: /天赋/ }).count() === 1, '自创 restores 天赋 panel')
  check(await page.getByRole('button', { name: '先选一个出身' }).isDisabled(), '自创 start disabled again without 出身')

  // Screenshots at 320/390/1280, no horizontal overflow.
  await page.getByRole('button', { name: '真人' }).click()
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal overflow at ${width}`)
    await page.screenshot({ path: resolve(output, `new-${width}.png`) })
  }

  await page.goto(origin + '/?saved')
  check(await page.getByRole('button', { name: '真人', exact: true }).count() === 0, 'existing save initially hides creation form')
  await page.getByRole('button', { name: '开新生涯', exact: true }).click()
  check(await page.getByRole('alertdialog').count() === 1, 'existing save requires overwrite confirmation')
  check(await page.evaluate(() => !window.captured), 'confirmation has not created a career')
  await page.getByRole('alertdialog').getByRole('button', { name: '开新生涯', exact: true }).click()
  await page.getByRole('button', { name: '真人', exact: true }).click()
  check(await page.evaluate(() => window.seeded === true), 'old save seeds hall before replacing')
  await page.getByRole('button', { name: 'Demon1', exact: false }).click()
  await page.getByRole('button', { name: '开始生涯', exact: true }).click()
  await page.waitForFunction(() => window.captured?.scenario === 'demon1-2023')
  check(await page.evaluate(() => window.captured.year === 2023), 'confirmed existing-save flow opens selected real start')
  check(errors.length === 0, 'no page errors: ' + errors.join(';'))
  check(blocked.length === 0, 'no remote/network requests')
  console.log(`Real scenarios browser checks passed: ${checks}`)
} catch(e) { console.error(e); process.exitCode = 1 } finally { await browser?.close(); await new Promise(r => server.close(r)) }
