/** Weekly report dates: deterministic boundaries, undated legacy data, actual
 * rollover writers, and an AST guard for every production news append. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { deskLine, weekReport } from '../src/engine/me/press'
import { mateLine } from '../src/engine/me/chatter'
import { advanceDay } from '../src/engine/season'
import type { MeMatchRecord } from '../src/engine/me/types'

const s = createCareer({ name: 'Date probe', region: 'China', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 9, year: 2026 })
const me = s.me!
function reportAt(year: number, day: number, dates: [number | undefined, number, string][]) {
  s.year = year; s.day = day
  me.log = dates.filter(([y]) => y !== undefined).map(([y, d, text]) => ({ year: y!, day: d, text: `log:${text}`, kind: 'good' }))
  s.news = dates.map(([y, d, text]) => ({ year: y, day: d, text: `news:${text}`, kind: 'transfer' }))
  const before = JSON.stringify({ log: me.log, news: s.news })
  const out = weekReport(s)
  assert.equal(JSON.stringify({ log: me.log, news: s.news }), before, 'reading must not rewrite historical dates')
  return out
}
let out = reportAt(2027, 100, [[2026, 98, 'old'], [2027, 93, 'cutoff'], [2027, 94, 'first'], [2027, 100, 'today'], [2027, 101, 'future'], [2028, 98, 'future-year']])
assert.deepEqual(out, ['log:first', 'log:today', '📰 news:first', '📰 news:today'])
out = reportAt(2027, 2, [[2026, 359, 'cutoff'], [2026, 360, 'last-year'], [2026, 364, 'turn'], [2027, 2, 'today'], [2025, 364, 'ancient']])
assert.deepEqual(out, ['log:last-year', 'log:turn', 'log:today', '📰 news:last-year', '📰 news:turn', '📰 news:today'])
out = reportAt(2027, 0, [[2026, 357, 'cutoff'], [2026, 358, 'last-year'], [2026, 364, 'turn'], [2027, 0, 'opening']])
assert.deepEqual(out, ['log:last-year', 'log:turn', 'log:opening', '📰 news:last-year', '📰 news:turn', '📰 news:opening'])
assert.deepEqual(reportAt(2026, 364, [[2027, 0, 'future-year']]), [])
for (const year of [2026, 2027, 2032]) {
  assert.deepEqual(reportAt(year, 100, [[undefined, 98, 'sparse-legacy']]), [])
  assert.deepEqual(reportAt(year, 2, [[undefined, 363, 'legacy-wrap'], [undefined, 1, 'legacy-current-or-old']]), [])
}
out = reportAt(2027, 100, [[NaN, 98, 'invalid-year'], [2027, -1, 'negative-day'], [2027, 365, 'oversized-day'], [2027, 99.5, 'fraction'], [2027, 98, 'fresh']])
assert.deepEqual(out, ['log:fresh', '📰 news:fresh'])
// Filtering before caps must let valid items survive a tail of stale entries.
out = reportAt(2027, 100, [[2027, 99, 'fresh'], ...Array.from({ length: 10 }, (_, i): [number, number, string] => [2026, 99, `stale-${i}`])])
assert.deepEqual(out, ['log:fresh', '📰 news:fresh'])
console.log('PASS report: 7-day edges, cross-year/day-zero, future/invalid, sparse undated legacy, caps, read purity')

// Public feedback 7161c4da (2026-09-21): a line the week already carries (an achievement, a ceiling that gave —
// logged and put on the week at once) is not read back from the log a second time, and the four 「mine」 slots
// go to lines not yet on the paper. Found in a 2021 China career: 「成就：第一次首发」 twice in one report.
s.year = 2027; s.day = 100
me.log = [
  { year: 2027, day: 99, kind: 'good', text: '成就：第一次首发——打上一场正赛的首发。' },
  ...['a', 'b', 'c', 'd'].map((t) => ({ year: 2027, day: 98, kind: 'match' as const, text: `match:${t}` })),
]
s.news = [{ year: 2027, day: 99, kind: 'transfer', text: '📰 already said' }]
me.weekNotes = ['成就：第一次首发——打上一场正赛的首发。', '📰 already said']
out = weekReport(s)
assert.deepEqual(out, ['match:a', 'match:b', 'match:c', 'match:d'])
me.weekNotes = []
assert.deepEqual(weekReport(s), ['match:a', 'match:b', 'match:c', 'match:d', '📰 already said'])
me.log.reverse()
me.weekNotes = ['成就：第一次首发——打上一场正赛的首发。']
// newest last is the log's order; the line already said does not take one of the four slots
assert.deepEqual(weekReport(s), ['match:d', 'match:c', 'match:b', 'match:a', '📰 already said'])
// the manager's 「我们夺得」 beside the league's own title line: a club called 我们
assert.ok(deskLine('🏆 我们夺得 挑战者联赛 · 北美 · 第一赛段 冠军！'))
assert.ok(!deskLine('🏆 TSM 夺得 挑战者联赛 · 北美 · 第一赛段 冠军！'))
console.log('PASS report: lines already on the week are not repeated; the manager\'s 「我们夺得」 stays off a player\'s week')

// Chatter uses the same 364-day clock for match facts, but birthdays retain
// real calendar dates. Suppress birthdays so the match is the only trigger.
const pro = createCareer({ name: 'Chatter probe', region: 'China', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 9, year: 2026 })
pro.year = 2027; pro.day = 2
for (const id of pro.teams[pro.myTeam].roster) pro.players[id].birth = undefined
pro.me!.seasonStart.starts = 5
pro.me!.matches = [{ year: 2026, day: 360, started: true, won: true, score: '2-0', box: [] } as unknown as MeMatchRecord]
assert.match(mateLine(pro) ?? '', /^💬 /)
pro.me!.matches[0].day = 359
assert.equal(mateLine(pro), null)
console.log('PASS chatter: last-year match within 7 simulation days speaks; exact cutoff does not')

// A real turnover stamps the outgoing year before increment and the opening
// year after increment. Old items keep their dates (including missing year).
s.year = 2026; s.day = 363; s.news = [{ day: 99, kind: 'transfer', text: 'legacy stays undated' }]
s.fixtures = []; s.comps = {}; s.pendingDrawId = undefined
const legacy = s.news[0]
advanceDay(s, { autoResolveDrawDecisions: true })
assert.equal(s.year, 2027); assert.equal(s.day, 0)
assert.equal(legacy.year, undefined)
const fresh = s.news.filter(n => n !== legacy)
assert.ok(fresh.length > 0)
assert.ok(fresh.every(n => n.year === (n.day === 0 ? 2027 : 2026)))
assert.ok(fresh.some(n => n.year === 2027))
assert.ok(weekReport(s).some(line => fresh.some(n => (n.kind === 'transfer' || n.kind === 'player' || (n.kind === 'league' && n.important)) && line.includes(n.text))))
console.log(`PASS actual rollover: ${fresh.length} fresh news items correctly dated; new-year news enters report`)

// Check AST, not a multiline regex: disallow hidden spread/dynamic append
// arguments, and require the actual writer's year on every new news object.
let writers = 0
function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) { walk(file); continue }
    if (!file.endsWith('.ts')) continue
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const call = node.expression
        if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'news' && ['push', 'unshift', 'splice'].includes(call.name.text)) {
          if (call.name.text === 'splice' && node.arguments.length <= 2) return // retention trim, no inserted items
          assert.equal(call.name.text, 'push', `${file}: review non-append mutation explicitly`)
          const owner = call.expression.expression.getText(source)
          for (const arg of node.arguments) {
            assert.ok(ts.isObjectLiteralExpression(arg), `${file}: dynamic news write needs date review`)
            const year = arg.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(source) === 'year')
            assert.ok(year && ts.isPropertyAssignment(year), `${file}: missing news year`)
            assert.equal(year.initializer.getText(source), `${owner}.year`, `${file}: wrong year owner`)
            writers++
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
}
// Trimming retained history is not an insertion; handled separately below.
walk('src/engine')
assert.ok(writers >= 90)
console.log(`PASS all ${writers} production news writers explicitly stamp the owning state's year`)
