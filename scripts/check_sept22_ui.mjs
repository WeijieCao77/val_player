/** DeepSeek's UI test draft, corrected against real component/engine signatures. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=resolve(root,'.cache/sept22-ui')
mkdirSync(output,{recursive:true})
const compiled=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
import React,{useReducer,useState} from 'react';import {createRoot} from 'react-dom/client';import {GameCtx} from './src/ui/me/ctx';
import Week from './src/ui/me/Week';import TeamScreen from './src/ui/me/TeamScreen';import MeScreen from './src/ui/me/MeScreen';
import PlayerCard from './src/ui/me/PlayerCard';import {useNumbers} from './src/ui/me/words';import {ATTR_KEYS} from './src/engine/types';
import {createCareer,emptyTalents} from './src/engine/me/career';import './src/ui/me/base.css';import './src/me.css';
const game=createCareer({name:'界面测试',region:'China',role:'决斗者',talents:emptyTalents(),originKey:'netcafe',start:'t1',seed:20260922,year:2026});
game.me.week=26;game.me.pending=[];game.me.ap=game.me.apMax;window.game=game;window.attrKeys=ATTR_KEYS;window.openCalls=[];
function App(){const[,bump]=useReducer(x=>x+1,0),[openId,setOpenId]=useState(null),[view,setView]=useState('team'),[nums,setNums]=useNumbers();window.refresh=bump;
const ctx={game,commit:bump,toast:()=>{},openPlayer:id=>{window.openCalls.push(id);setOpenId(id)},openMatch:()=>{},go:()=>{},startTutorial:()=>{}};
return <GameCtx.Provider value={ctx}><div className="app career"><div className="body"><main className="main"><div className="row wrap">
<button onClick={()=>setNums(!nums)}>数值 {nums?'开':'关'}</button><button onClick={()=>setView('week')}>Week</button><button onClick={()=>setView('team')}>Team</button><button onClick={()=>setView('me')}>Me</button></div>
{view==='week'&&<Week onAdvance={()=>{}} onAdvanceUntil={()=>{}}/>}{view==='team'&&<TeamScreen/>}{view==='me'&&<MeScreen/>}
{openId&&<PlayerCard playerId={openId} onClose={()=>setOpenId(null)}/>}</main></div></div></GameCtx.Provider>}
createRoot(document.getElementById('root')).render(<App/>);
`},absWorkingDir:root,bundle:true,write:false,outfile:'app.js',platform:'browser',format:'esm',jsx:'automatic',define:{'import.meta.env.BASE_URL':'"/"','import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'}})
const files=new Map(compiled.outputFiles.map(f=>[extname(f.path),f.contents]))
const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(req.method!=='GET'){res.writeHead(405);res.end();return}
 if(path==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');return}
 if(path==='/app.js'||path==='/app.css'){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');res.end(files.get(extname(path)));return}
 const publicRoot=resolve(root,'public'),asset=resolve(publicRoot,'.'+decodeURIComponent(path)),mime={'.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'}[extname(asset)]
 if(asset.startsWith(publicRoot+sep)&&mime&&existsSync(asset)){res.setHeader('Content-Type',mime);res.end(readFileSync(asset));return}
 res.writeHead(404);res.end()})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`
let browser
try{browser=await chromium.launch({headless:true});for(const width of [320,390,1440]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],blocked=[],dialogs=[]
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss()})
 await page.addInitScript(()=>{localStorage.setItem('val_player.numbers','0');indexedDB.open=()=>{throw Error('No actual saves')};HTMLMediaElement.prototype.play=async()=>{}})
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin&&route.request().method()==='GET')return route.continue();blocked.push(url.origin+url.pathname);return route.abort()})
 await page.goto(origin)
 const snapshot=()=>page.evaluate(()=>JSON.stringify(window.game))
 const overflow=async label=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label} no page overflow at ${width}`)
 const close=async()=>{await page.getByRole('dialog').getByRole('button',{name:/关闭/}).click();await page.getByRole('dialog').waitFor({state:'hidden'})}
 await page.getByRole('button',{name:'Week',exact:true}).click();const details=page.locator('details.secondary-weekly');await details.waitFor()
 assert.equal(await details.evaluate(e=>e.open),false);const beforeOpen=await snapshot();await details.locator(':scope > summary').click();assert.equal(await snapshot(),beforeOpen,'opening the manual entry is read-only')
 const choose=details.getByRole('button',{name:'培养先锋',exact:true});await choose.click();const alert=page.getByRole('alertdialog');await alert.waitFor();
 assert.ok((await alert.innerText()).includes('首次投入训练后不能更换'));
 await alert.getByRole('button',{name:'取消',exact:true}).click();await alert.waitFor({state:'hidden'});
 assert.equal(await snapshot(),beforeOpen,'cancel choosing keeps whole world unchanged');
 await choose.click();await alert.waitFor();await alert.getByRole('button',{name:'确认',exact:true}).click();
 await page.waitForFunction(()=>window.game.me.positionTraining.secondary==='先锋');
 await alert.waitFor({state:'hidden'});
 const summary=details.locator(':scope > summary'),auto=details.getByRole('checkbox');
 const manualLabel='手动安排，不自动扣行动点',autoLabel='已开启每周自动训练，推进或按推荐时执行';
 assert.ok((await summary.innerText()).includes(manualLabel));assert.equal(await auto.isChecked(),false);
 const beforeAuto=await snapshot(),autoAP=await page.evaluate(()=>window.game.me.ap);
 await auto.click();await alert.waitFor();assert.match(await alert.innerText(),/开启本身不扣点/);
 await alert.getByRole('button',{name:'取消',exact:true}).click();await alert.waitFor({state:'hidden'});
 assert.equal(await snapshot(),beforeAuto,'cancel auto authorization leaves entire state unchanged');
 assert.equal(await auto.isChecked(),false);assert.ok((await summary.innerText()).includes(manualLabel));
 await auto.click();await alert.waitFor();await alert.getByRole('button',{name:'确认',exact:true}).click();await alert.waitFor({state:'hidden'});
 await page.waitForFunction(()=>window.game.me.positionTraining.autoTrain===true);
 await page.waitForFunction(()=>document.querySelector('details.secondary-weekly > summary')?.textContent.includes('已开启每周自动训练'));
 assert.equal(await page.evaluate(()=>window.game.me.ap),autoAP,'enabling authorizes only; no AP spent');
 assert.equal(await auto.isChecked(),true);assert.ok((await summary.innerText()).includes(autoLabel));
 await auto.uncheck();await page.waitForFunction(()=>window.game.me.positionTraining.autoTrain===false);
 await page.waitForFunction(()=>document.querySelector('details.secondary-weekly > summary')?.textContent.includes('手动安排，不自动扣行动点'));
 assert.equal(await page.evaluate(()=>window.game.me.ap),autoAP,'disabling does not spend AP');assert.ok((await summary.innerText()).includes(manualLabel));
 const train=details.getByRole('button',{name:'训练副位置',exact:true});assert.ok(await train.isEnabled());
 const beforeCancel=await snapshot();await train.click();await alert.waitFor();
 assert.ok((await alert.innerText()).includes('本次不可撤回'));
 await alert.getByRole('button',{name:'取消',exact:true}).click();await alert.waitFor({state:'hidden'});
 assert.equal(await snapshot(),beforeCancel,'cancel training no mutations');
 const trainingBefore=await page.evaluate(()=>({ap:window.game.me.ap,fatigue:window.game.players[window.game.me.id].fatigue}));
 await train.click();await alert.waitFor();
 assert.ok((await alert.innerText()).includes('本次不可撤回'));
 assert.ok((await alert.innerText()).includes('锁定本周此前所有可撤回行动'));
 await alert.getByRole('button',{name:'确认',exact:true}).click();
 await page.waitForFunction(()=>window.game.players[window.game.me.id].rolePro['先锋']===2);
 assert.deepEqual(await page.evaluate(()=>({ap:window.game.me.ap,fatigue:window.game.players[window.game.me.id].fatigue,mastery:window.game.players[window.game.me.id].rolePro.先锋})),{ap:trainingBefore.ap-2,fatigue:trainingBefore.fatigue+4,mastery:2});
 await alert.waitFor({state:'hidden'});
 await page.waitForFunction(()=>{
   const btn=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('训练副位置'));
   return btn && btn.disabled;
 });
 assert.ok(await train.isDisabled());assert.deepEqual(dialogs,[]);await overflow('Week');await details.screenshot({path:resolve(output,`${width}-weekly.png`)})
 const afterTrain=await snapshot();await details.locator(':scope > summary').click();await details.locator(':scope > summary').click();assert.equal(await snapshot(),afterTrain,'reopening never repeats training')

 await page.getByRole('button',{name:'Team',exact:true}).click();await page.locator('table').first().waitFor();await overflow('Team')
 const mine=page.locator('tbody tr.me'),npc=page.locator('tbody tr:not(.me)').first();const myId=await page.evaluate(()=>window.game.me.id),npcName=(await npc.locator('.team-player-open').innerText()).trim()
 const beforeCard=await snapshot();await mine.locator('td').nth(3).click();let modal=page.getByRole('dialog');await modal.waitFor();assert.equal(await page.evaluate(()=>window.openCalls.at(-1)),myId);assert.match(await modal.innerText(),/界面测试/)
 assert.equal(await modal.locator('.ability-radar-off').count(),1,'my card hides exact radar with numbers off');assert.equal(await modal.locator('.player-attribute-row .bar').count(),0,'my card hides exact attribute bars');assert.equal(await modal.locator('.player-attribute-row').count(),8)
 assert.ok(!(await modal.locator('.player-attribute-row').allTextContents()).some(t=>/\d/.test(t)),'my card uses qualitative eight attributes')
 await modal.screenshot({path:resolve(output,`${width}-my-card-words.png`)});await close();assert.equal(await snapshot(),beforeCard,'opening own card is read-only')
 for(const key of ['Enter','Space']){const calls=await page.evaluate(()=>window.openCalls.length);await mine.locator('.team-player-open').focus();await page.keyboard.press(key);await modal.waitFor();assert.equal(await page.evaluate(()=>window.openCalls.length),calls+1,`${key} opens once`);assert.equal(await page.evaluate(()=>window.openCalls.at(-1)),myId);await close()}
 await npc.locator('td').nth(3).click();await modal.waitFor();assert.ok((await modal.innerText()).includes(npcName));assert.notEqual(await page.evaluate(()=>window.openCalls.at(-1)),myId);assert.equal(await modal.locator('.player-attribute-row .bar').count(),8,'existing NPC attribute policy unchanged');await close()
 await page.getByRole('button',{name:'数值 关',exact:true}).click();await mine.locator('.team-player-open').click();await modal.waitFor();assert.equal(await modal.locator('.ability-radar-axis').count(),8);assert.equal(await modal.locator('.player-attribute-row .bar').count(),8);await modal.screenshot({path:resolve(output,`${width}-my-card-numbers.png`)});await close()

 await page.getByRole('button',{name:'Me',exact:true}).click();let radar=page.locator('#my-abilities .ability-radar');await radar.waitFor()
 await page.evaluate(()=>{const p=window.game.players[window.game.me.id],values=[0,11,22,33,44,55,66,99];window.attrKeys.forEach((k,i)=>p.attrs[k]=values[i]);window.refresh()})
 await page.waitForFunction(()=>document.querySelector('#my-abilities .ability-radar-value-label')?.textContent==='0')
 const keys=['枪法','反应','意识','道具','残局','协同','沟通','指挥'];assert.deepEqual(await radar.locator('.ability-radar-label').allTextContents(),keys);assert.equal(await radar.locator('.ability-radar-axis').count(),8)
 assert.deepEqual((await radar.locator('.ability-radar-value-label').allTextContents()).map(Number),[0,11,22,33,44,55,66,99]);assert.equal(await radar.locator('.ability-radar-ring').count(),3)
 const pts=(await radar.locator('.ability-radar-data').getAttribute('points')).split(' ').map(p=>p.split(',').map(Number));assert.equal(pts.length,8)
 for(const [i,v]of [0,11,22,33,44,55,66,99].entries()){const a=Math.PI*2*i/8-Math.PI/2;assert.ok(Math.abs(pts[i][0]-(150+Math.cos(a)*96*v/99))<1e-8);assert.ok(Math.abs(pts[i][1]-(150+Math.sin(a)*96*v/99))<1e-8)}
 assert.deepEqual(pts[0],[150,150],'zero stays at center, not a fabricated minimum');assert.match(await radar.locator('desc').textContent(),/枪法：0/);assert.equal(await page.locator('#my-abilities .attr-row:has(.attr-track)').count(),8,'existing bars retained')
 await overflow('Me');await radar.screenshot({path:resolve(output,`${width}-radar.png`)})
 await page.evaluate(()=>{const p=window.game.players[window.game.me.id];p.attrs.aim=NaN;p.attrs.reaction=-4;p.attrs.awareness=120;window.refresh()})
 await page.waitForFunction(()=>document.querySelectorAll('#my-abilities .ability-radar-value-label')[2]?.textContent==='99');assert.deepEqual((await radar.locator('.ability-radar-value-label').allTextContents()).slice(0,3),['0','0','99'])
 // Keep malformed-fixture values outside other UI while testing number-off's data independence.
 await page.evaluate(()=>{window.game.players[window.game.me.id].attrs.aim=13;window.refresh()});await page.getByRole('button',{name:'数值 开',exact:true}).click()
 const off=page.locator('#my-abilities .ability-radar-off');await off.waitFor();assert.equal(await off.locator('svg').count(),0);assert.equal(await page.locator('#my-abilities .ability-radar-data').count(),0);const offHtml=await off.evaluate(e=>e.outerHTML)
 await page.evaluate(()=>{const p=window.game.players[window.game.me.id];window.attrKeys.forEach(k=>p.attrs[k]=77);window.refresh()});assert.equal(await off.evaluate(e=>e.outerHTML),offHtml,'numbers-off markup and geometry independent of real attributes');assert.equal(await page.locator('#my-abilities .attr-row:has(.attr-track)').count(),8)
 await overflow('Me words');assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);console.log(`PASS ${width}px: manual weekly reuse/cancel/cost, own/NPC card+keyboard, eight-axis 0–99 geometry/privacy, existing bars/no overflow/network`);await page.close()
}}finally{await browser?.close();await new Promise(r=>server.close(r))}
