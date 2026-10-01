import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/real-scenarios-ui')
mkdirSync(output, { recursive: true })
const compiled = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React from 'react'; import { createRoot } from 'react-dom/client';
import NewCareer from './src/ui/me/NewCareer';
import './src/ui/me/base.css'; import './src/me.css';
function App() { return <NewCareer save={location.search.includes('saved') ? {meta:null,year:2026,day:0} : null} onStart={async opts => { window.captured=opts; return false }} onContinue={async()=>false} onSeedHall={async()=>{window.seeded=true}} onReadBackup={async()=>null}/> }
createRoot(document.getElementById('root')).render(<App/>);
` }, absWorkingDir: root, bundle: true, write: false, outfile: 'app.js', format: 'esm', platform: 'browser', jsx: 'automatic',
plugins: [{ name: 'test-start-sheet', setup(b) { b.onResolve({ filter: /^virtual:start-sheet$/ }, () => ({ path: 'virtual:start-sheet', namespace: 'test-sheet' })); b.onLoad({ filter: /.*/, namespace: 'test-sheet' }, () => ({ resolveDir: root, contents: "import {buildStartSheet} from './src/engine/me/startSheet';export default buildStartSheet()", loader: 'ts' })) } }],
define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' } })
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
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => new URL(route.request().url()).origin === origin && route.request().method() === 'GET' ? route.continue() : route.abort())
  await page.goto(origin)
  await page.locator('.newcareer').waitFor()
  assert.equal(await page.getByRole('button', { name: '真人', exact: true }).count(), 0)
  assert.equal(await page.getByRole('heading', { name: '生涯剧本' }).count(), 0)
  for (const name of ['ZmjjKK', 'Demon1', 'Boaster']) assert.equal(await page.getByRole('button', { name }).count(), 0)
  assert.equal(await page.getByRole('heading', { name: '你是谁' }).count(), 1)
  assert.equal(await page.getByRole('heading', { name: '出身' }).count(), 1)
  assert.equal(await page.getByRole('heading', { name: /天赋/ }).count(), 1)
  assert.equal(await page.getByRole('button', { name: '先选一个出身' }).isDisabled(), true)
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await page.screenshot({ path: resolve(output, `entry-hidden-${width}.png`) })
  }
  await page.goto(origin + '/?saved')
  await page.getByRole('button', { name: '开新生涯', exact: true }).click()
  assert.equal(await page.getByRole('alertdialog').count(), 1)
  assert.equal(await page.evaluate(() => !!window.captured), false)
  await page.getByRole('alertdialog').getByRole('button', { name: '开新生涯', exact: true }).click()
  assert.equal(await page.evaluate(() => window.seeded === true), true)
  assert.equal(await page.getByRole('button', { name: '真人', exact: true }).count(), 0)
  assert.equal(errors.length, 0, errors.join('; '))
  console.log('Real-career entry hidden; ordinary form and save overwrite guard passed')
} catch (e) { console.error(e); process.exitCode = 1 } finally { await browser?.close(); await new Promise(r => server.close(r)) }
