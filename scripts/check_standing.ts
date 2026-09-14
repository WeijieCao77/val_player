/**
 * Where I stand with the coach (me/coach.ts), headless — two player reports of 2026-09-14:
 *   「本周栏目里写着教练对你完全信任，但是在队伍栏目和轮换竞争者的地方写着教练没把你当自己人」
 *   「拿了世界冠军fmvp但是一样被轮换」
 *
 *  - a trusted starter never put on trial is never called a newcomer, and after PROVEN_STARTS
 *    starts he is the coach's own; both screens say the same sentence
 *  - starts alone, with trust short of 「信任」, do not make him the coach's own
 *  - a title won as a starter: trust up, his own starter, and a run of starts after it in which
 *    losing as the worst of the five costs no place
 *  - a trusted starter of his own is never rotated out to try another five; one the coach is
 *    still unsure of can be
 *  - three nights as the worst of the five still cost the place once the grace is over
 *
 *   npx tsx scripts/check_standing.ts
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { CareerOpts } from '../src/engine/me/career'
import { GRACE_BIG, GRACE_FMVP, PROVEN_STARTS, PROVEN_TRUST, afterMyMatch, coachAfterTitle, standingLine } from '../src/engine/me/coach'
import type { MeMatchRecord } from '../src/engine/me/types'
import type { GameState } from '../src/engine/types'

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

/** a starter at a VCT club, never on trial, nothing counted yet */
function fresh(seed: number): GameState {
  const s = createCareer({ name: 'Stand', region: 'EMEA', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', year: 2026, seed } as CareerOpts)
  const me = s.me!
  const team = s.teams[s.myTeam]
  if (!team.starters.includes(me.id)) team.starters = [me.id, ...team.starters.filter((id) => id !== me.id).slice(0, 4)]
  me.proven = false
  me.trial = undefined
  me.benchLock = undefined
  me.badStreak = 0
  me.rotateHeat = 0
  me.startsHere = 0
  me.graceMatches = 0
  return s
}

let fx = 0
const rec = (s: GameState, o: Partial<MeMatchRecord>): MeMatchRecord => ({
  fixtureId: `standing-${fx++}`, day: s.day, year: s.year, comp: 'probe', label: '', opp: 'Probe', oppTag: 'PRB',
  started: true, won: true, score: '2-0', maps: 2, rounds: 44, kills: 30, deaths: 28, assists: 10,
  firstKills: 3, clutches: 1, acs: 200, rating: 1, mvp: false, carried: false, nodes: [], rank: 3,
  ...o,
})
const locked = (s: GameState) => !!s.me!.benchLock && s.me!.benchLock > s.day

console.log('完全信任、从没打过试用期的首发')
{
  const s = fresh(5)
  const me = s.me!
  me.coachTrust = 85
  const week = standingLine(s, 'week')
  const team = standingLine(s, 'team')
  check(!/新人|自己人/.test(week + team), `两处都不说「新人」「没当自己人」：「${team}」`)
  for (let i = 0; i < PROVEN_STARTS; i++) { s.day++; afterMyMatch(s, rec(s, { won: true, rank: 2 })) }
  check(me.proven, `以首发打满 ${PROVEN_STARTS} 场、信任 ${Math.round(me.coachTrust)}：成了教练认定的首发`)
  check(standingLine(s, 'week') === standingLine(s, 'team') && standingLine(s, 'team').includes('认定'), `本周页和队伍页说同一句：「${standingLine(s, 'team')}」`)
}

console.log('信任没到「信任」的首发')
{
  const s = fresh(7)
  const me = s.me!
  me.coachTrust = 50
  for (let i = 0; i < PROVEN_STARTS * 2; i++) { s.day++; afterMyMatch(s, rec(s, { won: i % 2 === 0, rank: 3 })) }
  check(me.coachTrust < PROVEN_TRUST && !me.proven, `打了 ${PROVEN_STARTS * 2} 场、信任 ${Math.round(me.coachTrust)}：还不是认定的首发`)
  check(standingLine(s, 'team').includes('观察') && !/自己人|新人/.test(standingLine(s, 'week')), `说教练还在观察，写明差什么：「${standingLine(s, 'team')}」`)
}

console.log('首发拿下冠军赛、决赛 MVP')
{
  const s = fresh(9)
  const me = s.me!
  me.coachTrust = 60
  coachAfterTitle(s, 'champions', true)
  check(me.proven, '成了教练认定的首发')
  check(Math.round(me.coachTrust) === 74, `信任 60 → ${Math.round(me.coachTrust)}（冠军赛 +10、决赛 MVP +4）`)
  check(me.graceMatches === GRACE_BIG + GRACE_FMVP, `之后 ${GRACE_BIG + GRACE_FMVP} 场正赛有保护：${me.graceMatches}`)
  const grace = me.graceMatches ?? 0
  let out = 0
  for (let i = 0; i < grace - 1; i++) {
    s.day++
    afterMyMatch(s, rec(s, { won: false, rank: 5 }))
    if (locked(s)) { out++; me.benchLock = undefined }
  }
  check(out === 0, `保护期里连输 ${grace - 1} 场、场场全队最差：没被换下，也没被拿去试新阵容`)
}

console.log('输球时拿谁试新阵容')
{
  const s = fresh(11)
  const me = s.me!
  me.proven = true
  let rotated = 0
  for (let i = 0; i < 40; i++) {
    s.day++
    me.coachTrust = 90
    afterMyMatch(s, rec(s, { won: false, rank: 4 }))
    if (locked(s)) { rotated++; me.benchLock = undefined }
  }
  check(rotated === 0, `认定的首发、信任 90：输 40 场、都排第四，一次也没被拿去试新阵容（${rotated}）`)

  const u = fresh(13)
  const um = u.me!
  let r2 = 0
  for (let i = 0; i < 40; i++) {
    u.day++
    um.coachTrust = 50
    afterMyMatch(u, rec(u, { won: false, rank: 4 }))
    if (locked(u)) { r2++; um.benchLock = undefined }
  }
  check(r2 > 0, `还不是认定的首发、信任 50：同样输 40 场，被换下去试新阵容 ${r2} 次，这条规则还在`)
}

console.log('保护期过了')
{
  const s = fresh(15)
  const me = s.me!
  me.proven = true
  me.coachTrust = 90
  me.graceMatches = 0
  for (let i = 0; i < 3; i++) { s.day++; afterMyMatch(s, rec(s, { won: false, rank: 5 })) }
  check(locked(s), '连着三场输球又是全队最差：照样换下两周')
}

if (bad) {
  console.log(`\n${bad} 项没过`)
  process.exit(1)
}
console.log('\n全部通过')
