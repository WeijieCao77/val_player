/**
 * 后台统计核查 —— 把真实批次和恶意批次真的喂进 server.js，再把看板真的算出来。
 *
 * 作者的经验是：看板的聚合口径没人真跑过，bug 就都在那儿。所以这个脚本不看形状，
 * 只看数：起一个真的 server.js（子进程、临时 DATA_DIR、真的 HTTP），铺一份手算好的
 * JSONL，让它自己从原始事件把 90 天重放出来，再把 /dash 上的每一个数字和手算的对一遍。
 *
 * 盖到的事：
 *  - 事件契约两边对齐：服务端收的那 16 个名字、那一堆属性名，和客户端导出的
 *    TELEMETRY_EVENTS 完全相等（多一个少一个都挂）。名字对不上的事件会被静悄悄丢掉，
 *    看板那一节就永远空着，而空图表看着和「还没人玩」一模一样——这种错要让核查红，
 *    不能让它自己躺着。（原来服务端收的是 career_end，客户端发的是 ending。）
 *  - 每日新设备 / 活跃设备 / 会话数 / 浏览量
 *  - 在线时长：会话取该会话见过的最大 active_s（心跳是累计量、会重发、还会迟到）
 *  - 留存：按首见日分群的次日 / 第 3 日 / 第 7 日回访率，对着手算的群
 *  - 漏斗：打开 → 建档(career_start) → 推完第一周(turns) → 打完第一个赛季(season_done)
 *    → 走到结局(ending)，按设备去重
 *  - 结局分布（破晓 答不了的那一问，认的是 ending 事件的 key）
 *  - 开局构成、打完还是快进（matches 的累计量）、存档失败、前端报错、设备与屏幕
 *  - 重发的批次一个数都不动；累计量迟到的那份一秒都不加
 *  - 超大 / 嵌套 / 属性过多 / 事件名不在契约里 / 信封不对的载荷，一律不进数
 *  - 限流会跳闸；聚合表删掉能从原始事件重算
 *  - 没配 STATS_KEY 时 /dash 是 404；钥匙错是 401（按作者核查记录的口径）
 *  - 盘上不许出现 IP，也不许出现玩家打进去的文字
 *
 *   npx tsx scripts/check_stats.ts
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVENTS, EVENT_PROPS, PROP_KEYS, ROLLUPS } from '../stats-contract.js'

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
const day = (n: number): string => dayStr(Date.now() + n * 86400e3)

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

/* ================= 手算好的那份数据 ================= */

