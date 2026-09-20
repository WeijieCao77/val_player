/**
 * 后台统计的边角 —— 跨零点、写盘出错、隔天重启、不合规的属性值、探活。
 *
 * scripts/check_stats.ts 核的是「一份手算好的 JSONL 重放出来，看板上每个数都对」。这里核的是
 * 那份核查碰不到的几种时刻，每一种都是一次外部审查（2026-09-18）真的复现出来的：
 *
 *  - 跨北京时间零点的会话：客户端报的是「这个会话到目前为止」的累计量，昨天报过 600 秒 /
 *    10 次浏览 / 2 场比赛，今天报 660 / 11 / 3，今天只该记 60 / 1 / 1。原来零点一过
 *    会话的水位线和收过的事件号一起清掉，今天把 660 / 11 / 3 整个又记一遍；昨天那批信标
 *    重发一次，建档也再记一次。活的进程、重启后的重放、重发，三条路都要对。
 *  - 写盘出错：原来 JSONL 的追加是 fs.appendFile(…, () => {})，盘满了也没人知道，
 *    事件先记进了内存、又标成收过，重启以后就没了——看板上一个数，盘上另一个数。
 *    现在先落盘、落成了才记账；出错记日志、按退避重试；退出前把收下的写完。
 *    写到一半断掉的那一行不许把后面的行粘坏，devices.log 也不许。
 *  - 隔天重启：原来启动只重算 stats.json 里缺的那几天和今天。昨天最后一次落缓存之后
 *    又进了事件、进程被杀、第二天才起来，昨天那份旧缓存就一直被当真。现在缓存记着
 *    每天算到了 JSONL 的第几个字节，对不上就重放。
 *  - 属性值：原来只核属性名，值是任意 48 个字以内的字符串、任意有限数——region / role /
 *    start / 结局 key 能变成随便什么聚合键，active_s 能报 1e308。现在按 stats-contract.js
 *    的值规则收：枚举、类型、范围。
 *  - /healthz：dist/index.html 不在就回 503（railway.json 拿它探活，页面都没有的部署不该算上线）。
 *
 * 另外把几件已经对的事钉住，改服务器的时候不许弄坏：/api/e 回 204；看板的 404 / 401 / 429 /
 * 200；背景音乐的 Range（206 / 416）；前端路由回 index.html；三档缓存头；/manager 302 回 /。
 *
 * 怎么测：把 server.js 和 stats-contract.js 抄进一个临时目录（旁边放一个假的 dist/），用
 * node --import 挂一个只在测试里存在的预载模块起真的进程。预载模块换掉 Date.now（时钟由这里
 * 拨）和 fs.appendFile / appendFileSync（按需注入 ENOSPC，可以只写一半再报错），再用 IPC
 * 接指令；「优雅退出」也从 IPC 发——Windows 上 child.kill('SIGTERM') 是直接杀掉，
 * 进程自己的 SIGTERM 处理根本不会跑。
 *
 *   npx tsx scripts/check_stats_edges.ts
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KEY = 'edge-key-456'

let bad = 0
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}
const eq = (got: unknown, want: unknown, what: string): void =>
  check(String(got) === String(want), `${what}：${String(got)}${String(got) === String(want) ? '' : `（应为 ${String(want)}）`}`)
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms) })

/* ---------- 北京时间 ---------- */
const bj = (day: string, hm: string): number => Date.parse(`${day}T${hm}:00+08:00`)
const D1 = '2026-03-10'
const D2 = '2026-03-11'

/* ---------- 预载：只在这个核查里存在 ---------- */
const PRELOAD = `
import fs from 'node:fs'
const realNow = Date.now.bind(Date)
let base = Number(process.env.EDGE_T0) || realNow()
let at = realNow()
Date.now = () => base + (realNow() - at)
let fault = { jsonl: '', dev: '', partial: false }
const kindOf = (f) => /\\.jsonl$/.test(String(f)) ? 'jsonl' : /devices\\.log$/.test(String(f)) ? 'dev' : ''
const boom = (code) => Object.assign(new Error(code + ': injected by check_stats_edges, write'), { code, syscall: 'write' })
const half = (d) => { const s = String(d); return s.slice(0, Math.max(1, Math.floor(s.length / 2))) }
const realAppend = fs.appendFile
const realAppendSync = fs.appendFileSync
fs.appendFile = function (file, data, ...rest) {
  const k = kindOf(file)
  if (k && fault[k]) {
    const cb = rest.find((x) => typeof x === 'function')
    if (fault.partial) { try { realAppendSync(file, half(data)) } catch {} }
    const e = boom(fault[k])
    if (cb) process.nextTick(cb, e)
    return
  }
  return realAppend.call(fs, file, data, ...rest)
}
fs.appendFileSync = function (file, data, ...rest) {
  const k = kindOf(file)
  if (k && fault[k]) {
    if (fault.partial) { try { realAppendSync(file, half(data)) } catch {} }
    throw boom(fault[k])
  }
  return realAppendSync.call(fs, file, data, ...rest)
}
process.on('message', (m) => {
  if (!m || typeof m !== 'object') return
  if (typeof m.at === 'number') { base = m.at; at = realNow() }
  if (m.fault) fault = { jsonl: m.fault.jsonl || '', dev: m.fault.dev || '', partial: !!m.fault.partial }
  if (m.term) { process.emit('SIGTERM'); return }
  if (process.send) process.send({ ok: m.id })
})
`

