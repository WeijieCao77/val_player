/**
 * The invitation and tryout cards under 托管, headless (found 2026-09-14 by the talent probe).
 *
 *  - two clubs ask on the same day: the second invite no longer sits at the head of the
 *    list for ever while the first club's tryout waits behind it (me/auto.ts)
 *  - signing elsewhere takes the invitation and tryout cards with it, so none is left that
 *    cannot be answered or closed (me/contract.ts joinClub)
 *  - by hand, the card on screen (found 2026-09-18 walking a ladder career): 去试训 on the
 *    first of two invitations opens that tryout, not the second club's card; a tryout passed
 *    opens its contract, and so does 看合同 on a 免试训 offer (me/pending.ts pushFront)
 *
 *   npx tsx scripts/check_tryout_queue.ts
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoResolve } from '../src/engine/me/auto'
import { startTryout, tryoutChoose, tryoutDays } from '../src/engine/me/tryout'
import { cerSkip } from '../src/engine/me/ceremony'
import { push } from '../src/engine/me/pending'
import { acceptDeal, makeDeal } from '../src/engine/me/contract'
import type { Invite } from '../src/engine/me/types'
import type { GameState } from '../src/engine/types'
import { Rng, hashStr } from '../src/engine/rng'

const mem: Record<string, string> = {}
const G = globalThis as unknown as { localStorage: unknown; fetch: unknown }
G.localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
}
G.fetch = () => Promise.reject(new Error('offline'))

let bad = 0
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}

const fresh = (seed: number): GameState =>
  createCareer({ name: 'Queue', region: 'EMEA', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed, year: 2026 })

/** the weakest second-tier clubs of the career's region: the ones a ladder player's tryout is worth taking */
function weakClubs(state: GameState, n: number): string[] {
  return Object.values(state.teams)
    .filter((t) => !t.dormant && t.tier === 2 && t.region === state.me!.region)
    .sort((a, b) => a.rating - b.rating)
    .slice(0, n)
    .map((t) => t.id)
}

function invite(state: GameState, teamId: string, id: string): Invite {
  const inv: Invite = { id, teamId, via: 'scout', day: state.day, expires: state.day + 14, direct: false }
  state.me!.pre.invites.push(inv)
  push(state, { kind: 'invite', id })
  return inv
}

const cardsLeft = (state: GameState) => state.me!.pending.filter((x) => x.kind === 'invite' || x.kind === 'tryout').length

// ------------------------------------------------------------------ two invites, one day
{
  const state = fresh(21)
  const me = state.me!
  const [a, b] = weakClubs(state, 2)
  check(!!a && !!b, `找到两家二线俱乐部（${state.teams[a]?.name ?? '无'}、${state.teams[b]?.name ?? '无'}）`)
  const first = invite(state, a, 'q:first')
  const second = invite(state, b, 'q:second')
  // the first club's tryout starts before 托管 gets to the list: the second invite is now in front of its card
  startTryout(state, first.id)
  const order = me.pending.map((x) => `${x.kind}:${x.id}`).join(' → ')
  let repeats = 0
  let last = ''
  let steps = 0
  while (cardsLeft(state) && steps++ < 30) {
    const head = me.pending.find((x) => x.kind === 'invite' || x.kind === 'tryout')!
    const key = `${head.kind}:${head.id}`
    repeats = key === last ? repeats + 1 : 0
    last = key
    if (repeats > 3) break
    autoResolve(state, head)
  }
  check(repeats <= 3, `同一天两份邀请（${order}）：托管不会卡在同一张卡上`)
  check(cardsLeft(state) === 0 && !me.tryout, `${steps} 步之内，邀请和试训卡都清完了，没有挂着的试训`)
  void second
}

// ------------------------------------------------------------------ signed elsewhere mid-tryout
{
  const state = fresh(22)
  const me = state.me!
  const [a, b] = weakClubs(state, 2)
  const inv = invite(state, a, 'q:tryout')
  startTryout(state, inv.id)
  invite(state, b, 'q:other')
  const before = cardsLeft(state)
  const deal = makeDeal(state, b, 'sign', 'B', new Rng(hashStr('queue:deal')))
  me.deals.push(deal)
  push(state, { kind: 'deal', id: deal.id })
  const said = acceptDeal(state, deal.id)
  check(before >= 2 && me.phase === 'pro', `试训途中签下另一家（${said}）`)
  check(cardsLeft(state) === 0 && !me.tryout && me.pre.invites.length === 0, '签约后没有留下答不了、关不掉的邀请卡和试训卡')
}

// ------------------------------------------------------------------ by hand: the card on screen
{
  const state = fresh(23)
  const me = state.me!
  const [a, b] = weakClubs(state, 2)
  const first = invite(state, a, 'q:hand-first')
  const second = invite(state, b, 'q:hand-second')
  // what PlayerGame puts up: the head of the list (the night before day one is a card of its own, ahead of day one)
  const onScreen = () => me.pending[0]
  const key = (x?: { kind: string; id?: string }) => (x ? `${x.kind}:${x.id ?? ''}` : '无')
  check(key(onScreen()) === `invite:${first.id}`, `两份邀请同一天到：先看到的是 ${state.teams[a].name} 的（${key(onScreen())}）`)
  const why = startTryout(state, first.id)
  check(!why, '点「去试训」接下第一家')
  if (onScreen()?.kind === 'ceremony') cerSkip(state)
  check(key(onScreen()) === `tryout:${first.id}`, `接下来是这一家的试训，不是另一家的邀请卡（${key(onScreen())}）`)
  // passed: the four days on the steady picks, with an impression good enough that the grade is a pass whatever the draws
  me.tryout!.score = 40
  let guard = 0
  while (me.tryout && guard++ < 6) tryoutChoose(state, tryoutDays(state)[me.tryout.step].rec)
  const deal = me.deals.find((d) => d.teamId === a)
  check(!!deal, `试训过了，${state.teams[a].name} 给了合同`)
  check(!!deal && key(onScreen()) === `deal:${deal.id}`, `试训一过，下一张就是这份合同（${key(onScreen())}）`)
  check(me.pending.some((x) => x.kind === 'invite' && x.id === second.id), `${state.teams[b].name} 的邀请还在，排在合同后面`)
}
{
  const state = fresh(24)
  const me = state.me!
  const [a, b] = weakClubs(state, 2)
  const direct = invite(state, a, 'q:hand-direct')
  direct.direct = true
  invite(state, b, 'q:hand-behind')
  startTryout(state, direct.id)
  const deal = me.deals.find((d) => d.teamId === a)
  check(!!deal && me.pending[0]?.kind === 'deal' && me.pending[0]?.id === deal.id, `免试训的报价点「看合同」，下一张就是这份合同（${me.pending[0]?.kind}）`)
}

if (bad) {
  console.log(`\n✗ 邀请和试训的卡片有 ${bad} 处不对。`)
  process.exit(1)
}
console.log('\n✓ 同一天两份邀请不会卡住托管，签约后不留试训卡；接下的试训和过了试训的合同都是下一张卡。')