const A = ['a1', 'a2', 'a3', 'a4']
const B = ['b1', 'b2']
const F = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10']

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
  put(day(-8), line(day(-8), 'a1', `s-a1-${day(-8)}`, 2, 'session_end', 'phone', { active_s: 600, reason: 'pagehide' }))
  put(day(-7), open(day(-7), 'a1') + open(day(-7), 'a2'))
  put(day(-5), open(day(-5), 'a1'))

  // ---- B 群：首见 -4。回访 -3（b1）、-1（b1,b2）
  for (const v of B) put(day(-4), open(day(-4), v))
  put(day(-3), open(day(-3), 'b1'))
  put(day(-1), open(day(-1), 'a3') + open(day(-1), 'b1') + open(day(-1), 'b2'))

  // ---- F 群：首见 -2
  const d2 = day(-2)
  for (const v of F) put(d2, open(d2, v, DEVW[v][0], DEVW[v][1]))
  const sid = (v: string): string => `s-${v}-${d2}`
  const row = (v: string, n: number, e: string, p?: Props): void => put(d2, line(d2, v, sid(v), n, e, DEVW[v][0], p))

  // 在线时长：f1 的心跳 1200 → 3600 → 2400（迟到的那份更小，一秒都不该加）
  row('f1', 3, 'session_ping', { active_s: 1200 })
  row('f1', 4, 'session_ping', { active_s: 3600 })
  row('f1', 5, 'session_ping', { active_s: 2400 })
  for (const v of F.slice(1)) row(v, 3, 'session_ping', { active_s: 1800 })

  // 浏览量（screens 是累计量）：f1 的 home 3 → 2（迟到）→ 5，再加 career 2；f2 的 home 1
  row('f1', 10, 'screens', { to: 'home', hits: 3 })
  row('f1', 11, 'screens', { to: 'home', hits: 2 })
  row('f1', 12, 'screens', { to: 'home', hits: 5 })
  row('f1', 13, 'screens', { to: 'career', hits: 2 })
  row('f2', 10, 'screens', { to: 'home', hits: 1 })

  // 漏斗：建档 f1–f8、推完第一周 f1–f6（turns）、打完第一个赛季 f1–f4（season_done）、结局 f1–f3
  for (const v of F.slice(0, 8)) {
    const [st, yr, rg, rl] = STARTS[v]
    row(v, 20, 'career_start', { year: yr, region: rg, role: rl, start: st, origin: 'netcafe', talent_max: 5, talent_spread: 3, talent_points: 12 })
  }
  for (const v of F.slice(0, 6)) row(v, 21, 'turns', { turns: 3, many: 1, day: 20, year: 2026, phase: 'pre', tier: 0 })
  for (const v of F.slice(0, 4)) row(v, 22, 'season_done', { n: 1, year: 2026, tier: 2, matches: 12, starts: 9, titles: 0 })
  const ends: Record<string, string> = { f1: 'world', f2: 'shore', f3: 'world' }
  for (const v of F.slice(0, 3)) {
    const one = line(d2, v, sid(v), 23, 'ending', DEVW[v][0], {
      key: ends[v], why: 'age', age: 28, pro_seasons: 5, titles: 2, titles_started: 1, peak_tier: 1, year: 2031, entry_year: 2026,
    })
    // f3 的结局写两遍：(sid, n) 认一条事件，重放时第二遍必须是空操作
    put(d2, v === 'f3' ? one + one : one)
  }

  // 比赛（matches 是累计量，按 cls 分行）：打完 5、快进 3、其中我首发 4
  row('f1', 30, 'matches', { cls: 'league', played: 2, skip: 1, started: 2 })
  row('f1', 31, 'matches', { cls: 'league', played: 3, skip: 1, started: 3 })
  row('f1', 32, 'matches', { cls: 'league', played: 2, skip: 0, started: 1 })   // 迟到的一份：一场都不该加
  row('f2', 30, 'matches', { cls: 'masters', played: 1, skip: 2, started: 0 })
  row('f3', 30, 'matches', { cls: 'league', played: 1, skip: 0, started: 1 })

  // 存档失败 2 次
  row('f8', 40, 'save_fail', { what: 'write', kb: 1400, packed: true, year: 2027, day: 30 })
  row('f9', 40, 'save_fail', { what: 'pack', kb: 1500, packed: false, year: 2028, day: 44 })

  // 前端报错（累计量）：一个位置 3 次，另一个 1 次
  row('f5', 50, 'errors', { n: 2, at: 'PlayerGame-abc.js:10:5' })
  row('f5', 51, 'errors', { n: 3, at: 'PlayerGame-abc.js:10:5' })
  row('f6', 50, 'errors', { n: 1, at: 'world-xyz.js:2:1' })
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

function cell(html: string, key: string): string {
  const m = new RegExp(`data-k="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">([^<]*)<`).exec(html)
  return m ? m[1] : '(缺)'
}

/** 那一天的 JSONL 里，这台设备落了几行 */
const linesFor = (dir: string, d: string, vid: string): number => {
  let txt = ''
  try { txt = fs.readFileSync(path.join(dir, `ev-${d}.jsonl`), 'utf8') } catch { return 0 }
  return txt.split('\n').filter((l) => l && (JSON.parse(l) as { vid: string }).vid === vid).length
}

/** 这台设备各个事件落盘时留下的属性名 */
function storedProps(dir: string, d: string, vid: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let txt = ''
  try { txt = fs.readFileSync(path.join(dir, `ev-${d}.jsonl`), 'utf8') } catch { return out }
  for (const l of txt.split('\n')) {
    if (!l) continue
    const o = JSON.parse(l) as { vid: string; e: string; p?: Record<string, unknown> }
    if (o.vid !== vid) continue
    out.set(o.e, Object.keys(o.p ?? {}))
  }
  return out
}

