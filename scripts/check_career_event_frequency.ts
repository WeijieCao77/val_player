/** Natural, offline, serial career diagnostics; no forced event draws or synthetic prerequisites. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoResolve, autoWeek } from '../src/engine/me/auto'
import { CAREER_EVENTS } from '../src/engine/me/events_career'
import { SEASON_DAYS } from '../src/engine/calendar'
import type { GameState, Role } from '../src/engine/types'
import type { StartPoint } from '../src/engine/me/talent'
import type { CareerAbsence } from '../src/engine/me/eventState'

const began = Date.now()
const deadline = began + 9 * 60_000
const output = resolve(process.argv[2] ?? `.cache/career-event-frequency-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)
assert.ok(output.startsWith(resolve('.cache') + '\\') || output.startsWith(resolve('.cache') + '/'), 'output must stay in this worktree .cache')
mkdirSync(dirname(output), { recursive: true })
const fd = openSync(output, 'wx')
const emit = (data: object) => { const line = JSON.stringify(data); writeSync(fd, line + '\n'); console.log(line) }
const storage = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, String(v)), removeItem: (k: string) => storage.delete(k), clear: () => storage.clear(), key: (i: number) => [...storage.keys()][i] ?? null, get length() { return storage.size } },
  fetch: () => Promise.reject(new Error('offline event frequency check')),
  XMLHttpRequest: class { constructor() { throw new Error('network disabled') } },
  WebSocket: class { constructor() { throw new Error('network disabled') } },
})
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { sendBeacon: () => false } })
function sourceHash() {
  const hash = createHash('sha256')
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else { hash.update(p); hash.update(readFileSync(p)) }
    }
  }
  walk('src'); return hash.digest('hex')
}
const loadedSourceHash = sourceHash()
const roles: Role[] = ['决斗者', '先锋', '控场', '哨卫']
const starts: StartPoint[] = ['pre', 'pre', 'chal', 'chal', 't1', 't1', 'chal', 't1']
const cases = starts.map((start, i) => ({ caseIndex: i, seed: 921101 + i * 97, year: (i % 2 ? 2026 : 2021) as 2021 | 2026, start, role: roles[i % roles.length] }))
const eventIds = CAREER_EVENTS.map(e => e.id)
assert.equal(eventIds.length, 17)
const stamp = (x: { year: number; day: number }) => x.year * SEASON_DAYS + x.day
const summaries: object[] = []
const allEvents = Object.fromEntries(eventIds.map(id => [id, 0]))
try {
  emit({ type: 'metadata', createdAt: new Date().toISOString(), sourceHash: loadedSourceHash, cases, policy: 'Real autoResolve for pending cards, then real autoWeek. No event hooks, forced draws, changed stats, fabricated injuries or synthetic prerequisites. Pending pre-clear duplicates the existing autoWeek clear policy and permits read-only absence observation.', observation: 'Major leave intervals are observed after actual pending decisions and weekly boundaries; scheduled and elapsed days reported separately. Seeds are public; output includes all 17 event counters including zeroes. Natural retirement/game-over is censoring, not a forced four-season success. Frequencies are diagnostic, not calibrated rates.', output })
  for (const c of cases) {
    assert.ok(Date.now() < deadline, 'nine-minute safety deadline reached')
    storage.clear()
    const s = createCareer({ name: '日常事件自然验收', region: c.year === 2021 ? 'Europe' : 'EMEA', role: c.role, talents: emptyTalents(), originKey: 'netcafe', start: c.start, seed: c.seed, year: c.year })
    const me = s.me!
    const from = stamp(s)
    const stopYear = c.year + 4
    const absences = new Map<string, CareerAbsence>()
    const decisions: { id: string; year: number; day: number; line: string }[] = []
    let calls = 0, stopped = '', previousProgress = '', stalled = 0
    const observe = () => {
      const book = me.careerEvents
      assert.ok(!book?.medicalRetirement, `case ${c.caseIndex}: automatic medical retirement`)
      assert.ok(!book?.disputes.some(x => x.dismissed), `case ${c.caseIndex}: automatic core dismissal`)
      const a = book?.absence
      if (!a) return
      if (absences.has(a.id)) {
        assert.deepEqual(a, absences.get(a.id), 'an active absence was overwritten or extended')
        return
      }
      const old = [...absences.values()].at(-1)
      assert.ok(!old || stamp(a.from) >= stamp(old.until), 'overlapping absences')
      if (a.reason === 'surgery') {
        assert.equal(a.label, '伤病保守治疗', 'autopilot selected season-ending surgery')
        assert.equal(stamp(a.until) - stamp(a.from), 84, 'autopilot medical alternative changed')
      }
      absences.set(a.id, structuredClone(a))
    }
    observe()
    while (s.year < stopYear && me.phase !== 'retired' && !s.gameOver) {
      assert.ok(++calls <= 280, `case ${c.caseIndex}: week-call guard`)
      assert.ok(Date.now() < deadline, 'nine-minute safety deadline reached')
      // autoWeek itself clears these in precisely this order. Observe each real choice without changing it.
      let clearGuard = 0
      while (me.pending.length && clearGuard++ < 20) {
        const p = me.pending[0]
        const isNewEvent = p.kind === 'event' && eventIds.includes(p.id ?? '')
        const line = autoResolve(s, p)
        if (isNewEvent) decisions.push({ id: p.id!, year: s.year, day: s.day, line })
        observe()
      }
      const stop = autoWeek(s)
      observe()
      const progress = `${s.year}:${s.day}:${me.week}:${me.phase}:${me.pending.map(p => `${p.kind}:${p.id}`).join(',')}`
      stalled = progress === previousProgress ? stalled + 1 : 0
      previousProgress = progress
      assert.ok(stalled < 3, `case ${c.caseIndex}: no progress for three calls`)
      if (stop.kind === 'game-over') { stopped = 'game-over'; break }
      if (calls % 52 === 0) emit({ type: 'progress', caseIndex: c.caseIndex, calls, year: s.year, day: s.day, week: me.week })
    }
    const eventCounts = Object.fromEntries(eventIds.map(id => [id, me.eventCounts[id] ?? 0]))
    for (const id of eventIds) allEvents[id] += eventCounts[id]
    const end = stamp(s)
    const intervals = [...absences.values()].map(a => ({ ...a, scheduledDays: stamp(a.until) - stamp(a.from), elapsedDays: Math.max(0, Math.min(end, stamp(a.until)) - Math.max(from, stamp(a.from))) }))
    const row = { type: 'career', ...c, calls, end: { year: s.year, day: s.day, week: me.week, phase: me.phase, overall: s.players[me.id].overall }, reason: stopped || (me.phase === 'retired' ? 'retired' : s.gameOver ? 'game-over' : 'target-year'), censored: s.year < stopYear, eventCounts, absences: intervals, majorAbsenceScheduledDays: intervals.reduce((n, a) => n + a.scheduledDays, 0), majorAbsenceElapsedDays: intervals.reduce((n, a) => n + a.elapsedDays, 0), medicalRetirement: !!me.careerEvents?.medicalRetirement, coreDismissals: me.careerEvents?.disputes.filter(x => x.dismissed).length ?? 0, decisions }
    summaries.push(row); emit(row)
  }
  assert.equal(summaries.length, 8)
  assert.ok(Object.values(allEvents).some(n => n > 0), 'no new events triggered in the natural sample')
  const sourceAtEnd = sourceHash()
  emit({ type: 'summary', status: 'pass', careers: summaries.length, allEvents, elapsedSeconds: Math.round((Date.now() - began) / 1000), sourceHash: loadedSourceHash, sourceHashAtEnd: sourceAtEnd, sourceChangedDuringRun: sourceAtEnd !== loadedSourceHash, releaseEvidenceCaveat: sourceAtEnd !== loadedSourceHash ? 'Sources changed while this process retained its loaded module snapshot; rerun before treating as final-release evidence.' : null })
} catch (error) {
  emit({ type: 'failure', completedCareers: summaries.length, elapsedSeconds: Math.round((Date.now() - began) / 1000), error: error instanceof Error ? error.message : String(error) })
  throw error
} finally { closeSync(fd) }
