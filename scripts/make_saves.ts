/**
 * Saves at the interesting moments, for looking at the screens: the bot plays
 * until each kind of thing is waiting on me, then packs the state the way the
 * browser autosave does. Written to the directory given.
 *
 *   npx tsx scripts/make_saves.ts <outDir> [seed=7]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek, autoResolve, autoPlan } from '../src/engine/me/auto'
import { advanceWeek } from '../src/engine/me/week'
import { MeMatch } from '../src/engine/me/matchplay'
import { packState } from '../src/engine/save'
import type { GameState } from '../src/engine/types'
import type { PendingItem } from '../src/engine/me/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
} as unknown as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const out = process.argv[2]
const seed = Number(process.argv[3] ?? 7)
mkdirSync(out, { recursive: true })
const save = (name: string, s: GameState) => { writeFileSync(`${out}/${name}.txt`, packState(s)); console.log('saved', name, 'day', s.day, 'year', s.year, 'phase', s.me!.phase, 'pending', s.me!.pending.map((x) => x.kind).join(',')) }

/** step until something of this kind is waiting, playing matches and clearing other pendings */
function until(state: GameState, want: (item: PendingItem) => boolean, maxWeeks = 200): boolean {
  const me = state.me!
  for (let w = 0; w < maxWeeks; w++) {
    let guard = 0
    while (me.pending.length && guard++ < 20) {
      if (want(me.pending[0])) return true
      autoResolve(state, me.pending[0])
    }
    if (me.phase === 'retired') return false
    autoPlan(state)
    let stop = advanceWeek(state)
    let g = 0
    while (stop.kind !== 'week-end' && stop.kind !== 'game-over' && g++ < 40) {
      if (stop.kind === 'match') new MeMatch(state, stop.fixture).runOut()
      else if (stop.kind === 'pending') {
        if (want(stop.item)) return true
        autoResolve(state, stop.item)
      }
      stop = advanceWeek(state)
    }
  }
  return false
}

// 1. pre-pro: the first cup is offered
let s = createCareer({ name: 'Hikari', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'academy', start: 'pre', seed })
save('00-pre-week1', s)
if (until(s, (i) => i.kind === 'cup')) save('01-cup', s)
// 2. an invitation
if (until(s, (i) => i.kind === 'invite')) save('02-invite', s)
// 3. the tryout in progress
if (until(s, (i) => i.kind === 'tryout')) save('03-tryout', s)
// 4. a contract on the table
if (until(s, (i) => i.kind === 'deal')) save('04-deal', s)
// 5. first pro week (sign it, then the next week-end)
autoResolve(s, s.me!.pending[0])
autoWeek(s)
save('05-pro-week', s)
// 6. an event
if (until(s, (i) => i.kind === 'event')) save('06-event', s)
// 7. a stream offer
if (until(s, (i) => i.kind === 'stream', 300)) save('07-stream', s)
// 8. a transfer deal
if (until(s, (i) => i.kind === 'deal', 400)) save('08-transfer', s)
// 9. a trait
if (until(s, (i) => i.kind === 'trait', 400)) save('09-trait', s)
// 10. season end
if (until(s, (i) => i.kind === 'season', 200)) save('10-season', s)
// 11. run to retirement
let guard = 0
while (s.me!.phase !== 'retired' && guard++ < 1200) autoWeek(s)
save('11-ending', s)
