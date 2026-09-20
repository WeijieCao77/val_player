/* 玩家信箱 —— 玩家在游戏里写一条建议，作者看过之后展示出来，大家投票，作者照着赞多的往下修。
   （作者 2026-09-20：「我考虑加一个玩家信箱……然后我就可以按照点赞数量高的进行 bug 修改」）

   server.js 只负责把 /api/box/* 和 /dash/box 转到这里，存储、接口和审核页都在这个文件里。

   ================== 这条线不许越过 ==================

   统计那边「不记玩家打进去的任何文字」的规矩一个字不改：信箱是另一套文件、另一套接口、另一套
   聚合，两边不共用任何存储。信箱当然要存玩家打的字——那是它的全部意义——但除了这些字和一个
   随机设备号，什么都不存：

   · 不记 IP。限流用的地址只活在内存的一张表里，一秒都不落盘、不进日志、不上审核页。
   · 不记 User-Agent，不记位置，不记游戏进度，不记任何和统计对得上的东西。
   · 身份就是统计已经在用的那个 vid（浏览器第一次打开时自己生成的随机串）。审核页上也不显示
     vid 原文，只显示 sha256(vid) 的前 6 位——够作者认出「这 8 条是同一台设备刷的」，又不是
     一个能拿去别处对的号。

   ================== 先审后展示 ==================

   玩家写的每一个字都会被别的玩家看到，这页是作者自己的站，出什么事都是他担着。所以新投稿一律
   pending：除了提交的那台设备和作者，谁都看不见；作者在 /dash/box 按「展示」才上榜。
   「不展示」把已展示的收回成 hidden，内容还在、随时能再展示；真要清掉是另一个按钮。
   提交的人永远看得到自己那条和它的状态，所以信箱不会看起来像坏了。

   脏话表、字数上限、挡链接、挡重复，都只是第一道闸，不是唯一一道：就算有人绕过词表，没有作者
   点「展示」，别的玩家一个字都看不到。

   ================== 存储 ==================

   和统计同一个目录（DATA_DIR / RAILWAY_VOLUME_MOUNT_PATH / ~/.val_player-stats），自己的文件
   box.jsonl：一行一条操作（new / vote / st / pin / del / merge / set），追加前后都带换行，
   避免写到一半的坏尾粘住下一条成功记录。启动时按顺序重放，空行、坏行跳过。
   追加成功才更新内存，写不进去就回一句中文（不保证断电落盘或失败写入的原子回滚）。文件到上限就压实（每条一行 set），
   条目到上限就不再收新投稿，点赞照常；字节硬上限前改用候选快照原子提交，
   有效数据已满时仍允许减少占用的删除/合并/退票。写失败的审核操作明确返回失败。

   信箱出任何毛病都不该变成游戏打不开：每个入口自己把错兜住，记一行，进程继续服务 dist/。 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/* ---------- 封顶 ----------
   公网是敌意的。一条这么长、一共这么多条、待审核最多排这么多、日志到这么大就压实。 */
const MAX_BODY = 8 * 1024
/** 一条建议的字数（按码点数，一个汉字就是一个） */
const MAX_TEXT = 200
const MIN_TEXT = 4
/** 信箱里一共留这么多条（含未展示的）。到顶只挡新投稿，点赞不受影响 */
const MAX_ITEMS = 600
/** 待审核排队上限：作者还没看完，就先别再收 */
const MAX_PENDING = 200
/** 一条最多记这么多个投票设备（真实永远到不了，防的是脚本） */
const MAX_VOTERS = 5000
/** 日志到这么大就压实成每条一行 */
const COMPACT_AT = 4 * 1024 * 1024
/** 压实之后仍到这个大小：暂停增加占用，但保留减量清理路径，审核页写明 */
const HARD_BYTES = 8 * 1024 * 1024
/** 公开列表一次最多发这么多条，「我的」最多这么多条 */
const LIST_MAX = 200
const MINE_MAX = 50
/** id 的样子：8 位十六进制 */
const ID_RE = /^[0-9a-f]{8}$/

/** 状态。pending / hidden 只有提交的那台设备和作者看得见；其余三个在榜上。 */
const STATES = new Set(['pending', 'shown', 'taken', 'fixed', 'hidden'])
const PUBLIC_STATES = new Set(['shown', 'taken', 'fixed'])
export const STATE_CN = {
  pending: '待审核', shown: '已展示', taken: '已采纳', fixed: '已修复', hidden: '未展示',
}

