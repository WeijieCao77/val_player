/**
 * 玩家信箱：接口契约、审核闸、一设备一票、限流、转义、重启恢复。
 *
 * 信箱（box.js）是这个游戏里唯一一处把陌生人打的字展示给别的陌生人看的地方，所以这份核查盯的
 * 是「谁能看到什么」和「打进来的字会不会被当成代码」这两件事，一条一条按真的 HTTP 请求走：
 *
 *  - 先审后展示：新投稿在作者按「展示」之前，别的设备的公开列表里一条都不许有；提交的那台设备
 *    自己永远看得见，还写着状态（待审核 / 已展示 / 已采纳 / 已修复 / 未展示）。
 *  - 「不展示」是可逆的：已展示的收回来还在，作者随时能再展示；删除才是真的删掉。
 *  - 一台设备一条一票，可以收回；自己提的那条不能再投；没上榜的条目连投票都不认。
 *  - 转义：一条带 `<script>`、引号和反引号的建议，发出去、读回来、进审核页，
 *    每一处都得原样是那串字，而不是被当成标签——这是最不该出事的一处。
 *  - 限流：把每台设备、每个 IP 的闸调小，按下去要真的响。
 *  - 重启：进程被硬杀之后重放 box.jsonl，条目、状态、票数一个不差；开张预置的那三条不会再来一遍。
 *  - 管理动作：没钥匙 401、钥匙不对 401、没配 STATS_KEY 404、不是从后台页发的 403。
 *  - 顺手钉住没动过的那几条路：/api/e 回 204、/dash 没钥匙 401、/healthz 带 x-build、
 *    前端路由回 index.html、音乐的 Range 206。
 *
 * 怎么测：把 server.js、box.js、stats-contract.js 抄进一个临时目录（旁边放一个假的 dist/），
 * 起真的进程，全程只走 fetch。
 *
 *   npx tsx scripts/check_box.ts
 */
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KEY = 'box-key-789'
const AUTH = `Basic ${Buffer.from(`:${KEY}`).toString('base64')}`

let bad = 0
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}
const eq = (got: unknown, want: unknown, what: string): void =>
  check(String(got) === String(want), `${what}：${String(got)}${String(got) === String(want) ? '' : `（应为 ${String(want)}）`}`)
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms) })

/* ---------- 临时站点 ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'valbox-'))
const MP3 = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))

function site(name: string): string {
  const dir = path.join(tmp, name)
  fs.mkdirSync(dir, { recursive: true })
  for (const f of ['server.js', 'box.js', 'stats-contract.js']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f))
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}')
  fs.mkdirSync(path.join(dir, 'dist', 'music'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'), '<!doctype html><title>box</title><div id="root"></div>')
  fs.writeFileSync(path.join(dir, 'dist', 'music', 'song.mp3'), MP3)
  return dir
}

interface Srv { proc: ChildProcess; port: number; data: string }
const servers: Srv[] = []

async function boot(dir: string, data: string, env: Record<string, string> = {}): Promise<Srv> {
  fs.mkdirSync(data, { recursive: true })
  for (let attempt = 0; attempt < 8; attempt++) {
    const port = 32000 + Math.floor(Math.random() * 8000)
    const proc = spawn(process.execPath, [path.join(dir, 'server.js')], {
      cwd: dir,
      env: { ...process.env, PORT: String(port), DATA_DIR: data, STATS_KEY: KEY, BOX_RATE_IP: '400', BOX_RATE_ALL: '4000', BOX_NEW_HOUR: '50', BOX_NEW_DAY: '200', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    proc.stdout?.on('data', () => {})
    proc.stderr?.on('data', () => {})
    let up = false
    for (let i = 0; i < 100; i++) {
      await sleep(80)
      if (proc.exitCode !== null) break
      try {
        const r = await fetch(`http://127.0.0.1:${port}/healthz`)
        if (r.status) { up = true; break }
      } catch { /* 还没起来 */ }
    }
    if (up) { const s = { proc, port, data }; servers.push(s); return s }
    proc.kill('SIGKILL')
  }
  throw new Error('server.js 起不来')
}
async function kill(s: Srv): Promise<void> {
  if (s.proc.exitCode === null) {
    const gone = new Promise((r) => s.proc.once('exit', r))
    s.proc.kill('SIGKILL')
    await gone
  }
}

