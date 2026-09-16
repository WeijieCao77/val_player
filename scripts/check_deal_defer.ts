/**
 * 放着的报价：关掉的卡片（engine/me/aside.ts）。
 *
 * Reported 2026-09-14: 「转会报价的弹窗点不了关闭，如果玩家需要做一些思考再回来做决定这个关闭点不了就很不好，
 * 我们除了弹窗之外，转会栏目也要显示这次的报价，然后玩家点了关闭弹窗之后也可以在转会栏目找到这次报价」
 *
 *   一、关闭：报价、续约、试训邀请留在桌上，卡片从等着的事里拿掉，提示说了放在哪、还有几天
 *   二、放着的不挡路：推进照走，快进不被挡在门外，也不会每天自己弹回来
 *   三、从「转会」页回去谈：卡片回到最前面，点两次也只有一张，关掉再列还是一条
 *   四、到期前一天「本周」页提醒；最后一天还能答复，第二天下桌并写进日志；跨年也算得对
 *   五、续约放到过期＝没签：合同到期，成自由人，弹「自由人」卡
 *   六、托管照旧：「生涯」开着照样替你答复新来的卡，答法一模一样；放着的它不碰；没开照样挡在门外
 *   七、快进为快过期的放着的报价停一次，再按就照常推进，过期写进总结
 *   八、老存档读进来照常，也关得掉
 *
 *   npx tsx scripts/check_deal_defer.ts
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { declineDeal, expireDeals, makeDeal } from '../src/engine/me/contract'
import { declineInvite } from '../src/engine/me/tryout'
import { expireInvites, skillRead, skillReadCn, tryoutSkill, SKILL_READ_CN } from '../src/engine/me/prepro'
import { readFileSync } from 'node:fs'
import { push } from '../src/engine/me/pending'
import { asideItems, asideReminders, daysLeft, reopen, setAside } from '../src/engine/me/aside'
import { advanceUntil, autoResolve, runAutoPilot, runBlocked } from '../src/engine/me/auto'
import { advanceTurn } from '../src/engine/me/week'
import { MeMatch } from '../src/engine/me/matchplay'
import { migratePlayerSave } from '../src/engine/me/save'
import { packState, unpackState } from '../src/engine/save'
import { Rng, hashStr } from '../src/engine/rng'
import type { Deal, Invite } from '../src/engine/me/types'
import type { GameState } from '../src/engine/types'

const mem: Record<string, string> = {}
const G = globalThis as unknown as { localStorage: unknown; fetch: unknown }
G.localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
}
G.fetch = () => Promise.reject(new Error('offline'))

let bad = 0
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}
const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState

const career = (start: 'pre' | 't1', seed: number): GameState =>
  createCareer({ name: 'Aside', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed, year: 2026 })

/** clubs that could put something on the table */
const others = (s: GameState, n: number): string[] =>
  Object.values(s.teams)
    .filter((t) => t.id !== s.myTeam && !t.dormant && !t.id.startsWith('CUP_') && t.roster.length >= 5)
    .map((t) => t.id)
    .slice(0, n)

/** an offer with its card in front, the way the engine puts one there (me/transfer.ts, me/tryout.ts) */
function offer(s: GameState, teamId: string, kind: Deal['kind'] = 'transfer'): Deal {
  const d = makeDeal(s, teamId, kind, 'B', new Rng(hashStr(`aside:${teamId}:${kind}:${s.year}:${s.day}`)))
  s.me!.deals.push(d)
  push(s, { kind: 'deal', id: d.id })
  return d
}

function invite(s: GameState, teamId: string, id: string, direct = false): Invite {
  const inv: Invite = { id, teamId, via: 'scout', day: s.day, year: s.year, expires: s.day + 21, direct }
  s.me!.pre.invites.push(inv)
  push(s, { kind: 'invite', id })
  return inv
}

