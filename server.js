/* val_player —— 零依赖静态服务器 + 后台统计
   游戏是 vite 打出来的纯静态产物（dist/），没有后端。这个文件做两件事：
   把 dist/ 里的文件按路径发出去；把游戏回报的事件记下来，在 /dash 上算成看板。

   · 经理模式和卡牌模式不再构建：旧的 /manager、/cards 链接（含其下的子路径）302 回 /，
     打开的就是选手生涯（带斜杠的 /manager/ 若直接回 index.html，相对路径的资源会 404）；

   · 只从 dist/ 出，路径规范化后不在 dist/ 下的一律 403；
   · assets/ 下是带 hash 的文件，缓存一年；index.html 每次校验（no-cache）；
   · music/ 下是背景音乐（照抄 Val Manager），网址带版本号，缓存一周；带 Range 的请求回 206
     只发那一段——Safari 碰上整文件回 200 的服务器就不放声音；
   · /healthz 给 Railway 探活；
   · Railway 注入 PORT，本地默认 3000。

   ================== 隐私：这条线不许越过 ==================

   后台只记游戏自己的枚举值和数字，别的一概不记：

   · IP 地址只在内存里做限流，一秒都不落盘——不进 JSONL、不进 stats.json、不进日志。
     JSONL 的每一行都是先过一遍白名单再写的，写进去的字段就是 stats-contract.js
     列着的那些，IP 不在里面，也没有任何地方把它传进 record()。错误日志还多过一道
     scrubIp：socket 出错时 Node 会把对端地址写进 message，那一行也不许带出来。
   · 不记 User-Agent，不记精确位置（只有浏览器自报的时区偏移和窗口宽高档位）。
   · 不记玩家打进去的任何文字。选手的 IGN 是全游戏唯一一个玩家自己打的字段，客户端
     那边就不让它出门；这里是第二道闸：属性名走白名单，表外的键直接丢掉。
     报错只报出错的文件和行号，不报报错信息本身——引擎的信息会把拿到的东西原样插进去。
   · 身份是浏览器第一次打开时自己生成的随机 id（vid）。清了站点数据就是新的人，
     一台手机两个人用就是一个人。要回答「有没有人第二天又来了」，这比 IP 准得多：
     国内运营商几百个用户共用一个出口地址，一个用户一晚上还会换好几个。

   统计绝不能拖垮游戏：入口先回 204 再算，写盘全是异步的，任何一处抛错都只记一行日志，
   进程继续服务 dist/。看板算错了是看板的事，游戏该怎么跑还怎么跑。 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
// 事件词表和客户端共用一份，见 stats-contract.js
import { EVENTS, EVENT_PROPS, ROLLUPS } from './stats-contract.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(ROOT, 'dist')
const PORT = Number(process.env.PORT) || 3000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

function send(res, code, body, type = 'text/plain; charset=utf-8', extra) {
  const h = Object.assign({ 'content-type': type, 'cache-control': 'no-store' }, extra || {})
  res.writeHead(code, h)
  res.end(body)
}

function resolve(pathname) {
  let rel
  try { rel = decodeURIComponent(pathname) } catch { return null }
  const file = path.normalize(path.join(DIST, rel))
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return null
  return file
}

/* ================= 统计与后台看板 =================

   回答作者几个问题：多少人来、来了几次、玩了多久、走到哪一步、走到哪个结局。
   照 破晓 的结构来，两个已知的毛病不再犯：

   · 破晓 的 end 事件不带结局标识，「大家最后打出的是哪个结局」永远答不了——
     这里 ending 事件必带 key（engine/me/endings.ts 的那 14 个），结局分布是看板的一节；
   · 破晓 的 view 事件 98% 带着 v:"undefined"，因为版本常量在第一次上报之后才赋值——
     这里服务端不依赖客户端上报任何版本常量，看板只认每条事件自带的枚举字段。

   设计取舍（和 破晓 一致）：
   · 事实源是按北京时间分天追加的 JSONL（追加写天然崩溃安全）；stats.json 只是它的缓存，
     每 30 秒原子落盘（临时文件 + rename，留 .bak）。进程被杀重启后，当天从 JSONL 重放，
     不丢不重；stats.json 整个丢了也能从 JSONL 把 90 天全部重算回来。
   · 持久化在 Railway Volume（DATA_DIR / RAILWAY_VOLUME_MOUNT_PATH）；没挂卷时照常工作，
     但看板顶部亮红条警告「重启即丢」。
   · 看板 /dash 零 JS、纯服务端渲染、手写 SVG——没有脚本就没有 XSS 面。
   · 信标数据一律不可信：事件名走白名单，属性名走白名单，条数、长度、体积全封顶，
     限流按 IP 每分钟计数且只在内存里。                                        */

/* 兜底目录在仓库外（主目录下的 .val_player-stats）。本来放在仓库里的 .data/，
   但开发机上仓库有几十个 worktree，一次 git clean 就能把收上来的数据连锅端掉——
   数据不该有这种死法。线上永远走 DATA_DIR / RAILWAY_VOLUME_MOUNT_PATH，兜底只在本地生效。 */
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(os.homedir(), '.val_player-stats')
const VOLATILE = !process.env.DATA_DIR && !process.env.RAILWAY_VOLUME_MOUNT_PATH
const STATS_KEY = process.env.STATS_KEY || ''
const RETAIN_DAYS = 90
try { fs.mkdirSync(DATA_DIR, { recursive: true }) } catch { /* 卷还没挂上；record() 每次写都自己兜着 */ }

const STATS_FILE = path.join(DATA_DIR, 'stats.json')
const DEV_FILE = path.join(DATA_DIR, 'devices.log')
const evFile = (day) => path.join(DATA_DIR, `ev-${day}.jsonl`)

/* 日志里绝不许出现 IP。限流用的地址只活在内存的那张表里，错误信息也不许把它带出来：
   socket 出错时 Node 会把对端地址写进 message，那一行要是进了日志，就等于写盘了。
   lastErr 还会显示在看板页脚上，所以这一层也护着那里。 */
const scrubIp = (s) => String(s)
  .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[ip]')
  .replace(/\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/gi, '[ip]')

/** 出错只记一行，绝不往上抛：统计的任何毛病都不该变成游戏打不开 */
let errCount = 0
let lastErr = ''
function logErr(where, e) {
  errCount++
  lastErr = scrubIp(`${where}: ${e && e.message ? e.message : String(e)}`)
  if (errCount <= 50) console.error(`[stats] ${lastErr}`)
}