/* ---------- 客户端那三个调用 ---------- */
interface Item { id: string; t: number; text: string; votes: number; state: string; pin: number; mine: boolean; voted: boolean }
interface Reply { ok?: boolean; why?: string; items?: Item[]; mine?: Item[]; item?: Item; votes?: number; on?: boolean; full?: boolean; max?: number }

async function api(s: Srv, what: string, body: Record<string, unknown>): Promise<{ status: number; j: Reply }> {
  const r = await fetch(`http://127.0.0.1:${s.port}/api/box/${what}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, ...body }),
  })
  let j: Reply = {}
  try { j = (await r.json()) as Reply } catch { j = {} }
  return { status: r.status, j }
}
const list = async (s: Srv, vid: string): Promise<{ items: Item[]; mine: Item[]; full: boolean }> => {
  const { j } = await api(s, 'list', { vid })
  return { items: j.items ?? [], mine: j.mine ?? [], full: !!j.full }
}
const post = (s: Srv, vid: string, text: string) => api(s, 'new', { vid, text })
const vote = (s: Srv, vid: string, id: string, on: boolean) => api(s, 'vote', { vid, id, on })

/** 审核页的一个动作，和作者在浏览器里按按钮一样：同源的表单 POST */
async function act(s: Srv, form: Record<string, string>, headers: Record<string, string> = {}): Promise<number> {
  const r = await fetch(`http://127.0.0.1:${s.port}/dash/box`, {
    method: 'POST',
    redirect: 'manual',
    headers: { authorization: AUTH, 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', ...headers },
    body: new URLSearchParams(form).toString(),
  })
  await r.text()
  return r.status
}
async function dashBox(s: Srv, headers: Record<string, string> = { authorization: AUTH }): Promise<{ status: number; html: string }> {
  const r = await fetch(`http://127.0.0.1:${s.port}/dash/box`, { headers })
  return { status: r.status, html: r.status === 200 ? await r.text() : '' }
}
const lines = (data: string): string[] => {
  try { return fs.readFileSync(path.join(data, 'box.jsonl'), 'utf8').split('\n').filter(Boolean) } catch { return [] }
}

/** 一串真能出事的字：标签、引号、反引号、右尖括号 */
const NASTY = '这里能不能加个<script>alert("1")</script>，还有 </td><b>粗体</b> 和 `反引号` 跟 "双引号"'

