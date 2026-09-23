import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { Rng } from '../src/engine/rng'
import { makeDeal, askDeal } from '../src/engine/me/contract'
import { payBand } from '../src/engine/me/paytable'
import { leagueCurOf, toCny, type Cur } from '../src/engine/me/currency'
import { ATTR_KEYS, type GameState, type Player, type Team } from '../src/engine/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] },
  clear: () => {},
  key: () => null,
  length: 0,
} as unknown as Storage
Object.assign(globalThis, { fetch: () => Promise.reject(new Error('offline')) })

type Title = NonNullable<GameState['me']>['titles'][number]

const clone = <T>(x: T): T => structuredClone(x)

function lift(state: GameState, level: number): void {
  const p = state.players[state.me!.id]
  for (const k of ATTR_KEYS) p.attrs[k] = Math.max(p.attrs[k], level)
  p.overall = level
}

function findTeam(state: GameState, cur: Cur, excludeId?: string): Team {
  const t = Object.values(state.teams).find(
    (x) => !x.dormant && leagueCurOf(x.region) === cur && x.tier === 1 && (!excludeId || x.id !== excludeId)
  )
  assert.ok(t, `missing ${cur} tier1 team`)
  return t
}

function setEliteHistory(me: NonNullable<GameState['me']>, teamId: string, titles: Title[]): void {
  me.seasons = [
    { year: 2024, team: teamId, tier: 1, matches: 30, starts: 30, wins: 25, acs: 240, overallFrom: 90, overallTo: 95, titles: [] },
    { year: 2025, team: teamId, tier: 1, matches: 30, starts: 30, wins: 25, acs: 240, overallFrom: 90, overallTo: 95, titles: [] },
  ]
  me.titles = titles
  me.matches = []
}

function baseState(cur: Cur): GameState {
  const region = cur === 'USD' ? 'Americas' : cur === 'EUR' ? 'EMEA' : cur === 'KRW' ? 'Pacific' : 'China'
  const s = createCareer({
    name: 'PayReach',
    region,
    role: '控场',
    talents: emptyTalents(),
    originKey: 'netcafe',
    start: 'pre',
    seed: 1,
    year: 2026,
  })
  const me = s.me!
  const p = s.players[me.id]
  p.overall = 97
  for (const k of ATTR_KEYS) p.attrs[k] = 97
  p.potential = 99
  return s
}

function patchForRenew(s: GameState, team: Team): void {
  const me = s.me!
  s.myTeam = team.id
  me.phase = 'pro'
  const p = s.players[me.id]
  p.teamId = team.id
  const current = s.teams[team.id]
  current.roster = [...current.roster.filter(id => id !== me.id).slice(0,6), me.id]
  current.starters = [me.id, ...current.starters.filter(id => id !== me.id).slice(0,4)]
}

function patchForTransfer(s: GameState, team: Team): void {
  const me = s.me!
  const origin = findTeam(s, leagueCurOf(team.region), team.id)
  patchForRenew(s, origin)
}

function make2021Base(cur: Cur): GameState {
  const region = cur === 'USD' ? 'Americas' : cur === 'EUR' ? 'EMEA' : cur === 'KRW' ? 'Pacific' : 'China'
  return createCareer({ name: 'Pay2021', region, role: '控场', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 1, year: 2021 })
}

const expectBug = process.argv.includes('--expect-bug')
function test2026PayReach(): void {
  for(const cur of ['USD','EUR','KRW','CNY'] as Cur[]){
    const base=baseState(cur), target=findTeam(base,cur)
    const titles:Title[]=[{year:2024,title:'Masters Shanghai',started:true},{year:2025,title:'Champions 2025',started:true},{year:2026,title:'Champions 2026',started:true}]
    for(const kind of ['renew','transfer','sign'] as const){
      const s=clone(base), team=s.teams[target.id]
      team.rating=80
      if(kind==='renew')patchForRenew(s,team)
      else if(kind==='transfer')patchForTransfer(s,team)
      setEliteHistory(s.me!,team.id,titles)
      const d=makeDeal(s,team.id,kind,'A+',new Rng(1)), band=payBand(team.region,1,2026)
      assert.equal(d.cur,cur)
      if(!expectBug)assert.equal(d.salary,band.cap*.8,`${kind} ${cur} initial elite salary`)
      let successful:number|undefined
      for(let seed=1;seed<=100;seed++){
        const q=clone(s), deal=clone(d);q.me!.deals=[deal]
        if(askDeal(q,deal.id,'pay',new Rng(seed)).ok){successful=deal.salary;break}
      }
      assert.notEqual(successful,undefined,'must exercise actual successful negotiation')
      if(expectBug)assert.ok(toCny(successful!,cur,2026)<3_000_000)
      else{assert.equal(successful,band.cap);assert.ok(toCny(successful!,cur,2026)>=3_000_000)}
      console.log(JSON.stringify({year:2026,cur,kind,initial:d.salary,negotiated:successful,cny:toCny(successful!,cur,2026)}))
    }
  }
}