/* 收得下的事件名和属性名都在 stats-contract.js 里，是客户端 TELEMETRY_EVENTS 的镜像。
   名字对不上的事件会被静悄悄丢掉、对应的那一节永远空着，而空图表看着和「没人玩」
   一模一样——所以 scripts/check_stats.ts 会把两边逐项对一遍，哪边改了名字都让核查挂掉。 */

/* 体积与条数的封顶。公网是敌意的：一个批次最多这么大、这么多条、每条这么多属性。 */
const MAX_BODY = 32 * 1024
const MAX_EVENTS = 40
const MAX_PROPS = 16
const MAX_KEY = 24
const MAX_STR = 48
const MAX_ID = 64

/** 每个事件各自允许的属性名（= 客户端 TELEMETRY_EVENTS 的那一行）。
    按事件收窄，不是一张大表：ending 的 key 不该能出现在 session_start 上。 */
const ALLOWED = new Map(Object.entries(EVENT_PROPS).map(([e, ks]) => [e, new Set(ks)]))

/* ---------- 归日：北京时间 ----------
   玩家几乎全在国内，看板上的「一天」要和他们的一天对齐。 */
const dayStr = (t) => new Date((t || Date.now()) + 8 * 3600e3).toISOString().slice(0, 10)
const shiftDay = (day, n) => dayStr(Date.parse(`${day}T00:00:00Z`) - 8 * 3600e3 + n * 86400e3)

/* ---------- 设备登记簿 ----------
   devices.log 每行「YYYY-MM-DD <vid>」，就是首见日。行号即设备号：聚合表里存的是号，
   不是 36 个字符的 vid——90 天的日活集合因此小得能整个放进 stats.json。 */
const REG = { idx: new Map(), firstDay: [], vids: [] }
function deviceIdx(vid, day) {
  let i = REG.idx.get(vid)
  if (i !== undefined) return i
  i = REG.vids.length
  REG.idx.set(vid, i)
  REG.vids.push(vid)
  REG.firstDay.push(day)
  /* 这一笔必须是同步写，而且必须按顺序落。
     聚合表里存的是设备号（行号），不是 36 个字符的 vid——重启之后设备号要能对得上，
     就得靠 devices.log 的行序和当初登记的顺序一模一样。异步 appendFile 并发起来会乱序
     （核查脚本抓到过：同一份 JSONL 重放两次，第一行一会儿是 a1 一会儿是 a3），
     乱序就意味着重启后旧日子的 act 数组指到别的设备身上，留存和漏斗会静悄悄地错。
     另外同步写还保证了「登记先于引用」：这行落盘之后，30 秒后的 flush 才会把这个号写进
     stats.json，崩在中间也只会少一台设备，不会让号错位。
     只有新设备走这里，一天几百笔，开销可以忽略。 */
  try { fs.appendFileSync(DEV_FILE, `${day} ${vid}\n`) } catch (e) { logErr('devlog', e) }
  return i
}

/* ---------- 一天的聚合 ---------- */
function blankDay() {
  return {
    nu: 0,            // 新设备
    uv: 0,            // 活跃设备
    sess: 0,          // 会话数
    pv: 0,            // 浏览量（screens 的累计量按会话取最大再求和）
    act: [],          // 活跃设备号
    sec: [],          // 与 act 对齐：这台设备这天的在线秒数
    f: { profile: [], week1: [], season1: [], ending: [] },   // 漏斗四级（打开 = act）
    end: {},          // 结局分布
    st: {}, yr: {}, rg: {}, rl: {},                            // 开局构成
    m: { watched: 0, skipped: 0, started: 0 },                 // 打完 / 快进 / 其中我首发
    er: {},                                                    // 前端报错：按出错的文件行号
    sf: 0,                                                     // 存档失败
    // 下面两个和 sec 一样，与 act 一一对齐：存的是「这台设备的档位」而不是当天的计数。
    // 存计数的话，跨天求和会把一台常来的设备算成好几台（核查脚本抓到过一次）。
    dv: [],                                                    // 设备类型
    wd: [],                                                    // 屏幕宽度档
  }
}

/* 当天在内存里用 Map/Set 攒，落盘时再摊平成上面的样子。
   sess: sid -> {vi, sec}；
   roll: (会话, 组, 行键, 字段) -> 见过的最大值（累计量事件全走这张表）；
   seen: sid -> 已收过的事件号（(sid, n) 认一条事件，重发的信标因此是空操作）。 */
function newLive(day) {
  return {
    day,
    seen: new Map(), sess: new Map(), roll: new Map(),
    act: new Map(),                                  // vi -> 在线秒数
    f: { profile: new Set(), week1: new Set(), season1: new Set(), ending: new Set() },
    dv: new Map(), wd: new Map(),                    // vi -> 档位（按设备去重，最后一次为准）
    end: {}, st: {}, yr: {}, rg: {}, rl: {}, er: {},
    m: { watched: 0, skipped: 0, started: 0 }, sf: 0, pv: 0,
  }
}

const ST = { days: {}, live: newLive(dayStr()), dirty: false, flushedAt: 0, gen: 0, flushedGen: 0, flushing: false }

/** (sid, n)：收过的不再收第二遍。n 在会话里单调递增，重发的批次整批都是收过的号。 */
function fresh(sid, n) {
  if (!Number.isInteger(n) || n < 0) return false
  let s = ST.live.seen.get(sid)
  if (!s) { s = { set: new Set(), max: -1, over: false }; ST.live.seen.set(sid, s) }
  if (s.over) { if (n <= s.max) return false; s.max = n; return true }
  if (s.set.has(n)) return false
  s.set.add(n)
  if (n > s.max) s.max = n
  // 一个会话攒到这么多号就只认水位线，省得内存被一个长会话拖大
  if (s.set.size > 2048) { s.over = true; s.set = new Set() }
  return true
}

const bump = (o, k) => { if (k) o[k] = (o[k] || 0) + 1 }
const bumpBy = (o, k, n) => { if (k) o[k] = (o[k] || 0) + n }
const widthBucket = (w) => {
  const n = Number(w)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 360) return '<360'
  if (n < 414) return '360–413'
  if (n < 480) return '414–479'
  if (n < 768) return '480–767'
  if (n < 1024) return '768–1023'
  if (n < 1280) return '1024–1279'
  if (n < 1600) return '1280–1599'
  return '≥1600'
}