try {
  const web = site('web')

  /* ================= 一、开张预置的那几条 ================= */
  console.log('开张（空信箱先摆几条真的建议，不然没人写第一条）：')
  const data1 = path.join(tmp, 'd-seed')
  {
    const s = await boot(web, data1)
    const { items } = await list(s, 'seed-dev')
    console.log(`  · 榜上：${items.map((i) => `「${i.text.slice(0, 12)}…」${i.votes} 赞`).join('、')}`)
    eq(items.length, 3, '第一次跑，榜上先有三条')
    check(items.every((i) => i.state === 'shown'), '三条都是已展示，打开就看得见')
    check(items.every((i) => i.votes === 0), '票数是真的 0，没有编出来的赞')
    check(items.every((i) => !i.mine), '预置的不算在谁名下')
    eq(lines(data1).length, 3, 'box.jsonl 里就是三行普通记录，没有第二条代码路径')
    await kill(s)
    const s2 = await boot(web, data1)
    eq((await list(s2, 'seed-dev')).items.length, 3, '重启不会再放一遍')
    // 作者删掉一条：重启也不该自己长回来
    const first = (await list(s2, 'seed-dev')).items[0]
    eq(await act(s2, { act: 'del', id: first.id }), 303, '作者删掉其中一条')
    eq((await list(s2, 'seed-dev')).items.length, 2, '删掉就是两条')
    await kill(s2)
    const s3 = await boot(web, data1)
    eq((await list(s3, 'seed-dev')).items.length, 2, '删掉的那条重启以后没有长回来')
    await kill(s3)
  }

  /* ================= 二、先审后展示 ================= */
  console.log('\n先审后展示（作者按「展示」之前，别人一条都看不见）：')
  const data2 = path.join(tmp, 'd-gate')
  let mineId = ''
  {
    const s = await boot(web, data2)
    const r = await post(s, 'dev-A', '希望能在赛季末看到一张这一年的总结')
    eq(r.j.ok, true, 'A 发了一条')
    eq(r.j.item?.state, 'pending', '新投稿是待审核')
    mineId = r.j.item?.id ?? ''

    const a = await list(s, 'dev-A')
    const b = await list(s, 'dev-B')
    check(!a.items.some((i) => i.id === mineId), 'A 自己的公开榜上也没有这条（它还没展示）')
    check(a.mine.some((i) => i.id === mineId && i.state === 'pending'), 'A 在「我的」里看得到自己那条，写着待审核')
    check(!b.items.some((i) => i.id === mineId), 'B 的榜上没有这条')
    check(!b.mine.some((i) => i.id === mineId), 'B 的「我的」里也没有这条')
    check(!JSON.stringify(b).includes('总结'), 'B 拿到的整份回话里，一个字都没有这条的正文')
    eq((await vote(s, 'dev-B', mineId, true)).j.ok, false, 'B 连给它投票都不行（没上榜的条目对别人不存在）')

    eq(await act(s, { act: 'show', id: mineId }), 303, '作者按「展示」')
    const b2 = await list(s, 'dev-B')
    check(b2.items.some((i) => i.id === mineId && i.state === 'shown'), '这条上榜了，B 看得见')

    // 「不展示」可逆
    eq(await act(s, { act: 'hide', id: mineId }), 303, '作者按「不展示」')
    const b3 = await list(s, 'dev-B')
    const a3 = await list(s, 'dev-A')
    check(!b3.items.some((i) => i.id === mineId), '收起来之后别人看不见了')
    check(a3.mine.some((i) => i.id === mineId && i.state === 'hidden'), '提交的人还看得见自己那条，写着未展示（没被删）')
    eq(await act(s, { act: 'show', id: mineId }), 303, '再按一次「展示」')
    check((await list(s, 'dev-B')).items.some((i) => i.id === mineId), '收起来的还能再展示，内容一个字没少')

    // 状态
    eq(await act(s, { act: 'state', id: mineId, s: 'taken' }), 303, '标成已采纳')
    eq((await list(s, 'dev-B')).items.find((i) => i.id === mineId)?.state, 'taken', '榜上写着已采纳')
    eq(await act(s, { act: 'state', id: mineId, s: 'fixed' }), 303, '改好了标成已修复')
    eq((await list(s, 'dev-B')).items.find((i) => i.id === mineId)?.state, 'fixed', '榜上写着已修复')
    await kill(s)
  }

  /* ================= 三、一台设备一票 ================= */
  console.log('\n一台设备一条一票（可以收回，自己提的不能再投）：')
  const data3 = path.join(tmp, 'd-vote')
  let voteId = ''
  {
    const s = await boot(web, data3)
    const r = await post(s, 'dev-A', '想要更多赚钱的路子，比如直播独家')
    voteId = r.j.item?.id ?? ''
    await act(s, { act: 'show', id: voteId })
    let it = (await list(s, 'dev-B')).items.find((i) => i.id === voteId)
    eq(it?.votes, 1, '提的人自己那一票已经算进去了')
    eq((await vote(s, 'dev-A', voteId, true)).j.ok, false, '自己提的不能再投一票')
    eq((await vote(s, 'dev-B', voteId, true)).j.votes, 2, 'B 投了一票：2')
    eq((await vote(s, 'dev-B', voteId, true)).j.votes, 2, 'B 再点一次还是 2，不是 3')
    eq((await vote(s, 'dev-C', voteId, true)).j.votes, 3, 'C 也投了：3')
    eq((await vote(s, 'dev-B', voteId, false)).j.votes, 2, 'B 把票收回来：2')
    it = (await list(s, 'dev-C')).items.find((i) => i.id === voteId)
    check(it?.voted === true, 'C 自己看这条是「投过了」')
    it = (await list(s, 'dev-B')).items.find((i) => i.id === voteId)
    check(it?.voted === false, 'B 自己看这条是「没投」')
    eq((await vote(s, 'dev-D', 'zzzzzzzz', true)).j.ok, false, '给一个不存在的 id 投票，不认')

    /* 重启：条目、状态、票数一个不差 */
    await kill(s)
    const s2 = await boot(web, data3)
    const back = (await list(s2, 'dev-C')).items.find((i) => i.id === voteId)
    eq(back?.votes, 2, '硬杀之后重启：票数还是 2')
    eq(back?.state, 'shown', '状态也还在')
    eq(back?.voted, true, 'C 那一票还认得是 C 的')
    eq((await list(s2, 'dev-A')).mine.length, 1, '提交的人重启以后照样看得到自己那条')
    await kill(s2)
  }

  /* ================= 四、转义 ================= */
  console.log('\n转义（陌生人打的字，从头到尾都只是字）：')
  {
    const data = path.join(tmp, 'd-esc')
    const s = await boot(web, data)
    const r = await post(s, 'dev-X', NASTY)
    eq(r.j.ok, true, `发一条带 <script>、引号和反引号的建议`)
    const id = r.j.item?.id ?? ''
    eq(r.j.item?.text, NASTY, '回执里原样是那串字（一个字符都没被吃掉、也没被改写）')
    await act(s, { act: 'show', id })
    const seen = (await list(s, 'dev-Y')).items.find((i) => i.id === id)
    eq(seen?.text, NASTY, '别人从榜上读到的也是原样那串字')
    const { html } = await dashBox(s)
    check(!/<script/i.test(html), '审核页的 HTML 里没有一个真的 <script 标签')
    check(html.includes('&lt;script&gt;alert(&quot;1&quot;)&lt;/script&gt;'), '审核页上它是转义过的文本')
    check(html.includes('&lt;/td&gt;&lt;b&gt;粗体&lt;/b&gt;'), '想闭掉表格的那半截也只是文本')
    check(html.includes('`反引号`'), '反引号照样显示出来')
    check(!/<b>粗体<\/b>/.test(html), '没有一处把它当标签插进去')
    // 控制字符不许落盘
    const r2 = await post(s, 'dev-X2', '第一行 [31m 第二行\n第三行')
    check(r2.j.ok === true && !/[ -]/.test(r2.j.item?.text ?? ''), '控制字符和换行在收的时候就剥成了空格')
    check(!/[ -]/.test(fs.readFileSync(path.join(data, 'box.jsonl'), 'utf8').replace(/\n/g, '')),
      'box.jsonl 里也没有控制字符（一行一条，不会被撑破）')
    await kill(s)
  }

  /* ================= 五、第一道闸 ================= */
  console.log('\n第一道闸（字数、词表、链接、重复）：')
  {
    const data = path.join(tmp, 'd-filter')
    const s = await boot(web, data)
    eq((await post(s, 'dev-F', '好')).j.ok, false, '三个字以内的，挡回去')
    eq((await post(s, 'dev-F', '好'.repeat(201))).j.ok, false, '超过 200 字的，挡回去')
    eq((await post(s, 'dev-F', '好'.repeat(200))).j.ok, true, '正好 200 字，收')
    eq((await post(s, 'dev-F2', '加微信 xiaozhu 领皮肤')).j.ok, false, '词表里的词，挡回去')
    eq((await post(s, 'dev-F3', '去 https://example.com 看看我的攻略')).j.ok, false, '带链接的，挡回去')
    eq((await post(s, 'dev-F4', '有问题加我 12345678901 聊')).j.ok, false, '带一长串数字的，挡回去')
    eq((await post(s, 'dev-F5', '希望赛程页能看到下一场是谁')).j.ok, true, '正常一句话，收')
    eq((await post(s, 'dev-F5', '希望赛程页能看到下一场是谁')).j.ok, false, '同一台设备提一模一样的，挡回去')
    eq((await post(s, 'dev-F6', '希望赛程页能看到下一场是谁')).j.ok, true, '别的设备提同样的话照收（审核页会标疑似重复）')
    const { html } = await dashBox(s)
    check(html.includes('疑似重复'), '审核页上标出了疑似重复')
    await kill(s)
  }

  /* ================= 六、限流 ================= */
  console.log('\n限流（闸调小了要真的响，而且只在内存里）：')
  {
    const data = path.join(tmp, 'd-rate')
    const s = await boot(web, data, { BOX_NEW_HOUR: '2', BOX_NEW_DAY: '3', BOX_RATE_IP: '8' })
    eq((await post(s, 'dev-R', '第一条建议：希望排位能连着打十把')).j.ok, true, '第一条，收')
    eq((await post(s, 'dev-R', '第二条建议：希望休息能一次休两天')).j.ok, true, '第二条，收')
    const third = await post(s, 'dev-R', '第三条建议：希望训练能选教练')
    eq(third.j.ok, false, '一小时第三条，挡回去')
    eq(third.status, 429, '回的是 429')
    check(typeof third.j.why === 'string' && third.j.why.length > 0, `挡回去也给一句人话：「${third.j.why}」`)
    eq((await post(s, 'dev-R2', '换一台设备发的第一条建议')).j.ok, true, '换一台设备还能发（按设备算，不是按 IP 一刀切）')
    // 这个 IP 的写操作闸：上面已经用掉 5 次
    const codes: number[] = []
    for (let i = 0; i < 6; i++) codes.push((await post(s, `dev-R${i + 10}`, `压测用的第 ${i} 条建议内容`)).status)
    check(codes.includes(429), `同一个 IP 写多了也会 429（${codes.join(',')}）`)
    eq((await list(s, 'dev-R')).items.length >= 0, true, '读列表不受写的闸影响')
    const disk = fs.readFileSync(path.join(data, 'box.jsonl'), 'utf8')
    check(!/127\.0\.0\.1|::1/.test(disk), 'box.jsonl 里没有任何 IP（限流只在内存里）')
    const { html } = await dashBox(s)
    check(!/127\.0\.0\.1|::1/.test(html), '审核页上也没有 IP')
    check(!/dev-R\b/.test(html), '审核页上不显示设备号原文（只显示前 6 位哈希）')
    await kill(s)
  }

  /* ================= 七、管理动作的门 ================= */
  console.log('\n管理动作的门（钥匙、同源、没配钥匙）：')
  {
    const data = path.join(tmp, 'd-auth')
    const s = await boot(web, data)
    const r = await post(s, 'dev-Z', '希望队友的名字能点开看资料')
    const id = r.j.item?.id ?? ''
    eq((await dashBox(s, {})).status, 401, '/dash/box 不带钥匙：401')
    eq((await dashBox(s, { authorization: `Basic ${Buffer.from(':nope').toString('base64')}` })).status, 401, '钥匙不对：401')
    eq((await dashBox(s)).status, 200, '钥匙对：200')
    const noKey = await fetch(`http://127.0.0.1:${s.port}/dash/box`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' },
      body: `act=show&id=${id}`,
    })
    await noKey.text()
    eq(noKey.status, 401, '没有钥匙的人按不动「展示」')
    check(!(await list(s, 'dev-Y2')).items.some((i) => i.id === id), '那条还是没上榜')
    eq(await act(s, { act: 'show', id }, { 'sec-fetch-site': 'cross-site' }), 403, '不是从后台页发出来的表单：403（别的站拿着浏览器缓存的凭证也按不动）')
    check(!(await list(s, 'dev-Y2')).items.some((i) => i.id === id), '跨站那一下什么也没改')
    eq(await act(s, { act: 'show', id }), 303, '作者自己在后台页上按：成了')
    check((await list(s, 'dev-Y2')).items.some((i) => i.id === id), '这下上榜了')
    await kill(s)

    const s2 = await boot(web, path.join(tmp, 'd-nokey'), { STATS_KEY: '' })
    eq((await dashBox(s2, {})).status, 404, '没配 STATS_KEY：/dash/box 当这页不存在（404，和 /dash 一样）')
    eq((await post(s2, 'dev-Z2', '没配钥匙的时候投稿照样收得下')).j.ok, true, '投稿照收（只是作者还没法审）')
    await kill(s2)
  }

  /* ================= 八、合并与删除 ================= */
  console.log('\n合并重复、删除：')
  {
    const data = path.join(tmp, 'd-merge')
    const s = await boot(web, data)
    const a = (await post(s, 'dev-M1', '希望能看到队友的伤病情况')).j.item
    const b = (await post(s, 'dev-M2', '想知道队友是不是带伤上场的')).j.item
    await act(s, { act: 'show', id: a!.id })
    await act(s, { act: 'show', id: b!.id })
    await vote(s, 'dev-M3', a!.id, true)
    await vote(s, 'dev-M4', b!.id, true)
    await vote(s, 'dev-M3', b!.id, true)
    eq(await act(s, { act: 'merge', id: b!.id, to: a!.id }), 303, '把 B 合并进 A')
    const items = (await list(s, 'dev-M9')).items
    check(!items.some((i) => i.id === b!.id), '被合并的来源退出公开榜')
    const receipt = (await list(s, 'dev-M2')).mine.find((i) => i.id === b!.id) as any
    eq(receipt?.state, 'merged', '原作者保留已合并回执')
    eq(receipt?.merge?.target?.id, a!.id, '原作者知道合并去向')
    // A 是 M1 提的（自投一票）+ M3；B 是 M2 提的（自投一票）+ M4 + M3。两边都投过的 M3 只算一次：2 + 3 − 1 = 4
    eq(items.find((i) => i.id === a!.id)?.votes, 4, 'B 的票并进了 A，两边都投过的那台设备只算一次（2 + 3 − 1 = 4）')
    eq(await act(s, { act: 'del', id: a!.id }), 303, '删掉 A')
    check(!(await list(s, 'dev-M9')).items.some((i) => i.id === a!.id), '删掉就真的没了')
    check(!(await list(s, 'dev-M1')).mine.some((i) => i.id === a!.id), '提交的人那边也没了')
    await kill(s)
    const s2 = await boot(web, data)
    check(!(await list(s2, 'dev-M9')).items.some((i) => i.id === a!.id || i.id === b!.id), '重启以后删掉的也没有回来')
    await kill(s2)
  }

  /* ================= 九、原来的几条路没动 ================= */
  console.log('\n原来的几条路（改服务器时不许弄坏）：')
  {
    const s = await boot(web, path.join(tmp, 'd-keep'))
    const base = `http://127.0.0.1:${s.port}`
    const ev = await fetch(`${base}/api/e`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, vid: 'k1', sid: 's-k1', seq: 1, dev: 'phone', tz: 480, events: [{ name: 'session_start', n: 1, props: { w: 390 } }] }),
    })
    eq(ev.status, 204, '/api/e 还是 204')
    eq((await fetch(`${base}/dash`)).status, 401, '/dash 不带钥匙还是 401')
    eq((await fetch(`${base}/dash`, { headers: { authorization: AUTH } })).status, 200, '/dash 钥匙对还是 200')
    const health = await fetch(`${base}/healthz`)
    eq(`${health.status} ${health.headers.get('x-build') ? 'has-build' : 'no-build'}`, '200 has-build', '/healthz 200，还带着 x-build')
    const route = await fetch(`${base}/some/front/route`)
    check(route.status === 200 && (await route.text()).includes('<title>box</title>'), '前端路由还是回 index.html')
    const part = await fetch(`${base}/music/song.mp3`, { headers: { range: 'bytes=100-199' } })
    eq(`${part.status} ${part.headers.get('content-range')}`, '206 bytes 100-199/1000', '音乐的 Range 还是 206')
    await part.arrayBuffer()
    eq((await fetch(`${base}/api/box/list`)).status, 405, 'GET 信箱的接口：405（只走 POST）')
    const dash = await fetch(`${base}/dash`, { headers: { authorization: AUTH } })
    check((await dash.text()).includes('/dash/box'), '看板上有一块指向信箱审核页（一打开就看得见有多少条在等）')
    await kill(s)
  }
} finally {
  for (const s of servers) { try { s.proc.kill('SIGKILL') } catch { /* 已经没了 */ } }
  await sleep(200)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* Windows 上偶尔还占着 */ }
}

if (bad) {
  console.log(`\n✗ 玩家信箱有 ${bad} 处不对。`)
  process.exit(1)
}
console.log('\n✓ 玩家信箱：作者按「展示」之前别人一条都看不见，提交的人永远看得见自己那条；'
  + '「不展示」可逆、删除才是真删；一台设备一条一票、可以收回；带标签和引号的建议从头到尾都只是字；'
  + '限流按设备和 IP 都会响、盘上没有 IP；硬杀重启后条目、状态、票数一个不差；管理动作要钥匙、要同源；'
  + '/api/e、/dash、/healthz、前端路由和音乐的 Range 都没动。')
