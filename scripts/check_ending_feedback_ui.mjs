/** Real PlayerGame + ending card + mailbox, synthetic isolated browser storage only. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/ending-feedback'); mkdirSync(output, { recursive: true })
const compiled = await build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import PlayerGame from './src/PlayerGame';
  import {createCareer,emptyTalents} from './src/engine/me/career';
  import {retire} from './src/engine/me/endings';
  import './src/ui/me/base.css'; import './src/me.css';
  const saved=sessionStorage.getItem('ending-feedback-harness');
  const game=saved?JSON.parse(saved):createCareer({name:'本地结局提示测试',region:'China',role:'决斗者',talents:emptyTalents(),originKey:'netcafe',start:'pre',seed:7,year:2022});
  if(!saved){
    retire(game,'本地测试退役','chose');
    game.me.pending=game.me.pending.filter(x=>x.kind==='ending'); game.me.moments=[];
    if(game.me.achState)game.me.achState.seen=game.me.achievements.length;
    if(new URLSearchParams(location.search).get('case')==='old'){
      delete game.me.flags.endingFeedback;game.me.pending=[];
    }
  }
  window.harnessGame=game;
  window.keepHarness=()=>sessionStorage.setItem('ending-feedback-harness',JSON.stringify(game));
  createRoot(document.getElementById('root')).render(<PlayerGame opened={game} onHome={()=>document.body.dataset.home='yes'}/>);
`, resolveDir: root, loader: 'tsx' }, absWorkingDir: root, bundle: true, write: false, outfile: 'app.js', format: 'esm', platform: 'browser', jsx: 'automatic',
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' } })
const files = new Map(compiled.outputFiles.map(f => [extname(f.path), f.contents]))
const boxRequests = []
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if(path.startsWith('/api/box/')){
    boxRequests.push(path)
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,items:[],mine:[],max:200,full:false}));return
  }
  if(req.method!=='GET'){res.writeHead(405);res.end();return}
  if(path==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');return}
  if(path==='/app.js'||path==='/app.css'){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');res.end(files.get(extname(path)));return}
  res.writeHead(404);res.end()
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin=`http://127.0.0.1:${server.address().port}`
let browser
try{
  browser=await chromium.launch({headless:true,args:['--mute-audio']})
  for(const width of [320,1280])for(const scenario of ['old','later','go']){
    // newPage creates a fresh context: never touches a user's real domain/save.
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort())
    await page.addInitScript(()=>{HTMLMediaElement.prototype.play=async()=>{};localStorage.setItem('valplayer.music',JSON.stringify({muted:true,off:true,vol:0}));localStorage.setItem('val_player.tour.off','1')})
    const before=boxRequests.length
    await page.goto(origin+'/?case='+scenario)
    await page.locator('.app.career').waitFor()
    const prompt=page.getByRole('dialog',{name:'这段生涯，有什么想告诉作者？'})
    if(scenario==='old'){
      await page.locator('.poster-me').waitFor()
      assert.equal(await prompt.count(),0)
      assert.equal(await page.evaluate(()=>window.harnessGame.me.flags.endingFeedback),undefined)
    }else{
      const verdict=page.getByRole('dialog',{name:'生涯结束',exact:true})
      await verdict.waitFor()
      assert.equal(await prompt.count(),0)
      assert.equal(await page.evaluate(()=>window.harnessGame.me.flags.endingFeedback),1)
      await verdict.getByRole('button',{name:'合上',exact:true}).click()
      await prompt.waitFor()
      await page.waitForFunction(()=>window.harnessGame.me.flags.endingFeedback===2)
      assert.equal(boxRequests.length,before,'opening the invitation must not contact the mailbox')
      const box=await prompt.boundingBox();assert.ok(box.x>=-1&&box.x+box.width<=width+1)
      await page.screenshot({path:resolve(output,width+'-'+scenario+'.png')})
      if(scenario==='later'){
        await prompt.getByRole('button',{name:'稍后再说',exact:true}).click()
        assert.equal(await prompt.count(),0)
        await page.locator('.poster-me').waitFor()
      }else{
        await prompt.getByRole('button',{name:'前往信箱',exact:true}).click()
        await page.locator('.main textarea').waitFor()
        assert.equal(await page.locator('.main .poster-me').count(),0,'mailbox must not be buried under the ending poster')
        assert.equal(await page.locator('.main textarea').inputValue(),'','nothing is prefilled or sent')
        await page.getByRole('button',{name:'本周',exact:true}).click()
        await page.locator('.main .poster-me').waitFor()
      }
      await page.evaluate(()=>window.keepHarness())
      await page.reload();await page.locator('.app.career').waitFor();await page.locator('.main .poster-me').waitFor()
      assert.equal(await prompt.count(),0,'reload must not repeat the invitation')
      assert.equal(await page.evaluate(()=>window.harnessGame.me.flags.endingFeedback),2)
    }
    assert.deepEqual(errors,[])
    assert.ok(boxRequests.every(path=>path==='/api/box/list'),'must never submit a suggestion or a vote')
    console.log('PASS',width,scenario)
    await page.close()
  }
}finally{await browser?.close();await new Promise(r=>server.close(r))}
