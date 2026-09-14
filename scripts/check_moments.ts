/**
 * The big moments' queue (me/moments.ts), headless.
 *
 * Two careers played by 托管 — 2026 from the ladder, 2021 from a second-tier club —
 * with the queue taken every week, the way the full-screen card takes it. Then:
 *
 *  - a career that opens at its club opens with no signing card
 *  - no moment comes twice (by key)
 *  - every title I started in has its card, and none won from the bench does
 *  - every award won has its card
 *  - every signing card names a club the career really joined
 *  - a big ladder tier comes at most once, and its flag is set
 *  - the queue keeps a dozen at most, the newest
 *  - a save from before the queue (no field) plays on
 *
 *   npx tsx scripts/check_moments.ts [seasons=3]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { CareerOpts } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { BIG_TIERS, MOMENTS_CAP, pushMoment } from '../src/engine/me/moments'
import type { MomentItem } from '../src/engine/me/types'
import type { GameState } from '../src/engine/types'

const mem: Record<string, string> = {}
const G = globalThis as unknown as { localStorage: unknown; fetch: unknown }
G.localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
}
G.fetch = () => Promise.reject(new Error('offline'))

const seasons = Number(process.argv[2] ?? 3)
let bad = 0
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}

function play(label: string, o: Partial<CareerOpts>): { state: GameState; seen: MomentItem[]; clubsAtStart: number } {
  const t0 = Date.now()
  const state = createCareer({ name: 'Moments', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', ...o } as CareerOpts)
  const me = state.me!
  const p = state.players[me.id]
  const clubsAtStart = p.clubHist?.length ?? 0
  if (o.start !== 'pre') check((me.moments?.length ?? 0) === 0, `${label}：开局就在俱乐部，第一屏没有签约卡`)
  const seen: MomentItem[] = []
  const until = state.year + seasons
  let weeks = 0
  while (me.phase !== 'retired' && state.year < until && weeks++ < 70 * seasons) {
    if (autoWeek(state).kind === 'game-over') break
    // taken each week, as the card does
    if (me.moments?.length) { seen.push(...me.moments); me.moments = [] }
  }
  console.log(`${label}：${state.year} 年停 · ${me.titles.length} 冠（首发 ${me.titles.filter((t) => t.started).length}）· 奖 ${(me.awards ?? []).filter((a) => a.won).length} · 待过 ${p.clubHist?.length ?? 0} 家 · 大事卡 ${seen.length} 张（${seen.map((m) => m.kind).join('、') || '无'}）· ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  return { state, seen, clubsAtStart }
}

function judge(label: string, r: ReturnType<typeof play>): void {
  const { state, seen, clubsAtStart } = r
  const me = state.me!
  const p = state.players[me.id]
  const keys = seen.map((m) => m.key)
  check(new Set(keys).size === keys.length, `${label}：没有一张卡出两次（${keys.length} 张）`)
  const started = me.titles.filter((t) => t.started)
  const titleCards = seen.filter((m) => m.kind === 'title')
  check(titleCards.length === started.length && started.every((t) => keys.includes(`title:${t.year}:${t.title}`)),
    `${label}：首发拿的 ${started.length} 个冠军各一张卡，替补席上的没有（${titleCards.length} 张）`)
  const won = (me.awards ?? []).filter((a) => a.won)
  check(seen.filter((m) => m.kind === 'award').length === won.length, `${label}：拿到的 ${won.length} 个年度奖项各一张卡`)
  const joined = new Set((p.clubHist ?? []).slice(clubsAtStart).map((h) => h.team))
  const signs = seen.filter((m) => m.kind === 'sign')
  check(signs.every((m) => !!m.teamId && joined.has(m.teamId)) && signs.length <= (p.clubHist?.length ?? 0) - clubsAtStart,
    `${label}：${signs.length} 张签约卡都是真的加盟过的俱乐部（开局之后待过 ${(p.clubHist?.length ?? 0) - clubsAtStart} 家）`)
  const ranks = seen.filter((m) => m.kind === 'rank')
  check(ranks.length <= BIG_TIERS.length && new Set(ranks.map((m) => m.tier)).size === ranks.length && ranks.every((m) => !!me.flags[`reached:${m.tier}`]),
    `${label}：天梯大段位每个最多一张（${ranks.map((m) => m.rank).join('、') || '没到'}）`)
}

const A = play('A 2026 天梯 中国', { seed: 11, year: 2026, start: 'pre' })
judge('A', A)
const B = play('B 2021 二线 欧洲', { seed: 7, year: 2021, region: 'EMEA', start: 'chal' })
judge('B', B)

// the cap: the newest dozen stay
{
  const s = B.state
  s.me!.moments = []
  for (let i = 0; i < 20; i++) pushMoment(s, { kind: 'rank', key: `cap:${i}` })
  const list = s.me!.moments ?? []
  check(list.length === MOMENTS_CAP && list[0].key === `cap:${20 - MOMENTS_CAP}` && list[list.length - 1].key === 'cap:19', `队列最多留 ${MOMENTS_CAP} 张，留最新的`)
  pushMoment(s, { kind: 'rank', key: 'cap:19' })
  check((s.me!.moments ?? []).length === MOMENTS_CAP, '同一个 key 不会再进一次')
}

// a save from before the queue
{
  const s = A.state
  delete s.me!.moments
  let ok = true
  try { for (let i = 0; i < 3 && s.me!.phase !== 'retired'; i++) autoWeek(s) } catch { ok = false }
  check(ok, '没有这个字段的老存档照样往下打')
}

if (bad) {
  console.log(`\n✗ 大事卡队列有 ${bad} 处不对。`)
  process.exit(1)
}
console.log('\n✓ 冠军、签约、年度奖项、天梯大段位各出一次卡，开局不弹，队列有上限，老存档不受影响。')