/**
 * 把一条（已经过白名单的）事件记进当天的聚合。
 * 增量记账和重放走的是同一个函数——不然「重启后重放出来的那天」和「一直开着攒出来的那天」
 * 会是两个数，而这种错只有在出事之后才看得见。
 */
function applyEvent(L, o) {
  const vi = deviceIdx(o.vid, L.day)
  if (!L.act.has(vi)) L.act.set(vi, 0)
  if (o.sid) L.sess.set(o.sid, L.sess.get(o.sid) || { vi, sec: 0 })
  const p = o.p || {}
  const e = o.e

  if (o.dev) L.dv.set(vi, o.dev)

  /* 累计量的那几组（stats-contract.js 的 ROLLUPS）：客户端每次报的是「这个会话到
     目前为止的总数」，不是增量。按 (会话, 组, 行键, 字段) 记住见过的最大值，只把
     涨出来的那一截计进当天——同一个总数再来一遍加的是 0，所以重发的信标无害，
     迟到的那份（比已见过的还小）也一秒都不加。 */
  const R = ROLLUPS[e]
  if (R) {
    const rowKey = R.key ? String(p[R.key] ?? '') : ''
    for (const f of R.nums) {
      const v = Number(p[f])
      if (!Number.isFinite(v) || v < 0) continue
      const k = JSON.stringify([o.sid, e, rowKey, f])
      const prev = L.roll.get(k) || 0
      if (v <= prev) continue
      const add = v - prev
      L.roll.set(k, v)
      if (e === 'screens' && f === 'hits') L.pv += add
      else if (e === 'turns' && f === 'turns') L.f.week1.add(vi)   // 推完过第一周
      else if (e === 'matches') {
        if (f === 'played') L.m.watched += add
        else if (f === 'skip') L.m.skipped += add
        else if (f === 'started') L.m.started += add
      } else if (e === 'errors' && f === 'n') {
        // 只有出错的文件和行号，永远没有报错信息本身
        bumpBy(L.er, typeof p.at === 'string' && p.at ? p.at : '（未报位置）', add)
      }
    }
    return
  }

  if (e === 'session_start') {
    const b = widthBucket(p.w)
    if (b) L.wd.set(vi, b)
  } else if (e === 'session_ping' || e === 'session_end') {
    // 心跳同样是累计量而且会重发：一个会话只认它见过的最大 active_s，按差值加进设备的在线秒数
    const s = L.sess.get(o.sid)
    const v = Number(p.active_s)
    if (s && Number.isFinite(v) && v > s.sec) {
      L.act.set(vi, (L.act.get(vi) || 0) + (v - s.sec))
      s.sec = v
    }
  } else if (e === 'career_start') {
    L.f.profile.add(vi)
    bump(L.st, typeof p.start === 'string' ? p.start : '')
    bump(L.yr, p.year === undefined || p.year === null ? '' : String(p.year))
    bump(L.rg, typeof p.region === 'string' ? p.region : '')
    bump(L.rl, typeof p.role === 'string' ? p.role : '')
  } else if (e === 'season_done') {
    // 客户端挂在赛季「记录」上而不是赛季卡上：卡在退役之后会被跳过，
    // 挂记录才让第四级对那些真走到第五级的人也算得准
    L.f.season1.add(vi)
  } else if (e === 'ending') {
    L.f.ending.add(vi)
    // 破晓 的 end 不带结局标识，「大家最后打出的是哪个结局」那一问永远答不了。
    // 这里认的是 engine/me/endings.ts 的 key —— 事件名是 ending，键名是 key。
    bump(L.end, typeof p.key === 'string' && p.key ? p.key : '（未报结局）')
  } else if (e === 'save_fail') {
    L.sf++
  }
  // career_resume：只算这台设备活跃过，不进漏斗（它是回访，不是新建档）
}

/** 摊平成能进 stats.json 的样子 */
function serialise(L) {
  const d = blankDay()
  const act = [...L.act.keys()].sort((a, b) => a - b)
  d.act = act
  d.sec = act.map((vi) => Math.round(L.act.get(vi) || 0))
  d.uv = act.length
  d.sess = L.sess.size
  d.pv = Math.round(L.pv)
  d.nu = act.filter((vi) => REG.firstDay[vi] === L.day).length
  d.f = {
    profile: [...L.f.profile].sort((a, b) => a - b),
    week1: [...L.f.week1].sort((a, b) => a - b),
    season1: [...L.f.season1].sort((a, b) => a - b),
    ending: [...L.f.ending].sort((a, b) => a - b),
  }
  d.end = { ...L.end }; d.st = { ...L.st }; d.yr = { ...L.yr }; d.rg = { ...L.rg }; d.rl = { ...L.rl }
  d.m = { ...L.m }; d.er = { ...L.er }; d.sf = L.sf
  d.dv = act.map((vi) => L.dv.get(vi) || '')
  d.wd = act.map((vi) => L.wd.get(vi) || '')
  return d
}

const liveDay = () => { ST.days[ST.live.day] = serialise(ST.live); return ST.days[ST.live.day] }

/* ---------- 落盘 ----------
   照 破晓 修过的那版：异步落盘拿着开始时的代数，写完只有代数没变才敢把 dirty 放下；
   两次异步落盘不并发；同步落盘（退出、跨天）用自己的临时文件名。 */
function flush(sync) {
  if (!ST.dirty) return
  const gen = ST.gen
  liveDay()
  let body
  try { body = JSON.stringify({ v: 1, days: ST.days, savedAt: Date.now() }) } catch (e) { return logErr('flush-json', e) }
  try {
    if (sync) {
      const tmp = `${STATS_FILE}.tmp-sync`
      try { fs.copyFileSync(STATS_FILE, `${STATS_FILE}.bak`) } catch { /* 第一次落盘时还没有可备份的 */ }
      fs.writeFileSync(tmp, body)
      fs.renameSync(tmp, STATS_FILE)
      ST.dirty = false; ST.flushedAt = Date.now(); ST.flushedGen = gen
    } else {
      if (ST.flushing) return
      ST.flushing = true
      const tmp = `${STATS_FILE}.tmp`
      fs.writeFile(tmp, body, (err) => {
        if (err) { ST.flushing = false; return logErr('flush-write', err) }
        fs.copyFile(STATS_FILE, `${STATS_FILE}.bak`, () => {
          if (gen < ST.flushedGen) { ST.flushing = false; fs.unlink(tmp, () => {}); return }
          fs.rename(tmp, STATS_FILE, (e2) => {
            ST.flushing = false
            if (e2) return logErr('flush-rename', e2)
            ST.flushedAt = Date.now(); ST.flushedGen = gen
            if (ST.gen === gen) ST.dirty = false
          })
        })
      })
    }
  } catch (e) { ST.flushing = false; logErr('flush', e) }
}