/* ---------- 临时站点：server.js + 契约 + 一个假的 dist/ ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'valedges-'))
const MP3 = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))

interface Site { dir: string; preload: string }
function site(name: string, withDist: boolean): Site {
  const dir = path.join(tmp, name)
  fs.mkdirSync(dir, { recursive: true })
  // box.js 是玩家信箱（2026-09-20）：server.js 引它，不抄过来的话这份核查里的服务器起不来
  for (const f of ['server.js', 'stats-contract.js', 'box.js']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f))
  // server.js 是 ESM（仓库的 package.json 写着 type: module），抄出来也得是
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}')
  const preload = path.join(dir, 'edge-preload.mjs')
  fs.writeFileSync(preload, PRELOAD)
  if (withDist) {
    fs.mkdirSync(path.join(dir, 'dist', 'assets'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'dist', 'music'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'dist', 'index.html'), '<!doctype html><title>edge</title><div id="root"></div>')
    fs.writeFileSync(path.join(dir, 'dist', 'assets', 'app-abc123.js'), 'console.log(1)')
    fs.writeFileSync(path.join(dir, 'dist', 'music', 'song.mp3'), MP3)
  }
  return { dir, preload }
}

interface Srv { proc: ChildProcess; port: number; data: string; out: string[]; seq: number }
const servers: Srv[] = []

async function boot(s: Site, data: string, t0: number, env: Record<string, string> = { STATS_KEY: KEY }): Promise<Srv> {
  fs.mkdirSync(data, { recursive: true })
  for (let attempt = 0; attempt < 8; attempt++) {
    const port = 31000 + Math.floor(Math.random() * 9000)
    const proc = spawn(process.execPath, ['--import', pathToFileURL(s.preload).href, path.join(s.dir, 'server.js')], {
      cwd: s.dir,
      env: { ...process.env, PORT: String(port), DATA_DIR: data, EDGE_T0: String(t0), STATS_KEY: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    const out: string[] = []
    proc.stdout?.on('data', (b: Buffer) => out.push(String(b)))
    proc.stderr?.on('data', (b: Buffer) => out.push(String(b)))
    let up = false
    for (let i = 0; i < 100; i++) {
      await sleep(80)
      if (proc.exitCode !== null) break
      try {
        // 起来了就行，哪一个状态码都算：没有 dist/ 的那一个 /healthz 本来就该是 503
        const r = await fetch(`http://127.0.0.1:${port}/healthz`)
        if (r.status) { up = true; break }
      } catch { /* 还没起来 */ }
    }
    if (up) { const srv = { proc, port, data, out, seq: 0 }; servers.push(srv); return srv }
    proc.kill('SIGKILL')
  }
  throw new Error('server.js 起不来')
}

/** 发一条 IPC 指令，等进程回话 */
function ctl(s: Srv, m: Record<string, unknown>): Promise<void> {
  const id = ++s.seq
  return new Promise((res) => {
    const on = (r: { ok?: number }) => { if (r && r.ok === id) { s.proc.off('message', on); res() } }
    s.proc.on('message', on)
    s.proc.send({ ...m, id })
  })
}
const setClock = (s: Srv, t: number): Promise<void> => ctl(s, { at: t })
const fault = (s: Srv, f: { jsonl?: string; dev?: string; partial?: boolean }): Promise<void> => ctl(s, { fault: f })
/** 进程被硬杀（崩溃、OOM、断电）：什么收尾都不做 */
async function kill(s: Srv): Promise<void> {
  if (s.proc.exitCode === null) {
    const gone = new Promise((r) => s.proc.once('exit', r))
    s.proc.kill('SIGKILL')
    await gone
  }
}
/** 平台发 SIGTERM（重新部署）：进程自己的收尾跑完再退 */
async function term(s: Srv): Promise<number | null> {
  if (s.proc.exitCode !== null) return s.proc.exitCode
  const gone = new Promise<number | null>((r) => s.proc.once('exit', (c) => r(c)))
  s.proc.send({ term: true })
  return gone
}

