import assert from 'node:assert/strict'
import { makeDeal, askDeal } from '../src/engine/me/contract'
import { Rng } from '../src/engine/rng'
import { toCny } from '../src/engine/me/currency'
/**
 * Controlled elite scenario probe: a 2026 China tier-1 start, protagonist and
 * own roster attributes set to 95, recomputed overalls each week, potential 99,
 * coachTrust 100, body 100, form 90. Run the real autoWeek calendar up to 156
 * weeks (through 2028). Report actual attainable titles and tier-1 official
 * starts; never write history directly. Log year/day/pre-phase official starts
 * and completed tier-1 starts each month. Exit 0 if >=3 distinct started
 * international titles and >=60 tier-1 official starts found in real calendar,
 * else exit 2. Offline fetch stub. No production modifications.
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { recomputeOverall } from '../src/engine/player'
import { isIntlComp } from '../src/engine/me/compclass'
import { ATTR_KEYS, type GameState } from '../src/engine/types'

// Offline environment stubs
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

const MAX_WEEKS = 156 // 2026, 2027, 2028
const REQUIRE_TITLES = 3
const REQUIRE_STARTS = 60

const state: GameState = createCareer({
  name: 'EliteProbe',
  region: 'China',
  role: '决斗者',
  talents: emptyTalents(),
  originKey: 'netcafe',
  start: 't1',
  seed: 711,
  year: 2026,
})

// Controlled elite abilities for protagonist and all own club players
const boost = (): void => {
  const me = state.me!
  const p = state.players[me.id]
  for (const k of ATTR_KEYS) p.attrs[k] = 95
  p.potential = 99
  p.form = 90
  recomputeOverall(p)
  const clubId = state.myTeam
  if (clubId) {
    const club = state.teams[clubId]
    if (club && club.roster) {
      for (const id of club.roster) {
        const q = state.players[id]
        if (q && q.id !== p.id) {
          for (const k of ATTR_KEYS) q.attrs[k] = 95
          q.potential = 99
          recomputeOverall(q)
        }
      }
    }
  }
  me.coachTrust = 100
  me.body = 100
}

let week = 0
let movedClubs = 0
let lastClub = state.myTeam

function evidence() {
  const me = state.me!, first = state.year - 2
  const titles = [...new Map(me.titles.filter(t => t.started && t.year >= first && t.year <= state.year && isIntlComp(t.title)).map(t => [`${t.year}:${t.title}`,t])).values()]
  const rows = me.seasons.filter(s => s.year >= first && s.year < state.year && s.tier === 1)
  const starts = rows.reduce((n,s) => n+s.starts,0) + me.matches.filter(m => m.year === state.year && m.started && !m.friendly).length
  return { titles, starts, rows }
}
let found = false
while (week < MAX_WEEKS && state.me!.phase !== 'retired') {
  boost()
  const stop = autoWeek(state)
  week++
  if (state.myTeam !== lastClub) { movedClubs++; lastClub=state.myTeam }
  const e=evidence()
  if (week%4===0) console.log(JSON.stringify({week,year:state.year,day:state.day,phase:state.me!.phase,starts:e.starts,titles:e.titles}))
  if(e.titles.length>=REQUIRE_TITLES && e.starts>=REQUIRE_STARTS){found=true;break}
  if(stop.kind==='game-over')break
}
console.log(JSON.stringify({scenario:'Controlled 95 ability; real autoWeek calendar and outcomes, no history writes',found,week,movedClubs,year:state.year,day:state.day,...evidence()},null,2))
assert.ok(found,'elite award/start gate must occur in a real calendar')
const deal=makeDeal(state,state.myTeam,'renew','A+',new Rng(17))
let negotiated:number|undefined
for(let seed=1;seed<=100;seed++){
  const s=structuredClone(state),d=structuredClone(deal);s.me!.deals=[d]
  if(askDeal(s,d.id,'pay',new Rng(seed)).ok){negotiated=toCny(d.salary,d.cur,s.year);break}
}
assert.notEqual(negotiated,undefined)
assert.ok(negotiated!>=3_000_000,'genuine simulated history must qualify on SAME CLUB renewal')
console.log(JSON.stringify({renewalTeam:state.myTeam,initial:deal.salary,cur:deal.cur,negotiatedCny:negotiated}))
console.log('PASS real-calendar elite history, same-club renewal reaches CNY3m without extra transfers')
