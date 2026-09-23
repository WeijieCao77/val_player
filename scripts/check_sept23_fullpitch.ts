/** Full-7 self-pitch admission and reply revalidation, focused. */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { abroadClub, makeInvite } from '../src/engine/me/prepro'
import { makeDeal, acceptDeal, settleMove, joinClub } from '../src/engine/me/contract'
import { pitchClubBlock, pitchDay, pitchHit, pitchPool, sendPitch } from '../src/engine/me/selfpitch'
import { pitchBook } from '../src/engine/me/pitchbook'
import { push } from '../src/engine/me/pending'
import { todayAbs, windowAt } from '../src/engine/me/window'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState, Team } from '../src/engine/types'
import { recomputeOverall } from '../src/engine/player'
import { Rng } from '../src/engine/rng'
import { stagesOf } from '../src/engine/era'
import { startTryout, tryoutChoose, tryoutDays } from '../src/engine/me/tryout'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] },
  clear: () => {},
  key: () => null,
  length: 0,
} as unknown as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const expectBug = process.argv.includes('--expect-bug')

const create2021 = (seed: number): GameState =>
  createCareer({ name: 'FullPitch', region: 'Europe', role: '控场', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed, year: 2021 })

function setAttrs(s: GameState, id: string, level: number): void {
  const p = s.players[id]
  for (const k of ATTR_KEYS) p.attrs[k] = Math.max(p.attrs[k], level)
  recomputeOverall(p)
  p.overall = level
}

function setMe(s: GameState, overall: number): void {
  const me = s.me!
  setAttrs(s, me.id, overall)
  me.ap = 12
  me.phase = 'free'
  me.pre.invites = []
  me.tryout = undefined
  me.moveAfter = undefined
  me.flags.signedPeriod = 0
  me.flags.lang = 1
}

function pickTarget(s: GameState): Team {
  const t = pitchPool(s).find((x) => x.tier === 2 && x.region === 'Europe' && x.roster.length >= 5 && x.id !== s.myTeam)
  assert.ok(t, 'need tier2 club with 7 roster players')
  return t!
}

function setupFull(s: GameState, target: Team): { starters: string[]; benchWeak: string; benchStrong: string } {
  while(target.roster.length<7){
    const q=structuredClone(s.players[target.roster[0]])
    q.id=`FULL_BENCH_${target.roster.length}`;q.ign=q.id;q.teamId=target.id;q.retiring=false
    s.players[q.id]=q;target.roster.push(q.id)
  }
  const roster = target.roster.slice(0, 7)
  target.roster = roster
  target.starters = roster.slice(0, 5)
  target.budget = 10_000_000
  const starters = roster.slice(0, 5)
  const benchWeak = roster[5]
  const benchStrong = roster[6]
  for (const id of starters) s.players[id].overall = 95
  s.players[benchWeak].overall = 60
  s.players[benchStrong].overall = 65
  return { starters, benchWeak, benchStrong }
}

function findOpen(s: GameState, target: Team, wantGate: (s: GameState, t: Team) => string | null = () => null): number {
  for (let d = 0; d <= 363; d++) {
    s.day = d
    if (windowAt(s, target.id).open && (wantGate(s, target) === null)) return d
  }
  return -1
}

function findClosed(s: GameState, target: Team): number {
  for (let d = 0; d <= 363; d++) {
    s.day = d
    if (!windowAt(s, target.id).open) return d
  }
  return -1
}

/** Actual old-save calendar: unlike 2021's open era, it has non-lock closed spans. */
function legacyCalendar(s: GameState, target: Team): void {
  s.year=2026;s.bridged=true;s.comps={};s.fixtures=[]
  target.tier=1;target.league='VCT EMEA'
}

// 1. strong full send should pass the helper (after fix), or be blocked with --expect-bug
{
  const s = create2021(100)
  setMe(s, 97)
  const target = pickTarget(s)
  setupFull(s, target)
  const day = findOpen(s, target)
  if (expectBug) {
    assert.match(sendPitch(s, target.id) ?? '', /名单满了/)
    console.log('REPRODUCED: eligible strong player cannot pitch to a full roster');process.exit(0)
  } else {
    assert.ok(day >= 0, 'expected an open day where strong full send passes its gate')
    s.day = day
    assert.strictEqual(sendPitch(s, target.id), null)
    assert.strictEqual(target.roster.length, 7)
    assert.ok(pitchBook(s).out?.teamId === target.id)
  }
}

