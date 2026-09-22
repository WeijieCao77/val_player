import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=resolve(root,'.cache/milestone-qualify-ui');mkdirSync(output,{recursive:true})
const compiled=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
import React,{useReducer} from 'react';import {createRoot} from 'react-dom/client';import {GameCtx} from './src/ui/me/ctx';
import AchievementsScreen from './src/ui/me/AchievementsScreen';import MomentQueue from './src/ui/me/MomentQueue';
import {createCareer,emptyTalents} from './src/engine/me/career';import {pushMoment,takeMoment} from './src/engine/me/moments';
import './src/ui/me/base.css';import './src/me.css';
const game=createCareer({name:'里程碑资格界面测试',region:'Europe',role:'决斗者',talents:emptyTalents(),originKey:'netcafe',start:'t1',seed:741,year:2026});
game.players[game.me.id].career.maps=999;game.me.moments=[];
pushMoment(game,{kind:'qualify',key:'first1',comp:'东京大师赛'});pushMoment(game,{kind:'qualify',key:'repeat2',comp:'上海大师赛'});pushMoment(game,{kind:'qualify',key:'first3',comp:'全球冠军赛'});pushMoment(game,{kind:'title',key:'title4',comp:'全球冠军赛'});pushMoment(game,{kind:'sign',key:'sign5',teamId:game.myTeam});
window.game=game;window.original=JSON.stringify(game);
function App(){const[,bump]=useReducer(x=>x+1,0);window.refresh=bump;window.takeFirst=()=>{takeMoment(game);bump()};
return <GameCtx.Provider value={{game,commit:bump,toast:()=>{},openPlayer:()=>{},openMatch:()=>{},go:()=>{},startTutorial:()=>{}}}><div className="app career"><div className="body"><main className="main"><AchievementsScreen/><MomentQueue/></main></div></div></GameCtx.Provider>};createRoot(document.getElementById('root')).render(<App/>);
`},absWorkingDir:root,bundle:true,write:false,outfile:'app.js',format:'esm',platform:'browser',jsx:'automatic',define:{'import.meta.env.BASE_URL':'"/"','import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'}})
const files=new Map(compiled.outputFiles.map(f=>[extname(f.path),f.contents]));const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(req.method!=='GET'){res.writeHead(405);res.end();return}if(path==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');return}if(path==='/app.js'||path==='/app.css'){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');res.end(files.get(extname(path)));return}res.writeHead(404);res.end()})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;let browser
try{browser=await chromium.launch({headless:true});for(const width of[320,390,1440]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===origin&&route.request().method()==='GET'?route.continue():route.abort());await page.goto(origin)
 const select=page.locator('.moment select');await select.waitFor();assert.equal(await page.locator('select').count(),2)
 assert.equal(await page.evaluate(()=>JSON.stringify(window.game)===window.original),true,'render is read-only')
 assert.equal(await page.getByRole('progressbar',{name:'千图征途',exact:true}).getAttribute('value'),'999')
 await select.focus();await select.press('Enter');assert.equal(await page.evaluate(()=>window.game.me.moments[0].key),'first1','select Enter does not take card')
 await select.press('Enter');assert.equal(await page.evaluate(()=>window.game.me.moments[0].key),'first1','native option confirmation does not take card')
 await select.selectOption('first');assert.deepEqual(await page.evaluate(()=>window.game.me.moments.map(m=>m.key)),['first1','first3','title4','sign5'])
 assert.equal(await page.locator('select').first().inputValue(),'first');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
 await select.press('Tab');assert.equal(await page.evaluate(()=>window.game.me.qualifyAlerts.mode),'first');await page.screenshot({path:resolve(output,`${width}-qualify.png`)});
 await page.evaluate(()=>window.takeFirst());assert.match(await page.locator('.mo-title').innerText(),/全球冠军赛/)
 await page.evaluate(()=>window.takeFirst());assert.equal(await page.locator('.mo-title').innerText(),'世界冠军');assert.equal(await page.locator('.moment select').count(),0)
 await page.evaluate(()=>window.takeFirst());assert.match(await page.locator('.mo-title').innerText(),/加盟/)
 await page.evaluate(()=>window.takeFirst());await page.locator('.moment').waitFor({state:'detached'})
 const settings=page.locator('.qualify-alert-settings select');await settings.selectOption('yearly');assert.equal(await page.evaluate(()=>window.game.me.qualifyAlerts.mode),'yearly')
 await page.evaluate(()=>{window.game.me.qualifyAlerts={mode:'bad',yearFirstKeys:{masters:{year:'broken',key:7}}};window.refresh()});assert.equal(await settings.inputValue(),'all')
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,`${width}-achievements.png`)});assert.deepEqual(errors,[])
 console.log('PASS milestone/qualify UI',width,'real achievements + moment, counter, mode filtering, keyboard, preserved title/sign, malformed preference, no overflow');await page.close()
}}finally{await browser?.close();await new Promise(r=>server.close(r))}