/* ---------- 第一道闸的词表 ----------
   挡的是一眼就不能挂在公开榜上的东西：引流、赌博、色情、骂街。列全是不可能的，也不必——
   真正的闸是作者点不点「展示」。作者要加词，加在这里就行。 */
const BLOCK = [
  '加微信', '加威信', '加vx', '加v信', '私聊我', '代练', '代打', '外挂', '辅助器', '破解版',
  '刷单', '兼职日结', '博彩', '棋牌', '菠菜', '网赚', '免费领', '扫码进群', '包赢',
  '裸聊', '约炮', '一夜情', '色情',
  '草泥马', '傻逼', '煞笔', '尼玛', '狗日的', '你妈的', '妈了个',
  'fuck', 'shit', 'bitch', 'asshole',
]
/** 链接和联系方式：先别放，直接说问题就行（引流最爱走这条） */
const LINKY = /(https?:\/\/|www\.|\.com|\.cn\b|\.net\b|[a-z]{2,}\.(me|top|xyz|vip)\b)/i
/** 一长串数字：QQ 号、手机号、微信号 */
const DIGITS = /\d{7,}/

/* ---------- 内存里的样子 ---------- */
/** id -> { id, t, dev, text, state, pin, votes: Set<vid> } */
const ITEMS = new Map()
const BOX = { dir: '', file: '', volatile: false, bytes: 0, ready: false, errCount: 0, lastErr: '', full: '' }

/** 出错只记一行，绝不往上抛 */
function logErr(where, e) {
  BOX.errCount++
  // 地址永远不许进日志：socket 出错时 Node 会把对端地址写进 message
  BOX.lastErr = String(`${where}: ${e && e.message ? e.message : String(e)}`)
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[ip]')
    .replace(/\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/gi, '[ip]')
  if (BOX.errCount <= 50) console.error(`[box] ${BOX.lastErr}`)
}

/* ---------- 重放与落盘 ---------- */
function applyOp(o, items = ITEMS) {
  if (!o || typeof o !== 'object') return
  const id = typeof o.id === 'string' ? o.id : ''
  if (!ID_RE.test(id)) return
  if (o.o === 'new' || o.o === 'set') {
    const it = {
      id,
      t: Number.isFinite(o.t) ? o.t : 0,
      dev: typeof o.dev === 'string' ? o.dev : '',
      text: typeof o.text === 'string' ? o.text : '',
      state: STATES.has(o.s) ? o.s : 'pending',
      pin: o.p ? 1 : 0,
      votes: new Set(Array.isArray(o.v) ? o.v.filter((x) => typeof x === 'string').slice(0, MAX_VOTERS) : []),
    }
    if (o.o === 'new' && it.dev) it.votes.add(it.dev)      // 提了一条就是投了自己一票
    items.set(id, it)
    return
  }
  const it = items.get(id)
  if (!it) return
  if (o.o === 'vote') {
    if (typeof o.dev !== 'string' || !o.dev) return
    if (o.on) { if (it.votes.size < MAX_VOTERS) it.votes.add(o.dev) } else it.votes.delete(o.dev)
  } else if (o.o === 'st') {
    if (STATES.has(o.s)) it.state = o.s
  } else if (o.o === 'pin') {
    it.pin = o.v ? 1 : 0
  } else if (o.o === 'del') {
    items.delete(id)
  } else if (o.o === 'merge') {
    const to = items.get(typeof o.to === 'string' ? o.to : '')
    if (to) for (const v of it.votes) { if (to.votes.size < MAX_VOTERS) to.votes.add(v) }
    items.delete(id)
  }
}