const post = async (s: Srv, body: string): Promise<number> => {
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/e`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    return r.status
  } catch { return 0 }
}
interface Ev { name: string; n: number; props?: Record<string, unknown> }
const batch = (vid: string, sid: string, events: Ev[], dev = 'phone'): string =>
  JSON.stringify({ v: 1, vid, sid, seq: 1, dev, tz: 480, events })

const AUTH = `Basic ${Buffer.from(`:${KEY}`).toString('base64')}`
async function dash(s: Srv): Promise<string> {
  const r = await fetch(`http://127.0.0.1:${s.port}/dash`, { headers: { authorization: AUTH } })
  return r.status === 200 ? r.text() : `(dash ${r.status})`
}
function cell(html: string, key: string): string {
  const m = new RegExp(`data-k="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">([^<]*)<`).exec(html)
  return m ? m[1] : '(缺)'
}
const internalErrors = (html: string): number => Number(/统计内部错误 (\d+) 次/.exec(html)?.[1] ?? 0)
/** 看板上的数要等写盘落了才动：轮询到它变成想要的样子，或者等够了 */
async function until(s: Srv, key: string, want: string | number, ms = 6000): Promise<string> {
  const end = Date.now() + ms
  let h = ''
  do {
    h = await dash(s)
    if (cell(h, key) === String(want)) return h
    await sleep(150)
  } while (Date.now() < end)
  return h
}
interface Day { uv: number; sess: number; pv: number; sec: number[]; act: number[]; m: { watched: number; skipped: number; started: number }; st: Record<string, number> }
const statsJson = (data: string): { days: Record<string, Day>; logs?: Record<string, number>; agg?: number } =>
  JSON.parse(fs.readFileSync(path.join(data, 'stats.json'), 'utf8'))
const lines = (data: string, day: string): string[] => {
  try { return fs.readFileSync(path.join(data, `ev-${day}.jsonl`), 'utf8').split('\n').filter(Boolean) } catch { return [] }
}
const parsed = (data: string, day: string): { e: string; vid: string; sid: string; n: number; p?: Record<string, unknown> }[] =>
  lines(data, day).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })

try {
  const web = site('web', true)

  /* ================= 一、跨零点的会话 ================= */
  console.log('跨北京时间零点的会话（累计量只记涨出来的那一截）：')
  {
    const data = path.join(tmp, 'd-midnight')
    const s = await boot(web, data, bj(D1, '23:50'))
    const day1 = batch('x1', 's-x1', [
      { name: 'session_start', n: 1, props: { w: 390, h: 800, theme: 'dark' } },
      { name: 'career_start', n: 2, props: { year: 2026, region: 'China', role: '决斗者', start: 'pre', origin: 'netcafe' } },
      { name: 'session_ping', n: 3, props: { active_s: 600 } },
      { name: 'screens', n: 4, props: { to: 'week', hits: 10 } },
      { name: 'matches', n: 5, props: { cls: 'league', played: 2, skip: 0, started: 2 } },
    ])
    eq(await post(s, day1), 204, `${D1} 23:50 一批：600 秒 / 10 次浏览 / 2 场比赛 / 建档`)
    await until(s, `日:${D1}:浏览`, 10)
    await setClock(s, bj(D2, '00:10'))
    const day2 = batch('x1', 's-x1', [
      { name: 'session_ping', n: 6, props: { active_s: 660 } },
      { name: 'screens', n: 7, props: { to: 'week', hits: 11 } },
      { name: 'matches', n: 8, props: { cls: 'league', played: 3, skip: 0, started: 3 } },
    ])
    eq(await post(s, day2), 204, `${D2} 00:10 同一个会话接着报：660 / 11 / 3`)
    eq(await post(s, day1), 204, '昨天那一批信标过了零点又重发一次')
    await sleep(400)
    let h = await until(s, `日:${D2}:浏览`, 1)
    console.log(`  · 活的进程：${D1} 浏览 ${cell(h, `日:${D1}:浏览`)}、${D2} 浏览 ${cell(h, `日:${D2}:浏览`)}、打完 ${cell(h, '比赛:打完')}、首发 ${cell(h, '比赛:首发')}、建档 ${cell(h, '出身:pre')}、人均在线 ${cell(h, '时长:人均')}`)
    eq(cell(h, `日:${D1}:浏览`), 10, `${D1} 浏览量还是 10`)
    eq(cell(h, `日:${D2}:浏览`), 1, `${D2} 浏览量只记涨出来的 1，不是 11`)
    eq(cell(h, '比赛:打完'), 3, '两天合计打完 3 场（2 + 1），不是 5')
    eq(cell(h, '比赛:首发'), 3, '两天合计首发 3 场，不是 5')
    eq(cell(h, '出身:pre'), 1, '建档只算一次：昨天的信标过了零点重发，不再记')
    eq(cell(h, '时长:人均'), '11 分钟', '这台设备一共在线 660 秒，不是 600 + 660')
    eq(cell(h, `日:${D2}:会话`), 1, `${D2} 这个会话照样算一个活跃会话`)
    eq(await term(s), 0, '优雅退出')
    const j = statsJson(data)
    eq(JSON.stringify(j.days[D1]?.sec), '[600]', `stats.json：${D1} 在线秒数`)
    eq(JSON.stringify(j.days[D2]?.sec), '[60]', `stats.json：${D2} 在线秒数只有 60`)
    eq(j.days[D2]?.m?.watched, 1, `stats.json：${D2} 打完 1 场`)

    // ---- 重启：今天从 JSONL 重放，昨天的水位线也得从 JSONL 里找回来
    const s2 = await boot(web, data, bj(D2, '00:30'))
    h = await dash(s2)
    console.log(`  · 重启重放：${D2} 浏览 ${cell(h, `日:${D2}:浏览`)}、打完 ${cell(h, '比赛:打完')}、建档 ${cell(h, '出身:pre')}、人均在线 ${cell(h, '时长:人均')}`)
    eq(cell(h, `日:${D2}:浏览`), 1, `重启后重放 ${D2}：浏览量还是 1`)
    eq(cell(h, '比赛:打完'), 3, '重启后打完还是 3')
    eq(cell(h, '出身:pre'), 1, '重启后建档还是 1')
    eq(cell(h, '时长:人均'), '11 分钟', '重启后在线还是 660 秒')
    eq(await post(s2, day1), 204, '重启以后昨天那批又重发')
    eq(await post(s2, day2), 204, '今天那批也重发')
    await sleep(400)
    h = await dash(s2)
    check(cell(h, `日:${D2}:浏览`) === '1' && cell(h, '比赛:打完') === '3' && cell(h, '出身:pre') === '1',
      `重启后的重发一个数都没动（浏览 ${cell(h, `日:${D2}:浏览`)}、打完 ${cell(h, '比赛:打完')}、建档 ${cell(h, '出身:pre')}）`)
    eq(await post(s2, batch('x1', 's-x1', [{ name: 'session_ping', n: 9, props: { active_s: 700 } }])), 204, '会话接着报 700 秒')
    h = await until(s2, '时长:人均', '12 分钟')
    eq(cell(h, '时长:人均'), '12 分钟', '重启之后只加涨出来的 40 秒（700 秒）')
    eq(await term(s2), 0, '优雅退出')
    eq(JSON.stringify(statsJson(data).days[D2]?.sec), '[100]', `stats.json：${D2} 在线 100 秒（660 − 600，再加 40）`)
  }

  /* ================= 二、写盘出错 ================= */
  console.log('\n写盘出错（先落盘、落成了才记账；出错记下来、重试；退出前写完）：')
  {
    const data = path.join(tmp, 'd-enospc')
    const s = await boot(web, data, bj(D1, '12:00'))
    await fault(s, { jsonl: 'ENOSPC' })
    eq(await post(s, batch('w1', 's-w1', [{ name: 'session_start', n: 1, props: { w: 390 } }])), 204, '盘满了：游戏照样拿到 204')
    await sleep(500)
    let h = await dash(s)
    const liveUV = Number(cell(h, '今日:活跃'))
    const recordedErrors = internalErrors(h)
    await kill(s)
    const s2 = await boot(web, data, bj(D1, '12:05'))
    h = await dash(s2)
    const replayedUV = Number(cell(h, '今日:活跃'))
    console.log(`  · 盘满时：${JSON.stringify({ liveUV, replayedUV, recordedErrors })}`)
    eq(liveUV, replayedUV, '看板上的数和盘上的数是同一个（没落盘的事件不先记进看板）')
    check(recordedErrors >= 1, `写盘出错记下来了：看板页脚「统计内部错误 ${recordedErrors} 次」`)

    // ---- 盘又有空间了：排着的那条自己重试写进去
    await fault(s2, { jsonl: 'ENOSPC' })
    await post(s2, batch('w2', 's-w2', [{ name: 'session_start', n: 1, props: { w: 390 } }]))
    await post(s2, batch('w2', 's-w2', [{ name: 'session_start', n: 1, props: { w: 390 } }]))   // 排着的时候又重发了一遍
    await sleep(300)
    eq(cell(await dash(s2), '今日:活跃'), 0, '盘满期间收下的事件还排着，没进看板')
    await fault(s2, {})
    h = await until(s2, '今日:活跃', 1)
    eq(cell(h, '今日:活跃'), 1, '盘恢复以后自己重试写进去了，看板跟着 +1')
    eq(lines(data, D1).filter((l) => l.includes('"w2"')).length, 1, '排着的时候重发的那一遍没有再写一行')
    await kill(s2)
    const s3 = await boot(web, data, bj(D1, '12:10'))
    eq(cell(await dash(s3), '今日:活跃'), 1, '重试写进去的那条重启以后还在')

    // ---- 排着的时候来了 SIGTERM：退出前把收下的写完
    await fault(s3, { jsonl: 'ENOSPC' })
    await post(s3, batch('w3', 's-w3', [{ name: 'session_start', n: 1, props: { w: 390 } }]))
    await sleep(200)
    await fault(s3, {})
    eq(await term(s3), 0, '盘刚恢复就收到 SIGTERM：优雅退出')
    check(lines(data, D1).some((l) => l.includes('"w3"')), '退出前把排着的那条写进了 JSONL')
    const s4 = await boot(web, data, bj(D1, '12:15'))
    eq(cell(await dash(s4), '今日:活跃'), 2, '重启以后 w3 在看板上')

    // ---- 写到一半断了：半行不许把后面的行粘坏
    await fault(s4, { jsonl: 'ENOSPC', partial: true })
    await post(s4, batch('w4', 's-w4', [
      { name: 'session_start', n: 1, props: { w: 390 } },
      { name: 'career_start', n: 2, props: { year: 2026, region: 'EMEA', role: '哨卫', start: 'chal', origin: 'cs' } },
    ]))
    await sleep(300)
    await fault(s4, {})
    await until(s4, '今日:活跃', 3)
    await post(s4, batch('w5', 's-w5', [{ name: 'session_start', n: 1, props: { w: 390 } }]))
    h = await until(s4, '今日:活跃', 4)
    eq(cell(h, '今日:活跃'), 4, '写到一半的 w4 重试成功，后面的 w5 也照常进来')
    await kill(s4)
    const s5 = await boot(web, data, bj(D1, '12:20'))
    h = await dash(s5)
    eq(cell(h, '今日:活跃'), 4, '重启重放：w4、w5 都在（半行被隔成单独一行，跳过）')
    eq(cell(h, '出身:chal'), 1, 'w4 的建档只算一次（整批重写了一遍，重放按 (会话, 事件号) 认一次）')

    // ---- devices.log 写到一半断了：登记簿的行序就是设备号，一行都不许歪
    await fault(s5, { dev: 'ENOSPC', partial: true })
    await post(s5, batch('w6', 's-w6', [{ name: 'session_start', n: 1, props: { w: 390 } }]))
    await sleep(300)
    await fault(s5, {})
    await post(s5, batch('w7', 's-w7', [{ name: 'session_start', n: 1, props: { w: 390 } }]))
    h = await until(s5, '今日:活跃', 6)
    eq(cell(h, '今日:活跃'), 6, 'devices.log 恢复以后 w6、w7 都登记上了')
    const reg = fs.readFileSync(path.join(data, 'devices.log'), 'utf8').split('\n').filter(Boolean)
    const wellFormed = reg.every((l) => /^\d{4}-\d{2}-\d{2} [A-Za-z0-9._:-]+$/.test(l))
    check(wellFormed, `devices.log 每一行都完整（${reg.map((l) => l.slice(11)).join(' ')}）`)
    eq(reg.map((l) => l.slice(11)).join(','), 'w1,w2,w3,w4,w5,w6,w7', 'devices.log 的行序就是登记的先后，一台不多一台不少')
    await kill(s5)
    const s6 = await boot(web, data, bj(D1, '12:25'))
    h = await dash(s6)
    eq(cell(h, '今日:活跃'), 6, '重启以后还是 6 台')
    eq(cell(h, '今日:新设备'), 6, '6 台都是今天的新设备（设备号没错位）')
    await kill(s6)
  }

  /* ================= 三、隔天重启 ================= */
  console.log('\n隔天重启（缓存记着算到了 JSONL 的第几个字节）：')
  {
    // ---- 一份旧格式的缓存：没有字节数，昨天的活跃是 0，JSONL 里其实有 1 台
    const data = path.join(tmp, 'd-stale')
    fs.mkdirSync(data, { recursive: true })
    fs.writeFileSync(path.join(data, `ev-${D1}.jsonl`), `${JSON.stringify({ t: bj(D1, '20:00'), e: 'session_start', vid: 'c1', sid: 's-c1', n: 1, dev: 'phone', tz: 480, p: { w: 390 } })}\n`)
    fs.writeFileSync(path.join(data, 'devices.log'), `${D1} c1\n`)
    const blank = { nu: 0, uv: 0, sess: 0, pv: 0, act: [], sec: [], f: { profile: [], week1: [], season1: [], ending: [] }, end: {}, st: {}, yr: {}, rg: {}, rl: {}, m: { watched: 0, skipped: 0, started: 0 }, er: {}, sf: 0, dv: [], wd: [] }
    fs.writeFileSync(path.join(data, 'stats.json'), JSON.stringify({ v: 1, days: { [D1]: blank }, savedAt: bj(D1, '19:00') }))
    const s = await boot(web, data, bj(D2, '09:00'))
    eq(cell(await dash(s), `日:${D1}:活跃`), 1, `旧缓存说 ${D1} 活跃 0、JSONL 里有 1 台：第二天重启按 JSONL 重算`)
    await kill(s)
  }
  {
    // ---- 真走一遍：落过一次缓存之后又进了事件，进程被杀，第二天才起来
    const data = path.join(tmp, 'd-stale2')
    const s = await boot(web, data, bj(D1, '20:00'))
    await post(s, batch('c2', 's-c2', [{ name: 'session_start', n: 1, props: { w: 390 } }]))
    await until(s, '今日:活跃', 1)
    await dash(s)                                  // 看板会顺手落一次缓存
    for (let i = 0; i < 30 && !fs.existsSync(path.join(data, 'stats.json')); i++) await sleep(100)
    await sleep(300)
    const cached = statsJson(data).days[D1]?.uv
    await post(s, batch('c3', 's-c3', [{ name: 'session_start', n: 1, props: { w: 390 } }]))
    for (let i = 0; i < 30 && !lines(data, D1).some((l) => l.includes('"c3"')); i++) await sleep(100)
    await kill(s)
    const s2 = await boot(web, data, bj(D2, '09:00'))
    const h = await dash(s2)
    console.log(`  · 缓存里 ${D1} 活跃 ${cached}，JSONL 里 2 台；第二天重启后看板：${cell(h, `日:${D1}:活跃`)}`)
    eq(cell(h, `日:${D1}:活跃`), 2, `${D1} 被杀之前进来的 c3 第二天重启以后也在`)
    eq(await term(s2), 0, '优雅退出')
    const j = statsJson(data)
    check(!!j.logs && j.logs[D1] === fs.statSync(path.join(data, `ev-${D1}.jsonl`)).size,
      `stats.json 记下了 ${D1} 算到的字节数（${j.logs?.[D1]}）`)

    // ---- 封好的那天直接用缓存，不白白重算；JSONL 又长了就重算
    j.days[D1].pv = 777
    fs.writeFileSync(path.join(data, 'stats.json'), JSON.stringify(j))
    const s3 = await boot(web, data, bj(D2, '10:00'))
    eq(cell(await dash(s3), `日:${D1}:浏览`), 777, '字节数对得上的那天：缓存照用（故意改成 777，没有被重算掉）')
    await kill(s3)
    fs.appendFileSync(path.join(data, `ev-${D1}.jsonl`), `${JSON.stringify({ t: bj(D1, '23:00'), e: 'session_start', vid: 'c4', sid: 's-c4', n: 1, p: { w: 390 } })}\n`)
    const s4 = await boot(web, data, bj(D2, '10:05'))
    let h4 = await dash(s4)
    eq(cell(h4, `日:${D1}:浏览`), 0, '字节数对不上的那天：按 JSONL 重算（777 没了）')
    eq(cell(h4, `日:${D1}:活跃`), 3, '重算以后 c2、c3、c4 三台')
    await kill(s4)

    // ---- stats.json 坏了：退回 .bak，再按字节数补齐
    fs.writeFileSync(path.join(data, 'stats.json'), '{"v":1,"days":{')
    const s5 = await boot(web, data, bj(D2, '10:10'))
    h4 = await dash(s5)
    eq(cell(h4, `日:${D1}:活跃`), 3, 'stats.json 写坏了：从 .bak 和 JSONL 补回来')
    await kill(s5)
  }

  {
    // ---- 上一个进程写到一半被杀（或者从写到一半的拷贝里恢复）：最后一行没有换行。
    //      重启以后新写的那一行不许粘到半行后面——粘上去就是两行一起作废，那条事件重放时就没了
    const data = path.join(tmp, 'd-torn')
    fs.mkdirSync(data, { recursive: true })
    const whole = JSON.stringify({ t: bj(D1, '08:00'), e: 'session_start', vid: 't1', sid: 's-t1', n: 1, p: { w: 390 } })
    const cut = JSON.stringify({ t: bj(D1, '08:01'), e: 'session_start', vid: 't2', sid: 's-t2', n: 1, p: { w: 390 } }).slice(0, 30)
    fs.writeFileSync(path.join(data, `ev-${D1}.jsonl`), `${whole}\n${cut}`)
    fs.writeFileSync(path.join(data, 'devices.log'), `${D1} t1\n${D1} t2`)
    const s = await boot(web, data, bj(D1, '09:00'))
    await post(s, batch('t3', 's-t3', [{ name: 'session_start', n: 1, props: { w: 390 } }]))
    await until(s, '今日:活跃', 2)
    await kill(s)
    const s2 = await boot(web, data, bj(D1, '09:05'))
    eq(cell(await dash(s2), '今日:活跃'), 2, '半行后面新写的 t3 没被粘坏：重启重放 t1、t3 两台')
    const reg = fs.readFileSync(path.join(data, 'devices.log'), 'utf8').split('\n')
    check(reg.includes(`${D1} t3`), `devices.log 里 t3 自成一行（${reg.filter(Boolean).join(' | ')}）`)
    await kill(s2)
  }

  /* ================= 四、属性值 ================= */
  console.log('\n属性值（按 stats-contract.js 的值规则收）：')
  {
    const data = path.join(tmp, 'd-values')
    const s = await boot(web, data, bj(D1, '15:00'))
    await post(s, batch('v8', 's-v8', [
      { name: 'session_start', n: 1, props: { w: 390 } },
      { name: 'career_start', n: 2, props: { year: 99999, region: 'x'.repeat(40), role: 'hacker', start: 'zzz', origin: 'netcafe' } },
      { name: 'ending', n: 3, props: { key: 'pwned', why: 'age' } },
      { name: 'session_ping', n: 4, props: { active_s: 1e308 } },
      { name: 'screens', n: 5, props: { to: 'week', hits: 1e15 } },
      { name: 'matches', n: 6, props: { cls: 'evil', played: 1e9, skip: 0, started: 0 } },
      { name: 'errors', n: 7, props: { n: 3, at: '<img src=x onerror=alert(1)>' } },
    ]))
    await post(s, batch('v9', 's-v9', [
      { name: 'session_start', n: 1, props: { w: 1920, h: 1080, theme: 'cream', new_id: true, had_save: false, host: 'valplayer.example.com' } },
      { name: 'career_start', n: 2, props: { year: 2021, region: 'Hong Kong & Taiwan', role: '自由人', start: 't1', origin: 'exchild', talent_max: 8, talent_spread: 4, talent_points: 20 } },
      { name: 'ending', n: 3, props: { key: 'breaker', why: 'chose', age: 29, pro_seasons: 7, titles: 3, titles_started: 2, peak_tier: 1, year: 2028, entry_year: 2021 } },
      { name: 'session_ping', n: 4, props: { active_s: 1200 } },
      { name: 'screens', n: 5, props: { to: 'standings', hits: 4 } },
      { name: 'matches', n: 6, props: { cls: 'masters', played: 2, skip: 1, started: 2 } },
      { name: 'errors', n: 7, props: { n: 1, at: 'PlayerGame-abc123.js:10:5' } },
    ], 'desktop'))
    const h = await until(s, '结局:breaker', 1)
    const junk = {
      赛区: cell(h, `赛区:${'x'.repeat(40)}`), 位置: cell(h, '位置:hacker'), 出身: cell(h, '出身:zzz'),
      年份: cell(h, '入场年份:99999'), 结局: cell(h, '结局:pwned'), 浏览: cell(h, `日:${D1}:浏览`),
      打完: cell(h, '比赛:打完'), 在线: cell(h, '时长:人均'),
    }
    console.log(`  · 看板上：${JSON.stringify(junk)}`)
    check(junk.赛区 === '(缺)' && junk.位置 === '(缺)' && junk.出身 === '(缺)' && junk.年份 === '(缺)',
      '随便写的 region / role / start / 年份没有变成开局构成里的一行')
    eq(junk.结局, '(缺)', '随便写的结局 key 不进结局分布')
    eq(cell(h, '结局:（未报结局）'), 1, '那条结局本身还算走到结局，只是 key 不认')
    eq(cell(h, '漏斗:走到结局'), 2, '漏斗照样两台走到结局')
    eq(junk.浏览, 4, '1e15 次浏览不认，只剩 v9 的 4 次')
    eq(junk.打完, 2, '比赛类别不在词表里的那行不认：打完只有 v9 的 2 场')
    eq(junk.在线, '10 分钟', 'active_s 1e308 不认：两台设备人均 (0 + 1200) ÷ 2 秒')
    check(!/onerror|&lt;img/.test(h), '出错位置不像「文件:行:列」的不进报错表')
    eq(cell(h, '出错位置:PlayerGame-abc123.js:10:5'), 1, '像样的出错位置照收')
    eq(cell(h, '赛区:Hong Kong &amp; Taiwan'), 1, '合法的值照收：港台（看板上 & 转义成 &amp;）')
    eq(cell(h, '位置:自由人'), 1, '合法的值照收：自由人')
    eq(cell(h, '出身:t1'), 1, '合法的值照收：一线替补')
    eq(cell(h, '入场年份:2021'), 1, '合法的值照收：2021 入场')
    const disk = lines(data, D1).join('\n')
    check(!/pwned|hacker|xxxxxxxxxx|zzz|99999|1e\+308|onerror|evil/.test(disk), 'JSONL 里没有这些值（收的时候就剥掉了）')
    const v9 = parsed(data, D1).filter((o) => o.vid === 'v9')
    const kept = v9.reduce((t, o) => t + Object.keys(o.p ?? {}).length, 0)
    eq(kept, 6 + 8 + 9 + 1 + 2 + 4 + 2, 'v9 的每一个属性都原样落了盘（合法的一个都没剥）')
    await kill(s)
  }

  /* ================= 五、探活 ================= */
  console.log('\n/healthz：')
  {
    const bare = site('bare', false)
    const s = await boot(bare, path.join(tmp, 'd-bare'), bj(D1, '12:00'))
    const r = await fetch(`http://127.0.0.1:${s.port}/healthz`)
    eq(r.status, 503, '没有 dist/index.html：/healthz 回 503，这样的部署不该上线')
    eq((await fetch(`http://127.0.0.1:${s.port}/`)).status, 503, '首页也是 503（dist/ 还没构建）')
    eq(await post(s, batch('h1', 's-h1', [{ name: 'session_start', n: 1 }])), 204, '事件照收')
    await kill(s)
    const s2 = await boot(web, path.join(tmp, 'd-web'), bj(D1, '12:00'))
    eq((await fetch(`http://127.0.0.1:${s2.port}/healthz`)).status, 200, '有 dist/index.html：/healthz 回 200')
    await kill(s2)
  }

  /* ================= 六、已经对的事，不许弄坏 ================= */
  console.log('\n已经对的事（改服务器时不许弄坏）：')
  {
    const s = await boot(web, path.join(tmp, 'd-regress'), bj(D1, '12:00'))
    const base = `http://127.0.0.1:${s.port}`
    eq(await post(s, batch('r1', 's-r1', [{ name: 'session_start', n: 1 }])), 204, '/api/e 回 204')
    eq((await fetch(`${base}/api/other`, { method: 'POST', body: 'x' })).status, 405, '别的地址 POST 一律 405')
    const d0 = await fetch(`${base}/dash`)
    eq(d0.status, 401, '/dash 不带钥匙 401')
    check(/Basic realm/.test(d0.headers.get('www-authenticate') ?? ''), '401 带 WWW-Authenticate，浏览器会弹密码框')
    eq((await fetch(`${base}/dash`, { headers: { authorization: AUTH } })).status, 200, '/dash 钥匙对 200')
    const wrong = { authorization: `Basic ${Buffer.from(':nope').toString('base64')}` }
    const codes: number[] = []
    for (let i = 0; i < 31; i++) codes.push((await fetch(`${base}/dash`, { headers: wrong })).status)
    check(codes.slice(0, 30).every((c) => c === 401) && codes[30] === 429, `钥匙错 30 次都是 401，第 31 次 429（${codes[29]} → ${codes[30]}）`)
    eq((await fetch(`${base}/dash`, { headers: { authorization: AUTH } })).status, 429, '猜太多次以后钥匙对了也先 429')

    const full = await fetch(`${base}/music/song.mp3`)
    eq(full.status, 200, '背景音乐不带 Range：200')
    eq(full.headers.get('accept-ranges'), 'bytes', '声明 accept-ranges: bytes')
    eq(full.headers.get('cache-control'), 'public, max-age=604800', '背景音乐缓存一周')
    eq(Buffer.from(await full.arrayBuffer()).equals(MP3), true, '整个文件一个字节不差')
    const part = await fetch(`${base}/music/song.mp3`, { headers: { range: 'bytes=100-199' } })
    eq(part.status, 206, 'Range: bytes=100-199 → 206')
    eq(part.headers.get('content-range'), 'bytes 100-199/1000', 'content-range')
    eq(Buffer.from(await part.arrayBuffer()).equals(MP3.subarray(100, 200)), true, '只发那一段')
    const tail = await fetch(`${base}/music/song.mp3`, { headers: { range: 'bytes=-10' } })
    eq(`${tail.status} ${tail.headers.get('content-range')}`, '206 bytes 990-999/1000', 'Range: bytes=-10 → 最后 10 个字节')
    await tail.arrayBuffer()
    const past = await fetch(`${base}/music/song.mp3`, { headers: { range: 'bytes=5000-' } })
    eq(`${past.status} ${past.headers.get('content-range')}`, '416 bytes */1000', '越界的 Range → 416')

    const idx = await fetch(`${base}/`)
    eq(`${idx.status} ${idx.headers.get('cache-control')}`, '200 no-cache', '首页 200，每次校验')
    const route = await fetch(`${base}/some/front/route`)
    check(route.status === 200 && (await route.text()).includes('<title>edge</title>'), '前端路由回 index.html')
    const asset = await fetch(`${base}/assets/app-abc123.js`)
    eq(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable', 'assets/ 带 hash 的文件缓存一年')
    await asset.text()
    eq((await fetch(`${base}/missing.png`)).status, 404, '缺的静态资源 404，不回首页')
    const mgr = await fetch(`${base}/manager/x`, { redirect: 'manual' })
    eq(`${mgr.status} ${mgr.headers.get('location')}`, '302 /', '/manager 302 回 /')
    await kill(s)
  }
} finally {
  for (const s of servers) { try { s.proc.kill('SIGKILL') } catch { /* 已经没了 */ } }
  await sleep(200)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* Windows 上偶尔还占着 */ }
}

if (bad) {
  console.log(`\n✗ 后台统计的边角有 ${bad} 处不对。`)
  process.exit(1)
}
console.log('\n✓ 后台统计的边角：跨零点的会话只记涨出来的那一截（活的、重启的、重发的都一样）；写盘出错记下来、重试、退出前写完，'
  + '半行不粘坏后面；隔天重启按字节数认缓存；不合规的属性值进不来；没有 dist/ 时 /healthz 是 503；原有的门、Range、缓存头都没动。')