const name = (s: GameState, id: string): string => s.teams[id]?.name ?? id
const has = (s: GameState, d: Deal): boolean => s.me!.deals.some((x) => x.id === d.id)
const carded = (s: GameState, kind: 'deal' | 'invite', id: string): boolean => s.me!.pending.some((x) => x.kind === kind && x.id === id)
const lapsedLog = (s: GameState): string => s.me!.log.filter((l) => /过期了/.test(l.text)).slice(-1)[0]?.text ?? '（没写）'

/**
 * The clock, driven the way the week screen drives it: every card answered, matches played, nothing signed — so
 * nothing clears the table but time. Returns whichever of `watch` came up as a card, which is what an offer set
 * aside must never do.
 */
function roll(s: GameState, done: () => boolean, presses: number, watch: string[] = []): string[] {
  const me = s.me!
  const seen: string[] = []
  let guard = 0
  for (let i = 0; i < presses && guard < 200; i++) {
    let inner = 0
    while (me.pending.length && inner++ < 30 && guard++ < 200) {
      const it = me.pending[0]
      if (it.id && watch.includes(it.id) && !seen.includes(it.id)) seen.push(it.id)
      if (it.kind === 'deal') { declineDeal(s, it.id!); continue }
      if (it.kind === 'invite') { declineInvite(s, it.id!); continue }
      autoResolve(s, it)
    }
    if (done()) break
    const stop = advanceTurn(s)
    if (stop.kind === 'match') new MeMatch(s, stop.fixture).runOut()
    if (stop.kind === 'game-over') break
    if (done()) break
  }
  return seen
}

const t0 = Date.now()
const secs = (): string => `${((Date.now() - t0) / 1000).toFixed(0)} 秒`

/** a VCT career, kept aside as the pattern the rest of the sections are cut from */
const A = career('t1', 41)

console.log(`一、关闭：留在桌上，卡片拿掉 · ${secs()}`)
const s = clone(A)
const [buyer, second] = others(s, 2)
const deal = offer(s, buyer)
const inv = invite(s, second, 'aside:inv')
{
  check(carded(s, 'deal', deal.id), `${name(s, buyer)} 开了价，卡片在等着`)
  const line = setAside(s, 'deal', deal.id)
  check(has(s, deal), '关掉之后，报价还在桌上')
  check(!carded(s, 'deal', deal.id), '卡片从等着的事里拿掉了')
  check(line.includes('「转会」页') && line.includes('14 天内回来谈'), `提示说了放在哪、还有几天：${line}`)
  const items = asideItems(s)
  check(items.length === 1 && items[0].id === deal.id && items[0].left === 14, `「转会」页上列着一条，还有 ${items[0]?.left ?? '?'} 天`)
  const l2 = setAside(s, 'invite', inv.id)
  check(s.me!.pre.invites.some((x) => x.id === inv.id) && !carded(s, 'invite', inv.id), '试训邀请一样：留在桌上，卡片拿掉')
  check(l2.includes('试训邀请放在「转会」页') && l2.includes('21 天内回复'), `提示：${l2}`)
  check(asideItems(s).length === 2, '两条都列在「转会」页，一条只列一次')
}

console.log(`\n二、放着的不挡路 · ${secs()}`)
{
  check(!runBlocked(s), '快进没有被挡在门外')
  const day0 = s.day
  const stop = advanceTurn(s)
  const stuck = stop.kind === 'pending' && stop.item.kind === 'deal' && stop.item.id === deal.id
  check(!stuck, `推进没有停在放着的报价上（停在 ${stop.kind}）`)
  check(s.day > day0 || stop.kind === 'match', `时钟照走：第 ${day0} 天 → 第 ${s.day} 天`)
  // three more weeks, with plenty of time left on both, to see whether either comes back as a card by itself
  deal.expires = s.day + 60
  inv.expires = s.day + 60
  const back = roll(s, () => false, 3, [deal.id, inv.id])
  check(!back.length, '一路上没有再弹成卡片')
  check(has(s, deal) && s.me!.pre.invites.some((x) => x.id === inv.id), '也一直留在桌上')
  check(asideItems(s).filter((x) => x.id === deal.id || x.id === inv.id).length === 2, '「转会」页上还是这两条，没有重复')
}

