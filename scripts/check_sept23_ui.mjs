import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), output = resolve(root, '.cache/sept23-ui')
mkdirSync(output, { recursive: true })
const compiled = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {GameCtx} from './src/ui/me/ctx';
import Standings, { PointsPanel } from './src/ui/me/Standings';
import NewCareer from './src/ui/me/NewCareer';
import {createCareer, emptyTalents} from './src/engine/me/career';
import {performanceRating} from './src/engine/performance';
import {setNumbers} from './src/ui/me/words';
import {ORIGINS, originOf} from './src/engine/me/origins';
import {ATTR_CN} from './src/engine/types';
import './src/ui/me/base.css';import './src/me.css';

const opts={name:'UI测试',region:'China',role:'先锋',talents:emptyTalents(),originKey:'netcafe',start:'pre',seed:741,year:2026};
const game=createCareer(opts);
const originalTeamIds=Object.keys(game.teams); if(originalTeamIds.length<3) throw new Error('need 3 teams');
const first3=originalTeamIds.slice(0,3);
const longTeamId=first3[0];
game.teams[longTeamId].name='超长战队名LongTeam超长战队名LongTeam超长战队名LongTeam';
game.teams[longTeamId].tag='超长TAG超长TAG超长TAG';
for(const p of Object.values(game.players)) { p.season.maps=0; }
const realBase=Object.values(game.players).find(p=>p.teamId && p.season && typeof p.season==='object');
if(!realBase) throw new Error('no base player with team');
for(let i=0;i<45;i++){
 const p=structuredClone(realBase);
 p.id='UiRanked'+String(i).padStart(2,'0');
 p.ign='UiRanked'+String(i).padStart(2,'0');
 p.teamId=first3[i%first3.length];
 p.season.maps=8+i;
 p.season.rounds=100+i*10;
 p.season.kills=80+i*5;
 p.season.deaths=60+i*3;
 p.season.assists=10+i;
 p.season.damage=15000+i*400;
 p.season.firstKills=8+i;
 p.season.firstDeaths=4+i;
 game.players[p.id]=p;
}
const rare=structuredClone(realBase); rare.id='UiRareZero'; rare.ign='UiRareZero'; rare.teamId=''; rare.season.maps=0; rare.season.rounds=0; rare.season.kills=0; rare.season.deaths=0; rare.season.assists=0; rare.season.damage=0; rare.season.firstKills=0; rare.season.firstDeaths=0; game.players[rare.id]=rare;
const low=structuredClone(realBase); low.id='UiRareLow'; low.ign='UiRareLow'; low.teamId=first3[0]; low.season.maps=2; low.season.rounds=20; low.season.kills=10; low.season.deaths=12; low.season.assists=5; low.season.damage=2000; low.season.firstKills=3; low.season.firstDeaths=4; game.players[low.id]=low;
for(let i=0;i<30;i++){
 const p=structuredClone(realBase);
 p.id='UiMany'+String(i).padStart(2,'0');
 p.ign='UiMany'+String(i).padStart(2,'0');
 p.teamId=first3[i%first3.length];
 p.season.maps=0;
 game.players[p.id]=p;
}
const ranked=Object.values(game.players).filter(p=>p.season.maps>=8 && p.teamId).sort((a,b)=>performanceRating(b.season)-performanceRating(a.season)).slice(0,40);
const expectedBaseIDs=ranked.map(p=>p.id); const expectedBaseIGNs=ranked.map(p=>p.ign);
rare.realName='测试实名唯一';
const snapshot=JSON.stringify(game);
const openPlayerCalls=[];
const openPlayer=(id)=>openPlayerCalls.push(id);
const commit=()=>{};
function PointsFixture(){ return <PointsPanel table={{pool:'China',regions:['China'],league:'China',rows:[{team:longTeamId,points:123,mark:'direct'},{team:first3[1],points:100,mark:'direct'},{team:first3[2],points:80,mark:'lcq'}],direct:2,lcq:1,stage2:3,basis:'standing',lcqBasis:null}}/>; }
function App(){
 const params=new URLSearchParams(location.search);
 const [view,setView]=useState(params.get('view')||'standings');
 window.h=Object.assign(window.h||{}, {setView:setView, setNumbers:setNumbers, game:game, snapshot:snapshot, expectedBaseIDs:expectedBaseIDs, expectedBaseIGNs:expectedBaseIGNs, openPlayerCalls:openPlayerCalls, commit:commit, ORIGINS:ORIGINS, originOf:originOf, ATTR_CN:ATTR_CN, createCareer:createCareer, opts:opts, captured:null});
 const ctx={game:game, commit:commit, toast:()=>{}, openPlayer:openPlayer, openMatch:()=>{}, go:()=>{}, startTutorial:()=>{}};
 if(view==='new') return <NewCareer save={null} onStart={async opts=>{window.h.captured=opts;return false}} onContinue={async()=>false} onSeedHall={async()=>{}} onReadBackup={async()=>null}/>;
 if(view==='points') return <GameCtx.Provider value={ctx}><div className='app career'><div className='body'><main className='main'><PointsFixture/></main></div></div></GameCtx.Provider>;
 return <GameCtx.Provider value={ctx}><div className='app career'><div className='body'><main className='main'><Standings/></main></div></div></GameCtx.Provider>;
}
createRoot(document.getElementById('root')).render(<App/>);
` }, absWorkingDir: root, bundle: true, write: false, outfile: 'app.js', format: 'esm', platform: 'browser', jsx: 'automatic',
plugins:[{name:'test-start-sheet',setup(b){b.onResolve({filter:/^virtual:start-sheet$/},()=>({path:'virtual:start-sheet',namespace:'test-sheet'}));b.onLoad({filter:/.*/,namespace:'test-sheet'},()=>({resolveDir:root,contents:"import {buildStartSheet} from './src/engine/me/startSheet';export default buildStartSheet()",loader:'ts'}))}}],
define: { 'import.meta.env.BASE_URL':'"/"','import.meta.env.DEV':'false','process.env.NODE_ENV':"\"production\"" } })
const files = new Map(compiled.outputFiles.map(f => [extname(f.path), f.contents]))
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if(req.method!=='GET'){res.writeHead(405);res.end();return}
  if(path==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<!doctype html><html lang='zh-CN'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><link rel='stylesheet' href='/app.css'><div id='root'></div><script type='module' src='/app.js'></script></html>`);return}
  if(path==='/app.js'||path==='/app.css'){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');res.end(files.get(extname(path)));return}
  res.writeHead(404);res.end()
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin=`http://127.0.0.1:${server.address().port}`
let browser, checks=0
const check=(value,label)=>{assert.ok(value,label);checks++;console.log('PASS '+label)}
try {
  browser=await chromium.launch({headless:true})
  const page=await browser.newPage({viewport:{width:390,height:900}})
  const errors=[], blocked=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',route=>{
    const url = new URL(route.request().url())
    if(url.origin===origin && route.request().method()==='GET') return route.continue()
    blocked.push(url); return route.abort()
  })
  await page.addInitScript(()=>{
    indexedDB.open=()=>{throw new Error('No actual saves')};
    HTMLMediaElement.prototype.play=async()=>{};
    window.created=0; window.revoked=0;
    const make=URL.createObjectURL,drop=URL.revokeObjectURL;
    URL.createObjectURL=function(b){window.created++;return make.call(this,b)};
    URL.revokeObjectURL=function(u){window.revoked++;return drop.call(this,u)}
  })
  if(process.argv.includes('--before')){
    await page.goto(origin + '/?view=points');
    await page.locator('.app').waitFor();
    await page.waitForSelector('.table-wrap');
    const metrics={};
    for(const width of [320,390,1440]){
      await page.setViewportSize({width,height:900});
      await page.waitForSelector('.table-wrap');
      metrics[width]=await page.evaluate(()=>{
        const rows=[...document.querySelectorAll('.table-wrap tr')];
        const maxRight=Math.max(...rows.map(r=>r.getBoundingClientRect().right));
        const overflow=document.documentElement.scrollWidth-innerWidth;
        const firstCell=document.querySelector('.table-wrap tbody tr td:nth-child(2)');
        return {maxRight,overflow,clientWidth:firstCell?.clientWidth,scrollWidth:firstCell?.scrollWidth,text:firstCell?.textContent,html:firstCell?.innerHTML}
      });
      await page.screenshot({path:resolve(output,`before-points-${width}.png`)});
      await page.screenshot({path:resolve(output,`baseline-${width}-full.png`)});
    }
    await page.evaluate(()=>window.h.setView('new'));
    await page.locator('.newcareer').waitFor();
    await page.screenshot({path:resolve(output,'before-newcareer.png')});
    const evidence={newcareerSearchCount:await page.locator('input[aria-label=搜索选手],input[type=search]').count(), metrics};
    writeFileSync(resolve(output,'before-metrics.json'), JSON.stringify(evidence,null,2));
    check(errors.length===0,'before no page errors');
    check(blocked.length===0,'before no remote requests');
    console.log('before baseline done '+checks);
    await browser.close(); await new Promise(r=>server.close(r)); process.exit(0)
  }
  for(const width of [320,390,1440]) {
  await page.setViewportSize({width,height:900});
  await page.goto(origin + '/?view=standings');
  await page.locator('.app').waitFor();
  await page.getByRole('button',{name:'选手榜'}).click();
  await page.waitForSelector('input[aria-label=搜索选手],input[type=search]');
  const search = page.locator('input[aria-label=搜索选手],input[type=search]').first();
  await search.fill('');
  check(await page.locator('tbody tr').count()===40, 'base player table shows 40 rows');
  const baseTexts = await page.locator('tbody tr').allTextContents();
  check(baseTexts.every(t=>!t.includes('—')),'no dash in base list');
  const actualIGNs = await page.evaluate(()=>Array.from(document.querySelectorAll('tbody tr')).map(tr=>tr.children[1]?.querySelector('b')?.textContent?.trim() ?? ''));
  const expectedBaseIGNs = await page.evaluate(()=>window.h.expectedBaseIGNs);
  check(JSON.stringify(actualIGNs)===JSON.stringify(expectedBaseIGNs),'base order matches performance rating');
  await search.fill('UiRareZero');
  await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===1);
  const rareRow = page.locator('tbody tr',{hasText:'UiRareZero'});
  await rareRow.waitFor();
  check(await rareRow.count()===1,'free agent found');
  const rareText = await rareRow.textContent();
  check(rareText.includes('自由选手'),'free agent label');
  check(JSON.stringify(await rareRow.locator('td').allTextContents()).includes('—'),'free agent dash stats');
  check((await rareRow.locator('td').allTextContents()).slice(4,8).every(t=>t==='—'),'all zero-map statistics are dashes');
  check(rareText.includes('0'),'0 maps shown');
  await search.fill('测试实名唯一');
  await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===1);
  check((await page.locator('tbody tr').textContent()).includes('UiRareZero'),'realName searchable');
  await search.fill('');
  await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===40);
  await search.fill('   ');
  check(JSON.stringify(await page.locator('tbody tr td:nth-child(2) b').allTextContents())===JSON.stringify(expectedBaseIGNs),'whitespace preserves ranking');
  await search.fill('UiRareLow');
  await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===1);
  check((await page.locator('tbody tr td').last().textContent()).trim()==='2','low maps included');
  await search.fill('  uiRareZero  ');
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('tbody tr')).some(tr=>tr.textContent.includes('UiRareZero')));
  check(await page.locator('tbody tr',{hasText:'UiRareZero'}).count()===1,'trim case-insensitive works');
  await search.fill('ZZZZZ');
  await page.waitForFunction(()=>document.querySelectorAll('.empty').length>0 || document.querySelectorAll('tbody tr').length===0);
  check(await page.locator('.empty').count()>0,'no matches message');
  await search.fill('UiMany');
  await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length>0);
  const displayedCount = await page.locator('tbody tr').count();
  check(displayedCount===20,'search results truncated at 20');
  const tableText = await search.locator('xpath=ancestor::div[contains(@class,"panel")]').last().textContent();
  check(tableText.includes('20')||tableText.includes('超过'),'truncation note mentions 20');
  await search.fill('UiRareZero');
  await rareRow.waitFor();
  await rareRow.click();
  check(await page.evaluate(()=>window.h.openPlayerCalls.includes('UiRareZero')),'row click opens free agent');
  await search.fill('');
  await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===40);
  const beforePeekCalls = await page.evaluate(()=>window.h.openPlayerCalls.length);
  const rankedIGN = await page.evaluate(()=>window.h.expectedBaseIGNs[0]);
  await search.fill(rankedIGN);
  const rankedRow = page.locator('tbody tr',{hasText:rankedIGN}).first();
  await rankedRow.locator('.team-peek-trigger').click();
  await page.locator('.modal').waitFor();
  const afterPeekCalls = await page.evaluate(()=>window.h.openPlayerCalls.length);
  check(afterPeekCalls===beforePeekCalls,'team peek stopPropagation');
  const modalHeading = await page.locator('.modal h3').first().textContent();
  check(modalHeading.length>0,'team peek modal heading');
  await page.locator('.modal .modal-head button').first().click();
  await page.locator('.modal').waitFor({state:'hidden'});
  await search.fill('');
  await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===40);
  await search.fill('UiMany');
  await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length>0);
  await page.screenshot({path:resolve(output,`after-search-${width}.png`)});
  await search.fill('');
  await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===40);
  await page.evaluate(()=>window.h.setView('points'));
  await page.getByRole('heading',{name:'冠军积分榜 · 中国',exact:true}).waitFor();
  const afterMetrics={};
  {
    await page.waitForSelector('.table-wrap');
    afterMetrics[width]=await page.evaluate(()=>{
      const rows=[...document.querySelectorAll('.table-wrap tr')];
      const maxRight=Math.max(...rows.map(r=>r.getBoundingClientRect().right));
      const overflow=document.documentElement.scrollWidth-innerWidth;
      const firstCell=document.querySelector('.table-wrap tbody tr td:nth-child(2)');
      return {maxRight,overflow,clientWidth:firstCell?.clientWidth,scrollWidth:firstCell?.scrollWidth,text:firstCell?.textContent}
    });
    check(afterMetrics[width].overflow<=1,`points no page overflow ${width}`);
    const ellipsis=await page.locator('.team-peek-trigger').first().evaluate(el=>({text:getComputedStyle(el).textOverflow,white:getComputedStyle(el).whiteSpace,scroll:el.scrollWidth,client:el.clientWidth}));
    check(ellipsis.text==='ellipsis'&&ellipsis.white==='nowrap'&&ellipsis.scroll>ellipsis.client,`long name actual ellipsis ${width}`);
    check(await page.locator('tbody tr').first().locator('td').nth(2).innerText()==='123','points numeric cell preserved');
    await page.screenshot({path:resolve(output,`after-points-${width}.png`)});
  }
  writeFileSync(resolve(output,'after-points-metrics.json'), JSON.stringify(afterMetrics,null,2));
  await page.evaluate(()=>window.h.setView('new'));
  await page.locator('.newcareer').waitFor();
  const cards = page.locator('.nc-origin-card');
  const cardCount = await cards.count();
  check(cardCount===3,'three origin cards');
  const keys = await page.evaluate(()=>Array.from(document.querySelectorAll('.nc-origin-card')).map(el=>el.getAttribute('data-origin')));
  check(keys.every(k=>k),'cards have data-origin keys');
  for(let i=0;i<cardCount;i++){
    const details = cards.nth(i).locator('details');
    check(await details.getAttribute('open')===null,`card ${i} details closed by default`);
  }
  const firstCard = cards.first();
  const firstDetails = firstCard.locator('details');
  await firstCard.locator('summary').click();
  check(await firstDetails.getAttribute('open')!==null,'details opened');
  check(await firstCard.locator('.origin-pick').getAttribute('aria-pressed')==='false','summary does not select origin');
  await firstCard.locator('summary').click();
  check(await firstDetails.getAttribute('open')===null,'details closes');
  await firstCard.locator('summary').click();
  const detailsList = firstCard.locator('.origin-details-list, .origin-effects, .origin-numbers-list');
  let listText;
  if(await detailsList.count()>0) listText = await detailsList.first().innerText();
  else { const dt = await firstDetails.innerText(); const st = await firstCard.locator('summary').innerText(); listText = dt.replace(st,''); }
  check(!/[0-9]/.test(listText),'no digits in details list with nums false');
  await page.evaluate(()=>window.h.setNumbers(true));
  await page.waitForFunction(()=>{
    const dt = document.querySelector('.nc-origin-card details')?.innerText||'';
    return /[0-9]/.test(dt);
  });
  const key = keys[0];
  const chosenOrigin = await page.evaluate(k=>window.h.originOf(k), key);
  const attrLabels = await page.evaluate(()=>window.h.ATTR_CN);
  const txt = await firstDetails.innerText();
  check(Object.keys(chosenOrigin.attrs||{}).every(attr=>{
    const label=attrLabels[attr];
    return txt.includes(label) && txt.includes(String(Math.abs(chosenOrigin.attrs[attr])));
  }),'attr rows match origin config');
  if(chosenOrigin.money) check(txt.includes(String(chosenOrigin.money)),'money value present');
  if(chosenOrigin.trainMul) check(txt.includes(String(chosenOrigin.trainMul)),'trainMul value present');
  await page.evaluate(()=>window.h.setNumbers(false));
  await page.waitForFunction(()=>{
    const dt = document.querySelector('.nc-origin-card details')?.innerText||'';
    return !/[0-9]/.test(dt);
  });
  await firstCard.locator('summary').click();
  await page.getByRole('button',{name:'换一批'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.nc-origin-card details[open]').length===0);
  check(await page.locator('.origin-pick.on').count()===0,'reroll clears selection and closes details');
  await page.locator('.origin-grid').scrollIntoViewIfNeeded();
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`origins no overflow ${width}`);
  await page.screenshot({path:resolve(output,`after-origins-${width}.png`)});
  const pick = page.locator('.origin-pick').first();
  await pick.click();
  const pickKey = await pick.locator('..').getAttribute('data-origin');
  await page.getByRole('button',{name:'一键随机分配'}).click();
  await page.getByLabel('游戏 ID').fill('UI测试');
  await page.getByRole('button',{name:'开始生涯', exact:true}).click();
  await page.waitForFunction(()=>!!window.h.captured);
  const captured = await page.evaluate(()=>window.h.captured);
  check(captured.originKey===pickKey,'captured origin key matches');
  check(captured.name==='UI测试','captured name matches');
  check(Object.values(captured.talents).reduce((s,v)=>s+v,0)===20,'captured talents allocated 20');
  const finalSnapshot = await page.evaluate(()=>JSON.stringify(window.h.game));
  check(finalSnapshot===await page.evaluate(()=>window.h.snapshot),'world JSON unchanged');
  check(errors.length===0,'no page errors '+errors.join(';'));
  check(blocked.length===0,'no remote requests');
  console.log(`PASS ${width}px interactions`);
  }
  console.log(`Sept23 UI checks passed: ${checks}`);
}catch(e){console.error(e);process.exitCode=1}finally{await browser?.close();await new Promise(r=>server.close(r))}
