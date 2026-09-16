/**
 * 后台统计核查 —— 把真实批次和恶意批次真的喂进 server.js，再把看板真的算出来。
 *
 * 作者的经验是：看板的聚合口径没人真跑过，bug 就都在那儿。所以这个脚本不看形状，
 * 只看数：起一个真的 server.js（子进程、临时 DATA_DIR、真的 HTTP），
 * 铺一份手算好的 JSONL，让它自己从原始事件把 90 天重放出来，然后把 /dash 上的
 * 每一个数字和手算的对一遍。
 *
 * 盖到的事：
 *  - 每日新设备 / 活跃设备 / 会话数 / 浏览量
 *  - 在线时长：会话取该会话见过的最大 active_s（心跳是累计量、会重发、还会迟到）
 *  - 留存：按首见日分群的次日 / 第 3 日 / 第 7 日回访率，对着手算的群
 *  - 漏斗：打开 → 建档 → 推完第一周 → 打完第一个赛季 → 走到结局，按设备去重
 *  - 结局分布（破晓 答不了的那一问）、开局构成、打完还是快进、存档失败、设备与屏幕
 *  - 重发的批次一个数都不动（(sid, n) 认一条事件）
 *  - 超大 / 嵌套 / 属性过多 / 事件名不在白名单 / 信封不对的载荷，一律不进数
 *  - 限流会跳闸
 *  - 没配 STATS_KEY 时 /dash 是 404；钥匙错也是 404；不带钥匙才 401 弹框
 *  - 盘上不许出现 IP，也不许出现玩家打进去的文字
 *
 *   npx tsx scripts/check_stats.ts
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = path.join(ROOT, 'server.js')
const KEY = 'test-key-123'

let bad = 0
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}
const eq = (got: unknown, want: unknown, what: string): void =>
  check(String(got) === String(want), `${what}：${String(got)}${String(got) === String(want) ? '' : `（应为 ${String(want)}）`}`)

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms) })

/* ---------- 和 server.js 一模一样的归日（北京时间） ---------- */
const dayStr = (t: number): string => new Date(t + 8 * 3600e3).toISOString().slice(0, 10)
/** 今天往前 n 天 */
const day = (n: number): string => dayStr(Date.now() + n * 86400e3)

/* ---------- 事件与批次 ---------- */
interface Props { [k: string]: string | number | boolean | null }
interface Ev { name: string; n: number; props?: Props }

/** 盘上一行的样子（server.js 写出来的就是这个形状） */
function line(d: string, vid: string, sid: string, n: number, e: string, dev: string, p?: Props): string {
  const o: Record<string, unknown> = { t: Date.parse(`${d}T04:00:00Z`), e, vid, sid, n }
  if (dev) o.dev = dev
  o.tz = 480
  if (p) o.p = p
  return `${JSON.stringify(o)}\n`
}

/* ================= 手算好的那份数据 =================

   留存用两个群（A 群首见日 = 今天 -8，B 群 = -4）；漏斗、结局、开局构成、时长
   用第三个群（F 群 = -2）。每个数都在下面的注释里算过一遍。            */

const A = ['a1', 'a2', 'a3', 'a4']
const B = ['b1', 'b2']
const F = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10']

/** f 设备的开局构成：出身 / 入场年份 / 赛区 / 位置 */
const STARTS: Record<string, [string, number, string, string]> = {
  f1: ['pre', 2026, 'China', '决斗者'],
  f2: ['pre', 2026, 'China', '决斗者'],
  f3: ['chal', 2021, 'EMEA', '哨卫'],
  f4: ['chal', 2021, 'EMEA', '哨卫'],
  f5: ['t1', 2026, 'Pacific', '控场'],
  f6: ['pre', 2026, 'China', '先锋'],
  f7: ['chal', 2026, 'Americas', '自由人'],
  f8: ['t1', 2021, 'Korea', '决斗者'],
}
/** f 设备的设备类型与窗口宽度 */
const DEVW: Record<string, [string, number]> = {
  f1: ['phone', 390], f2: ['desktop', 1280], f3: ['tablet', 768], f4: ['phone', 390],
  f5: ['phone', 390], f6: ['phone', 414], f7: ['desktop', 1920], f8: ['phone', 360],
  f9: ['phone', 360], f10: ['phone', 360],
}

