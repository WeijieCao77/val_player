/** Real save-warning component, synthetic callback data only. No user storage/network. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const output=resolve(root,'.cache/save-notice-mobile'); mkdirSync(output,{recursive:true})
const built=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
import React from 'react'; import {createRoot} from 'react-dom/client';
import SaveNotice from './src/ui/me/SaveNotice'; import './src/ui/me/base.css'; import './src/me.css';
const text='LOCAL SYNTHETIC CURRENT MEMORY SNAPSHOT';
const retry=async()=>{document.body.dataset.retry='yes'; return false};
const backup=async()=>{document.body.dataset.export='current-memory';return {ok:true,text,name:'test-only.json',bytes:text.length,backup:{}}};
createRoot(document.getElementById('root')).render(<div className="app career"><SaveNotice trouble={{year:2028,day:182,kept:'2028年6月25日'}} onRetry={retry} onExport={backup}/></div>);
`},absWorkingDir:root,bundle:true,write:false,outfile:'app.js',format:'esm',platform:'browser',jsx:'automatic',
define:{'import.meta.env.BASE_URL':'"/"','import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'}})
const files=new Map(built.outputFiles.map(f=>[extname(f.path),f.contents]))
const server=createServer((req,res)=>{
  const p=new URL(req.url,'http://localhost').pathname
  if(p==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script>')}
  else if(p==='/app.js'||p==='/app.css'){res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':'text/css');res.end(files.get(extname(p)))}
  else {res.writeHead(404);res.end()}
})
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const origin=`http://127.0.0.1:${server.address().port}`
let browser; const report=[]
try {
  browser=await chromium.launch({headless:true,args:['--mute-audio']})
  for(const width of [320,390,1440]) {
    const page=await browser.newPage({viewport:{width,height:800}}), errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort())
    await page.goto(origin)
    await page.getByText('最新进度没存进这个浏览器',{exact:true}).waitFor()
    assert.match(await page.locator('.update-body').innerText(),/不要清除网站数据/)
    assert.match(await page.locator('.update-body').innerText(),/电脑有空余内存/)
    await page.getByRole('button',{name:'再试一次',exact:true}).click()
    await page.getByText(/刚才又试了一次/).waitFor()
    assert.equal(await page.locator('body').getAttribute('data-retry'),'yes')
    await page.getByRole('button',{name:'导出当前进度',exact:true}).click()
    await page.getByRole('button',{name:'下载存档文件',exact:true}).waitFor()
    assert.equal(await page.locator('body').getAttribute('data-export'),'current-memory')
    assert.equal(await page.getByRole('button',{name:'下载存档文件',exact:true}).isEnabled(),true)
    const bounds=await page.locator('.save-nudge').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:el.scrollWidth-el.clientWidth}})
    assert.ok(bounds.left>=-1&&bounds.right<=width+1&&bounds.top>=-1&&bounds.bottom<=801&&bounds.overflow<=1,JSON.stringify({width,bounds}))
    await page.screenshot({path:resolve(output,`${width}-export.png`)})
    await page.getByRole('button',{name:'收起',exact:true}).first().click()
    await page.getByRole('button',{name:'进度没存上',exact:true}).waitFor()
    await page.getByRole('button',{name:'进度没存上',exact:true}).click()
    await page.getByText('最新进度没存进这个浏览器',{exact:true}).waitFor()
    assert.deepEqual(errors,[]);report.push({width,bounds,errors}); await page.close()
    console.log(`PASS save rescue ${width}px: warning, retry, current-memory export callback, fold/reopen`)
  }
  writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2))
} finally {await browser?.close();await new Promise(r=>server.close(r))}