console.log(`\n三、从「转会」页回去谈 · ${secs()}`)
{
  reopen(s, 'deal', deal.id)
  check(s.me!.pending[0]?.kind === 'deal' && s.me!.pending[0]?.id === deal.id, '「去谈」把卡片放回最前面')
  check(!asideItems(s).some((x) => x.id === deal.id), '卡片在前面时，它不再算「放着」，不会两处都列')
  reopen(s, 'deal', deal.id)
  check(s.me!.pending.filter((x) => x.kind === 'deal' && x.id === deal.id).length === 1, '点两次也只有一张卡')
  setAside(s, 'deal', deal.id)
  check(
    s.me!.deals.filter((x) => x.id === deal.id).length === 1 && asideItems(s).filter((x) => x.id === deal.id).length === 1 && !carded(s, 'deal', deal.id),
    '再关掉：报价还是一条，卡片不留',
  )
}

console.log(`\n四、到期前一天提醒，过期那天下桌 · ${secs()}`)
{
  const q = career('pre', 43)
  const me = q.me!
  const [a, b] = others(q, 2)
  const soon = invite(q, a, 'aside:soon')
  const far = invite(q, b, 'aside:far')
  setAside(q, 'invite', soon.id)
  setAside(q, 'invite', far.id)
  me.weekDay = 0
  soon.expires = q.day
  far.expires = q.day + 30
  const lines = asideReminders(q)
  check(lines.length === 1 && lines[0].includes('明天过期') && lines[0].includes(name(q, a)), `到期前一天提醒：${lines.join('；') || '（没有）'}`)
  soon.expires = q.day + 2
  check(asideReminders(q).some((l) => l.includes('3 天后过期')), '这一周里要过期的也提醒')
  check(asideReminders(q).every((l) => !l.includes(name(q, b))), '还早的不提醒')
  check(!me.pending.length && !runBlocked(q), '提醒只是一行字：没有卡片，也不挡快进')
  soon.expires = q.day
  expireInvites(q, 0)
  check(me.pre.invites.some((x) => x.id === soon.id), '最后一天还能回来答复')
  expireInvites(q, 1)
  check(
    !me.pre.invites.some((x) => x.id === soon.id) && me.log.some((l) => l.text.includes(name(q, a)) && /过期了/.test(l.text)),
    `第二天下桌，日志写了：${lapsedLog(q)}`,
  )

  // an offer, with the clock really walking past its day
  const t = clone(A)
  const [club] = others(t, 1)
  const d = offer(t, club)
  setAside(t, 'deal', d.id)
  d.expires = t.day + 3
  const back = roll(t, () => !has(t, d), 4, [d.id])
  check(!back.length, '过期之前没有把它弹成卡片')
  check(!has(t, d), '过了日子，报价自己从桌上下去')
  check(
    t.me!.log.some((l) => l.kind === 'deal' && l.text.includes(name(t, club)) && /过期了/.test(l.text)),
    `日志写了「…的报价过期了」：${lapsedLog(t)}`,
  )
  check(!carded(t, 'deal', d.id), '没有留下答不了、关不掉的卡')
}

console.log(`\n四、跨年的报价 · ${secs()}`)
{
  const y = clone(A)
  const [club] = others(y, 1)
  const d = offer(y, club)
  setAside(y, 'deal', d.id)
  // a winter offer: opened on day 360 of last year, fourteen days to answer — that is 1 月 10 日 this year
  d.year = y.year - 1
  d.day = 360
  d.expires = 374
  y.day = 5
  check(daysLeft(y, d) === 4, `跨年的报价还有 ${daysLeft(y, d)} 天`)
  expireDeals(y, 0)
  check(has(y, d), '没到日子不会提前过期')
  y.day = 10
  expireDeals(y, 0)
  check(!has(y, d), '到了日子的第二天才过期')
  // a save from before this kept no year of its own: the id it was written with says which
  const old = offer(y, club)
  setAside(y, 'deal', old.id)
  old.id = 'deal:2025:360:OLD:transfer'
  old.day = 360
  old.expires = 374
  delete (old as { year?: number }).year
  y.day = 5
  check(daysLeft(y, old) === 4, `老存档没有年份这一项，按 id 里的年份算：还有 ${daysLeft(y, old)} 天`)
}

