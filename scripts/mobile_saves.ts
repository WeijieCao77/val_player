/**
 * Saves for the phone audit (scripts/mobile_audit.mjs). The engine plays each
 * career headlessly to the moment worth looking at, and the state is packed the
 * way the browser autosave packs it, so the page opens it as 「继续上次的生涯」.
 *
 * What is covered: a ladder start in its first week and twenty weeks in, a
 * Challengers starter in a week of days the evening before a match, a VCT
 * club at an international event, a long career (eight seasons, long club
 * names, big money and fan numbers, an injury), its ending, and one save per
 * card the clock can stop on.
 *
 * The numbers pushed in by hand (money, fans, titles, a tryout instead of a
 * direct offer) are test data for the layout, not something the engine would
 * have written.
 *
 *   npx tsx scripts/mobile_saves.ts [outDir=.cache/mobile-audit/saves] [pre,chal,t1,long]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { createCareer, emptyTalents, candidateClubs, careerRegions } from '../src/engine/me/career'
import { autoPlan, autoResolve, autoWeek } from '../src/engine/me/auto'
import { advanceTurn, advanceWeek, dueToday, weekCalendar, weekInDays } from '../src/engine/me/week'
import { MeMatch } from '../src/engine/me/matchplay'
import { packState } from '../src/engine/save'
import { stripToTheBone } from '../src/engine/match'
import { fireEvent } from '../src/engine/me/events'
import { cerStart } from '../src/engine/me/ceremony'
import { startInjury } from '../src/engine/me/injury'
import { pop, push } from '../src/engine/me/pending'
import { declineInvite, startTryout } from '../src/engine/me/tryout'
import { declineDeal } from '../src/engine/me/contract'
import { retire } from '../src/engine/me/endings'
import { TRAITS } from '../src/engine/me/traits'
import { fixturesFor, nextRealFixtureFor } from '../src/engine/season'
import { regionsOf } from '../src/engine/era'
import { Rng } from '../src/engine/rng'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState, Region } from '../src/engine/types'
import type { PendingItem } from '../src/engine/me/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
} as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const out = process.argv[2] ?? '.cache/mobile-audit/saves'
const groups = new Set((process.argv[3] ?? 'pre,chal,t1,long').split(','))
mkdirSync(out, { recursive: true })
const t0 = Date.now()
const clock = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`

/** Chromium keeps about 5 MB of UTF-16 per origin; past that the game itself strips old match paperwork (save.ts autosave). */
const BUDGET = 2_400_000
function save(name: string, s: GameState): void {
  let text = packState(s)
  if (text.length > BUDGET) {
    const c = clone(s)
    stripToTheBone(c)
    text = packState(c)
  }
  writeFileSync(`${out}/${name}.txt`, text)
  const me = s.me!
  console.log(`[${clock()}] ${name.padEnd(16)} ${(text.length / 1e6).toFixed(2)}M  ${s.year} D${s.day} ${me.phase} week ${me.week}+${me.weekDay}  days ${weekInDays(s) ? 'y' : 'n'}  pending ${me.pending.map((x) => x.kind).join(',') || '-'}  club ${me.phase === 'pro' ? s.teams[s.myTeam]?.name : '-'}`)
}
const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState

const talents = (spread: number[]) => {
  const t = emptyTalents()
  ATTR_KEYS.forEach((k, i) => { t[k] = spread[i] ?? 0 })
  return t
}

type Hook = (s: GameState, item: PendingItem) => 'stop' | 'done'
const steady: Hook = () => 'done'

/** answer what is waiting; a hook that says stop leaves it at the head */
function clearPending(s: GameState, hook: Hook): PendingItem | null {
  const me = s.me!
  let g = 0
  while (me.pending.length && g++ < 30) {
    const it = me.pending[0]
    if (hook(s, it) === 'stop') return it
    if (me.pending[0] === it) autoResolve(s, it)
  }
  return null
}

/** one week the steady way, handing every card to the hook first */
function runWeek(s: GameState, hook: Hook): PendingItem | 'over' | null {
  const me = s.me!
  const held = clearPending(s, hook)
  if (held) return held
  if (me.phase === 'retired' || s.gameOver) return 'over'
  if (me.weekDay === 0 && me.ap === me.apMax) autoPlan(s)
  let stop = advanceWeek(s)
  let g = 0
  while (stop.kind !== 'week-end' && stop.kind !== 'game-over' && g++ < 60) {
    if (stop.kind === 'match') new MeMatch(s, stop.fixture).runOut()
    else if (stop.kind === 'pending') {
      const q = clearPending(s, hook)
      if (q) return q
    }
    stop = advanceWeek(s)
  }
  return stop.kind === 'game-over' ? 'over' : null
}