/* ================= 开跑 ================= */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'valstats-'))
const dirs: string[] = [tmp]
const servers: Srv[] = []
try {
  console.log(`临时数据目录 ${tmp}`)

  // ---------- 〇、事件契约两边对齐 ----------
  console.log('\n事件契约（服务端收的 = 客户端 TELEMETRY_EVENTS 声明的）：')
  // 用拼出来的路径 import：客户端那半边还没合过来时，这里要能跳过而不是编译不过
  const spec = ['..', 'src', 'engine', 'me', 'telemetry'].join('/')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(spec).catch(() => null)
  if (!mod) {
    console.log('  ⚠ 客户端 src/engine/me/telemetry.ts 还没合到这个分支上，契约比对跳过。')
    console.log('    （两半合到一棵树上之后这一节会自动生效；合并前它只能这样。）')
  } else if (!mod.TELEMETRY_EVENTS) {
    check(false, '客户端模块在，却没有导出 TELEMETRY_EVENTS——契约没法比对')
  } else {
    const c = mod.TELEMETRY_EVENTS as Record<string, readonly string[]>
    // ---- 事件名：两个方向都不许有多的
    const theirs = new Set(Object.keys(c))
    const mineOnly = [...EVENTS].filter((k) => !theirs.has(k))
    const theirsOnly = [...theirs].filter((k) => !EVENTS.has(k))
    check(mineOnly.length === 0, `服务端没有多收契约里没有的事件名${mineOnly.length ? `（多了 ${mineOnly.join('、')}）` : ''}`)
    check(theirsOnly.length === 0, `契约声明的事件名服务端全都收${theirsOnly.length ? `（漏了 ${theirsOnly.join('、')}）` : ''}`)
    eq(EVENTS.size, theirs.size, `事件名个数一致（${theirs.size} 个）`)

    // ---- 属性名：逐个事件比，不是比并集。
    //      比并集会漏掉「属性搬了家」这种错：key 从 ending 挪到 session_start，
    //      并集一点没变，但 ending 的结局分布会空掉。
    const perEvent: string[] = []
    for (const name of [...theirs].sort()) {
      const want = [...(c[name] ?? [])].sort()
      const got = [...(EVENT_PROPS as Record<string, string[]>)[name] ?? []].sort()
      const extra = got.filter((k) => !want.includes(k))
      const missing = want.filter((k) => !got.includes(k))
      if (extra.length || missing.length) {
        perEvent.push(`${name}${missing.length ? ` 缺 ${missing.join('、')}` : ''}${extra.length ? ` 多 ${extra.join('、')}` : ''}`)
      }
    }
    check(perEvent.length === 0,
      `每个事件允许的属性名都和契约逐字一致${perEvent.length ? `：\n      ${perEvent.join('\n      ')}` : `（${theirs.size} 个事件、${PROP_KEYS.size} 个属性名）`}`)

    // ---- 累计量那几组必须都在契约里，且行键/数字字段都是它声明过的属性
    for (const [g, r] of Object.entries(ROLLUPS)) {
      const ks = c[g]
      check(!!ks, `累计量组 ${g} 在契约里`)
      if (!ks) continue
      const missing = [r.key, ...r.nums].filter((k) => k && !ks.includes(k))
      check(missing.length === 0, `${g} 的行键和累计字段都在契约里${missing.length ? `（缺 ${missing.join('、')}）` : ''}`)
    }
  }

  // ---------- 〇之二、契约里的每个名字都真的收得下 ----------
  // 单起一个服务器和数据目录。这一批要把 16 个名字都发一遍，其中 season_done 和 ending
  // 本来就会进漏斗和结局分布——混在主夹具里就会把手算好的数顶掉（第一版就是这么错的：
  // 走到结局多了一个、打完第一个赛季多了一个）。探针只负责证明「名字收得下」，
  // 不该和口径核对共用一份数据。
  console.log('\n契约里的每个名字都真的收得下（单独一个实例，不碰主夹具）：')
  {
    const pdir = fs.mkdtempSync(path.join(os.tmpdir(), 'valstats-names-'))
    dirs.push(pdir)
    const sp = await start({ STATS_KEY: KEY }, pdir)
    servers.push(sp)
    // 载荷直接照契约造：每个事件带上它声明的每一个属性（值给 1，这一节只问收不收）
    const names = [...EVENTS]
    const all: Ev[] = names.map((name, i) => ({
      name,
      n: i + 1,
      props: Object.fromEntries((EVENT_PROPS as Record<string, string[]>)[name].map((k) => [k, 1])) as Props,
    }))
    eq(await post(sp, batch('allnames', 's-allnames', all)), 204, `一批 ${all.length} 条，契约里的名字一个不落`)
    await sleep(250)
    eq(linesFor(pdir, day(0), 'allnames'), EVENTS.size, `${EVENTS.size} 条全部落了盘——契约声明的名字服务端一个都没丢`)
    // 落盘那一行里的属性，必须正好是契约给这个事件声明的那些
    const stored = storedProps(pdir, day(0), 'allnames')
    const wrong: string[] = []
    for (const name of names) {
      const want = [...(EVENT_PROPS as Record<string, string[]>)[name]].sort().join(',')
      const got = (stored.get(name) ?? []).sort().join(',')
      if (want !== got) wrong.push(`${name}：落盘 [${got}]，契约 [${want}]`)
    }
    check(wrong.length === 0,
      `每个事件落盘的属性正好是契约声明的那些${wrong.length ? `：\n      ${wrong.join('\n      ')}` : ''}`)
    // 反向：把 ending 的 key 塞到 session_start 上——按事件收窄就该把它剥掉
    await post(sp, batch('crossprop', 's-crossprop', [
      { name: 'session_start', n: 1, props: { w: 390, key: 'world', at: 'x.js:1:1' } as unknown as Props },
    ]))
    await sleep(250)
    const cross = storedProps(pdir, day(0), 'crossprop').get('session_start') ?? []
    check(cross.includes('w') && !cross.includes('key') && !cross.includes('at'),
      `别的事件的属性混进来会被剥掉：session_start 只留下 [${cross.join(',')}]`)

    const junkNames: Ev[] = [
      // 改名之前服务端收的就是这几个；现在必须被拒，否则就是又对不上了
      { name: 'career_end', n: 1, props: { key: 'world' } },
      { name: 'week_done', n: 2 },
      { name: 'match_done', n: 3 },
      { name: 'save_size', n: 4 },
      { name: 'my_own_metric', n: 5 },
    ]
    eq(await post(sp, batch('badnames', 's-badnames', junkNames)), 204, '一批契约外的名字')
    await sleep(250)
    eq(linesFor(pdir, day(0), 'badnames'), 0, '契约外的名字一条都没落盘（career_end / week_done / match_done 都在其中）')
    stop(sp)
  }

  writeFixture(tmp)
  check(!fs.existsSync(path.join(tmp, 'stats.json')), '先不给聚合缓存：stats.json 不存在，全部从 JSONL 重放')

  const s = await start({ STATS_KEY: KEY }, tmp)
  servers.push(s)

  // ---------- 一、看板上的每个数 ----------
  console.log('\n看板上的数（全部从原始 JSONL 重放出来）：')
  const g = await dash(s)
  eq(g.status, 200, '带对钥匙打开 /dash')
  let h = g.html

  const d2 = day(-2)
  eq(cell(h, `日:${d2}:新设备`), 10, `${d2} 新设备`)
  eq(cell(h, `日:${d2}:活跃`), 10, `${d2} 活跃设备`)
  eq(cell(h, `日:${d2}:会话`), 10, `${d2} 会话数`)
  eq(cell(h, `日:${d2}:浏览`), 8, `${d2} 浏览量：累计量按 (会话, 页面) 取最大，迟到的那份不倒扣`)
  eq(cell(h, `日:${day(-8)}:新设备`), 4, `${day(-8)} 新设备（A 群）`)
  eq(cell(h, `日:${day(-1)}:活跃`), 3, `${day(-1)} 活跃设备（a3 + b1 + b2）`)
  eq(cell(h, `日:${day(-1)}:新设备`), 0, `${day(-1)} 新设备：全是回访的老设备`)

  eq(cell(h, '时长:人均'), '21 分钟', '人均在线（每台设备累计）：20400 秒 ÷ 16 台')
  eq(cell(h, '时长:中位'), '30 分钟', '中位在线（每台设备累计）')

  console.log('\n漏斗（按设备去重）：')
  eq(cell(h, '漏斗:打开'), 16, '打开：a1–a4 + b1,b2 + f1–f10')
  eq(cell(h, '漏斗:建档'), 8, '建档 career_start：f1–f8')
  eq(cell(h, '漏斗:推完第一周'), 6, '推完第一周 turns：f1–f6')
  eq(cell(h, '漏斗:打完第一个赛季'), 4, '打完第一个赛季 season_done：f1–f4')
  eq(cell(h, '漏斗:走到结局'), 3, '走到结局 ending：f1–f3（f3 写了两遍，只能算一次）')

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

  console.log('\n结局分布（认的是 ending 事件的 key）：')
  eq(cell(h, '结局:world'), 2, '世界冠军 world：f1、f3')
  eq(cell(h, '结局:shore'), 1, '没能上岸 shore：f2')
  eq(cell(h, '结局:breaker'), 0, '没人打到的 breaker 也列出来，是 0')
  check(/破局者/.test(h) && /没能上岸/.test(h), '14 个结局的中文名都在页面上')

  console.log('\n开局构成 / 比赛 / 存档 / 报错 / 设备：')
  eq(cell(h, '出身:pre'), 3, '天梯 pre：f1,f2,f6')
  eq(cell(h, '出身:chal'), 3, '二队 chal：f3,f4,f7')
  eq(cell(h, '出身:t1'), 2, '一线替补 t1：f5,f8')
  check(/天梯/.test(h) && /二队/.test(h) && /一线替补/.test(h), '出身按中文显示')
  eq(cell(h, '入场年份:2026'), 5, '2026 入场：f1,f2,f5,f6,f7')
  eq(cell(h, '入场年份:2021'), 3, '2021 入场：f3,f4,f8')
  eq(cell(h, '赛区:China'), 3, '中国：f1,f2,f6')
  eq(cell(h, '位置:决斗者'), 3, '决斗者：f1,f2,f8')
  eq(cell(h, '比赛:打完'), 5, '打完（matches.played 累计）：f1 3 + f2 1 + f3 1，迟到的那份不加')
  eq(cell(h, '比赛:快进'), 3, '快进（matches.skip 累计）：f1 1 + f2 2')
  eq(cell(h, '比赛:首发'), 4, '其中我首发（matches.started 累计）：f1 3 + f3 1')
  eq(cell(h, '存档:失败'), 2, '存档失败 2 次')
  eq(cell(h, '出错位置:PlayerGame-abc.js:10:5'), 3, '前端报错按位置累计：2 → 3，只加涨出来的那一截')
  eq(cell(h, '出错位置:world-xyz.js:2:1'), 1, '另一个出错位置 1 次')
  eq(cell(h, '设备类型:phone'), 13, '手机：f 群 7 台 + a 群 4 台 + b 群 2 台（按设备去重）')
  eq(cell(h, '屏幕宽度:360–413'), 12, '360–413 档（按设备去重）')

  // ---------- 二、活的批次 + 重发 ----------
  console.log('\n活的批次（今天）：')
  const live = batch('live1', 's-live1', [
    { name: 'session_start', n: 1, props: { w: 390, h: 800, theme: 'dark' } },
    { name: 'career_start', n: 2, props: { year: 2026, region: 'China', role: '控场', start: 'pre', origin: 'netcafe' } },
    { name: 'turns', n: 3, props: { turns: 1, many: 0, day: 3, year: 2026, phase: 'pre', tier: 0 } },
    { name: 'season_done', n: 4, props: { n: 1, year: 2026, tier: 2, matches: 10, starts: 6, titles: 0 } },
    { name: 'ending', n: 5, props: { key: 'master', why: 'age', year: 2030 } },
    { name: 'session_end', n: 6, props: { active_s: 900, reason: 'pagehide' } },
  ])
  eq(await post(s, live), 204, '一个正常批次回 204')
  await sleep(200)
  h = (await dash(s)).html
  eq(cell(h, '结局:master'), 1, '刚上报的结局 master 进了分布')
  eq(cell(h, '漏斗:走到结局'), 4, '漏斗的「走到结局」跟着 +1')
  eq(cell(h, '漏斗:打完第一个赛季'), 5, '漏斗的「打完第一个赛季」跟着 +1')
  eq(cell(h, '漏斗:推完第一周'), 7, '漏斗的「推完第一周」跟着 +1')

  const before = h
  eq(await post(s, live), 204, '把同一个批次原样再发一遍')
  eq(await post(s, live), 204, '再发第三遍')
  await sleep(200)
  h = (await dash(s)).html
  const keys = ['今日:活跃', '今日:会话', '结局:master', '漏斗:打开', '漏斗:走到结局', '漏斗:建档', '漏斗:打完第一个赛季', '时长:人均']
  check(keys.every((k) => cell(h, k) === cell(before, k)),
    `重发的批次一个数都没动（${keys.map((k) => `${k}=${cell(h, k)}`).join('、')}）`)

  // ---------- 四、恶意载荷 ----------
  console.log('\n恶意载荷：')
  const snap = h
  const junk: [string, string][] = [
    ['信封版本不对', JSON.stringify({ v: 9, vid: 'evil3', sid: 's3', events: [{ name: 'session_start', n: 1 }] })],
    ['vid 带奇怪字符', batch('evil<script>', 's-evil4', [{ name: 'session_start', n: 1 }])],
    ['events 不是数组', JSON.stringify({ v: 1, vid: 'evil5', sid: 's5', events: 'nope' })],
    ['events 是空的', batch('evil6', 's-evil6', [])],
    ['一批 400 条（上限 40）', batch('evil7', 's-evil7', Array.from({ length: 400 }, (_, i) => ({ name: 'session_start', n: i })))],
    ['根本不是 JSON', 'not json at all {{{'],
    ['JSON 是个数组', '[1,2,3]'],
    ['n 不是整数', batch('evil8', 's-evil8', [{ name: 'ending', n: 1.5, props: { key: 'world' } }])],
  ]
  for (const [what, body] of junk) {
    const st = await post(s, body)
    check(st === 204 || st === 0, `${what}：回 ${st}，不抛错`)
  }
  const huge = JSON.stringify({
    v: 1, vid: 'evil9', sid: 's-evil9', seq: 1, dev: 'phone', tz: 480,
    events: [{ name: 'ending', n: 1, props: { key: 'world', why: 'x'.repeat(60000) } }],
  })
  const hugeStatus = await post(s, huge)
  check(huge.length > 32 * 1024 && (hugeStatus === 204 || hugeStatus === 0), `超大 body（${(huge.length / 1024).toFixed(0)} KB）被挡在门外，回 ${hugeStatus}`)
  await sleep(200)
  h = (await dash(s)).html
  const same = ['今日:活跃', '结局:master', '结局:world', '漏斗:打开', '漏斗:建档', '出身:pre']
  check(same.every((k) => cell(h, k) === cell(snap, k)),
    `畸形载荷全部没进数，看板一个数都没变（${same.map((k) => `${k}=${cell(h, k)}`).join('、')}）`)

  console.log('\n合法事件里夹带的东西（该收的收下，该剥的剥掉）：')
  await post(s, batch('evil10', 's-evil10', [{
    name: 'ending',
    n: 1,
    props: {
      key: 'world',
      player_name: '我的选手名字',
      team_name: '我打进去的战队名',
      note: '一段自由文字',
      msg: '引擎的报错信息',
      ip: '8.8.8.8',
    } as unknown as Props,
  }]))
  await post(s, `{"v":1,"vid":"evil11","sid":"s-evil11","seq":1,"dev":"phone","tz":480,"events":[{"name":"ending","n":1,"props":{"key":{"deep":{"deeper":["x"]}},"why":["a","b"]}}]}`)
  await sleep(200)
  h = (await dash(s)).html
  eq(cell(h, '结局:world'), 3, 'evil10 的 ending 本身合法，world 照收 +1（夹带的字段另算）')
  eq(cell(h, '结局:（未报结局）'), 1, 'evil11 的 key 是个嵌套对象：被剥成「未报结局」，不是存进去')

  // ---------- 五、落盘的东西 ----------
  console.log('\n落盘的东西：')
  const onDisk = fs.readdirSync(tmp).filter((f) => f.endsWith('.jsonl') || f === 'devices.log' || f === 'stats.json')
    .map((f) => fs.readFileSync(path.join(tmp, f), 'utf8')).join('\n')
  check(!/127\.0\.0\.1|::1/.test(onDisk), 'JSONL / devices.log / stats.json 里没有任何 IP 地址')
  check(!onDisk.includes('我的选手名字') && !onDisk.includes('我打进去的战队名') && !onDisk.includes('一段自由文字'),
    '玩家打进去的文字一个字都没落盘（属性名白名单挡住了）')
  check(!onDisk.includes('引擎的报错信息') && !onDisk.includes('"msg"'), '报错信息本身也落不了盘（msg 不在白名单里）')
  check(!onDisk.includes('player_name') && !onDisk.includes('team_name'), '白名单外的属性名连键都没留下')
  check(!/user-agent|Mozilla/i.test(onDisk), '没有 User-Agent')
  const devLog = fs.readFileSync(path.join(tmp, 'devices.log'), 'utf8').trim().split('\n')
  check(devLog[0] === `${day(-8)} a1`, `devices.log 第一行就是首见日：「${devLog[0]}」`)
  const sample = fs.readFileSync(path.join(tmp, `ev-${day(-2)}.jsonl`), 'utf8').split('\n')[0]
  console.log(`  盘上一行长这样：${sample}`)

  // ---------- 六、重启之后 ----------
  console.log('\n重启（聚合缓存被删掉，全部重放）：')
  stop(s)
  await sleep(300)
  fs.rmSync(path.join(tmp, 'stats.json'))
  fs.rmSync(path.join(tmp, 'stats.json.bak'), { force: true })
  const s2 = await start({ STATS_KEY: KEY }, tmp)
  servers.push(s2)
  const h2 = (await dash(s2)).html
  const survive = ['漏斗:打开', '漏斗:建档', '漏斗:推完第一周', '漏斗:打完第一个赛季', '漏斗:走到结局',
    '结局:world', '结局:master', '出身:pre', '比赛:打完', '时长:人均', `留存:${day(-8)}:7`]
  check(survive.every((k) => cell(h2, k) === cell(h, k)),
    `聚合表整个删掉也能从 JSONL 重算回同样的数（${survive.map((k) => `${k}=${cell(h2, k)}`).join('、')}）`)
  stop(s2)

  // ---------- 七、限流 ----------
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
  eq(cell((await dash(s3)).html, '今日:活跃'), 5, '被限流挡下的那 4 台设备一台都没记进去')
  stop(s3)

  // ---------- 八、看板的门 ----------
  console.log('\n看板的门：')
  const ndir = fs.mkdtempSync(path.join(os.tmpdir(), 'valstats-nokey-'))
  dirs.push(ndir)
  const s4 = await start({}, ndir)
  servers.push(s4)
  eq((await dash(s4)).status, 404, '没配 STATS_KEY：/dash 是 404，当这页不存在')
  eq((await dash(s4, null)).status, 404, '没配 STATS_KEY 且不带钥匙：还是 404，不弹框')
  eq((await fetch(`http://127.0.0.1:${s4.port}/healthz`)).status, 200, '没配钥匙不影响游戏：/healthz 照样 200')
  eq(await post(s4, batch('nk1', 's-nk1', [{ name: 'session_start', n: 1 }])), 204, '没配钥匙时事件照记')
  stop(s4)

  const adir = fs.mkdtempSync(path.join(os.tmpdir(), 'valstats-auth-'))
  dirs.push(adir)
  const s5 = await start({ STATS_KEY: KEY }, adir)
  servers.push(s5)
  const wrong = await dash(s5, `Basic ${Buffer.from(':nope').toString('base64')}`)
  eq(wrong.status, 401, '钥匙错：401 再弹一次框（破晓 就是这么做的，作者核查记录里也是这个口径）')
  check(/Basic realm/i.test(wrong.wwwAuth), `钥匙错的 401 也带 WWW-Authenticate：${wrong.wwwAuth}`)
  const none = await dash(s5, null)
  eq(none.status, 401, '不带钥匙：401，浏览器才好弹密码框')
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
console.log('\n✓ 后台统计：事件契约和客户端对齐；看板每个数都对得上手算的；重发的批次不动数；'
  + '恶意载荷进不来；限流会跳闸；聚合表删了能从原始事件重算；没配钥匙 /dash 是 404、钥匙错是 401；'
  + '盘上没有 IP、没有玩家打进去的文字、也没有报错信息本身。')
