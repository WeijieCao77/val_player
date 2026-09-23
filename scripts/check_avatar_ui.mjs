import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), output = resolve(root, '.cache/avatar-ui')
mkdirSync(output, { recursive: true })
const compiled = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {GameCtx} from './src/ui/me/ctx';import AvatarEditor from './src/ui/me/AvatarEditor';import Face from './src/ui/me/Face';
import MeScreen from './src/ui/me/MeScreen';import {createCareer,emptyTalents} from './src/engine/me/career';
import NewCareer from './src/ui/me/NewCareer';
import {avatarData,AVATAR_MAX_CHARS,jpegDimensions} from './src/engine/me/avatar';import {fileToAvatarDataUrl} from './src/ui/me/avatarImage';
import {migratePlayerSave} from './src/engine/me/save';import {packState,unpackState} from './src/engine/save';
import {weekStartSnap} from './src/engine/me/undo';import {doAction,undoAction} from './src/engine/me/week';
import {noteHall,readHall} from './src/engine/me/hall';import {drawCareerCard} from './src/ui/me/share';
import './src/ui/me/base.css';import './src/me.css';
const opts={name:'头像本地测试',region:'China',role:'先锋',talents:emptyTalents(),originKey:'netcafe',start:'pre',seed:741,year:2026};
const game=createCareer(opts);const noop=()=>{};
function App(){const [tick,setTick]=useState(0),[show,setShow]=useState(true),[disabled,setDisabled]=useState(false),[screen,setScreen]=useState(false);
 const commit=()=>setTick(n=>n+1),setAvatar=(v)=>{if(v)game.me.avatar=v;else delete game.me.avatar;commit()};
 Object.assign(window.h,{setAvatar,setShow,setDisabled,setScreen});
 if(screen==='new')return <NewCareer save={null} onStart={async opts=>{window.captured=opts;return false}} onContinue={async()=>false} onSeedHall={async()=>{}} onReadBackup={async()=>null}/>;
 return <GameCtx.Provider value={{game,commit,toast:noop,openPlayer:noop,openMatch:noop,go:noop,startTutorial:noop}}><div className="app career"><div className="body"><main className="main">
 {screen?<MeScreen/>:<><div id="face"><Face id="ME" size={64}/></div>{show&&<AvatarEditor value={game.me.avatar} onChange={setAvatar} disabled={disabled}/>}</>}
 </main></div></div></GameCtx.Provider>}