/** 原始事件只留 90 天（聚合表永久留着；devices.log 很小，不动） */
function pruneEvents() {
  try {
    const cut = dayStr(Date.now() - RETAIN_DAYS * 86400e3)
    for (const f of fs.readdirSync(DATA_DIR)) {
      const m = /^ev-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f)
      if (m && m[1] < cut) { try { fs.unlinkSync(path.join(DATA_DIR, f)) } catch (e) { logErr('prune', e) } }
    }
  } catch (e) { logErr('prune-dir', e) }
}

/** 记一条：先落 JSONL（异步，游戏不等），再更新内存里的当天聚合 */
function record(o) {
  const day = dayStr()
  if (day !== ST.live.day) {
    liveDay()
    flush(true)
    ST.live = newLive(day)
    pruneEvents()
  }
  if (!fresh(o.sid, o.n)) return    // 重发的信标：一条都不记
  try { fs.appendFile(evFile(day), `${JSON.stringify(o)}\n`, () => {}) } catch (e) { logErr('append', e) }
  applyEvent(ST.live, o)
  ST.dirty = true; ST.gen++
}

/* ---------- 重放 ----------
   一天的聚合永远是那天 JSONL 的纯函数。stats.json 只是缓存：当天每次启动都重放，
   而 stats.json 里缺的那些天（整个文件丢了、或者换了卷）也照样从 JSONL 重算回来。 */
function replay(day) {
  const L = newLive(day)
  let txt = ''
  try { txt = fs.readFileSync(evFile(day), 'utf8') } catch { return L }
  for (const ln of txt.split('\n')) {
    if (!ln) continue
    let o
    try { o = JSON.parse(ln) } catch { continue }
    if (!o || typeof o.vid !== 'string' || !EVENTS.has(o.e)) continue
    const save = ST.live
    ST.live = L
    try { if (fresh(o.sid, o.n)) applyEvent(L, o) } catch (e) { logErr('replay-ev', e) } finally { ST.live = save }
  }
  return L
}

function diskDays() {
  const out = []
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      const m = /^ev-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f)
      if (m) out.push(m[1])
    }
  } catch (e) { logErr('scan', e) }
  return out.sort()
}

function loadStats() {
  for (const f of [STATS_FILE, `${STATS_FILE}.bak`]) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (j && j.days) { ST.days = j.days; break }
    } catch { /* 没有缓存就从 JSONL 重算 */ }
  }
  try {
    for (const ln of fs.readFileSync(DEV_FILE, 'utf8').split('\n')) {
      if (ln.length < 12) continue
      const day = ln.slice(0, 10)
      const vid = ln.slice(11).trim()
      if (!vid || REG.idx.has(vid)) continue
      REG.idx.set(vid, REG.vids.length); REG.vids.push(vid); REG.firstDay.push(day)
    }
  } catch { /* 第一次跑，还没有登记簿 */ }

  const today = dayStr()
  const cut = dayStr(Date.now() - RETAIN_DAYS * 86400e3)
  // 先把 stats.json 里缺的历史天从 JSONL 补回来（按日期从早到晚，首见日才是对的）
  for (const day of diskDays()) {
    if (day < cut || day >= today) continue
    if (ST.days[day]) continue
    ST.days[day] = serialise(replay(day))
  }
  ST.live = replay(today)
  liveDay()
  ST.dirty = true; ST.gen++
}

const flushTimer = setInterval(() => flush(false), 30e3)
flushTimer.unref()
process.on('SIGTERM', () => { try { flush(true) } catch (e) { logErr('sigterm', e) } process.exit(0) })
process.on('SIGINT', () => { try { flush(true) } catch (e) { logErr('sigint', e) } process.exit(0) })
/* 统计出了任何没接住的错，记一行，进程继续服务 dist/。
   （破晓 没有这一层——它的 server.js 只挂了 SIGTERM/SIGINT。） */
process.on('uncaughtException', (e) => logErr('uncaught', e))
process.on('unhandledRejection', (e) => logErr('unhandled', e))

/* ---------- 限流：只在内存里 ----------
   客户端 IP：X-Forwarded-For 只在受信代理（Railway 边缘）后面才看，而且取代理追加的最后一段——
   第一段是客户端自己想写什么写什么。本地直连只认 socket 地址。
   这个值只活在下面这张表里，不写盘、不进日志。 */
const BEHIND_PROXY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.TRUST_PROXY)
function clientIp(req) {
  if (BEHIND_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (xff.length) return xff[xff.length - 1]
  }
  return String(req.socket.remoteAddress || '')
}
const RATE = new Map()
const RATE_PER_IP = Number(process.env.STATS_RATE_IP) || 120
const RATE_GLOBAL = Number(process.env.STATS_RATE_ALL) || 6000
const RATE_MAX_KEYS = 5000
const RATE_ALL = { n: 0, t0: 0 }
function rateOk(ip) {
  const now = Date.now()
  if (now - RATE_ALL.t0 > 60e3) { RATE_ALL.n = 0; RATE_ALL.t0 = now }
  if (++RATE_ALL.n > RATE_GLOBAL) return false
  let r = RATE.get(ip)
  if (!r || now - r.t0 > 60e3) {
    if (!r && RATE.size >= RATE_MAX_KEYS) {
      for (const [k, v] of RATE) if (now - v.t0 > 60e3) RATE.delete(k)
      if (RATE.size >= RATE_MAX_KEYS) return false
    }
    r = { n: 0, t0: now }; RATE.set(ip, r)
  }
  return ++r.n <= RATE_PER_IP
}

/* ---------- 洗数据 ---------- */
const idOk = (s) => typeof s === 'string' && s.length > 0 && s.length <= MAX_ID && /^[A-Za-z0-9._:-]+$/.test(s)
const DEVS = new Set(['phone', 'tablet', 'desktop'])

