/** Real player UI, in-memory fixtures only; no account, saved career, server write or external request. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.cache/bracket-mobile'); mkdirSync(output, { recursive: true })
const compiled = await build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import Bracket from './src/ui/me/Bracket'; import CircuitPanel from './src/ui/me/CircuitPanel';
  import CupDetail from './src/ui/me/CupDetail'; import {GameCtx} from './src/ui/me/ctx';
  import {createCareer,emptyTalents} from './src/engine/me/career';
  import {eventOf} from './src/engine/circuit';
  import './src/ui/me/base.css'; import './src/me.css';
  const scenario=new URLSearchParams(location.search).get('case');
  const game=createCareer({name:'签表本地测试',region:'China',role:'决斗者',talents:emptyTalents(),originKey:'netcafe',start:'t1',seed:7,year:2026});
  const id=scenario==='swiss'?'2760':'2682';
  const base=Object.values(game.comps).find(c=>c.circuit);
  const ev=eventOf(id);
  const comp={...base,key:'test',name:ev.cn,champion:undefined,circuit:{...base.circuit,id,mode:scenario==='future'?undefined:'history',start:ev.start,end:ev.end,done:undefined}};
  game.day=ev.start+8; game.comps.test=comp;
  const noop=()=>{};
  const value={game,commit:noop,toast:noop,openPlayer:noop,openMatch:f=>document.body.dataset.opened=f.id,go:noop,startTutorial:noop};
  let body=<CircuitPanel comp={comp}/>;
  if(scenario==='legacy'){
    const ids=Object.keys(game.teams).slice(0,4); comp.format='double'; comp.circuit=undefined; comp.seeds=ids;
    game.fixtures=[{id:'click-me',comp:'test',label:'KO:1:胜者组第一轮',teamA:ids[0],teamB:ids[3],bo:3,day:2,played:true,result:{mapsWonA:2,mapsWonB:0}}];
    body=<Bracket comp={comp}/>;
  }
  if(scenario.startsWith('cup')){
    game.me.pre.cups=[]; game.me.pre.cup=undefined; game.day=0;
    if(scenario==='cup-done')game.me.pre.cups=[{key:'city',year:2026,reached:1,rounds:4,won:false,prize:0,results:['首轮 胜 1-0','八强 负 0-1']}];
    body=<CupDetail cupKey="city" onClose={noop}/>;
  }
  createRoot(document.getElementById('root')).render(<div className="app career" style={{padding:8,minWidth:0}}><GameCtx.Provider value={value}>{body}</GameCtx.Provider></div>);
`, resolveDir: root, loader: 'tsx' }, absWorkingDir: root, bundle: true, write: false, outfile: 'app.js', platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' } })
const files = new Map(compiled.outputFiles.map(f => [extname(f.path), f.contents]))
const server = createServer((req, res) => {
  if(req.method!=='GET'){res.writeHead(405);res.end();return}
  const path = new URL(req.url,'http://localhost').pathname
  if(path==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');return}
  if(path==='/app.js'||path==='/app.css'){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');res.end(files.get(extname(path)));return}
  res.writeHead(404);res.end()
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin=`http://127.0.0.1:${server.address().port}`
let browser
try{
  browser=await chromium.launch({headless:true,args:['--mute-audio']})
  for(const width of [320,390,1440]){
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    await page.route('**/*',r=>new URL(r.request().url()).origin===origin&&r.request().method()==='GET'?r.continue():r.abort())
    await page.addInitScript(()=>{indexedDB.open=()=>{throw Error('Saved careers forbidden in harness')};HTMLMediaElement.prototype.play=async()=>{};localStorage.setItem('valplayer.music',JSON.stringify({muted:true,off:true,vol:0}))})
    for(const scenario of ['future','history','swiss','legacy','cup','cup-done']){
      await page.goto(origin+'/?case='+scenario)
      await page.locator('.career-bracket-scroll').first().waitFor({state:'attached'})
      if(scenario==='future')await page.locator('.career-bracket-toggle').click()
      if(scenario==='swiss')await page.locator('.career-bracket-section summary').first().click()
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)
      assert.ok(overflow<=1,`${width} ${scenario} page overflow ${overflow}`)
      const regions=page.locator('.career-bracket-scroll:visible')
      assert.ok(await regions.count()>0)
      for(const region of await regions.all()){
        await region.scrollIntoViewIfNeeded()
        const d=await region.evaluate(el=>{el.scrollLeft=el.scrollWidth;return {w:el.clientWidth,sw:el.scrollWidth,left:el.scrollLeft,r:el.getBoundingClientRect().right}})
        assert.ok(d.r<=width+1 && d.w>0,JSON.stringify(d))
        if(d.sw>d.w+1)assert.ok(d.left>0,'horizontal scroll must reach last rounds')
        await region.evaluate(el=>{el.scrollLeft=0})
      }
      if(scenario==='future')assert.equal(await page.locator('.career-bracket-side.win').count(),0)
      if(scenario==='legacy'){
        await page.locator('.career-bracket-match:not(:disabled)').click()
        assert.equal(await page.locator('body').getAttribute('data-opened'),'click-me')
        assert.ok(await page.locator('path[data-outcome="l"]').count()>0)
      }
      if(scenario==='cup-done')assert.ok(await page.locator('.career-cup-route .lost').count()>0)
      await regions.first().scrollIntoViewIfNeeded()
      await page.screenshot({path:resolve(output,width+'-'+scenario+'.png')})
      assert.deepEqual(errors,[],`${width} ${scenario} runtime errors`)
      console.log('PASS',width,scenario)
    }
    await page.close()
  }
}finally{await browser?.close();await new Promise(r=>server.close(r))}