function writeFixture(dir: string): void {
  const put = (d: string, text: string): void => { fs.appendFileSync(path.join(dir, `ev-${d}.jsonl`), text) }
  const open = (d: string, vid: string, dev = 'phone', w = 390): string =>
    line(d, vid, `s-${vid}-${d}`, 1, 'session_start', dev, { w, h: 800, theme: 'dark' })

  // ---- A 群：首见 -8。回访 -7（a1,a2）、-5（a1）、-1（a3）
  for (const v of A) put(day(-8), open(day(-8), v))
  // a1 那天在线 600 秒
  put(day(-8), line(day(-8), 'a1', `s-a1-${day(-8)}`, 2, 'session_end', 'phone', { active_s: 600, reason: 'pagehide' }))
  put(day(-7), open(day(-7), 'a1') + open(day(-7), 'a2'))
  put(day(-5), open(day(-5), 'a1'))

  // ---- B 群：首见 -4。回访 -3（b1）、-1（b1,b2）
  for (const v of B) put(day(-4), open(day(-4), v))
  put(day(-3), open(day(-3), 'b1'))
  // -1 那天：a3（A 群的第 7 日）+ b1,b2（B 群的第 3 日）
  put(day(-1), open(day(-1), 'a3') + open(day(-1), 'b1') + open(day(-1), 'b2'))

  // ---- F 群：首见 -2。漏斗 / 结局 / 开局构成 / 时长 / 设备屏幕全在这天
  const d2 = day(-2)
  for (const v of F) {
    const [dev, w] = DEVW[v]
    put(d2, open(d2, v, dev, w))
  }
  const sid = (v: string): string => `s-${v}-${d2}`
  // 在线时长：f1 的心跳 1200 → 3600 → 2400（迟到的那份更小，一秒都不该加）
  put(d2, line(d2, 'f1', sid('f1'), 3, 'session_ping', 'phone', { active_s: 1200 }))
  put(d2, line(d2, 'f1', sid('f1'), 4, 'session_ping', 'phone', { active_s: 3600 }))
  put(d2, line(d2, 'f1', sid('f1'), 5, 'session_ping', 'phone', { active_s: 2400 }))
  for (const v of F.slice(1)) {
    put(d2, line(d2, v, sid(v), 3, 'session_ping', DEVW[v][0], { active_s: 1800 }))
  }
  // 浏览量：f1 的 home 3 → 2（迟到）→ 5，再加 career 2；f2 的 home 1。合计 3+0+2+2+1 = 8
  put(d2, line(d2, 'f1', sid('f1'), 10, 'screens', 'phone', { to: 'home', hits: 3 }))
  put(d2, line(d2, 'f1', sid('f1'), 11, 'screens', 'phone', { to: 'home', hits: 2 }))
  put(d2, line(d2, 'f1', sid('f1'), 12, 'screens', 'phone', { to: 'home', hits: 5 }))
  put(d2, line(d2, 'f1', sid('f1'), 13, 'screens', 'phone', { to: 'career', hits: 2 }))
  put(d2, line(d2, 'f2', sid('f2'), 10, 'screens', 'desktop', { to: 'home', hits: 1 }))
  // 漏斗：建档 f1–f8、推完第一周 f1–f6、打完第一个赛季 f1–f4、走到结局 f1–f3
  for (const v of F.slice(0, 8)) {
    const [st, yr, rg, rl] = STARTS[v]
    put(d2, line(d2, v, sid(v), 20, 'career_start', DEVW[v][0], { start: st, year: yr, region: rg, role: rl, origin: 'netcafe' }))
  }
  for (const v of F.slice(0, 6)) put(d2, line(d2, v, sid(v), 21, 'week_done', DEVW[v][0], { week: 1 }))
  for (const v of F.slice(0, 4)) put(d2, line(d2, v, sid(v), 22, 'season_done', DEVW[v][0], { season: 1 }))
  const ends: Record<string, string> = { f1: 'world', f2: 'shore', f3: 'world' }
  for (const v of F.slice(0, 3)) {
    const row = line(d2, v, sid(v), 23, 'career_end', DEVW[v][0], { ending: ends[v], seasons: 3 })
    // f3 的结局写两遍：(sid, n) 认一条事件，重放时第二遍必须是空操作
    put(d2, v === 'f3' ? row + row : row)
  }
  // 比赛：打完 5 次、快进 3 次（match_done 带 watched，和两个老名字混着用）
  put(d2, line(d2, 'f1', sid('f1'), 30, 'match_watched', 'phone', { bo: 3 }))
  put(d2, line(d2, 'f1', sid('f1'), 31, 'match_done', 'phone', { watched: true }))
  put(d2, line(d2, 'f2', sid('f2'), 30, 'match_done', 'desktop', { watched: true }))
  put(d2, line(d2, 'f3', sid('f3'), 30, 'match_watched', 'tablet', { bo: 1 }))
  put(d2, line(d2, 'f4', sid('f4'), 30, 'match_watched', 'phone', { bo: 1 }))
  put(d2, line(d2, 'f5', sid('f5'), 30, 'match_skipped', 'phone', { bo: 1 }))
  put(d2, line(d2, 'f6', sid('f6'), 30, 'match_done', 'phone', { watched: false }))
  put(d2, line(d2, 'f7', sid('f7'), 30, 'match_skipped', 'desktop', { bo: 3 }))
  // 存档失败 2 次
  put(d2, line(d2, 'f8', sid('f8'), 40, 'save_fail', 'phone', { kb: 1400, day: 30, year: 2027 }))
  put(d2, line(d2, 'f9', sid('f9'), 40, 'save_fail', 'phone', { kb: 1500, day: 44, year: 2028 }))
}