/** 控制字符一律去掉（按码点挑，不用正则，省得源码里出现不可见字符） */
function plain(v) {
  let s = ''
  for (const ch of v) {
    const c = ch.codePointAt(0)
    if (c > 31 && c !== 127) s += ch
    if (s.length >= MAX_STR) break
  }
  return s
}

/** 属性：这个事件自己声明过的键、只认标量、字符串掐到 48 字并去掉控制字符、数字必须有限 */
function cleanProps(raw, allowed) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  if (!allowed) return undefined
  const out = {}
  let n = 0
  for (const k of Object.keys(raw)) {
    if (n >= MAX_PROPS) break
    if (k.length > MAX_KEY || !allowed.has(k)) continue
    const v = raw[k]
    if (v === null || v === undefined) continue
    if (typeof v === 'string') {
      const s = plain(v)
      if (!s) continue
      out[k] = s
    } else if (typeof v === 'number') {
      if (!Number.isFinite(v)) continue
      out[k] = v
    } else if (typeof v === 'boolean') {
      out[k] = v
    } else {
      continue                      // 对象、数组、函数：整个丢掉（嵌套就是在这里被挡住的）
    }
    n++
  }
  return n ? out : undefined
}

/** 一整批。任何一处不对就丢掉那一条（或整批），绝不抛。 */
function ingest(text) {
  let b
  try { b = JSON.parse(text) } catch { return 0 }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 0
  if (b.v !== 1) return 0
  if (!idOk(b.vid) || !idOk(b.sid)) return 0
  if (!Array.isArray(b.events) || !b.events.length || b.events.length > MAX_EVENTS) return 0
  const dev = DEVS.has(b.dev) ? b.dev : ''
  const tz = Number.isFinite(b.tz) ? Math.max(-900, Math.min(900, Math.round(b.tz))) : 0
  let took = 0
  for (const ev of b.events) {
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) continue
    if (typeof ev.name !== 'string' || !EVENTS.has(ev.name)) continue
    if (!Number.isInteger(ev.n) || ev.n < 0 || ev.n > 1e7) continue
    // t 用服务器时间：客户端的钟可能是错的，而「这条算哪一天」不能由客户端说了算
    const o = { t: Date.now(), e: ev.name, vid: b.vid, sid: b.sid, n: ev.n }
    if (dev) o.dev = dev
    if (tz) o.tz = tz
    const p = cleanProps(ev.props, ALLOWED.get(ev.name))
    if (p) o.p = p
    record(o)
    took++
  }
  return took
}

function handleIngest(req, res) {
  const ip = clientIp(req)
  if (!rateOk(ip)) return send(res, 429, '')
  let chunks = []
  let len = 0
  let over = false
  req.on('data', (c) => {
    len += c.length
    if (len > MAX_BODY) { over = true; chunks = []; req.destroy(); return }
    chunks.push(c)
  })
  req.on('end', () => {
    // 先回 204 再算：游戏一秒都不用等统计
    send(res, 204, '')
    if (over) return
    try { ingest(Buffer.concat(chunks).toString('utf8')) } catch (e) { logErr('ingest', e) }
  })
  req.on('error', () => {})
}

/* ---------- 看板鉴权 ----------
   · 没配 STATS_KEY：404，当这页不存在——对谁都不存在，这才是 404 的意思
   · 没带 Authorization：401 + WWW-Authenticate，浏览器弹密码框（不弹就没法登录）
   · 钥匙不对：也是 401，再弹一次框。破晓 就是这么做的，作者在核查记录里也写明了
     「没配 STATS_KEY 才 404；钥匙错或没带头是 401」——按他的来
   · 同一来源 10 分钟里错 30 次就 429 十分钟，别让人拿密码框慢慢猜 */
function sameSecret(a, b) {
  const x = Buffer.from(String(a || ''))
  const y = Buffer.from(String(b || ''))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
const AUTH_FAILS = new Map()
const AUTH_FAIL_MAX = 30
const AUTH_FAIL_WIN = 10 * 60e3
function authFail(ip) {
  const now = Date.now()
  let r = AUTH_FAILS.get(ip)
  if (!r || now - r.t0 > AUTH_FAIL_WIN) { r = { n: 0, t0: now }; AUTH_FAILS.set(ip, r) }
  if (AUTH_FAILS.size > 2000) for (const [k, v] of AUTH_FAILS) if (now - v.t0 > AUTH_FAIL_WIN) AUTH_FAILS.delete(k)
  r.n++
}
const authBlocked = (ip) => {
  const r = AUTH_FAILS.get(ip)
  return !!(r && Date.now() - r.t0 <= AUTH_FAIL_WIN && r.n >= AUTH_FAIL_MAX)
}
/** 'ok' 放行 / 'ask' 弹密码框（没带钥匙、或钥匙不对）/ 'blocked' 猜太多次 / '' 装作没有这页 */
function dashAuth(req) {
  if (!STATS_KEY) return ''
  const ip = clientIp(req)
  if (authBlocked(ip)) return 'blocked'
  const auth = String(req.headers.authorization || '')
  if (!auth) return 'ask'
  let m
  let given = ''
  if ((m = /^Bearer\s+(.+)$/i.exec(auth))) given = m[1].trim()
  else if ((m = /^Basic\s+(.+)$/i.exec(auth))) {
    let raw = ''
    try { raw = Buffer.from(m[1].trim(), 'base64').toString('utf8') } catch { raw = '' }
    const i = raw.indexOf(':')
    const user = i < 0 ? raw : raw.slice(0, i)
    const pw = i < 0 ? '' : raw.slice(i + 1)
    given = pw || user
  }
  if (sameSecret(given, STATS_KEY)) return 'ok'
  authFail(ip)
  return 'ask'
}

/* ---------- 看板 ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** engine/me/endings.ts 的 14 个 key。看板上没见过的 key 照原样单独列一行——
    宁可多出一行陌生的，也不要新加的结局在看板上凭空消失。 */
const ENDING_CN = {
  breaker: '破局者', dynasty: '王朝', world: '世界冠军', master: '大师',
  uncrowned: '无冕之王', regional: '赛区功勋', ring: '板凳上的冠军', oneclub: '一队终老',
  evergreen: '常青树', abroad: '远征', titled: '拿过冠军', journeyman: '泯然众人',
  flash: '昙花一现', shore: '没能上岸',
}
const START_CN = { pre: '天梯', chal: '二队', t1: '一线替补' }
const REGION_CN = {
  Americas: '美洲', EMEA: '欧非中东', Pacific: '太平洋', China: '中国',
  'North America': '北美', Europe: '欧洲', Turkey: '土耳其', CIS: '独联体',
  Brazil: '巴西', LATAM: '拉美', Korea: '韩国', Japan: '日本', SEA: '东南亚',
  'Malaysia & Singapore': '马新', Indonesia: '印尼', Thailand: '泰国',
  Philippines: '菲律宾', Vietnam: '越南', 'Hong Kong & Taiwan': '港台',
  MENA: '中东北非', 'South Asia': '南亚', Oceania: '大洋洲',
}
const DEV_CN = { phone: '手机', tablet: '平板', desktop: '电脑' }

const pct = (a, b) => (b ? `${(a / b * 100).toFixed(1)}%` : '—')
const fmtMin = (sec) => {
  const m = sec / 60
  return m >= 60 ? `${(m / 60).toFixed(1)} 小时` : `${m.toFixed(0)} 分钟`
}
function median(xs) {
  if (!xs.length) return 0
  const a = [...xs].sort((x, y) => x - y)
  const i = a.length >> 1
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2
}
function lastDays(n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = dayStr(Date.now() - i * 86400e3)
    out.push({ d, a: ST.days[d] || blankDay() })
  }
  return out
}
function svgBars(rows, pick, color) {
  const W = 900
  const H = 120
  const bw = W / Math.max(1, rows.length)
  const mx = Math.max(1, ...rows.map((r) => pick(r.a)))
  let s = `<svg viewBox="0 0 ${W} ${H + 18}" style="width:100%;height:auto" role="img">`
  rows.forEach((r, i) => {
    const h = Math.round(pick(r.a) / mx * H)
    s += `<rect x="${(i * bw + 1).toFixed(1)}" y="${H - h}" width="${(bw - 2).toFixed(1)}" height="${h}" rx="2" fill="${color}"><title>${r.d}：${pick(r.a)}</title></rect>`
    if (i % 5 === 0) s += `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H + 14}" font-size="10" fill="#7d8ea6" text-anchor="middle">${r.d.slice(5)}</text>`
  })
  return `${s}</svg>`
}
/** 一节按计数排好的表 */
function countTable(obj, label, cn, total) {
  const rows = Object.entries(obj).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
  const sum = total ?? rows.reduce((t, [, n]) => t + n, 0)
  if (!rows.length) return `<table><tr><th>${label}</th><th class="num">数量</th><th class="num">占比</th></tr><tr><td colspan="3">还没有数据</td></tr></table>`
  return `<table><tr><th>${label}</th><th class="num">数量</th><th class="num">占比</th></tr>${rows.map(([k, n]) =>
    `<tr><td>${esc((cn && cn[k]) || k || '（未报）')}</td><td class="num" data-k="${esc(label)}:${esc(k)}">${n}</td><td class="num">${pct(n, sum)}</td></tr>`).join('')}</table>`
}