/** 一条操作：追加成功才记账。写不进去回 false，调用方显示失败。 */
function write(o) {
  let line
  // 不能只在启动时检查坏尾：同一进程的 append 也可能写了一半才抛错。
  // 每条都先隔开前面的残片；重放本就忽略空行，旧日志和压实快照无需迁移。
  try { line = `\n${JSON.stringify(o)}\n` } catch (e) { logErr('stringify', e); return false }
  if (BOX.bytes + Buffer.byteLength(line) >= HARD_BYTES) {
    // 日志可能只是历史操作太多，也可能有效数据本身已满。先在副本里演算，
    // 用一次原子替换提交“压实 + 本次操作”；任何落盘失败都不提前改内存。
    const next = new Map([...ITEMS].map(([id, it]) => [id, { ...it, votes: new Set(it.votes) }]))
    applyOp(o, next)
    const body = snapshot(next)
    const bytes = Buffer.byteLength(body)
    const cleanup = o.o === 'del' || o.o === 'merge' || (o.o === 'vote' && !o.on)
    if (bytes >= HARD_BYTES && !(cleanup && bytes < Buffer.byteLength(snapshot(ITEMS)))) {
      BOX.full = 'bytes'
      return false
    }
    if (!replaceSnapshot(body)) return false
    applyOp(o)
    return true
  }
  try {
    fs.appendFileSync(BOX.file, line)
  } catch (e) {
    // append 可能已经留下半条；下一次容量判断也要按真实长度算。
    try { BOX.bytes = fs.statSync(BOX.file).size } catch { /* 保留已知长度 */ }
    BOX.full = BOX.bytes >= HARD_BYTES ? 'bytes' : ''
    logErr('append', e)
    return false
  }
  BOX.bytes += Buffer.byteLength(line)
  applyOp(o)
  if (BOX.bytes > COMPACT_AT) compact()
  return true
}

function snapshot(items) {
  let body = ''
  for (const it of items.values()) {
    body += `${JSON.stringify({ o: 'set', id: it.id, t: it.t, dev: it.dev, text: it.text, s: it.state, p: it.pin, v: [...it.votes] })}\n`
  }
  // 空信箱仍留下“曾开张过”的记号，否则删光后重启会把预置建议重新放回来。
  return body || '\n'
}

/** 同目录临时文件 + rename；失败不覆盖原日志、不更新内存/字节账。 */
function replaceSnapshot(body) {
  const tmp = `${BOX.file}.${crypto.randomBytes(8).toString('hex')}.tmp`
  let collision = false
  try {
    fs.writeFileSync(tmp, body, { flag: 'wx' })
    fs.renameSync(tmp, BOX.file)
    BOX.bytes = Buffer.byteLength(body)
    BOX.full = BOX.bytes >= HARD_BYTES ? 'bytes' : ''
    return true
  } catch (e) {
    collision = e.code === 'EEXIST'
    logErr('compact', e)
    return false
  }
  finally {
    // wx 碰到已有路径时没有取得该文件的所有权，不清理它。
    if (!collision) {
      try { fs.unlinkSync(tmp) } catch (e) { if (e.code !== 'ENOENT') logErr('compact-cleanup', e) }
    }
  }
}

/** 常规追加已经成功后，压实失败也不撤销已落盘的操作。 */
function compact() {
  try { return replaceSnapshot(snapshot(ITEMS)) } catch (e) { logErr('compact', e); return false }
}

/* ---------- 开张时先放几条 ----------
   空榜没人愿意写第一条，摆着三条真的建议，别人一看就知道该往里写什么（作者 2026-09-20：
   「默认先展示几个，等以后我改了就显示已修复，然后移除，但现在先放几个不然太空了」）。
   就是三条普通的记录：走 write() 的同一条路、一行一条躺在 box.jsonl 里，作者在审核页上照样
   能收起、标已修复、删掉。只在日志文件还一个字节都没有的时候写一次，所以重启不会再放一遍，
   删光了也不会自己长回来。票数是真的 0——不编数字充场面。 */
const SEEDS = [
  '买外设只能少受伤，能不能也加点强度？花了钱想看到属性涨一点。',
  '赚钱的路子太少了，希望多几条，比如直播独家、接代言这种。',
  '比赛被淘汰之后只能干等着，希望能马上去度假或者谈转会，不用等到窗口才有事做。',
]

/** 启动：把日志重放一遍。半行、坏行跳过；文件不在就是第一次跑。 */
export function initBox({ dir, volatile }) {
  BOX.dir = dir
  BOX.file = path.join(dir, 'box.jsonl')
  BOX.volatile = !!volatile
  ITEMS.clear()
  let txt = ''
  try { txt = fs.readFileSync(BOX.file, 'utf8') } catch { txt = '' }
  BOX.bytes = Buffer.byteLength(txt)
  BOX.full = BOX.bytes >= HARD_BYTES ? 'bytes' : ''
  for (const ln of txt.split('\n')) {
    if (!ln) continue
    let o
    try { o = JSON.parse(ln) } catch { continue }          // 写到一半的半行：跳过
    try { applyOp(o) } catch (e) { logErr('replay', e) }
  }
  BOX.ready = true
  // 第一次跑（日志一个字节都没有）才放那三条；有过日志就说明作者已经处置过了
  if (!BOX.bytes) {
    for (const text of SEEDS) {
      const id = crypto.randomBytes(4).toString('hex')
      if (ITEMS.has(id)) continue
      write({ o: 'new', id, t: Date.now(), dev: '', text, s: 'shown' })
    }
  }
  return counts()
}

