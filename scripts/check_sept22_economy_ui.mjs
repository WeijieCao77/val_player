/** DeepSeek V4 Pro draft corrected against real APIs, with actual DOM/state assertions. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {dirname,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=resolve(root,'.cache/sept22-economy-ui');
mkdirSync(output,{recursive:true});
const compiled=await build({stdin:{resolveDir:root,loader:'tsx',contents:"\nimport React,{useReducer,useState} from 'react';import{createRoot}from'react-dom/client';import{GameCtx}from'./src/ui/me/ctx';\nimport EconomyScreen from './src/ui/me/EconomyScreen';import TransferScreen from './src/ui/me/TransferScreen';import{useNumbers}from'./src/ui/me/words';\nimport{createCareer,emptyTalents}from'./src/engine/me/career';import{fanCap,fanOutlook,fansCn}from'./src/engine/me/fans';\nimport{pitchTargets,pitchExplanation}from'./src/engine/me/selfpitch';import'./src/ui/me/base.css';import'./src/me.css';\nconst game=createCareer({name:'经济测试',region:'China',role:'决斗者',talents:emptyTalents(),originKey:'netcafe',start:'pre',seed:20260922,year:2026});\ngame.me.pending=[];delete game.me.pitch;game.me.fans=fanCap(game)/2;\nwindow.game=game;window.initial=JSON.stringify(game);window.api={fanCap,fanOutlook,fansCn,pitchTargets,pitchExplanation};\nfunction App(){const[,bump]=useReducer(x=>x+1,0),[view,setView]=useState('economy'),[nums,setNums]=useNumbers();window.refresh=bump;\nreturn <GameCtx.Provider value={{game,commit:bump,toast:()=>{},openPlayer:()=>{},openMatch:()=>{},go:()=>{},startTutorial:()=>{}}}>\n<div className=\"app career\"><div className=\"body\"><main className=\"main\"><div className=\"row wrap\">\n<button onClick={()=>setView('economy')}>Economy</button><button onClick={()=>setView('transfer')}>Transfer</button>\n<button onClick={()=>setNums(!nums)}>数值 {nums?'开':'关'}</button></div>\n{view==='economy'?<EconomyScreen/>:<TransferScreen/>}</main></div></div></GameCtx.Provider>}\ncreateRoot(document.getElementById('root')).render(<App/>);\n"},absWorkingDir:root,bundle:true,write:false,outfile:'app.js',platform:'browser',format:'esm',jsx:'automatic',define:{'import.meta.env.BASE_URL':'"/"','import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'}});
const files = new Map(compiled.outputFiles.map((f) => [extname(f.path), f.contents]));

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end();
    return;
  }
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
    return;
  }
  if (path === '/app.js' || path === '/app.css') {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css');
    res.end(files.get(extname(path)));
    return;
  }
  const publicRoot = resolve(root, 'public');
  const asset = resolve(publicRoot, '.' + decodeURIComponent(path));
  const mime = { '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' }[extname(asset)];
  if (asset.startsWith(publicRoot + sep) && mime && existsSync(asset)) {
    res.setHeader('Content-Type', mime);
    res.end(readFileSync(asset));
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;


let browser;
try {
 browser=await chromium.launch({headless:true});
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],blocked=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('val_player.numbers','0');indexedDB.open=()=>{throw Error('No actual saves')};HTMLMediaElement.prototype.play=async()=>{}});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin&&route.request().method()==='GET')return route.continue();blocked.push(url.origin+url.pathname);return route.abort()});
  await page.goto(origin);await page.getByText('本周自然趋势：',{exact:false}).waitFor();
  const snapshot=()=>page.evaluate(()=>JSON.stringify(window.game));
  const overflow=async label=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' no overflow '+width);
  assert.equal(await snapshot(),await page.evaluate(()=>window.initial),'first Economy render is pure, including legacy missing pitch');
  const fanPanel=page.locator('.panel').filter({has:page.getByText('粉丝与直播',{exact:true})});
  for(const direction of ['up','flat','down']){
   const fixture=await page.evaluate(direction=>{const cap=window.api.fanCap(window.game);window.game.me.fans=direction==='up'?cap/2:direction==='flat'?cap:cap*2;const before=JSON.stringify(window.game);const outlook=window.api.fanOutlook(window.game);const capText=window.api.fansCn(cap);window.refresh();return{before,outlook,capText}},direction);
   const word={up:'增长',flat:'平稳',down:'回落'}[direction];
   await page.getByText('本周自然趋势：'+word,{exact:false}).waitFor();
   assert.equal(fixture.outlook.direction,direction);
   const line=await fanPanel.locator('p').filter({hasText:'本周自然趋势'}).innerText();
   assert.equal(line,'本周自然趋势：'+word+(direction==='flat'?'':'，约 '+Math.abs(fixture.outlook.deltaWan).toFixed(1)+' 万'));
   assert.ok((await fanPanel.innerText()).includes('支持规模约 '+fixture.capText));
   assert.equal(await snapshot(),fixture.before,'fan rerender is read-only '+direction);
   await overflow('Economy '+direction);
   await fanPanel.screenshot({path:resolve(output,width+'-fans-'+direction+'.png')});
  }
  const beforeTransfer=await snapshot();
  const expected=await page.evaluate(()=>window.api.pitchTargets(window.game).rows.map(r=>({id:r.team.id,name:r.team.name,tag:r.team.tag,why:r.why,pct:r.odds.pct,gap:r.odds.gap,nevpro:r.odds.nevpro,mate:r.odds.need.mate?.ign,off:window.api.pitchExplanation(r.odds,false),on:window.api.pitchExplanation(r.odds,true)})));
  assert.equal(await snapshot(),beforeTransfer,'pitchTargets/explanation reads are pure');
  assert.ok(expected.some(r=>!r.why),'real calendar fixture must contain eligible clubs');
  assert.equal(new Set(expected.map(r=>r.name)).size,expected.length,'team names unique in chosen fixture');
  await page.getByRole('button',{name:'Transfer',exact:true}).click();
  await page.getByRole('searchbox',{name:'搜索自荐俱乐部',exact:true}).waitFor();
  assert.equal(await snapshot(),beforeTransfer,'first Transfer render is pure; no lazy save normalization');
  const rows=page.locator('.sp-row');
  assert.equal(await rows.count(),expected.length);
  for(const numbers of [false,true]){
   if(numbers)await page.getByRole('button',{name:'数值 关',exact:true}).click();
   const groups=page.locator('details.sp-group');
   for(let i=0;i<await groups.count();i++)if(!await groups.nth(i).evaluate(e=>e.open))await groups.nth(i).locator(':scope > summary').click();
   let checked=0;
   for(let i=0;i<await rows.count();i++){
    const row=rows.nth(i),name=(await row.locator('.team-peek-trigger').innerText()).trim(),r=expected.find(r=>r.name===name);
    assert.ok(r,'every DOM team matches real pitchTargets '+name);
    const detail=row.locator('details.sp-why');
    assert.equal(await detail.count(),r.why?0:1);
    if(r.why){assert.ok((await row.locator('span.sp-why').innerText()).includes(r.why));continue}
    if(!await detail.evaluate(e=>e.open))await detail.locator(':scope > summary').click();
    assert.equal(await detail.evaluate(e=>e.open),true);
    const paragraphs=await detail.locator('p').allTextContents();
    assert.deepEqual(paragraphs,numbers?r.on:r.off,'real explanation '+name);
    const oddsText=await row.locator('.sp-odds').innerText();
    if(numbers){assert.ok(oddsText.includes(r.pct+'%'));if(r.gap!==0)assert.ok(paragraphs.some(p=>p.includes(Math.abs(r.gap)+' 点')))}
    else{
     assert.ok(!oddsText.includes('%'));
     const withoutNames=paragraphs.join('\n').replaceAll(r.mate??'\u0000','');
     assert.ok(!/\d|[%％]/.test(withoutNames),'numbers-off explanation is qualitative '+name);
    }
    assert.equal(await snapshot(),beforeTransfer,'expanding explanation/toggle numbers is pure '+name);
    const bounds=await detail.evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth,right:e.getBoundingClientRect().right,parentRight:e.closest('.sp-row').getBoundingClientRect().right}));
    assert.ok(bounds.scroll<=bounds.client+1&&bounds.right<=bounds.parentRight+1,'explanation fits own row '+width+' '+name+' '+JSON.stringify(bounds));
    if(checked++===0)await row.screenshot({path:resolve(output,width+'-explanation-'+(numbers?'numbers':'words')+'.png')});
   }
   assert.equal(checked,expected.filter(r=>!r.why).length);
   await overflow('Transfer '+numbers);
  }
  const input=page.getByRole('searchbox',{name:'搜索自荐俱乐部',exact:true});
  await input.fill('不存在的俱乐部_no_match_20260922');
  await page.getByText('没有匹配的俱乐部。试试队名或缩写；搜索不改变外语、转会窗口和名单限制。',{exact:true}).waitFor();
  assert.equal(await rows.count(),0);assert.equal(await snapshot(),beforeTransfer);
  await input.locator('..').getByRole('button',{name:'清除',exact:true}).click();await rows.first().waitFor({state:'attached'});
  assert.equal(await rows.count(),expected.length);
  const chosen=expected.find(r=>!r.why);await input.fill(chosen.name);
  const picked=rows.filter({has:page.getByRole('button',{name:chosen.name,exact:true})});
  assert.equal(await picked.count(),1);await picked.locator('.team-peek-trigger').click();
  const modal=page.getByRole('dialog');await modal.waitFor();
  assert.ok((await modal.innerText()).includes(chosen.name));
  const ids=await page.evaluate(id=>[...new Set(window.game.teams[id].roster)].filter(pid=>!!window.game.players[pid]),chosen.id);
  assert.deepEqual((await modal.locator('[data-player]').evaluateAll(es=>es.map(e=>e.dataset.player))).sort(),ids.sort());
  assert.equal(await snapshot(),beforeTransfer,'search/real TeamPeek is read-only');
  await overflow('TeamPeek');
  await modal.getByRole('button',{name:/关闭/}).click();await modal.waitFor({state:'hidden'});
  await input.fill('');await rows.first().waitFor({state:'attached'});assert.equal(await rows.count(),expected.length);
  assert.equal(await snapshot(),beforeTransfer);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  console.log('PASS '+width+'px: fan up/flat/down; '+expected.filter(r=>!r.why).length+' eligible explanations both modes, blocked reasons, search/roster, full-state purity/no overflow/network');
  await page.close();
 }
}finally{await browser?.close();await new Promise(r=>server.close(r))}