function dashHtml() {
  const today = liveDay()
  const D = Number(process.env.STATS_WINDOW) || 30
  const d30 = lastDays(D)
  const win = lastDays(D).map((r) => r.a)

  // ---- 在线时长：会话取该会话见过的最大 active_s，再按设备求和
  const secByDev = new Map()
  const dayMeans = []
  for (const a of win) {
    a.act.forEach((vi, i) => secByDev.set(vi, (secByDev.get(vi) || 0) + (a.sec[i] || 0)))
    if (a.act.length) dayMeans.push(...a.sec)
  }
  const devSecs = [...secByDev.values()]
  const totSec = devSecs.reduce((t, x) => t + x, 0)

  // ---- 漏斗：按设备去重，窗口内曾经走到这一步的设备数
  const uni = (pick) => {
    const s = new Set()
    for (const a of win) for (const vi of pick(a)) s.add(vi)
    return s.size
  }
  const fn = [
    ['打开', uni((a) => a.act)],
    ['建档', uni((a) => a.f.profile)],
    ['推完第一周', uni((a) => a.f.week1)],
    ['打完第一个赛季', uni((a) => a.f.season1)],
    ['走到结局', uni((a) => a.f.ending)],
  ]
  const top = fn[0][1]
  const fnRows = fn.map(([k, n], i) => {
    const prev = i ? fn[i - 1][1] : 0
    return `<tr><td>${k}</td><td class="num" data-k="漏斗:${k}">${n}</td><td class="num">${i ? pct(n, prev) : '—'}</td><td class="num">${i ? pct(n, top) : '100.0%'}</td></tr>`
  }).join('')

  // ---- 留存：按首见日分群，次日 / 第 3 日 / 第 7 日 回访率
  //      回访 = 那一天这台设备有事件。只有整天过完了才算数，没过完显示「—」。
  const todayStr = dayStr()
  const cohorts = []
  for (let i = 14; i >= 1; i--) {
    const c = dayStr(Date.now() - i * 86400e3)
    const members = []
    const a0 = ST.days[c]
    if (a0) for (const vi of a0.act) if (REG.firstDay[vi] === c) members.push(vi)
    if (!members.length) continue
    const set = new Set(members)
    const cell = (k) => {
      const d = shiftDay(c, k)
      if (d >= todayStr) return null            // 这一天还没过完
      const a = ST.days[d]
      if (!a) return 0
      let n = 0
      for (const vi of a.act) if (set.has(vi)) n++
      return n
    }
    cohorts.push({ c, size: members.length, r1: cell(1), r3: cell(3), r7: cell(7) })
  }
  const rcell = (n, size, k, c) => (n === null
    ? '<td class="num dim">—</td>'
    : `<td class="num" data-k="留存:${c}:${k}">${pct(n, size)}</td>`)
  const retRows = cohorts.map((x) =>
    `<tr><td>${x.c}</td><td class="num" data-k="群:${x.c}">${x.size}</td>${rcell(x.r1, x.size, 1, x.c)}${rcell(x.r3, x.size, 3, x.c)}${rcell(x.r7, x.size, 7, x.c)}</tr>`).join('')

  // ---- 分布几节
  const merge = (pick) => {
    const o = {}
    for (const a of win) for (const [k, n] of Object.entries(pick(a) || {})) o[k] = (o[k] || 0) + n
    return o
  }
  /* 按设备去重的那几节：同一台设备活跃好几天只能算一台，所以先把窗口里每台设备
     的档位收进一张表（最后一次为准），再数。按天的计数直接相加是错的——一台每天
     都来的手机会被算成三十台。 */
  const perDev = (pick) => {
    const last = new Map()
    for (const a of win) a.act.forEach((vi, i) => { const v = (pick(a) || [])[i]; if (v) last.set(vi, v) })
    const o = {}
    for (const v of last.values()) o[v] = (o[v] || 0) + 1
    return o
  }
  const endAll = merge((a) => a.end)
  // 没人打到的结局也列出来，0 是个答案
  for (const k of Object.keys(ENDING_CN)) if (!(k in endAll)) endAll[k] = 0
  const endRows = Object.entries(endAll).sort((a, b) => b[1] - a[1])
  const endSum = endRows.reduce((t, [, n]) => t + n, 0)
  const endTable = `<table><tr><th>结局</th><th>key</th><th class="num">人次</th><th class="num">占比</th></tr>${endRows.map(([k, n]) =>
    `<tr><td>${esc(ENDING_CN[k] || k)}</td><td class="dim">${esc(k)}</td><td class="num" data-k="结局:${esc(k)}">${n}</td><td class="num">${pct(n, endSum)}</td></tr>`).join('')}</table>`

  const m = merge((a) => a.m)
  const mSum = (m.watched || 0) + (m.skipped || 0)
  const sf = win.reduce((t, a) => t + (a.sf || 0), 0)
  const errs = merge((a) => a.er)

  const tblRows = lastDays(14).reverse().map((r) => {
    const a = r.a
    const s = a.sec.reduce((t, x) => t + x, 0)
    return `<tr><td>${r.d}</td><td class="num" data-k="日:${r.d}:新设备">${a.nu}</td><td class="num" data-k="日:${r.d}:活跃">${a.uv}</td><td class="num" data-k="日:${r.d}:会话">${a.sess}</td><td class="num" data-k="日:${r.d}:浏览">${a.pv}</td><td class="num">${a.uv ? fmtMin(s / a.uv) : '—'}</td><td class="num">${a.uv ? fmtMin(median(a.sec)) : '—'}</td></tr>`
  }).join('')

  const stat = (n, l, k) => `<div class="st"><div class="n"${k ? ` data-k="${esc(k)}"` : ''}>${n}</div><div class="l">${l}</div></div>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="300"><title>val_player · 后台看板</title>
<style>
body{margin:0;background:#0b0f14;color:#dfe7f1;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;padding:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;color:#8fa2b8;margin:26px 0 10px;font-weight:600}
.sub{color:#7d8ea6;font-size:12px}.dim{color:#5d6c80}
.warn{background:#3a1518;border:1px solid #7a2b31;color:#ffb3ba;padding:10px 14px;border-radius:8px;margin:14px 0;font-size:13px}
.grid{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
.st{background:#121923;border:1px solid #1f2b3a;border-radius:10px;padding:12px 18px;min-width:96px}
.st .n{font-size:22px;font-weight:700;color:#5bc6cf;font-variant-numeric:tabular-nums}
.st .l{font-size:12px;color:#8fa2b8}
table{border-collapse:collapse;width:100%;max-width:760px;font-variant-numeric:tabular-nums;margin-bottom:6px}
td,th{padding:5px 10px;border-bottom:1px solid #1f2b3a;text-align:left;font-size:13px}
th{color:#8fa2b8;font-weight:600}.num{text-align:right}
.chart{background:#121923;border:1px solid #1f2b3a;border-radius:10px;padding:14px;max-width:960px}
.two{display:flex;flex-wrap:wrap;gap:24px}.two>div{min-width:280px;flex:1}
.foot{margin-top:28px;color:#5d6c80;font-size:12px}
</style></head><body>
<h1>val_player · 后台看板</h1>
<div class="sub">只有拿着钥匙的你能看到这页 · 每 5 分钟自动刷新 · 北京时间归日 · 统计窗口 ${D} 天 · 原始事件留 ${RETAIN_DAYS} 天</div>
${VOLATILE ? '<div class="warn">⚠ 未检测到持久化卷——数据现在只存在容器磁盘上，<b>重新部署或重启就会清零</b>。到 Railway 服务设置里挂一个 Volume，并把 DATA_DIR 指过去。</div>' : ''}
<h2>今日</h2>
<div class="grid">${stat(today.nu, '新设备', '今日:新设备')}${stat(today.uv, '活跃设备', '今日:活跃')}${stat(today.sess, '会话数', '今日:会话')}${stat(today.pv, '浏览量', '今日:浏览')}</div>
<h2>在线时长（近 ${D} 天）</h2>
<div class="grid">${stat(fmtMin(devSecs.length ? totSec / devSecs.length : 0), '人均（每台设备累计）', '时长:人均')}${stat(fmtMin(median(devSecs)), '中位（每台设备累计）', '时长:中位')}${stat(fmtMin(dayMeans.length ? dayMeans.reduce((t, x) => t + x, 0) / dayMeans.length : 0), '人均（每台设备每天）')}${stat(fmtMin(median(dayMeans)), '中位（每台设备每天）')}</div>
<div class="sub">会话取该会话见过的最大 active_s（心跳是累计量而且会重发），再按设备求和。</div>
<h2>近 ${D} 天 · 新设备</h2><div class="chart">${svgBars(d30, (a) => a.nu, '#5bc6cf')}</div>
<h2>近 ${D} 天 · 活跃设备</h2><div class="chart">${svgBars(d30, (a) => a.uv, '#c9a86a')}</div>
<h2>近 14 天明细</h2>
<table><tr><th>日期</th><th class="num">新设备</th><th class="num">活跃设备</th><th class="num">会话数</th><th class="num">浏览量</th><th class="num">人均在线</th><th class="num">中位在线</th></tr>${tblRows}</table>
<h2>漏斗（近 ${D} 天 · 按设备去重）</h2>
<table><tr><th>阶段</th><th class="num">设备数</th><th class="num">转化</th><th class="num">占打开</th></tr>${fnRows}</table>
<div class="sub">建档 = career_start，推完第一周 = turns，打完第一个赛季 = season_done，走到结局 = ending。</div>
<h2>留存（按首见日分群 · 回访 = 那天有事件）</h2>
<table><tr><th>首见日</th><th class="num">人数</th><th class="num">次日</th><th class="num">第 3 日</th><th class="num">第 7 日</th></tr>${retRows || '<tr><td colspan="5">还没有满一天的群</td></tr>'}</table>
<div class="sub">次日 = 首见日 + 1 天，第 3 日 = +3，第 7 日 = +7；那一天还没过完就显示「—」。</div>
<h2>结局分布（近 ${D} 天）</h2>
${endTable}
<h2>开局构成（近 ${D} 天）</h2>
<div class="two">
<div><h2>出身</h2>${countTable(merge((a) => a.st), '出身', START_CN)}</div>
<div><h2>入场年份</h2>${countTable(merge((a) => a.yr), '入场年份', null)}</div>
</div>
<div class="two">
<div><h2>赛区</h2>${countTable(merge((a) => a.rg), '赛区', REGION_CN)}</div>
<div><h2>位置</h2>${countTable(merge((a) => a.rl), '位置', null)}</div>
</div>
<h2>比赛：打完还是快进（近 ${D} 天）</h2>
<div class="grid">${stat(m.watched || 0, '打完', '比赛:打完')}${stat(m.skipped || 0, '快进', '比赛:快进')}${stat(pct(m.watched || 0, mSum), '打完占比')}${stat(m.started || 0, '其中我首发', '比赛:首发')}</div>
<h2>存档失败（近 ${D} 天）</h2>
<div class="grid">${stat(sf, '存档失败次数', '存档:失败')}</div>
<div class="sub">iPhone 的存储配额问题会先在这里露头，然后才会有人来报。</div>
<h2>前端报错（近 ${D} 天）</h2>
${countTable(errs, '出错位置', null)}
<div class="sub">只有出错的文件和行号，没有报错信息本身——引擎的报错会把拿到的东西原样插进去，那可以是任何东西。</div>
<h2>设备与屏幕（近 ${D} 天 · 按设备去重）</h2>
<div class="two">
<div>${countTable(perDev((a) => a.dv), '设备类型', DEV_CN)}</div>
<div>${countTable(perDev((a) => a.wd), '屏幕宽度', null)}</div>
</div>
<div class="foot">数据目录 ${esc(DATA_DIR)} · 设备总数 ${REG.vids.length} · 上次落盘 ${ST.flushedAt ? new Date(ST.flushedAt + 8 * 3600e3).toISOString().slice(11, 19) : '尚未'} (UTC+8)${errCount ? ` · 统计内部错误 ${errCount} 次（最近：${esc(lastErr)}）` : ''}<br>不记 IP、不记 User-Agent、不记玩家打进去的任何文字。</div>
</body></html>`
}