function testNegatives(): void {
  for (const cur of ['USD', 'EUR', 'KRW', 'CNY'] as Cur[]) {
    const base = baseState(cur)
    const templateTitles: Title[] = [
      { year: 2024, title: 'Masters Shanghai', started: true },
      { year: 2025, title: 'Champions 2025', started: true },
      { year: 2026, title: 'Champions 2026', started: true },
    ]
    const target = findTeam(base, cur, base.myTeam)
    const cap = payBand(target.region, target.tier, 2026).cap
    const cases: Array<{ name: string; mutate: (s: GameState) => void }> = [
      {
        name: 'overall89',
        mutate: (s) => {
          const p = s.players[s.me!.id]
          p.overall = 89
          for (const k of ATTR_KEYS) p.attrs[k] = 89
        },
      },
      { name: 'noStartedTitles', mutate: (s) => { s.me!.titles = templateTitles.map(t=>({...t,started:false})) } },
      {
        name: 'twoTitles',
        mutate: (s) => {
          s.me!.titles = templateTitles.slice(0, 2)
        },
      },
      {
        name: 'duplicateTitles',
        mutate: (s) => {
          s.me!.titles = [templateTitles[0], templateTitles[0], templateTitles[0]]
        },
      },
      {
        name: 'outsideRecentYears',
        mutate: (s) => {
          s.me!.titles = [
            { year: 2022, title: 'Champions 2022', started: true },
            { year: 2021, title: 'Champions 2021', started: true },
            { year: 2020, title: 'Champions 2020', started: true },
          ]
        },
      },
      {
        name: 'regionalTitles',
        mutate: (s) => {
          s.me!.titles = [
            { year: 2024, title: 'Regional Masters', started: true },
            { year: 2025, title: 'Regional Masters', started: true },
            { year: 2026, title: 'Regional Masters', started: true },
          ]
        },
      },
      {
        name: 'starts59',
        mutate: (s) => {
          s.me!.seasons = s.me!.seasons.map((x) => ({ ...x, starts: x.starts }))
          s.me!.seasons[0].starts = 29
          s.me!.seasons[1].starts = 30
        },
      },
      {
        name: 'zeroTitlesOrdinary97',
        mutate: (s) => {
          s.me!.titles = []
        },
      },
    ]
    for (const c of cases) {
      const s = clone(base)
      setEliteHistory(s.me!, s.myTeam, templateTitles)
      c.mutate(s)
      const d = makeDeal(s, target.id, 'sign', 'A', new Rng(1))
      assert.ok(d.salary < cap * 0.8, `${c.name}: salary ${d.salary} not below 80% cap`)
    }
  }
  console.log('Negative cases: PASS')
}

function test2021NoChange(): void {
  for (const cur of ['USD', 'EUR', 'KRW', 'CNY'] as Cur[]) {
    const s = make2021Base(cur)
    const target = findTeam(s, cur, s.myTeam)
    lift(s,97)
    target.rating=80
    const elite = clone(s)
    elite.me!.titles = [
      { year: 2019, title: 'Champions 2019', started: true },
      { year: 2020, title: 'Champions 2020', started: true },
      { year: 2021, title: 'Champions 2021', started: true },
    ]
    elite.me!.seasons = [
      { year: 2019, team: target.id, tier: 1, matches: 30, starts: 30, wins: 25, acs: 240, overallFrom: 90, overallTo: 95, titles: [] },
      { year: 2020, team: target.id, tier: 1, matches: 30, starts: 30, wins: 25, acs: 240, overallFrom: 90, overallTo: 95, titles: [] },
    ]
    const ordinary = clone(s)
    ordinary.me!.titles = []
    const eliteDeal = makeDeal(elite, target.id, 'sign', 'A', new Rng(1))
    const ordinaryDeal = makeDeal(ordinary, target.id, 'sign', 'A', new Rng(1))
    assert.equal(eliteDeal.salary, ordinaryDeal.salary, `2021 ${cur} salary differs for elite history`)
    if(cur==='CNY')assert.ok(ordinaryDeal.salary<payBand(target.region,1,2021).cap*.8,'2021 control must distinguish the exceptional premium')
  }
  console.log('2021 no change: PASS')
}

test2026PayReach()
testNegatives()
test2021NoChange()
console.log(expectBug ? 'REPRODUCED: 2026 all four currencies cannot reach CNY3m; 2021 unchanged' : 'PASS: four-currency reachability, 32 negative cases and unchanged 2021')