/* ---------- 数一数 ---------- */
export function counts() {
  let pending = 0
  let shown = 0
  for (const it of ITEMS.values()) {
    if (it.state === 'pending') pending++
    else if (PUBLIC_STATES.has(it.state)) shown++
  }
  return { pending, shown, total: ITEMS.size, bytes: BOX.bytes, volatile: BOX.volatile, errCount: BOX.errCount, lastErr: BOX.lastErr }
}

/* ---------- 洗玩家打进来的字 ----------
   控制字符全去掉（换行也收成空格：榜上一行就是一句话），首尾空白去掉，按码点掐长度。 */
function clean(v) {
  if (typeof v !== 'string') return ''
  let s = ''
  for (const ch of v) {
    const c = ch.codePointAt(0)
    s += (c <= 31 || c === 127) ? ' ' : ch
    if (s.length > 4 * MAX_TEXT) break            // 长度另外核；这里只是不让一串怪字把后面的活撑大
  }
  return s.replace(/\s+/g, ' ').trim()
}
/** 查重用的样子：去掉空白和标点，只比字 */
const normal = (s) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
const short = (vid) => crypto.createHash('sha256').update(String(vid)).digest('hex').slice(0, 6)

/** 设备号：统计那个 vid 的样子（客户端 engine/me/telemetry.ts 生成），长度和字符集都收着 */
const devOk = (s) => typeof s === 'string' && s.length > 0 && s.length <= 64 && /^[A-Za-z0-9._:-]+$/.test(s)

/* ---------- 限流：只在内存里 ----------
   地址只活在这几张表里，不写盘、不进日志、不上审核页。 */
const WIN = new Map()
const WIN_MAX_KEYS = 8000
function limit(key, max, ms) {
  const now = Date.now()
  let r = WIN.get(key)
  if (!r || now - r.t0 > ms) {
    if (!r && WIN.size >= WIN_MAX_KEYS) {
      for (const [k, v] of WIN) if (now - v.t0 > v.ms) WIN.delete(k)
      if (WIN.size >= WIN_MAX_KEYS) return false
    }
    r = { n: 0, t0: now, ms }
    WIN.set(key, r)
  }
  return ++r.n <= max
}
/** 看一眼还剩不剩，不计数 */
function over(key, max) {
  const r = WIN.get(key)
  return !!(r && Date.now() - r.t0 <= r.ms && r.n >= max)
}

const HOUR = 3600e3
const DAY = 86400e3
const TEN_MIN = 10 * 60e3
/* 每一档都能用环境变量调（统计的限流也是这么留口的）：线上不用动，核查脚本调小了才好把闸按响。 */
const env = (k, d) => Number(process.env[k]) || d
/** 每台设备：投稿 3 条/小时、10 条/天；投票 60 次/10 分钟 */
const NEW_PER_HOUR = env('BOX_NEW_HOUR', 3)
const NEW_PER_DAY = env('BOX_NEW_DAY', 10)
const VOTE_PER_TEN = env('BOX_VOTE_TEN', 60)
/** 每个 IP：写 30 次/10 分钟，读 120 次/分钟；全站写 600 次/10 分钟 */
const IP_WRITE = env('BOX_RATE_IP', 30)
const IP_READ = env('BOX_RATE_READ', 120)
const ALL_WRITE = env('BOX_RATE_ALL', 600)

/* ---------- 回话 ---------- */
function json(res, code, obj) {
  let body = '{"ok":false}'
  try { body = JSON.stringify(obj) } catch { /* 上面那句兜着 */ }
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}
const no = (res, why, code = 200) => json(res, code, { ok: false, why })