/* ---------- 起一个真的 server.js ---------- */
interface Srv { proc: ChildProcessWithoutNullStreams; port: number; dir: string }

async function start(env: Record<string, string>, dir: string): Promise<Srv> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const port = 21000 + Math.floor(Math.random() * 9000)
    const proc = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), DATA_DIR: dir, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    proc.stdout.on('data', () => {})
    proc.stderr.on('data', () => {})
    let up = false
    for (let i = 0; i < 100; i++) {
      await sleep(100)
      if (proc.exitCode !== null) break
      try {
        const r = await fetch(`http://127.0.0.1:${port}/healthz`)
        if (r.ok) { up = true; break }
      } catch { /* 还没起来 */ }
    }
    if (up) return { proc, port, dir }
    proc.kill('SIGKILL')
  }
  throw new Error('server.js 起不来')
}
const stop = (s: Srv): void => { try { s.proc.kill('SIGKILL') } catch { /* 已经没了 */ } }

const post = async (s: Srv, body: string): Promise<number> => {
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/e`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })
    return r.status
  } catch {
    return 0            // body 太大被 destroy 掉，连接直接断——也算「没收」
  }
}
const batch = (vid: string, sid: string, events: Ev[], dev = 'phone'): string =>
  JSON.stringify({ v: 1, vid, sid, seq: 1, dev, tz: 480, events: events.map((e) => ({ ...e, t: Date.now() })) })

async function dash(s: Srv, auth: string | null = `Basic ${Buffer.from(`:${KEY}`).toString('base64')}`): Promise<{ status: number; html: string; wwwAuth: string }> {
  const r = await fetch(`http://127.0.0.1:${s.port}/dash`, { headers: auth ? { authorization: auth } : {} })
  return { status: r.status, html: r.status === 200 ? await r.text() : '', wwwAuth: r.headers.get('www-authenticate') ?? '' }
}