console.log(`\n五、续约放到过期＝没签 · ${secs()}`)
{
  const r = career('t1', 45)
  const me = r.me!
  const club = r.myTeam
  const d = offer(r, club, 'renew')
  setAside(r, 'deal', d.id)
  d.expires = r.day
  expireDeals(r, 1)
  check(!has(r, d) && me.phase === 'free' && r.myTeam === '', `续约放到过期：合同到期，成了自由人（现在 ${me.phase}）`)
  check(me.pending.some((x) => x.kind === 'released'), '弹了「自由人」卡，说清楚发生了什么')
  check(me.log.some((l) => l.text.includes('续约过期了')), `日志：${me.log.slice(-2).map((l) => l.text).join(' / ')}`)
}

console.log(`\n六、托管照旧 · ${secs()}`)
{
  const [club] = others(A, 1)
  const s1 = clone(A)
  const d1 = offer(s1, club)
  s1.me!.auto.career = true
  const did = runAutoPilot(s1)
  const s2 = clone(A)
  const d2 = offer(s2, club)
  const line = autoResolve(s2, s2.me!.pending[0])
  check(d1.id === d2.id, '两边是同一份报价')
  check(!s1.me!.deals.length && did.includes(line), `托管「生涯」照样替你答复新来的卡：${did.join('；') || '（什么也没做）'}`)
  check(s1.myTeam === s2.myTeam && s1.me!.phase === s2.me!.phase, '答法和以前一模一样')

  const s3 = clone(A)
  const d3 = offer(s3, club)
  setAside(s3, 'deal', d3.id)
  s3.me!.auto.career = true
  const none = runAutoPilot(s3)
  check(has(s3, d3) && !carded(s3, 'deal', d3.id) && !none.length, `放着的报价是你的：托管「生涯」不替你答复（它做了 ${none.length} 件事）`)

  const s4 = clone(A)
  const d4 = offer(s4, club)
  s4.me!.auto.career = false
  const r4 = advanceUntil(s4, 'season')
  check(
    r4.weeks === 0 && r4.stop.kind === 'pending' && r4.stop.item.id === d4.id,
    `托管「生涯」没开：没关掉的报价卡照样把快进挡在门外（停在 ${r4.stop.kind}，${r4.weeks} 周）`,
  )
}

console.log(`\n七、快进为它停一次 · ${secs()}`)
{
  const f = clone(A)
  const me = f.me!
  me.auto = { buy: false, biz: true, daily: true, career: false }
  me.weekDay = 0
  const [club] = others(f, 1)
  const d = offer(f, club)
  setAside(f, 'deal', d.id)
  d.expires = f.day + 10
  let stops = 0
  let reminded = 0
  const lapsed: string[] = []
  let guard = 0
  while (guard++ < 10 && has(f, d)) {
    const r = advanceUntil(f, 'stage')
    if (r.aside) {
      stops++
      check(r.aside.includes(name(f, club)) && /过期/.test(r.aside), `停下来时说清了是哪一份：${r.aside}`)
      if (asideReminders(f).length) reminded++
    }
    for (const n of r.notes) if (/过期了/.test(n)) lapsed.push(n)
    if (r.stop.kind === 'match') { new MeMatch(f, r.stop.fixture).runOut(); continue }
    if (r.stop.kind === 'game-over') break
    if (r.stop.kind === 'pending') {
      const it = r.stop.item
      if (it.kind === 'deal' && it.id === d.id) { check(false, '放着的报价又变回卡片，把快进挡住了'); break }
      if (it.kind === 'deal') { declineDeal(f, it.id!); continue }
      if (it.kind === 'invite') { declineInvite(f, it.id!); continue }
      autoResolve(f, it)
    }
  }
  check(stops === 1, `快进为它停了 ${stops} 次（要 1 次：停一次，再按就照常推进）`)
  check(reminded === stops, '停下来的那一周，「本周」页也有提醒')
  check(!has(f, d), '接着推进，报价到了日子自己过期')
  check(lapsed.length >= 1, `过期写进了推进总结：${lapsed[0] ?? '（没写）'}`)
}