/** in a week of days: a day at a time until tomorrow holds my match, stopping before the press that plays it */
function eveOfMatch(s: GameState): boolean {
  for (let i = 0; i < 8; i++) {
    clearPending(s, steady)
    const tomorrow = weekCalendar(s).find((d) => d.day === s.day + 1)
    if (tomorrow?.matches.length && !dueToday(s)) return true
    const stop = advanceTurn(s)
    if (stop.kind === 'match') new MeMatch(s, stop.fixture).runOut()
    else if (stop.kind === 'week-end' || stop.kind === 'game-over') return false
  }
  return false
}

const longest = (region: Region, tier: 1 | 2, year: number) =>
  candidateClubs(region, tier, year).slice().sort((a, b) => b.name.length - a.name.length)[0]

// ------------------------------------------------------------------ 1–2. the ladder start
if (groups.has('pre')) {
  const s = createCareer({ name: 'xXNightOwlPlayXx', region: 'China', role: '决斗者', talents: talents([4, 4, 3, 3, 2, 2, 1, 1]), originKey: 'netcafe', start: 'pre', seed: 11, year: 2026 })
  save('pre-w0', s)
  const got = new Set<string>()
  const hook: Hook = (g, it) => {
    if (it.kind === 'cup' && !got.has('cup')) { got.add('cup'); save('modal-cup', g) }
    if (it.kind === 'invite') {
      if (!got.has('invite')) { got.add('invite'); save('modal-invite', g) }
      if (!got.has('deal')) {
        // a fork of the same week: take it, and sit in front of the contract that comes
        const f = clone(g)
        startTryout(f, it.id!)
        pop(f, 'invite', it.id)
        for (let w = 0; w < 80 && !got.has('deal'); w++) {
          const r = runWeek(f, (_, x) => (x.kind === 'deal' ? 'stop' : 'done'))
          if (r && r !== 'over' && r.kind === 'deal') { got.add('deal'); save('modal-deal', f) }
          if (r === 'over' || f.me!.phase === 'pro') break
        }
      }
      if (!got.has('tryout')) {
        // the same invite as a tryout rather than a straight offer: its first day on the card
        const f = clone(g)
        const inv = f.me!.pre.invites.find((x) => x.id === it.id)
        if (inv) inv.direct = false
        startTryout(f, it.id!)
        pop(f, 'invite', it.id)
        if (f.me!.tryout && !f.me!.pending.some((x) => x.kind === 'tryout')) push(f, { kind: 'tryout' })
        f.me!.pending = f.me!.pending.filter((x) => x.kind === 'tryout')
        if (f.me!.pending.length) { got.add('tryout'); save('modal-tryout', f) }
      }
      declineInvite(g, it.id!)
      pop(g, 'invite', it.id)
      return 'done'
    }
    if (it.kind === 'deal' && g.me!.phase !== 'pro') {
      declineDeal(g, it.id!)
      pop(g, 'deal', it.id)
      return 'done'
    }
    return 'done'
  }
  for (let w = 0; w < 80 && s.me!.week < 20; w++) if (runWeek(s, hook) === 'over') break
  clearPending(s, hook)
  // big figures on the ladder page
  s.me!.money = 1_234_567
  s.me!.fans = 2_345_678
  save('pre-w20', s)
  if (!got.has('tryout')) console.log('  (pre: no tryout found)')
}

// ------------------------------------------------------------------ 3. a Challengers starter in a week of days
if (groups.has('chal')) {
  // the strongest Challengers clubs go deepest, and a deep run is where a week holds two matches;
  // the longest-named one is tried first
  const all = careerRegions(2026).flatMap((r) => candidateClubs(r, 2, 2026).map((c) => ({ ...c, region: r })))
  const byName = all.slice().sort((a, b) => b.name.length - a.name.length)[0]
  const tries = [byName, ...all.slice().sort((a, b) => b.rating - a.rating).filter((c) => c.id !== byName.id).slice(0, 5)]
  let s: GameState | null = null
  for (const c of tries) {
    const g = createCareer({ name: 'Hikari', region: c.region, role: '决斗者', talents: talents([5, 5, 3, 3, 2, 1, 1, 0]), originKey: 'academy', start: 'chal', teamId: c.id, seed: 21, year: 2026 })
    let ok = false
    for (let w = 0; w < 52 && !ok; w++) {
      clearPending(g, steady)
      if (g.day >= 35 && g.me!.phase === 'pro' && g.me!.weekDay === 0 && weekInDays(g)) ok = eveOfMatch(g)
      if (!ok && runWeek(g, steady) === 'over') break
    }
    if (ok) { s = g; break }
    console.log(`  [${clock()}] (chal: ${c.name} had no week of days)`)
  }
  if (s) {
    s.me!.money = 45_678_901
    s.me!.fans = 1_234_567
    save('chal-days', s)

    // the cards the clock stops on in a pro week
    {
      const f = clone(s)
      for (const id of ['family_call', 'locker_dinner', 'old_friend', 'insomnia']) if (fireEvent(f, id)) break
      save('modal-event', f)
    }
    {
      const f = clone(s)
      cerStart(f, 'media', '')
      save('modal-ceremony', f)
    }
    {
      const f = clone(s)
      startInjury(f, 'back', new Rng(5))
      const fx = nextRealFixtureFor(f, f.myTeam) ?? fixturesFor(f, f.myTeam).find((x) => !x.played)
      if (fx) f.me!.pending.push({ kind: 'hurt', id: fx.id, day: f.day })
      save('modal-hurt', f)
    }
    {
      const f = clone(s)
      push(f, { kind: 'trait', id: TRAITS[0].key })
      save('modal-trait', f)
    }
  }
}