const DASH_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

const server = http.createServer((req, res) => {
  let url
  try { url = new URL(req.url ?? '/', 'http://localhost') } catch { return send(res, 400, 'bad request') }
  const p = url.pathname

  if (req.method === 'POST') {
    if (p === '/api/e') { try { return handleIngest(req, res) } catch (e) { logErr('post', e); return send(res, 204, '') } }
    return send(res, 405, 'method not allowed')
  }
  if (p === '/healthz') return send(res, 200, 'ok')
  if (/^\/(manager|cards)(\/|$)/.test(p)) {
    res.writeHead(302, { location: '/', 'cache-control': 'no-store' })
    return res.end()
  }
  if (p === '/dash') {
    try {
      const a = dashAuth(req)
      if (a === 'blocked') return send(res, 429, '猜太多次了，十分钟后再试。')
      if (a === 'ask') {
        return send(res, 401, '需要密码：用户名留空，密码填 STATS_KEY。', 'text/plain; charset=utf-8',
          { 'www-authenticate': 'Basic realm="val_player dash", charset="UTF-8"' })
      }
      if (a !== 'ok') return send(res, 404, 'not found')
      flush(false)
      return send(res, 200, dashHtml(), 'text/html; charset=utf-8', { 'content-security-policy': DASH_CSP })
    } catch (e) {
      logErr('dash', e)
      return send(res, 500, '看板算不出来了，游戏没事。')
    }
  }

  const file = resolve(p)
  if (!file) return send(res, 403, 'forbidden')

  let target = file
  let st = null
  try { st = fs.statSync(target) } catch { st = null }
  if (st && st.isDirectory()) { target = path.join(target, 'index.html'); try { st = fs.statSync(target) } catch { st = null } }
  if (!st) {
    // a missing asset is a 404; a missing page is the app (front-end routes)
    if (path.extname(p)) return send(res, 404, 'not found')
    target = path.join(DIST, 'index.html')
    try { st = fs.statSync(target) } catch { return send(res, 503, 'dist/ 还没构建：先跑 npm run build') }
  }

  const ext = path.extname(target).toLowerCase()
  const type = MIME[ext] ?? 'application/octet-stream'
  const hashed = target.split(path.sep).includes('assets')
  // 背景音乐（public/music，照抄 Val Manager）：一首两三兆，网址带 ?v= 版本号（src/data/music_me.ts），
  // 换了文件就是新网址，所以缓存一周
  const music = path.relative(DIST, target).split(path.sep)[0] === 'music'
  const head = {
    'content-type': type,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : music ? 'public, max-age=604800' : 'no-cache',
    'x-content-type-options': 'nosniff',
  }
  // 以下照抄 Val Manager 的 server.js：
  // A media player asks for a file in pieces — the first few kilobytes to
  // read the header, then wherever the listener drags to — and Safari will
  // not play audio at all from a server that answers a range request with
  // the whole file. Honoured for everything; it costs nothing.
  head['accept-ranges'] = 'bytes'
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
  if (range && (range[1] || range[2])) {
    const size = st.size
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start >= size || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${size}` }).end()
      return
    }
    head['content-range'] = `bytes ${start}-${end}/${size}`
    head['content-length'] = end - start + 1
    res.writeHead(206, head)
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(target, { start, end }).pipe(res)
    return
  }
  head['content-length'] = st.size
  res.writeHead(200, head)
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(target).pipe(res)
})

try { loadStats() } catch (e) { logErr('boot', e) }
server.listen(PORT, () => {
  console.log(`val_player static server on :${PORT}, serving ${DIST}`)
  console.log(`[stats] 数据目录 ${DATA_DIR}${VOLATILE ? '（⚠ 无持久化卷，重启即丢）' : ''} · 已记 ${REG.vids.length} 台设备 · `
    + `看板 ${STATS_KEY ? '已配钥匙，打开 /dash 在浏览器密码框里填钥匙' : '未配 STATS_KEY，/dash 一律 404（事件照记）'}`
    + `${BEHIND_PROXY ? ' · 受信代理后（X-Forwarded-For 取末段）' : ''}`)
})