// 2. weak full still rejects
{
  const s = create2021(101)
  setMe(s, 64)
  const target = pickTarget(s)
  setupFull(s, target)
  const day = findOpen(s, target)
  assert.ok(day >= 0, 'need an open day')
  s.day = day
  const why = sendPitch(s, target.id)
  assert.ok(why !== null && why.includes('名单已满'), `weak full should reject with full reason, got: ${why}`)
}

// 3. import blocked
{
  const s = create2021(102)
  setMe(s, 97)
  const target = pickTarget(s)
  setupFull(s, target)
  s.importLimit = true
  const p = s.players[s.me!.id]
  p.nat = 'us'
  for (const id of target.roster) {
    const q = s.players[id]
    if (q) q.nat = 'us'
  }
  const day = findOpen(s, target)
  assert.ok(day >= 0)
  s.day = day
  const why = sendPitch(s, target.id)
  assert.ok(why !== null && why.includes('外援'), `import should block, got: ${why}`)
}

// 4. foreign language blocked
{
  const s = create2021(103)
  setMe(s, 97)
  const target = pitchPool(s).find((x) => x.tier === 2 && x.roster.length >= 5 && abroadClub(s, x) && x.id !== s.myTeam)
  assert.ok(target, 'need an abroad tier2 club with 7 players')
  setupFull(s, target!)
  s.me!.flags.lang = 0
  const day = findOpen(s, target!)
  assert.ok(day >= 0)
  s.day = day
  const why = sendPitch(s, target!.id)
  assert.ok(why !== null && why.includes('外语'), `foreign language should block, got: ${why}`)
}

// 5. closed window blocked
{
  const s = create2021(104)
  setMe(s, 97)
  const target = pickTarget(s)
  setupFull(s, target)
  legacyCalendar(s, target)
  const day = findClosed(s, target)
  assert.ok(day >= 0, 'need a closed day')
  s.day = day
  const why = sendPitch(s, target.id)
  assert.ok(why !== null && /窗口/.test(why), `closed window should block, got: ${why}`)
}

// 6. successful reply with actual deterministic seed
{
  const found = (() => {
    for (let seed = 2000; seed < 4000; seed++) {
      const s = create2021(seed)
      setMe(s, 97)
      const target = pickTarget(s)
      setupFull(s, target)
      const day = findOpen(s, target, pitchClubBlock)
      if (day < 0) continue
      s.day = day
      if (sendPitch(s, target.id) !== null) continue
      const out = s.me!.pitch!.out
      if (out && pitchHit(s, out)) return { s, target, seed }
    }
    throw new Error('no seed with pitchHit true found')
  })()
  const out = found.s.me!.pitch!.out!
  out.due = todayAbs(found.s)
  pitchDay(found.s)
  assert.ok(found.s.me!.pre.invites.some((i) => i.via === 'self' && i.teamId === found.target.id), `seed ${found.seed}: successful reply should create self invite`)
  assert.ok(!found.s.me!.deals.some((d) => d.teamId === found.target.id), 'free self pitch should not directly create a deal')
}

// 7. roster strength change before reply cancels
{
  const s = create2021(105)
  setMe(s, 97)
  const target = pickTarget(s)
  const { benchWeak, benchStrong } = setupFull(s, target)
  const day = findOpen(s, target, pitchClubBlock)
  assert.ok(day >= 0)
  s.day = day
  assert.strictEqual(sendPitch(s, target.id), null)
  s.players[benchWeak].overall = 95
  s.players[benchStrong].overall = 95
  const out = s.me!.pitch!.out!
  out.due = todayAbs(s)
  pitchDay(s)
  assert.ok(!s.me!.pre.invites.some((i) => i.via === 'self' && i.teamId === target.id), 'no invite after roster strength change')
  assert.ok(!s.me!.deals.some((d) => d.teamId === target.id), 'no deal after roster strength change')
  assert.strictEqual(s.me!.pitch!.tally.cancelled, 1)
  assert.ok(s.me!.log.some((l) => l.text.includes('变故')), 'concrete reason should be logged')
}