// ------------------------------------------------------------------ 4. a VCT club at an international event
if (groups.has('t1')) {
  const clubs = careerRegions(2026).flatMap((r) => candidateClubs(r, 1, 2026).map((c) => ({ ...c, region: r })))
    .sort((a, b) => b.rating - a.rating).slice(0, 6)
  let done = false
  for (const c of clubs) {
    const s = createCareer({ name: 'Kaze', region: c.region, role: '先锋', talents: talents([5, 5, 4, 2, 2, 1, 1, 0]), originKey: 'academy', start: 't1', teamId: c.id, seed: 31, year: 2026 })
    for (let w = 0; w < 40 && !done; w++) {
      clearPending(s, steady)
      const fx = nextRealFixtureFor(s, s.myTeam)
      const intl = fx && !s.comps[fx.comp]?.region
      if (intl && fx.day - s.day <= 7 && s.me!.weekDay === 0) {
        if (weekInDays(s)) eveOfMatch(s)
        done = true
        break
      }
      if (runWeek(s, steady) === 'over') break
    }
    if (done) {
      save('t1-intl', s)
      break
    }
    console.log(`  (t1: ${c.name} reached no international in 40 weeks)`)
  }
}

// ------------------------------------------------------------------ 5–6. a long career, then its ending
if (groups.has('long')) {
  // the longest-named first-division club the 2021 book has
  const pick = regionsOf(2021).map((r) => ({ r, c: longest(r, 1, 2021) })).filter((x) => x.c)
    .sort((a, b) => b.c!.name.length - a.c!.name.length)[0]
  const s = createCareer({ name: 'TheLongestIGN16c', region: pick.r, role: '控场', talents: talents([8, 8, 4, 0, 0, 0, 0, 0]), originKey: 'academy', start: 't1', teamId: pick.c!.id, seed: 41, year: 2021 })
  let weeks = 0
  while (s.year < 2029 && s.me!.phase !== 'retired' && weeks++ < 60 * 10) {
    if (autoWeek(s).kind === 'game-over') break
    if (weeks % 52 === 0) console.log(`  [${clock()}] long: ${s.year} D${s.day} ${s.me!.phase} ${s.teams[s.myTeam]?.name}`)
  }
  const me = s.me!
  clearPending(s, steady)
  // what a long career carries: titles with long real names, big figures, a lay-off
  const titles = ['VALORANT Champions 2026 · 首尔', 'VCT Masters Toronto 2025', 'VCT 2027: Pacific League Stage 2', 'VCT Masters Santiago 2026']
  me.seasons.forEach((x, i) => { if (x.tier) x.titles.push(titles[i % titles.length]) })
  me.money = 98_765_432
  me.fans = 12_345_678
  if (me.phase === 'pro') startInjury(s, 'wrist', new Rng(9))
  save('long', s)
  {
    const f = clone(s)
    push(f, { kind: 'season', id: String(f.year - 1) })
    save('modal-season', f)
  }
  weeks = 0
  while (me.phase !== 'retired' && weeks++ < 60 * 8) {
    if (autoWeek(s).kind === 'game-over') break
  }
  if (me.phase !== 'retired') retire(s, `${s.players[me.id].age} 岁，你决定退役`)
  if (!me.pending.some((x) => x.kind === 'ending')) push(s, { kind: 'ending' })
  me.pending = me.pending.filter((x) => x.kind === 'ending')
  save('retired-ending', s)
  me.pending = []
  save('retired', s)
}
console.log(`done in ${clock()}`)