console.log(`\n八、老存档 · ${secs()}`)
{
  const o = clone(A)
  const [club] = others(o, 1)
  const d = offer(o, club)
  // a save written before this build: no year of its own on the offer
  delete (d as { year?: number }).year
  const loaded = migratePlayerSave(unpackState(packState(o)))
  const me = loaded.me!
  check(me.deals.length === 1 && carded(loaded, 'deal', d.id), '老存档读进来：桌上的报价和它的卡片都在')
  check(daysLeft(loaded, me.deals[0]) === 14, `还有 ${daysLeft(loaded, me.deals[0])} 天，和存档时一样`)
  check(!!runBlocked(loaded), '没关掉的卡还是照样等你拿主意')
  const line = setAside(loaded, 'deal', me.deals[0].id)
  check(
    line.includes('「转会」页') && me.deals.length === 1 && !me.pending.some((x) => x.kind === 'deal'),
    `老存档里也关得掉：${line}`,
  )
}

console.log(`\n九、「他们眼里的你」：拆开的数加起来就是卡上的数 · ${secs()}`)
{
  const w = clone(A)
  const me = w.me!
  const p = w.players[me.id]
  for (const [tac, ladder] of [[0, 0], [37, 63], [60, 100], [23, 41]] as [number, number][]) {
    me.pre.tac = tac
    me.pre.ladder = ladder
    const r = skillRead(w)
    check(r.shown === Math.round(tryoutSkill(w)), `战术素养 ${tac}、天梯 ${ladder}：卡上的数就是签约看的那个数（${r.shown}）`)
    check(r.overall + r.tac + r.ladder + r.igl === r.shown, `拆开的数加起来正好是 ${r.shown}：${skillReadCn(r)}`)
    check(r.overall === Math.round(p.overall), `「综合」就是「我的」页上那个综合 ${Math.round(p.overall)}`)
  }
  check(skillReadCn(skillRead(w)).startsWith('综合'), '拆解从综合说起')
  for (const word of ['综合', '战术素养', '天梯', '指挥']) check(SKILL_READ_CN.includes(word), `数值关掉时的说法点名了${word}`)
  // one helper, not a second copy of the formula on the screens
  const files = ['src/ui/me/Modals.tsx', 'src/ui/me/TransferScreen.tsx', 'src/ui/me/MeScreen.tsx', 'src/ui/me/Week.tsx', 'src/PlayerGame.tsx']
  const src: Record<string, string> = {}
  for (const f of files) src[f] = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
  for (const f of files) check(!/pre\.tac\s*\*|ladder\s*\*\s*0\.05|callerRead\s*\(/.test(src[f]), `${f} 没有再抄一遍公式`)
  for (const f of ['src/ui/me/Modals.tsx', 'src/ui/me/TransferScreen.tsx']) {
    check(src[f].includes('skillRead'), `${f} 用的是同一个拆解`)
    check(src[f].includes('他们眼里的你'), `${f} 说清了这是谁眼里的数`)
  }
  check(src['src/ui/me/MeScreen.tsx'].includes('战术素养'), '「我的」页上看得到战术素养')
}

if (bad) {
  console.log(`\n✗ 放着的报价有 ${bad} 处不对。 · ${secs()}`)
  process.exit(1)
}
console.log(`\n✓ 关掉的报价放在「转会」页，不挡路、不重弹；到期前一天提醒，过期就下桌；托管照旧，老存档照常。 · ${secs()}`)