window.h={game,opts,avatarData,jpegDimensions,fileToAvatarDataUrl,createCareer,migratePlayerSave,packState,unpackState,weekStartSnap,doAction,undoAction,noteHall,readHall,drawCareerCard};
createRoot(document.getElementById('root')).render(<App/>);
` }, absWorkingDir: root, bundle: true, write: false, outfile: 'app.js', format: 'esm', platform: 'browser', jsx: 'automatic',
plugins:[{name:'test-start-sheet',setup(b){b.onResolve({filter:/^virtual:start-sheet$/},()=>({path:'virtual:start-sheet',namespace:'test-sheet'}));b.onLoad({filter:/.*/,namespace:'test-sheet'},()=>({resolveDir:root,contents:"import {buildStartSheet} from './src/engine/me/startSheet';export default buildStartSheet()",loader:'ts'}))}}],
define: { 'import.meta.env.BASE_URL':'"/"','import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"' } })
const files = new Map(compiled.outputFiles.map(f => [extname(f.path), f.contents]))
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if(req.method!=='GET'){res.writeHead(405);res.end();return}
  if(path==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');return}
  if(path==='/app.js'||path==='/app.css'){res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/css');res.end(files.get(extname(path)));return}
  res.writeHead(404);res.end()
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin=`http://127.0.0.1:${server.address().port}`
let browser, checks=0
const check=(value,label)=>{assert.ok(value,label);checks++;console.log('PASS '+label)}
try {
  browser=await chromium.launch({headless:true})
  const page=await browser.newPage({viewport:{width:390,height:900}}),errors=[],blocked=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin&&route.request().method()==='GET')return route.continue();blocked.push(route.request().url());return route.abort()})
  await page.addInitScript(()=>{indexedDB.open=()=>{throw Error('No actual saves')};HTMLMediaElement.prototype.play=async()=>{};window.created=0;window.revoked=0;const make=URL.createObjectURL,drop=URL.revokeObjectURL;URL.createObjectURL=function(b){window.created++;return make.call(this,b)};URL.revokeObjectURL=function(u){window.revoked++;return drop.call(this,u)}})
  await page.goto(origin);await page.getByRole('group',{name:'头像编辑'}).waitFor()
  const fixtures=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d');const out={};
    for(const [key,mime,color] of [['png','image/png','#c33'],['jpeg','image/jpeg','#36a'],['webp','image/webp','#3a6'],['alpha','image/png',null]]){
      ctx.clearRect(0,0,640,360);if(color){ctx.fillStyle=color;ctx.fillRect(0,0,640,360)}
      const data=c.toDataURL(mime,.8);out[key]={name:key+'.'+key,mimeType:mime,base64:data.split(',')[1]}
    }return out
  })
  const upload=async fixture=>{await page.getByLabel('选择头像图片').setInputFiles({name:fixture.name,mimeType:fixture.mimeType,buffer:Buffer.from(fixture.base64,'base64')});await page.waitForFunction(()=>!document.querySelector('button')?.textContent?.includes('处理图片中'))}
  let prior
  for(const key of ['png','jpeg','webp','alpha']){
    await upload(fixtures[key]);await page.waitForFunction(()=>!!window.h.game.me.avatar)
    const result=await page.evaluate(()=>{const a=window.h.game.me.avatar;return{a,len:a.length,valid:window.h.avatarData(a)===a,dim:window.h.jpegDimensions(Uint8Array.from(atob(a.split(',')[1]),x=>x.charCodeAt(0)))}})
    check(result.valid&&result.len<=28000&&result.dim.width===128&&result.dim.height===128,`${key} converted to bounded JPEG`)
    check(result.a!==prior,`${key} replaces previous image`);prior=result.a
  }
  const alphaWhite=await page.evaluate(async()=>{const img=new Image();img.src=window.h.game.me.avatar;await img.decode();const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');g.drawImage(img,0,0);return [...g.getImageData(64,64,1,1).data]})
  check(alphaWhite.every(v=>v>=250),'transparent raster gets white background')
  // Real files arrive mislabelled, untyped, or with data after the main image (Ultra HDR gain
  // maps, camera trailers, chat-app appendices); the bytes decide, and the main image decodes.
  const jpegBytes=Buffer.from(fixtures.jpeg.base64,'base64'),pngBytes=Buffer.from(fixtures.png.base64,'base64'),webpBytes=Buffer.from(fixtures.webp.base64,'base64')
  const large=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=4200;c.height=4000;const g=c.getContext('2d');g.fillStyle='#48c';g.fillRect(0,0,4200,4000);return c.toDataURL('image/png').split(',')[1]})
  const tolerated=[
    {...fixtures.png,name:'wrong.jpg',mimeType:'image/jpeg'},
    {...fixtures.jpeg,name:'noext',mimeType:''},
    {...fixtures.jpeg,name:'photo.jpg',mimeType:'image/jpg'},
    {...fixtures.jpeg,name:'download.jpg',mimeType:'application/octet-stream'},
    {...fixtures.webp,name:'wechat.jpg',mimeType:'image/jpeg'},
    {name:'ultrahdr.jpg',mimeType:'image/jpeg',base64:Buffer.concat([jpegBytes,jpegBytes]).toString('base64')},
    {name:'trailer.jpg',mimeType:'image/jpeg',base64:Buffer.concat([jpegBytes,Buffer.from('SEFT camera trailer')]).toString('base64')},
    {name:'padded.png',mimeType:'image/png',base64:Buffer.concat([pngBytes,Buffer.alloc(4)]).toString('base64')},
    {name:'padded.webp',mimeType:'image/webp',base64:Buffer.concat([webpBytes,Buffer.alloc(3)]).toString('base64')},
    {name:'large.png',mimeType:'image/png',base64:large},
  ]
  for(const f of tolerated){
    await page.evaluate(()=>window.h.setAvatar(undefined));await upload(f)
    await page.waitForFunction(()=>!!window.h.game.me.avatar,null,{timeout:8000}).catch(()=>{})
    const alerts=await page.getByRole('alert').allInnerTexts()
    check(alerts.length===0&&await page.evaluate(()=>{const a=window.h.game.me.avatar;return !!a&&window.h.avatarData(a)===a}),`${f.name} accepted by content ${alerts.join(' ')}`)
  }
  prior=await page.evaluate(()=>window.h.game.me.avatar)
  const named=[
    {name:'photo.heic',mimeType:'',base64:Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypheic'),Buffer.alloc(16)]).toString('base64'),expect:'HEIC'},
    {name:'anim.gif',mimeType:'image/gif',base64:Buffer.concat([Buffer.from('GIF89a'),Buffer.alloc(8)]).toString('base64'),expect:'GIF'},
    {name:'unknown',mimeType:'',base64:Buffer.from('not image').toString('base64'),expect:'无法识别'},
  ]
  for(const f of named){await upload(f);await page.getByRole('alert').waitFor();const text=await page.getByRole('alert').innerText();check(text.includes(f.expect)&&await page.evaluate(a=>window.h.game.me.avatar===a,prior),`${f.name} rejected with a reason: ${text}`)}
  const invalids=[
    {name:'fake.jpg',mimeType:'image/jpeg',base64:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')},
    {name:'bad.png',mimeType:'image/png',base64:Buffer.from('not image').toString('base64')},
    {name:'big.png',mimeType:'image/png',base64:Buffer.alloc(8*1024*1024+1).toString('base64')},
    {name:'bad.svg',mimeType:'image/svg+xml',base64:Buffer.from('<svg/>').toString('base64')},
  ]
  const huge=Buffer.from(fixtures.png.base64,'base64');huge.writeUInt32BE(0xffffffff,16);invalids.push({name:'dimensions.png',mimeType:'image/png',base64:huge.toString('base64')})
  // Valid-sized headers with broken compressed content reach decode and still preserve the old image.
  const damaged=Buffer.from(fixtures.png.base64,'base64');damaged.fill(0,50,damaged.length-12)
  invalids.push({name:'corrupt.png',mimeType:'image/png',base64:damaged.toString('base64')})
  for(const f of invalids){const before=await page.evaluate(()=>window.created);await upload(f);await page.getByRole('alert').waitFor();check(await page.evaluate(a=>window.h.game.me.avatar===a,prior),`${f.name} rejected without losing old image`);if(f.name==='dimensions.png')check(await page.evaluate(n=>window.created===n,before),'huge header rejected before pixel allocation')}
  check(await page.evaluate(()=>window.created===window.revoked),'all created object URLs revoked')
  const saveResults=await page.evaluate(()=>{
    const h=window.h,g=h.game,a=g.me.avatar,snap=h.weekStartSnap(g),packed=h.packState(g),back=h.migratePlayerSave(h.unpackState(packed));
    const errors=[];const ok=(v,n)=>{if(!v)errors.push(n)};
    ok(back.me.avatar===a,'save-load avatar');ok(packed.split(a).length===2,'stored exactly once');ok(!JSON.stringify(snap).includes(a),'not in undo');
    const fresh=h.createCareer({...h.opts,avatar:a});ok(fresh.me.avatar===a,'new career avatar');
    const old=h.unpackState(packed);delete old.me.avatar;ok(!('avatar'in h.migratePlayerSave(old).me),'old save default');
    const c=document.createElement('canvas');c.width=c.height=64;
    for(const invalid of ['https://example.com/avatar.png','data:image/svg+xml;base64,PHN2Zy8+',a+'A'.repeat(28001),c.toDataURL('image/jpeg'),a.slice(0,-2),null,{},42]){
      const copy=h.unpackState(packed);copy.me.avatar=invalid;ok(!('avatar'in h.migratePlayerSave(copy).me),'bad import '+typeof invalid)
    }
    h.doAction(g,'aim');h.setAvatar(a);h.undoAction(g,'aim');ok(g.me.avatar===a,'undo preserves edit');
    g.me.ending={key:'world',title:'世界冠军',text:'synthetic',year:2026};h.noteHall(g,true);ok(!JSON.stringify(h.readHall()).includes(a),'hall excludes avatar');
    let images=0;const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(...args){images++;return draw.apply(this,args)};h.drawCareerCard(g);CanvasRenderingContext2D.prototype.drawImage=draw;ok(images===0,'share no avatar');
    return errors
  })
  check(saveResults.length===0,'save/import/create/undo/hall/share: '+JSON.stringify(saveResults))
  const parserChecks=await page.evaluate(()=>{
    const a=window.h.game.me.avatar,bytes=Uint8Array.from(atob(a.split(',')[1]),c=>c.charCodeAt(0));
    const data=b=>'data:image/jpeg;base64,'+btoa(String.fromCharCode(...b));
    const rejected=[];const reject=(v,label)=>{if(window.h.avatarData(v)!==undefined)rejected.push(label)};
    reject(a+'\n','whitespace');reject(a.replace(/=+$/,''),'missingpadding');
    reject(data(bytes.slice(0,-2)),'missingEOI');reject(data(new Uint8Array([...bytes,0])),'trailingbytes');
    let at=2;while(at<bytes.length){const marker=bytes[at+1],n=bytes[at+2]*256+bytes[at+3];if(marker===192||marker===194)break;at+=n+2}
    const wrong=bytes.slice();wrong[at+7]=255;reject(data(wrong),'hugewidth');
    const truncated=bytes.slice();truncated[at+2]=255;truncated[at+3]=255;reject(data(truncated),'segmentoverflow');
    const component=bytes.slice();component[at+9]=200;reject(data(component),'invalidcomponents');
    return rejected
  })
  check(parserChecks.length===0,'bounded JPEG grammar mutations: '+JSON.stringify(parserChecks))
  check((await page.getByRole('group',{name:'头像编辑'}).innerText()).includes('分享卡和成就殿堂不包含头像'),'share exclusion disclosed')
  await page.locator('#face img').dispatchEvent('error');check(await page.locator('#face svg').count()===1,'Face broken image falls back')
  await upload(fixtures.png);check(await page.locator('#face img').count()===1,'Face replacement recovers after error')
  await page.getByRole('button',{name:'恢复默认',exact:true}).click();check(await page.evaluate(()=>window.h.game.me.avatar===undefined),'reset clears image')
  // Hold file reads to exercise cancellation/unmount/disabled races deterministically.
  for(const mode of ['reset','unmount','disabled']){
    await page.evaluate(()=>{window.fileReads=[];window.originalArrayBuffer=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){return new Promise(resolve=>window.fileReads.push(()=>window.originalArrayBuffer.call(this).then(resolve)))}})
    await page.getByLabel('选择头像图片').setInputFiles({name:'slow.png',mimeType:'image/png',buffer:Buffer.from(fixtures.png.base64,'base64')})
    await page.getByRole('button',{name:'取消并恢复默认'}).waitFor()
    if(mode==='reset')await page.getByRole('button',{name:'取消并恢复默认'}).click()
    else await page.evaluate(mode=>mode==='unmount'?window.h.setShow(false):window.h.setDisabled(true),mode)
    await page.evaluate(async()=>{File.prototype.arrayBuffer=window.originalArrayBuffer;await Promise.all(window.fileReads.map(f=>f()))})
    await page.waitForFunction(()=>window.created===window.revoked)
    check(await page.evaluate(()=>window.h.game.me.avatar===undefined),`${mode} ignores stale conversion`)
    await page.evaluate(()=>{window.h.setShow(true);window.h.setDisabled(false)})
    await page.getByRole('group',{name:'头像编辑'}).waitFor()
  }
  await upload(fixtures.jpeg)
  await page.evaluate(()=>window.h.setScreen(true));await page.getByRole('group',{name:'头像编辑'}).waitFor()
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`MeScreen no overflow ${width}`);await page.getByRole('group',{name:'头像编辑'}).scrollIntoViewIfNeeded();await page.screenshot({path:resolve(output,`${width}.png`)});await page.getByRole('group',{name:'头像编辑'}).screenshot({path:resolve(output,`editor-${width}.png`)})}
  await page.getByRole('button',{name:'恢复默认',exact:true}).click();check(await page.evaluate(()=>!window.h.game.me.avatar),'MeScreen reset commits state')
  await page.evaluate(()=>window.h.setScreen('new'));await page.locator('.newcareer').waitFor()
  await page.locator('.origin-pick').first().click();await page.getByRole('button',{name:'一键随机分配'}).click()
  await page.evaluate(()=>{window.fileReads=[];window.originalArrayBuffer=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){return new Promise(resolve=>window.fileReads.push(()=>window.originalArrayBuffer.call(this).then(resolve)))}})
  await page.getByLabel('选择头像图片').setInputFiles({name:'new.png',mimeType:'image/png',buffer:Buffer.from(fixtures.png.base64,'base64')})
  await page.getByRole('button',{name:'等待头像处理完成'}).waitFor()
  check(await page.getByRole('button',{name:'等待头像处理完成'}).isDisabled(),'NewCareer cannot submit during image conversion')
  await page.evaluate(async()=>{File.prototype.arrayBuffer=window.originalArrayBuffer;await Promise.all(window.fileReads.map(f=>f()))})
  await page.getByRole('button',{name:'开始生涯',exact:true}).waitFor()
  const selected=await page.getByAltText('当前头像').getAttribute('src')
  for(const width of [320,1440]){await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`NewCareer no overflow ${width}`);await page.getByRole('group',{name:'头像编辑'}).scrollIntoViewIfNeeded();await page.screenshot({path:resolve(output,`new-${width}.png`)})}
  await page.getByRole('button',{name:'开始生涯',exact:true}).click();await page.waitForFunction(()=>!!window.captured)
  check(await page.evaluate(a=>window.captured.avatar===a&&window.h.createCareer(window.captured).me.avatar===a,selected),'NewCareer passes chosen avatar to actual career')
  check(errors.length===0,'no page errors: '+errors.join(';'))
  check(blocked.length===0,'no remote upload/network requests')
  console.log(`Avatar browser checks passed: ${checks}`)
}catch(e){console.error(e);process.exitCode=1}finally{await browser?.close();await new Promise(r=>server.close(r))}