// 8. failed acceptDeal preserves full JSON of offers/pending/RNG
{
  const s = create2021(106)
  setMe(s, 97)
  const target = pickTarget(s)
  const { benchWeak, benchStrong } = setupFull(s, target)
  const deal = makeDeal(s, target.id, 'sign', 'A', new Rng(11))
  deal.selfPitched = true
  s.me!.deals = [deal]
  push(s, { kind: 'deal', id: deal.id })
  s.players[benchWeak].overall = 95
  s.players[benchStrong].overall = 95
  const dealsBefore = JSON.stringify(s.me!.deals)
  const pendingBefore = JSON.stringify(s.me!.pending)
  const rosterBefore = JSON.stringify([...target.roster])
  const seedBefore = s.seed
  const fullBefore = JSON.stringify(s)
  const result = acceptDeal(s, deal.id)
  assert.equal(JSON.stringify(s), fullBefore, 'failed accept must not mutate any state')
  assert.ok(!result.includes('你签进了'), result)
  assert.strictEqual(JSON.stringify(s.me!.deals), dealsBefore)
  assert.strictEqual(JSON.stringify(s.me!.pending), pendingBefore)
  assert.strictEqual(JSON.stringify([...target.roster]), rosterBefore)
  assert.strictEqual(s.seed, seedBefore)
}

// 9. happy accept keeps original 5 starters, cap 7, only weak bench released
{
  const s = create2021(107)
  setMe(s, 97)
  const target = pickTarget(s)
  const { starters, benchWeak, benchStrong } = setupFull(s, target)
  assert.ok(findOpen(s, target) >= 0)
  const deal = makeDeal(s, target.id, 'sign', 'A', new Rng(12))
  deal.selfPitched = true
  s.me!.deals = [deal]
  push(s, { kind: 'deal', id: deal.id })
  const result = acceptDeal(s, deal.id)
  assert.ok(result.includes('你签进了'), result)
  assert.strictEqual(target.roster.length, 7)
  for (const id of starters) assert.ok(target.roster.includes(id), `starter ${id} should remain on roster`)
  assert.ok(!target.roster.includes(benchWeak), 'weakest bench should be released')
  assert.ok(target.roster.includes(benchStrong), 'other bench should stay')
  assert.ok(target.roster.includes(s.me!.id), 'protagonist should join')
}

// 10. delayed move with settleMove(s, true) valid and invalid
{
  const s = create2021(108)
  setMe(s, 97)
  const target = pickTarget(s)
  const { starters, benchWeak, benchStrong } = setupFull(s, target)
  const deal = makeDeal(s, target.id, 'sign', 'A', new Rng(13))
  deal.selfPitched = true
  s.me!.moveAfter = { deal, event: '测试窗口', until: 30, year: s.year }
  settleMove(s, true)
  assert.ok(target.roster.includes(s.me!.id), 'delayed move should settle')
  assert.strictEqual(target.roster.length, 7)
  assert.ok(!target.roster.includes(benchWeak), 'weak bench released')
  assert.ok(target.roster.includes(benchStrong), 'other bench kept')
  assert.strictEqual(s.me!.moveAfter, undefined)
}
{
  const s = create2021(109)
  setMe(s, 97)
  const target = pickTarget(s)
  const { benchWeak, benchStrong } = setupFull(s, target)
  const deal = makeDeal(s, target.id, 'sign', 'A', new Rng(14))
  deal.selfPitched = true
  s.me!.moveAfter = { deal, event: '测试窗口', until: 30, year: s.year }
  s.players[benchWeak].overall = 95
  s.players[benchStrong].overall = 95
  const rosterBefore = [...target.roster]
  settleMove(s, true)
  assert.ok(!target.roster.includes(s.me!.id), 'invalid delayed move should not transfer')
  assert.deepStrictEqual([...target.roster], rosterBefore)
  assert.strictEqual(s.me!.moveAfter, undefined)
  assert.ok(s.me!.log.some((l) => l.text.includes('取消')), 'cancel reason should be logged')
}

