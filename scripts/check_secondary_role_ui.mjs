import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=resolve(root,'.cache/secondary-role-ui');mkdirSync(output,{recursive:true})
const compiled=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
import React,{useReducer} from 'react';import {createRoot} from 'react-dom/client';import {GameCtx} from './src/ui/me/ctx';
import SecondaryRole from './src/ui/me/SecondaryRole';import {Roles} from './src/ui/me/common';import {useNumbers} from './src/ui/me/words';
import {createCareer,emptyTalents} from './src/engine/me/career';import './src/ui/me/base.css';import './src/me.css';
const game=createCareer({name:'副位置本地界面测试',region:'EMEA',role:'决斗者',talents:emptyTalents(),originKey:'netcafe',start:'pre',seed:741,year:2026});game.me.week=26;game.me.pending=[];window.game=game;window.original=JSON.stringify(game);
function App(){const[,bump]=useReducer(x=>x+1,0);const[nums,setNums]=useNumbers();window.refresh=bump;return <GameCtx.Provider value={{game,commit:bump,toast:()=>{},openPlayer:()=>{},openMatch:()=>{},go:()=>{},startTutorial:()=>{}}}><div className="app career"><div className="body"><main className="main"><button onClick={()=>setNums(!nums)}>数值 {nums?'开':'关'}</button><Roles p={game.players[game.me.id]}/><SecondaryRole/></main></div></div></GameCtx.Provider>};createRoot(document.getElementById('root')).render(<App/>);
`},absWorkingDir:root,bundle:true,write:false,outfile:'app.js',format:'esm',platform:'browser',jsx:'automatic',define:{'import.meta.env.BASE_URL':'"/"','import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'}})
const files=new Map(compiled.outputFiles.map(f=>[extname(f.path),f.contents]));const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(req.method!=='GET'){res.writeHead(405);res.end();return}if(path==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');return}if(path==='/app.js'||path==='/app.css'){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');res.end(files.get(extname(path)));return}res.writeHead(404);res.end()})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;let browser
try{browser=await chromium.launch({headless:true});for(const width of[320,390,1440]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],blocked=[],dialogs=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===origin&&route.request().method()==='GET'?route.continue():(blocked.push(route.request().url()),route.abort()));await page.goto(origin)
 const choose=page.getByRole('button',{name:'培养先锋',exact:true});await choose.waitFor();assert.equal(await page.evaluate(()=>JSON.stringify(window.game)===window.original),true,'render is read-only')
 page.once('dialog',d=>d.dismiss());await choose.click();assert.equal(await page.evaluate(()=>window.game.me.positionTraining.secondary),undefined)
 page.on('dialog',async d=>{dialogs.push(d.message());await d.accept()});await choose.click();assert.ok(await page.getByRole('button',{name:'改选控场',exact:true}).isEnabled())
 await page.getByRole('button',{name:'训练副位置',exact:true}).click();assert.ok(await page.getByRole('button',{name:'训练副位置',exact:true}).isDisabled());assert.equal(await page.evaluate(()=>window.game.me.ap),10);assert.equal(await page.evaluate(()=>window.game.players[window.game.me.id].rolePro['先锋']),2);assert.ok(dialogs.some(x=>x.includes('锁定本周此前所有可撤回行动')))
 assert.match(await page.locator('.main').innerText(),/学习中/);assert.equal(await page.locator('progress').count(),0);await page.getByRole('button',{name:'数值 关'}).click();assert.equal(await page.locator('progress').getAttribute('value'),'2')
 await page.evaluate(()=>{const m=window.game.me,p=window.game.players[m.id];m.week++;m.weekDay=0;m.ap=m.apMax;m.weekDone=[];m.plan={};delete m.trainWeek;p.rolePro['先锋']=100;p.roles=['决斗者','先锋'];window.refresh()})
 await page.getByRole('button',{name:'切换至先锋',exact:true}).click();assert.equal(await page.evaluate(()=>window.game.players[window.game.me.id].role),'先锋');assert.equal(await page.locator('.main > .row .role').first().innerText(),'先锋');assert.ok(dialogs.some(x=>x.includes('对位资本清零')))
 assert.equal(await page.evaluate(()=>window.game.players[window.game.me.id].roles[0]),'决斗者','persisted Hall identity order unchanged');assert.ok(await page.getByRole('button',{name:'切换至决斗者',exact:true}).isDisabled())
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(output,`${width}-secondary.png`)});assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);console.log('PASS secondary UI',width,'confirmation/cancel, real AP/mastery, once-weekly, number switch, active role label, no overflow/network');await page.close()
}}finally{await browser?.close();await new Promise(r=>server.close(r))}