function readBody(req) {
  return new Promise((resolve) => {
    let chunks = []
    let len = 0
    let over = false
    req.on('data', (c) => {
      len += c.length
      if (len > MAX_BODY) { over = true; chunks = []; req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })
}

/** 发给玩家的样子：绝不带 dev（别人的设备号谁都不该拿到） */
const wire = (it, vid) => ({
  id: it.id,
  t: it.t,
  text: it.text,
  votes: it.votes.size,
  state: it.state,
  pin: it.pin,
  // 开张时预置的那几条没有设备号；没认出设备的人也不该看到「你提的」
  mine: !!vid && !!it.dev && it.dev === vid,
  voted: !!vid && it.votes.has(vid),
})

/** 榜的顺序：置顶的在前，然后票多的，一样多的新的在前 */
const rank = (a, b) => (b.pin - a.pin) || (b.votes.size - a.votes.size) || (b.t - a.t)

/* ---------- 三个公开接口 ---------- */
async function apiList(req, res, ip) {
  if (!limit(`r:${ip}`, IP_READ, 60e3)) return no(res, '太快了，歇一会儿。', 429)
  const body = await readBody(req)
  let b = null
  try { b = body ? JSON.parse(body) : null } catch { b = null }
  const vid = b && devOk(b.vid) ? b.vid : ''
  const all = [...ITEMS.values()]
  const items = all.filter((it) => PUBLIC_STATES.has(it.state)).sort(rank).slice(0, LIST_MAX).map((it) => wire(it, vid))
  const mine = vid
    ? all.filter((it) => it.dev === vid).sort((a, b2) => b2.t - a.t).slice(0, MINE_MAX).map((it) => wire(it, vid))
    : []
  json(res, 200, { ok: true, items, mine, max: MAX_TEXT, full: ITEMS.size >= MAX_ITEMS })
}

async function apiNew(req, res, ip) {
  const body = await readBody(req)
  if (body === null) return no(res, '这条太长了，说重点就行。')
  let b = null
  try { b = JSON.parse(body) } catch { b = null }
  if (!b || typeof b !== 'object' || b.v !== 1) return no(res, '没看懂这条，刷新一下再试。')
  if (!devOk(b.vid)) return no(res, '没认出你的浏览器，刷新一下再试。')
  if (!limit(`w:${ip}`, IP_WRITE, TEN_MIN) || !limit('w:all', ALL_WRITE, TEN_MIN)) {
    return no(res, '发得太快了，过一会儿再来。', 429)
  }
  const text = clean(b.text)
  const n = [...text].length
  if (n < MIN_TEXT) return no(res, `太短了，至少 ${MIN_TEXT} 个字，把想说的说清楚。`)
  if (n > MAX_TEXT) return no(res, `一条最多 ${MAX_TEXT} 个字，长了就分两条。`)
  const low = text.toLowerCase()
  if (BLOCK.some((w) => low.includes(w))) return no(res, '这条里有不能挂在公开榜上的词，换个说法再发。')
  if (LINKY.test(text)) return no(res, '先别放链接，直接说问题就行。')
  if (DIGITS.test(text)) return no(res, '别留联系方式，作者在这儿就能看到你写的。')

  // 同一台设备提过一模一样的话：挡回去。别人提过同样的话照收，审核页会标「疑似重复」，作者可以合并
  const key = normal(text)
  for (const it of ITEMS.values()) {
    if (normal(it.text) === key && it.dev === b.vid) return no(res, '这条你已经提过了，在「我的」里能看到。')
  }
  if (ITEMS.size >= MAX_ITEMS) return no(res, '信箱满了，作者清一清就好。先去给已有的建议点个赞吧。')
  let pending = 0
  for (const it of ITEMS.values()) if (it.state === 'pending') pending++
  if (pending >= MAX_PENDING) return no(res, '作者还没看完排队的建议，过两天再来。')
  if (over(`nh:${b.vid}`, NEW_PER_HOUR)) return no(res, `一小时最多发 ${NEW_PER_HOUR} 条，攒一攒再来。`, 429)
  if (over(`nd:${b.vid}`, NEW_PER_DAY)) return no(res, `一天最多发 ${NEW_PER_DAY} 条，明天再来。`, 429)
  limit(`nh:${b.vid}`, NEW_PER_HOUR, HOUR)
  limit(`nd:${b.vid}`, NEW_PER_DAY, DAY)

  let id = ''
  for (let i = 0; i < 8 && !id; i++) {
    const cand = crypto.randomBytes(4).toString('hex')
    if (!ITEMS.has(cand)) id = cand
  }
  if (!id) return no(res, '这会儿发不出去，等会儿再试。')
  // dupOf 不落盘：审核页每次按正文自己认一遍重复，作者删掉源条之后标记也跟着没了
  if (!write({ o: 'new', id, t: Date.now(), dev: b.vid, text, s: 'pending' })) {
    return no(res, '作者的服务器一时写不进去，等会儿再发一次。')
  }
  json(res, 200, { ok: true, item: wire(ITEMS.get(id), b.vid) })
}

async function apiVote(req, res, ip) {
  const body = await readBody(req)
  let b = null
  try { b = body ? JSON.parse(body) : null } catch { b = null }
  if (!b || typeof b !== 'object' || b.v !== 1) return no(res, '没看懂，刷新一下再试。')
  if (!devOk(b.vid) || typeof b.id !== 'string' || !ID_RE.test(b.id)) return no(res, '没认出这一条，刷新一下再试。')
  if (!limit(`w:${ip}`, IP_WRITE, TEN_MIN) || !limit('w:all', ALL_WRITE, TEN_MIN)) return no(res, '点太快了，歇一会儿。', 429)
  if (!limit(`vt:${b.vid}`, VOTE_PER_TEN, TEN_MIN)) return no(res, '点太快了，歇一会儿。', 429)
  const it = ITEMS.get(b.id)
  // 没审核的条目对别人根本不存在：连「有没有这一条」都不该被问出来
  if (!it || !PUBLIC_STATES.has(it.state)) return no(res, '这条已经不在榜上了。')
  if (it.dev === b.vid) return no(res, '这条是你自己提的，已经算你一票了。')
  const on = !!b.on
  if (it.votes.has(b.vid) === on) return json(res, 200, { ok: true, id: it.id, votes: it.votes.size, on })
  if (on && it.votes.size >= MAX_VOTERS) return no(res, '这条的赞已经记满了。')
  if (!write({ o: 'vote', id: it.id, dev: b.vid, on: on ? 1 : 0 })) return no(res, '这一下没记上，再点一次。')
  json(res, 200, { ok: true, id: it.id, votes: it.votes.size, on })
}

/**
 * /api/box/* ——接住了回 true。任何一处抛错都只记一行，游戏那边照样拿到一句中文。
 * 调用方（server.js）给的 ip 只用来限流，到这里为止。
 */
export function handleBoxApi(req, res, p, ip) {
  const act = p === '/api/box/list' ? apiList : p === '/api/box/new' ? apiNew : p === '/api/box/vote' ? apiVote : null
  if (!act) return false
  if (req.method !== 'POST') { json(res, 405, { ok: false, why: '方法不对' }); return true }
  act(req, res, ip).catch((e) => {
    logErr('api', e)
    try { no(res, '信箱这会儿不太舒服，游戏没事。') } catch { /* 已经回过了 */ }
  })
  return true
}

/* ================= 审核页 =================
   纯服务端渲染、零 JS、纯表单——没有脚本就没有 XSS 面。玩家打的字在这里也只是数据：
   每一处都过 esc()，一次都不许原样插进 HTML。 */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const BOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

const when = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')

function row(it, dupOf) {
  const acts = []
  const btn = (act, label, extra = '', cls = '') =>
    `<form method="post"><input type="hidden" name="act" value="${act}"><input type="hidden" name="id" value="${esc(it.id)}">${extra}<button class="${cls}">${label}</button></form>`
  if (it.state !== 'shown') acts.push(btn('show', '展示', '', 'go'))
  if (it.state !== 'pending' && it.state !== 'hidden') acts.push(btn('hide', '不展示'))
  if (it.state !== 'taken') acts.push(btn('state', '已采纳', '<input type="hidden" name="s" value="taken">'))
  if (it.state !== 'fixed') acts.push(btn('state', '已修复', '<input type="hidden" name="s" value="fixed">'))
  acts.push(btn(it.pin ? 'unpin' : 'pin', it.pin ? '取消置顶' : '置顶'))
  acts.push(`<form method="post"><input type="hidden" name="act" value="merge"><input type="hidden" name="id" value="${esc(it.id)}"><input name="to" size="8" placeholder="并到 id" value="${esc(dupOf || '')}"><button>合并</button></form>`)
  acts.push(btn('del', '删除', '', 'bad'))
  return `<tr class="s-${esc(it.state)}">
<td class="tx">${esc(it.text)}</td>
<td class="num">${it.votes.size}</td>
<td class="dim">${esc(STATE_CN[it.state] || it.state)}${it.pin ? ' · 置顶' : ''}<br>${esc(when(it.t))}<br>#${esc(it.id)} · ${it.dev ? esc(short(it.dev)) : '开张预置'}${dupOf ? `<br><b class="dup">疑似重复 #${esc(dupOf)}</b>` : ''}</td>
<td class="acts">${acts.join('')}</td>
</tr>`
}

export function boxHtml() {
  const c = counts()
  const all = [...ITEMS.values()]
  // 全站同文的：后来的那条标一下，作者一眼看见能合并
  const first = new Map()
  for (const it of [...all].sort((a, b) => a.t - b.t)) {
    const k = normal(it.text)
    if (!first.has(k)) first.set(k, it.id)
  }
  const dupOf = (it) => (first.get(normal(it.text)) !== it.id ? first.get(normal(it.text)) : '')
  const wait = all.filter((it) => it.state === 'pending').sort((a, b) => a.t - b.t)
  const live = all.filter((it) => PUBLIC_STATES.has(it.state)).sort(rank)
  const away = all.filter((it) => it.state === 'hidden').sort((a, b) => b.t - a.t)
  const table = (rows) => (rows.length
    ? `<table><tr><th>建议</th><th class="num">赞</th><th>状态</th><th>动作</th></tr>${rows.map((it) => row(it, dupOf(it))).join('')}</table>`
    : '<p class="dim">这一栏是空的。</p>')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>val_player · 玩家信箱</title>
<style>
body{margin:0;background:#0b0f14;color:#dfe7f1;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;padding:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;color:#8fa2b8;margin:26px 0 10px;font-weight:600}
a{color:#5bc6cf}.sub{color:#7d8ea6;font-size:12px}.dim{color:#5d6c80;font-size:12px}
.warn{background:#3a1518;border:1px solid #7a2b31;color:#ffb3ba;padding:10px 14px;border-radius:8px;margin:14px 0;font-size:13px}
.warn.big{font-size:15px;padding:16px 18px;border-width:2px;line-height:1.7}
.warn.big b{color:#fff}
.grid{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
.st{background:#121923;border:1px solid #1f2b3a;border-radius:10px;padding:12px 18px;min-width:96px}
.st .n{font-size:22px;font-weight:700;color:#5bc6cf;font-variant-numeric:tabular-nums}
.st .l{font-size:12px;color:#8fa2b8}
table{border-collapse:collapse;width:100%;max-width:1100px;margin-bottom:6px}
td,th{padding:6px 10px;border-bottom:1px solid #1f2b3a;text-align:left;font-size:13px;vertical-align:top}
th{color:#8fa2b8;font-weight:600}.num{text-align:right;font-variant-numeric:tabular-nums}
td.tx{max-width:520px;word-break:break-word;white-space:pre-wrap}
tr.s-pending td.tx{color:#ffd9a0}
.acts{display:flex;flex-wrap:wrap;gap:4px}
.acts form{display:inline}
button{background:#121923;color:#dfe7f1;border:1px solid #2b3a4d;border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer}
button:hover{border-color:#5bc6cf}button.go{border-color:#3f7f5a;color:#8fe0ac}button.bad{border-color:#7a2b31;color:#ffb3ba}
input{background:#0b0f14;color:#dfe7f1;border:1px solid #2b3a4d;border-radius:6px;padding:3px 6px;font-size:12px}
.dup{color:#c9a86a}
.foot{margin-top:28px;color:#5d6c80;font-size:12px}
</style></head><body>
<h1>val_player · 玩家信箱</h1>
<div class="sub">玩家写的东西，你按「展示」之前只有他自己看得见 · <a href="/dash">回后台看板</a></div>
${BOX.volatile ? `<div class="warn big">⚠ <b>没挂持久化卷：这些建议下一次重新部署就全没了，找不回来。</b><br>
统计丢了还能从头再收，玩家写给你的话丢了就是丢了——写的人不会再写第二遍。<br>
到 Railway 服务设置里挂一个 Volume，把 DATA_DIR 指过去，再重新部署一次；在那之前，看到想留的就先自己抄一份。<br>
现在存在容器磁盘上：${esc(BOX.dir)}/box.jsonl</div>` : ''}
${BOX.full ? '<div class="warn">⚠ 信箱达到容量上限，新的写入暂时受限。作者仍可删除或合并旧条目来释放空间；失败会明确提示，请确认清理成功后再试。</div>' : ''}
${c.total >= MAX_ITEMS ? `<div class="warn">⚠ 信箱到了 ${MAX_ITEMS} 条上限，新的投稿暂时收不进来（点赞照常）。删掉一些就好。</div>` : ''}
<div class="grid"><div class="st"><div class="n">${c.pending}</div><div class="l">待审核</div></div><div class="st"><div class="n">${c.shown}</div><div class="l">榜上</div></div><div class="st"><div class="n">${c.total}</div><div class="l">一共</div></div></div>
<h2>待审核（早的在上面）</h2>
${table(wait)}
<h2>榜上（按赞排）</h2>
${table(live)}
<h2>收起来的</h2>
${table(away)}
<div class="foot">「不展示」把已展示的收回，内容还在、随时能再展示；「删除」才是真的删掉。
合并会把那一条的赞并进你填的 id，然后删掉那一条。<br>
存在 ${esc(BOX.dir)}/box.jsonl · ${(c.bytes / 1024).toFixed(1)} KB · 不记 IP、不记 User-Agent，设备号只显示前 6 位哈希${c.errCount ? ` · 信箱内部错误 ${c.errCount} 次（最近：${esc(c.lastErr)}）` : ''}</div>
</body></html>`
}

/** 表单的 body（application/x-www-form-urlencoded），只认这几个字段 */
function form(text) {
  const out = {}
  for (const kv of String(text || '').split('&')) {
    const i = kv.indexOf('=')
    if (i < 0) continue
    let k = ''
    let v = ''
    try {
      k = decodeURIComponent(kv.slice(0, i).replace(/\+/g, ' '))
      v = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '))
    } catch { continue }
    if (k.length <= 8 && !Object.hasOwn(out, k)) out[k] = v.slice(0, 64)
  }
  return out
}

/**
 * 同源才收：作者的浏览器记着 Basic 凭证，别的站上一个表单也能带着它 POST 过来。
 * 现代浏览器一定会发 Sec-Fetch-Site；老浏览器至少会发 Origin。两个都没有的只可能是手动发的请求。
 */
function sameOrigin(req) {
  const sf = String(req.headers['sec-fetch-site'] || '')
  if (sf) return sf === 'same-origin' || sf === 'none'
  const o = req.headers.origin
  if (!o) return true
  try { return new URL(o).host === String(req.headers.host || '') } catch { return false }
}

/**
 * /dash/box。钥匙由 server.js 验过了（和 /dash 同一把），这里只管页面和六个动作。
 * 动作走 post/redirect/get：做完 303 回本页，刷新不会再执行一遍。
 */
export async function handleBoxAdmin(req, res, pathname) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    const html = boxHtml()
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': BOX_CSP })
    return res.end(req.method === 'HEAD' ? undefined : html)
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    return res.end('method not allowed')
  }
  if (!sameOrigin(req)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    return res.end('这个请求不是从后台页发出来的，没有执行。')
  }
  const f = form(await readBody(req))
  const id = typeof f.id === 'string' && ID_RE.test(f.id) ? f.id : ''
  const it = id ? ITEMS.get(id) : null
  let written = true
  if (it) {
    if (f.act === 'show') written = write({ o: 'st', id, s: 'shown' })
    else if (f.act === 'hide') written = write({ o: 'st', id, s: 'hidden' })
    else if (f.act === 'state' && STATES.has(f.s)) written = write({ o: 'st', id, s: f.s })
    else if (f.act === 'pin') written = write({ o: 'pin', id, v: 1 })
    else if (f.act === 'unpin') written = write({ o: 'pin', id, v: 0 })
    else if (f.act === 'del') written = write({ o: 'del', id })
    else if (f.act === 'merge' && ID_RE.test(String(f.to || '')) && f.to !== id && ITEMS.has(f.to)) written = write({ o: 'merge', id, to: f.to })
  }
  if (!written) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    return res.end('这次操作未能保存，不能当作成功。请返回信箱确认当前状态后再试；如果持续失败，请检查服务器存储空间和写入权限。')
  }
  res.writeHead(303, { location: pathname, 'cache-control': 'no-store' })
  res.end()
}

/** 只给核查脚本用：现在内存里是什么样 */
export function _boxState() {
  return [...ITEMS.values()].map((it) => ({ ...it, votes: [...it.votes] }))
}
