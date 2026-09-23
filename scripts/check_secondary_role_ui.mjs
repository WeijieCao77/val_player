import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const output=resolve(root,'.cache/secondary-role-ui')
mkdirSync(output,{recursive:true})
const compiled=await build({
  stdin:{
    resolveDir:root,
    loader:'tsx',
    contents:`
import React,{useReducer} from 'react';import {createRoot} from 'react-dom/client';import {GameCtx} from './src/ui/me/ctx';
import SecondaryRole from './src/ui/me/SecondaryRole';import {Roles} from './src/ui/me/common';import {useNumbers} from './src/ui/me/words';
import {createCareer,emptyTalents} from './src/engine/me/career';import {runScheduledSecondary} from './src/engine/me/secondaryRole';import './src/ui/me/base.css';import './src/me.css';
const game=createCareer({name:'副位置本地界面测试',region:'EMEA',role:'决斗者',talents:emptyTalents(),originKey:'netcafe',start:'pre',seed:741,year:2026});game.me.week=26;game.me.pending=[];window.game=game;window.original=JSON.stringify(game);
function App(){const[,bump]=useReducer(x=>x+1,0);const[nums,setNums]=useNumbers();window.refresh=bump;window.runScheduledSecondary=()=>{const r=runScheduledSecondary(game);bump();return r;};return <GameCtx.Provider value={{game,commit:bump,toast:()=>{},openPlayer:()=>{},openMatch:()=>{},go:()=>{},startTutorial:()=>{}}}><div className='app career'><div className='body'><main className='main'><button onClick={()=>setNums(!nums)}>数值 {nums?'开':'关'}</button><Roles p={game.players[game.me.id]}/><SecondaryRole/></main></div></div></GameCtx.Provider>};createRoot(document.getElementById('root')).render(<App/>);
`
  },
  absWorkingDir:root,
  bundle:true,
  write:false,
  outfile:'app.js',
  format:'esm',
  platform:'browser',
  jsx:'automatic',
  define:{'import.meta.env.BASE_URL':'\"/\"','import.meta.env.DEV':'false','process.env.NODE_ENV':'\"production\"'}
})
const files=new Map(compiled.outputFiles.map(f=>[extname(f.path),f.contents]))
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname
  if(req.method!=='GET'){res.writeHead(405);res.end();return}
  if(path==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<!doctype html><html lang='zh-CN'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><link rel='stylesheet' href='/app.css'><div id='root'></div><script type='module' src='/app.js'></script></html>`);return}
  if(path==='/app.js'||path==='/app.css'){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');res.end(files.get(extname(path)));return}
  res.writeHead(404);res.end()
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin=`http://127.0.0.1:${server.address().port}`
let browser
try{
  browser=await chromium.launch({headless:true})
  for(const width of [320,390,1440]){
    const page=await browser.newPage({viewport:{width,height:1000}})
    const errors=[],blocked=[],nativeDialogs=[]
    page.on('pageerror',e=>errors.push(e.message))
    page.on('dialog',async d=>{nativeDialogs.push(d.message());await d.dismiss()})
    await page.route('**/*',route=>{
      const url=new URL(route.request().url())
      url.origin===origin&&route.request().method()==='GET'?route.continue():(blocked.push(route.request().url()),route.abort())
    })
    await page.goto(origin)
    const main=page.locator('.main')
    await main.waitFor()
    assert.equal(await page.evaluate(()=>JSON.stringify(window.game)===window.original),true,'render is read-only')
    assert.equal(await page.locator('progress').count(),0,'numeric default off')
    assert.equal(await page.locator('details[open]').count(),0,'details default closed')
    const baselineHeight=await main.evaluate(el=>el.getBoundingClientRect().height)

    const choose=page.getByRole('button',{name:'培养先锋',exact:true})
    await choose.waitFor()
    await choose.click()
    const dialog=page.getByRole('alertdialog')
    await dialog.waitFor()
    assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'取消','cancel initially focused')
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'确认','Tab moves to confirm')
    await page.keyboard.press('Tab')
    assert.ok(['确认','取消'].includes(await page.evaluate(()=>document.activeElement?.textContent)),'Tab traps within dialog')
    await page.screenshot({path:resolve(output,`${width}-modal-open.png`)})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'modal fits viewport')
    await page.keyboard.press('Escape')
    await dialog.waitFor({state:'hidden'})
    assert.equal(await page.getByRole('alertdialog').count(),0,'Escape closes')
    assert.equal(await page.evaluate(()=>window.game.me.positionTraining?.secondary),undefined,'cancel choose no secondary')
    assert.equal(await page.evaluate(()=>JSON.stringify(window.game)===window.original),true,'cancelled choose unchanged')

    await choose.click()
    await page.getByRole('button',{name:'确认',exact:true}).click()
    assert.equal(await page.evaluate(()=>window.game.me.positionTraining?.secondary),'先锋','confirm choose sets secondary')
    assert.equal(await page.locator('details[open]').count(),0,'selected rules remain collapsed')
    await page.locator('details summary').click()
    assert.ok(await page.getByRole('button',{name:'改选控场',exact:true}).isEnabled(),'reselect button enabled')
    await page.locator('details summary').click()
    await page.evaluate(()=>{window.game.me.ap=12;window.refresh()})
    const train=page.getByRole('button',{name:'训练副位置',exact:true})
    await train.waitFor()
    const beforeCancelTrain=await page.evaluate(()=>JSON.stringify(window.game))
    await train.click()
    await page.getByRole('button',{name:'取消',exact:true}).click()
    assert.equal(await page.evaluate(()=>JSON.stringify(window.game)),beforeCancelTrain,'cancel train full state unchanged')
    assert.equal(await page.evaluate(()=>window.game.me.ap),12,'cancel train no AP')
    await train.click()
    await page.getByRole('button',{name:'确认',exact:true}).evaluate(btn=>{btn.click();btn.click()})
    assert.equal(await page.evaluate(()=>window.game.me.ap),10,'double DOM click only one train')
    assert.equal(await page.evaluate(()=>window.game.players[window.game.me.id].rolePro['先锋']),2,'mastery 2 after one train')
    assert.equal(await page.locator('progress').count(),0,'numeric off hides progress after train')
    await page.getByRole('button',{name:'数值 关'}).click()
    assert.equal(await page.locator('progress').getAttribute('value'),'2','numeric on progress shows mastery')

    await page.evaluate(()=>{const m=window.game.me;m.week++;m.weekDay=0;m.ap=12;m.weekDone=[];m.plan={};delete m.trainWeek;window.refresh()})
    await page.getByRole('button',{name:'训练副位置',exact:true}).click()
    await page.evaluate(()=>{window.game.me.ap=0;window.refresh()})
    await page.getByRole('button',{name:'确认',exact:true}).click()
    assert.equal(await page.evaluate(()=>window.game.me.ap),0,'stale AP guarded no AP change')
    assert.equal(await page.evaluate(()=>window.game.players[window.game.me.id].rolePro['先锋']),2,'stale AP no mastery')
    await page.evaluate(()=>{window.game.me.ap=12;window.refresh()})
    await page.getByRole('button',{name:'训练副位置',exact:true}).click()
    await page.evaluate(()=>{window.game.me.positionTraining.secondary='控场';window.refresh()})
    await page.getByRole('button',{name:'确认',exact:true}).click()
    assert.equal(await page.evaluate(()=>window.game.me.ap),12,'changed secondary no AP')
    assert.equal(await page.evaluate(()=>window.game.players[window.game.me.id].rolePro['先锋']),2,'changed secondary no mastery')
    await page.evaluate(()=>{window.game.me.positionTraining.secondary='先锋';window.refresh()})

    await page.evaluate(()=>{const m=window.game.me;m.week++;m.weekDay=0;m.ap=12;m.weekDone=[];m.plan={};delete m.trainWeek;m.positionTraining.autoTrain=false;window.refresh()})
    const auto=page.getByRole('checkbox')
    await page.waitForFunction(()=>[...document.querySelectorAll('p')].some(p=>p.textContent.includes('副位置 ·')&&p.textContent.includes('先锋')))
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'compact scheduled row fits viewport')
    await page.screenshot({path:resolve(output,`${width}-auto-collapsed.png`)})
    await auto.click()
    await page.getByRole('alertdialog').waitFor()
    assert.equal(await page.evaluate(()=>window.game.me.positionTraining?.autoTrain),false,'enable dialog no immediate auto')
    await page.screenshot({path:resolve(output,`${width}-auto-modal.png`)})
    await page.getByRole('button',{name:'取消',exact:true}).click()
    assert.equal(await page.evaluate(()=>window.game.me.positionTraining?.autoTrain),false,'cancel auto false')
    await auto.click()
    await page.getByRole('button',{name:'确认',exact:true}).click()
    assert.equal(await page.evaluate(()=>window.game.me.positionTraining?.autoTrain),true,'enable auto true')
    assert.equal(await page.evaluate(()=>window.game.me.ap),12,'enable no immediate AP')
    await auto.click()
    assert.equal(await page.evaluate(()=>window.game.me.positionTraining?.autoTrain),false,'disable auto false')
    assert.equal(await page.evaluate(()=>window.game.me.ap),12,'disable no AP')
    await auto.click()
    await page.getByRole('button',{name:'确认',exact:true}).click()
    assert.equal(await page.evaluate(()=>window.game.me.positionTraining?.autoTrain),true,'reenable auto true')
    await page.evaluate(()=>window.runScheduledSecondary())
    assert.equal(await page.evaluate(()=>window.game.me.ap),10,'scheduled secondary AP')
    assert.equal(await page.evaluate(()=>window.game.players[window.game.me.id].rolePro['先锋']),4,'scheduled mastery +2')
    assert.equal(await page.evaluate(()=>window.game.me.positionTraining?.autoTrain),true,'auto still true after scheduled')

    await page.evaluate(()=>{
      const m=window.game.me,p=window.game.players[m.id];
      m.week++;m.weekDay=0;m.ap=12;m.weekDone=[];m.plan={};delete m.trainWeek;m.positionTraining.autoTrain=false;
      p.rolePro['先锋']=100;p.roles=['决斗者','先锋'];p.role='决斗者';
      window.refresh()
    })
    const details=page.locator('details')
    await details.locator('summary').click()
    assert.equal(await page.locator('details[open]').count(),1,'details expanded')
    await page.screenshot({path:resolve(output,`${width}-details-expanded.png`)})
    const switchBtn=page.getByRole('button',{name:'切换至先锋',exact:true})
    await switchBtn.click()
    await page.getByRole('alertdialog').waitFor()
    await page.getByRole('button',{name:'取消',exact:true}).click()
    assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'切换至先锋','focus restored after cancel')
    assert.equal(await page.evaluate(()=>window.game.players[window.game.me.id].role),'决斗者','cancel no switch')
    await switchBtn.click()
    await page.getByRole('button',{name:'确认',exact:true}).click()
    assert.equal(await page.evaluate(()=>window.game.players[window.game.me.id].role),'先锋','accept switch active role')
    assert.equal(await page.evaluate(()=>window.game.players[window.game.me.id].roles[0]),'决斗者','roles home first')
    assert.ok(await page.getByRole('button',{name:'切换至决斗者',exact:true}).isDisabled(),'switch once weekly disabled')

    await details.locator('summary').click()
    const finalHeight=await main.evaluate(el=>el.getBoundingClientRect().height)
    assert.ok(finalHeight>0,'final height')
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow')
    assert.deepEqual(nativeDialogs,[],'no native browser dialogs')
    assert.deepEqual(errors,[],'no page errors')
    assert.deepEqual(blocked,[],'no network requests')
    await page.screenshot({path:resolve(output,`${width}-secondary.png`)})
    console.log('PASS secondary UI',width,JSON.stringify({initialHeight:baselineHeight,collapsedHeight:finalHeight}))
    await page.close()
  }
}finally{
  await browser?.close()
  await new Promise(r=>server.close(r))
}