/** 看板上那个格子里的数 */
function cell(html: string, key: string): string {
  const m = new RegExp(`data-k="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">([^<]*)<`).exec(html)
  return m ? m[1] : '(缺)'
}

/* ================= 开跑 ================= */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'valstats-'))
const dirs: string[] = [tmp]
const servers: Srv[] = []
try {
  console.log(`临时数据目录 ${tmp}`)
  writeFixture(tmp)
  // stats.json 一份都不给：整个 90 天必须从原始 JSONL 自己重算回来
  check(!fs.existsSync(path.join(tmp, 'stats.json')), '先不给聚合缓存：stats.json 不存在，全部从 JSONL 重放')

  const s = await start({ STATS_KEY: KEY }, tmp)
  servers.push(s)

  // ---------- 一、看板上的每个数 ----------
  console.log('\n看板上的数（全部从原始 JSONL 重放出来）：')
  let g = await dash(s)
  eq(g.status, 200, '带对钥匙打开 /dash')
  let h = g.html

  const d2 = day(-2)
  eq(cell(h, `日:${d2}:新设备`), 10, `${d2} 新设备`)
  eq(cell(h, `日:${d2}:活跃`), 10, `${d2} 活跃设备`)
  eq(cell(h, `日:${d2}:会话`), 10, `${d2} 会话数`)
  // 3（home 到 3）+ 0（迟到的 2）+ 2（home 到 5）+ 2（career）+ 1（f2 的 home）
  eq(cell(h, `日:${d2}:浏览`), 8, `${d2} 浏览量：累计量按 (会话, 页面) 取最大，迟到的那份不倒扣`)
  eq(cell(h, `日:${day(-8)}:新设备`), 4, `${day(-8)} 新设备（A 群）`)
  eq(cell(h, `日:${day(-1)}:活跃`), 3, `${day(-1)} 活跃设备（a3 + b1 + b2）`)
  eq(cell(h, `日:${day(-1)}:新设备`), 0, `${day(-1)} 新设备：全是回访的老设备`)

  // 在线时长：f1 的会话见过的最大 active_s 是 3600（迟到的 2400 一秒都不加），
  // f2–f10 各 1800，a1 600。16 台设备合计 20400 秒 → 人均 1275 秒 = 21 分钟；
  // 排序后中位落在 1800 秒 = 30 分钟。
  eq(cell(h, '时长:人均'), '21 分钟', '人均在线（每台设备累计）：20400 秒 ÷ 16 台')
  eq(cell(h, '时长:中位'), '30 分钟', '中位在线（每台设备累计）')

  // 漏斗
  console.log('\n漏斗（按设备去重）：')
  eq(cell(h, '漏斗:打开'), 16, '打开：a1–a4 + b1,b2 + f1–f10')
  eq(cell(h, '漏斗:建档'), 8, '建档：f1–f8')
  eq(cell(h, '漏斗:推完第一周'), 6, '推完第一周：f1–f6')
  eq(cell(h, '漏斗:打完第一个赛季'), 4, '打完第一个赛季：f1–f4')
  eq(cell(h, '漏斗:走到结局'), 3, '走到结局：f1–f3（f3 的结局写了两遍，只能算一次）')

  // 留存
  console.log('\n留存（按首见日分群）：')
  eq(cell(h, `群:${day(-8)}`), 4, `A 群（${day(-8)}）人数`)
  eq(cell(h, `留存:${day(-8)}:1`), '50.0%', 'A 群次日：a1,a2 回来了 → 2/4')
  eq(cell(h, `留存:${day(-8)}:3`), '25.0%', 'A 群第 3 日：a1 → 1/4')
  eq(cell(h, `留存:${day(-8)}:7`), '25.0%', 'A 群第 7 日：a3 → 1/4')
  eq(cell(h, `群:${day(-4)}`), 2, `B 群（${day(-4)}）人数`)
  eq(cell(h, `留存:${day(-4)}:1`), '50.0%', 'B 群次日：b1 → 1/2')
  eq(cell(h, `留存:${day(-4)}:3`), '100.0%', 'B 群第 3 日：b1,b2 → 2/2')
  check(cell(h, `留存:${day(-4)}:7`) === '(缺)', 'B 群第 7 日还没到：显示「—」，不显示 0%')
  eq(cell(h, `留存:${day(-2)}:1`), '0.0%', 'F 群次日：一个都没回来 → 0%（0 也是个答案）')

  // 结局分布 —— 破晓 答不了的那一问
  console.log('\n结局分布：')
  eq(cell(h, '结局:world'), 2, '世界冠军 world：f1、f3')
  eq(cell(h, '结局:shore'), 1, '没能上岸 shore：f2')
  eq(cell(h, '结局:breaker'), 0, '没人打到的 breaker 也列出来，是 0')
  check(/破局者/.test(h) && /没能上岸/.test(h), '14 个结局的中文名都在页面上')

  // 开局构成
  console.log('\n开局构成：')
  eq(cell(h, '出身:pre'), 3, '天梯 pre：f1,f2,f6')
  eq(cell(h, '出身:chal'), 3, '二队 chal：f3,f4,f7')
  eq(cell(h, '出身:t1'), 2, '一线替补 t1：f5,f8')
  check(/天梯/.test(h) && /二队/.test(h) && /一线替补/.test(h), '出身按中文显示')
  eq(cell(h, '入场年份:2026'), 5, '2026 入场：f1,f2,f5,f6,f7')
  eq(cell(h, '入场年份:2021'), 3, '2021 入场：f3,f4,f8')
  eq(cell(h, '赛区:China'), 3, '中国：f1,f2,f6')
  eq(cell(h, '赛区:EMEA'), 2, '欧非中东：f3,f4')
  eq(cell(h, '位置:决斗者'), 3, '决斗者：f1,f2,f8')
  eq(cell(h, '位置:哨卫'), 2, '哨卫：f3,f4')

  // 比赛、存档、设备
  console.log('\n比赛 / 存档 / 设备：')
  eq(cell(h, '比赛:打完'), 5, '打完：match_watched 3 次 + match_done(watched) 2 次')
  eq(cell(h, '比赛:快进'), 3, '快进：match_skipped 2 次 + match_done(watched:false) 1 次')
  eq(cell(h, '存档:失败'), 2, '存档失败 2 次')
  eq(cell(h, '设备类型:phone'), 13, '手机：f 群 7 台 + a 群 4 台 + b 群 2 台')
  eq(cell(h, '设备类型:desktop'), 2, '电脑：f2、f7')
  eq(cell(h, '设备类型:tablet'), 1, '平板：f3')
  eq(cell(h, '屏幕宽度:360–413'), 12, '360–413 档：f1,f4,f5,f8,f9,f10 + a/b 六台')
  eq(cell(h, '屏幕宽度:≥1600'), 1, '≥1600 档：f7')

  // ---------- 二、活的批次进来 ----------
  console.log('\n活的批次（今天）：')
  const live = batch('live1', 's-live1', [
    { name: 'session_start', n: 1, props: { w: 390, h: 800, theme: 'dark' } },
    { name: 'career_start', n: 2, props: { start: 'pre', year: 2026, region: 'China', role: '控场' } },
    { name: 'week_done', n: 3, props: { week: 1 } },
    { name: 'career_end', n: 4, props: { ending: 'master', seasons: 5 } },
    { name: 'session_end', n: 5, props: { active_s: 900, reason: 'pagehide' } },
  ])
  eq(await post(s, live), 204, '一个正常批次回 204')
  await sleep(150)
  h = (await dash(s)).html
  eq(cell(h, '今日:新设备'), 1, '今日新设备 1 台')
  eq(cell(h, '今日:活跃'), 1, '今日活跃 1 台')
  eq(cell(h, '今日:会话'), 1, '今日会话 1 个')
  eq(cell(h, '结局:master'), 1, '刚上报的结局 master 进了分布')
  eq(cell(h, '漏斗:走到结局'), 4, '漏斗的「走到结局」跟着 +1')
  eq(cell(h, '漏斗:打开'), 17, '漏斗的「打开」跟着 +1')

  // 重发：一个数都不许动
  const before = h
  eq(await post(s, live), 204, '把同一个批次原样再发一遍')
  eq(await post(s, live), 204, '再发第三遍')
  await sleep(150)
  h = (await dash(s)).html
  const keys = ['今日:新设备', '今日:活跃', '今日:会话', '结局:master', '漏斗:打开', '漏斗:走到结局', '漏斗:建档', '时长:人均']
  check(keys.every((k) => cell(h, k) === cell(before, k)),
    `重发的批次一个数都没动（${keys.map((k) => `${k}=${cell(h, k)}`).join('、')}）`)

  // ---------- 三、恶意载荷 ----------
  console.log('\n恶意载荷：')
  const snap = h
  const junk: [string, string][] = [
    ['事件名不在白名单', batch('evil1', 's-evil1', [{ name: 'drop_table', n: 1, props: { key: 'x' } }])],
    ['自造的事件名混在正常批次里', batch('evil2', 's-evil2', [{ name: 'my_own_metric', n: 1 }])],
    ['信封版本不对', JSON.stringify({ v: 9, vid: 'evil3', sid: 's3', events: [{ name: 'session_start', n: 1 }] })],
    ['vid 带奇怪字符', batch('evil<script>', 's-evil4', [{ name: 'session_start', n: 1 }])],
    ['events 不是数组', JSON.stringify({ v: 1, vid: 'evil5', sid: 's5', events: 'nope' })],
    ['events 是空的', batch('evil6', 's-evil6', [])],
    ['一批 400 条（上限 40）', batch('evil7', 's-evil7', Array.from({ length: 400 }, (_, i) => ({ name: 'session_start', n: i })))],
    ['根本不是 JSON', 'not json at all {{{'],
    ['JSON 是个数组', '[1,2,3]'],
    ['n 不是整数', batch('evil8', 's-evil8', [{ name: 'career_end', n: 1.5, props: { ending: 'world' } }])],
  ]
  for (const [what, body] of junk) {
    const st = await post(s, body)
    check(st === 204 || st === 0, `${what}：回 ${st}，不抛错`)
  }
  // 超大 body（32 KB 上限）
  const huge = JSON.stringify({
    v: 1, vid: 'evil9', sid: 's-evil9', seq: 1, dev: 'phone', tz: 480,
    events: [{ name: 'career_end', n: 1, props: { ending: 'world', msg: 'x'.repeat(60000) } }],
  })
  const hugeStatus = await post(s, huge)
  check(huge.length > 32 * 1024 && (hugeStatus === 204 || hugeStatus === 0), `超大 body（${(huge.length / 1024).toFixed(0)} KB）被挡在门外，回 ${hugeStatus}`)
  await sleep(200)
  h = (await dash(s)).html
  const same = ['今日:新设备', '今日:活跃', '结局:master', '结局:world', '漏斗:打开', '漏斗:建档', '出身:pre']
  check(same.every((k) => cell(h, k) === cell(snap, k)),
    `畸形载荷全部没进数，看板一个数都没变（${same.map((k) => `${k}=${cell(h, k)}`).join('、')}）`)

  // ---------- 三之二、合法事件里夹带的东西 ----------
  // 下面两条的事件名和信封都是合法的，服务端本来就该收下——该被剥掉的是属性。
  // 把它们和上面的畸形载荷分开算：混在一起的话，「数没变」会同时掩盖
  // 「该收的没收」和「该挡的没挡」两种错。
  console.log('\n合法事件里夹带的东西（该收的收下，该剥的剥掉）：')
  await post(s, batch('evil10', 's-evil10', [{
    name: 'career_end',
    n: 1,
    props: {
      ending: 'world',
      // 下面这些都不在属性白名单里，一个都不许落盘
      player_name: '我的选手名字',
      team_name: '我打进去的战队名',
      note: '一段自由文字',
      ip: '8.8.8.8',
    } as unknown as Props,
  }]))
  // 嵌套对象 / 数组：cleanProps 只认标量，ending 会被整个丢掉
  await post(s, `{"v":1,"vid":"evil11","sid":"s-evil11","seq":1,"dev":"phone","tz":480,"events":[{"name":"career_end","n":1,"props":{"ending":{"deep":{"deeper":["x"]}},"key":["a","b"]}}]}`)
  await sleep(200)
  h = (await dash(s)).html
  eq(cell(h, '结局:world'), 3, 'evil10 的 career_end 本身合法，world 照收 +1（夹带的字段另算，见下面落盘那节）')
  eq(cell(h, '结局:（未报结局）'), 1, 'evil11 的 ending 是个嵌套对象：被剥成「未报结局」，而不是把对象存进去')

  // ---------- 四、盘上不许有 IP，也不许有玩家打的字 ----------
  console.log('\n落盘的东西：')
  const onDisk = fs.readdirSync(tmp).filter((f) => f.endsWith('.jsonl') || f === 'devices.log' || f === 'stats.json')
    .map((f) => fs.readFileSync(path.join(tmp, f), 'utf8')).join('\n')
  check(!/127\.0\.0\.1|::1|(^|[^\d])\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/m.test(onDisk.replace(/"kb":\d+/g, '')),
    'JSONL / devices.log / stats.json 里没有任何 IP 地址')
  check(!onDisk.includes('我的选手名字') && !onDisk.includes('我打进去的战队名') && !onDisk.includes('一段自由文字'),
    '玩家打进去的文字一个字都没落盘（属性名白名单挡住了）')
  check(!onDisk.includes('player_name') && !onDisk.includes('team_name'),
    '白名单外的属性名连键都没留下')
  check(!/user-agent|Mozilla/i.test(onDisk), '没有 User-Agent')
  const devLog = fs.readFileSync(path.join(tmp, 'devices.log'), 'utf8').trim().split('\n')
  check(devLog[0] === `${day(-8)} a1`, `devices.log 第一行就是首见日：「${devLog[0]}」`)
  check(devLog.filter((l) => l.startsWith(day(-2))).length === 10, 'devices.log 里 F 群 10 台的首见日都是 -2 天')
  const sample = fs.readFileSync(path.join(tmp, `ev-${day(-2)}.jsonl`), 'utf8').split('\n')[0]
  console.log(`  盘上一行长这样：${sample}`)

  // 聚合缓存真的落了盘
  check(fs.existsSync(path.join(tmp, 'stats.json')), 'stats.json 落盘了（/dash 每次都会催一次）')
  const cached = JSON.parse(fs.readFileSync(path.join(tmp, 'stats.json'), 'utf8')) as { days: Record<string, { uv: number }> }
  eq(cached.days[day(-2)].uv, 10, '聚合缓存里 -2 天的活跃设备数')

  // ---------- 五、重启之后 ----------
  console.log('\n重启（聚合缓存被删掉，全部重放）：')
  stop(s)
  await sleep(300)
  fs.rmSync(path.join(tmp, 'stats.json'))
  fs.rmSync(path.join(tmp, 'stats.json.bak'), { force: true })
  const s2 = await start({ STATS_KEY: KEY }, tmp)
  servers.push(s2)
  const h2 = (await dash(s2)).html
  const survive = ['漏斗:打开', '漏斗:建档', '漏斗:走到结局', '结局:world', '结局:master', '出身:pre', '时长:人均', `留存:${day(-8)}:7`]
  check(survive.every((k) => cell(h2, k) === cell(h, k)),
    `聚合表整个删掉也能从 JSONL 重算回同样的数（${survive.map((k) => `${k}=${cell(h2, k)}`).join('、')}）`)
  stop(s2)

  // ---------- 六、限流 ----------
  console.log('\n限流：')
  const rdir = fs.mkdtempSync(path.join(os.tmpdir(), 'valstats-rate-'))
  dirs.push(rdir)
  const s3 = await start({ STATS_KEY: KEY, STATS_RATE_IP: '5' }, rdir)
  servers.push(s3)
  const codes: number[] = []
  for (let i = 0; i < 9; i++) {
    codes.push(await post(s3, batch(`r${i}`, `s-r${i}`, [{ name: 'session_start', n: 1, props: { w: 390 } }])))
  }
  check(codes.slice(0, 5).every((c) => c === 204), `每分钟 5 次的上限内前 5 次都收下了（${codes.slice(0, 5).join(',')}）`)
  check(codes.slice(5).every((c) => c === 429), `超出之后一律 429（${codes.slice(5).join(',')}）`)
  const h3 = (await dash(s3)).html
  eq(cell(h3, '今日:活跃'), 5, '被限流挡下的那 4 台设备一台都没记进去')
  stop(s3)

  // ---------- 七、看板的门 ----------
  console.log('\n看板的门：')
  const ndir = fs.mkdtempSync(path.join(os.tmpdir(), 'valstats-nokey-'))
  dirs.push(ndir)
  const s4 = await start({}, ndir)          // 不给 STATS_KEY
  servers.push(s4)
  const noKey = await dash(s4)
  eq(noKey.status, 404, '没配 STATS_KEY：/dash 是 404，当这页不存在')
  const noKeyNoAuth = await dash(s4, null)
  eq(noKeyNoAuth.status, 404, '没配 STATS_KEY 且不带钥匙：还是 404，不弹框')
  const healthz = await fetch(`http://127.0.0.1:${s4.port}/healthz`)
  eq(healthz.status, 200, '没配钥匙不影响游戏：/healthz 照样 200')
  eq(await post(s4, batch('nk1', 's-nk1', [{ name: 'session_start', n: 1 }])), 204, '没配钥匙时事件照记')
  stop(s4)

  const s5 = await start({ STATS_KEY: KEY }, fs.mkdtempSync(path.join(os.tmpdir(), 'valstats-auth-')))
  servers.push(s5)
  dirs.push(s5.dir)
  const wrong = await dash(s5, `Basic ${Buffer.from(':nope').toString('base64')}`)
  eq(wrong.status, 404, '钥匙错：404（承认自己存在的入口会把人招回来）')
  const none = await dash(s5, null)
  eq(none.status, 401, '不带钥匙：401，浏览器才好弹密码框')
  check(/Basic realm/i.test(none.wwwAuth), `401 带上了 WWW-Authenticate：${none.wwwAuth}`)
  const right = await dash(s5)
  eq(right.status, 200, '钥匙对：200')
  const cspRes = await fetch(`http://127.0.0.1:${s5.port}/dash`, { headers: { authorization: `Basic ${Buffer.from(`:${KEY}`).toString('base64')}` } })
  const csp = cspRes.headers.get('content-security-policy') ?? ''
  check(/default-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp), `看板带着严格的 CSP：${csp}`)
  check(!/<script/i.test(right.html), '看板一行客户端 JS 都没有')
  check(/<meta http-equiv="refresh"/.test(right.html), '看板自己定时刷新')
  check(/<svg/.test(right.html), '柱状图是手写 SVG，没有图表库')
  stop(s5)
} finally {
  for (const s of servers) stop(s)
  await sleep(200)
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* Windows 上偶尔还占着 */ } }
}

if (bad) {
  console.log(`\n✗ 后台统计有 ${bad} 处不对。`)
  process.exit(1)
}
console.log('\n✓ 后台统计：看板每个数都对得上手算的；重发的批次不动数；恶意载荷进不来；'
  + '限流会跳闸；聚合表删了能从原始事件重算；没配钥匙 /dash 是 404；盘上没有 IP、没有玩家打进去的文字。')