function offered(seed: number) {
  const s=create2021(seed);setMe(s,97)
  const target=pickTarget(s), roster=setupFull(s,target)
  const deal=makeDeal(s,target.id,'sign','A',new Rng(31));deal.selfPitched=true
  s.me!.deals=[deal];push(s,{kind:'deal',id:deal.id})
  return {s,target,deal,...roster}
}
// Budget loss, missing bench, and malformed eight-player rosters: both public
// entry points reject before changing even a log, queue, fee or departing club.
for(const failure of ['budget','no-bench','eight'] as const){
  const {s,target,deal}=offered(401)
  if(failure==='budget')target.budget=0
  if(failure==='no-bench')target.starters=[...target.roster]
  if(failure==='eight'){
    const extra=structuredClone(s.players[target.roster[6]])
    extra.id='FULL_EIGHTH';s.players[extra.id]=extra;target.roster.push(extra.id)
  }
  const before=JSON.stringify(s)
  assert.ok(!acceptDeal(s,deal.id).includes('你签进了'))
  assert.equal(JSON.stringify(s),before,`${failure}: accept is atomic`)
  assert.ok(joinClub(s,deal))
  assert.equal(JSON.stringify(s),before,`${failure}: direct join is atomic`)
}
// Actual legacy closed calendar without a lock cannot be bypassed by either
// public entry point or by ordinary settlement; reopening permits settlement.
{
  const {s,target,deal}=offered(402);legacyCalendar(s,target);s.day=30
  const w=windowAt(s,target.id);assert.equal(w.open,false);assert.ok(!w.lock)
  const before=JSON.stringify(s)
  assert.match(acceptDeal(s,deal.id),/窗口/);assert.equal(JSON.stringify(s),before)
  assert.match(joinClub(s,deal)??'',/窗口/);assert.equal(JSON.stringify(s),before)
  s.me!.moveAfter={deal,event:'已约定的签约',until:30,year:s.year}
  const waiting=JSON.stringify(s);settleMove(s);assert.equal(JSON.stringify(s),waiting)
  s.day=63;assert.ok(windowAt(s,target.id).open);settleMove(s)
  assert.ok(target.roster.includes(s.me!.id));assert.equal(target.roster.length,7)
}
// A real old-save Masters roster lock defers the contract, without ejecting a
// bench player. It settles only after both event lock and calendar reopen.
{
  const {s,target,deal,benchWeak}=offered(403);legacyCalendar(s,target)
  const stage=stagesOf(s.year,false).find(x=>x.key==='masters1')!;assert.ok(stage)
  s.day=stage.start
  s.comps={masters:{key:'masters',name:'Masters I',stage:'masters1',teams:[target.id],standings:{},finished:[],format:'single'}}
  assert.ok(windowAt(s,target.id).lock)
  const roster=[...target.roster],budget=target.budget
  assert.match(acceptDeal(s,deal.id),/谈妥/)
  assert.deepEqual(target.roster,roster);assert.equal(target.budget,budget)
  assert.ok(s.me!.moveAfter);settleMove(s);assert.deepEqual(target.roster,roster)
  for(s.day=stage.end+1;s.day<364&&!windowAt(s,target.id).open;s.day++){}
  assert.ok(s.day<364);settleMove(s)
  assert.equal(target.roster.length,7);assert.ok(!target.roster.includes(benchWeak))
}
// Persist provenance through an invitation cleanup while the real four-day
// assessment runs. Both successful and newly invalidated assessments recheck.
for(const invalid of [false,true]){
  const s=create2021(404);setMe(s,97)
  const target=pickTarget(s), {benchWeak,benchStrong}=setupFull(s,target)
  const inv=makeInvite(s,target,'self',new Rng(1));inv.direct=false
  s.me!.pre.invites=[inv];push(s,{kind:'invite',id:inv.id})
  assert.equal(startTryout(s,inv.id),null);assert.equal(s.me!.tryout!.selfPitched,true)
  s.me!.pre.invites=[]
  if(invalid){s.players[benchWeak].overall=95;s.players[benchStrong].overall=95}
  const before=[...target.roster]
  let guard=0
  while(s.me!.tryout && guard++<tryoutDays(s).length+1)tryoutChoose(s,0)
  assert.equal(s.me!.tryout,undefined);assert.deepEqual(target.roster,before)
  if(invalid)assert.equal(s.me!.deals.length,0)
  else{assert.equal(s.me!.deals.length,1);assert.equal(s.me!.deals[0].selfPitched,true)}
}
console.log('PASS full7: send/reply/tryout/accept/settle, provenance cleanup, budget/import/window guards, full-state atomic failure and protected starters')
