/** Read-only evidence validation and descriptive paired report.
 * node scripts/summarize_career_access.mjs <career-access.jsonl>
 * Exit 1 means invalid/incomplete evidence; early retirement is valid censoring.
 * No engines are imported or simulated; exported helpers allow in-memory fixtures.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const hash = x => createHash('sha256').update(x).digest('hex')
const validHash = x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)
const finite = x => typeof x === 'number' && Number.isFinite(x)
const count = x => Number.isInteger(x) && x >= 0
const near = (a, b) => finite(a) && finite(b) && Math.abs(a - b) < 1e-8
const variants = ['baseline', 'candidate']
const kinds = ['champions', 'masters', 'lockin', 'league', 'chal', 'qual']
const roles = ['决斗者', '先锋', '控场', '哨卫', '自由人']
const expectedCases = []
for (const year of [2021, 2026]) for (const region of ['China', 'EMEA']) for (const seed of [8301, 8512]) {
  const i = expectedCases.length
  expectedCases.push({ caseIndex: i, year, endYear: year + 8, region, seed, role: roles[i % 5], talent: i % 2 ? 'gun' : 'even', start: 'pre', originKey: 'netcafe' })
}
const dateKey = x => x.year * 400 + x.day

export function analyze(records) {
  const errors = []
  const check = (ok, label) => { if (!ok) errors.push(label) }
  const of = type => records.filter(x => x?.type === type)
  const ms = of('metadata'), bs = of('bundle'), ss = of('summary'), rows = of('career')
  check(ms.length === 1, 'Expected one metadata record')
  check(bs.length === 2, 'Expected two bundle records')
  check(ss.length === 1, 'Expected one terminal summary')
  check(rows.length === 16, `Expected 16 careers, received ${rows.length}`)
  check(of('failure').length === 0, 'Failure record present')
  check(records.every(x => ['metadata', 'bundle', 'career', 'summary'].includes(x?.type)), 'Unexpected record type')
  const metadata = ms[0], summary = ss[0]
  if (!metadata || !summary) return { valid: false, errors, metadata, summary, pairs: [], rows }
  check(records[0] === metadata && records.at(-1) === summary, 'Metadata must be first and summary last')
  check(metadata.schema === 'career-access-jsonl-v1' && metadata.command === 'run', 'Wrong schema or not a formal run')
  check(validHash(metadata.scriptSha256), 'Missing script hash')
  check(metadata.design?.careers === 16 && metadata.design?.years === 8 && metadata.design?.policy === 'autoWeek', 'Unexpected experiment design')
  check(isDeepStrictEqual(metadata.cases, expectedCases), 'Case matrix differs from requested 8 paired cases')
  check(summary.complete === true && summary.completed === 16 && summary.planned === 16 && summary.sourcesUnchanged === true,
    'Summary must confirm 16/16 and unchanged sources')
  check(finite(summary.seconds) && summary.seconds >= 0, 'Invalid total elapsed time')
  for (const v of variants) {
    const source = metadata.sources?.[v]
    check(source?.sourceStatus === '', `${v}: source was not clean/committed`)
    check(typeof source?.headSha === 'string' && /^[0-9a-f]{40}$/.test(source.headSha), `${v}: missing commit SHA`)
    check(typeof source?.sourceTree === 'string' && /^[0-9a-f]{40}$/.test(source.sourceTree), `${v}: missing source tree SHA`)
    check(validHash(source?.sourceSha256), `${v}: invalid source hash`)
    check(Array.isArray(source?.sourceFiles) && source.sourceFiles.length > 0, `${v}: missing source manifest`)
    if (Array.isArray(source?.sourceFiles)) {
      check(new Set(source.sourceFiles.map(f => f.path)).size === source.sourceFiles.length, `${v}: duplicate source paths`)
      check(source.sourceFiles.every(f => typeof f.path === 'string' && validHash(f.sha256)), `${v}: malformed manifest`)
      check(hash(JSON.stringify(source.sourceFiles)) === source.sourceSha256, `${v}: manifest hash mismatch`)
    }
    if (v === 'baseline') check(source?.headSha === '3addd0f0581590a6ca7bb22f8013058a94f2d56b', 'Baseline is not 3addd0f')
    const bundles = bs.filter(b => b.variant === v)
    check(bundles.length === 1 && validHash(bundles[0]?.bundleSha256), `${v}: invalid/missing/duplicate bundle`)
  }
  const pairs = []
  for (const cell of expectedCases) {
    const pair = { cell }
    for (const v of variants) {
      const found = rows.filter(r => r.caseIndex === cell.caseIndex && r.variant === v)
      const label = `case ${cell.caseIndex} ${v}`
      check(found.length === 1, `${label}: missing/duplicate row`)
      const r = found[0]
      if (!r) continue
      pair[v] = r
      for (const [key, value] of Object.entries(cell)) check(r[key] === value, `${label}: ${key} differs from plan`)
      check(r.sourceSha256 === metadata.sources?.[v]?.sourceSha256 && r.sourceHead === metadata.sources?.[v]?.headSha, `${label}: source provenance mismatch`)
      check(r.bundleSha256 === bs.find(b => b.variant === v)?.bundleSha256, `${label}: bundle mismatch`)
      check(r.error === null && ['target-year', 'retired', 'game-over'].includes(r.reason), `${label}: exception or invalid endpoint ${r.reason}`)
      check(r.unresolvedMatchTier === 0, `${label}: unresolvedMatchTier=${r.unresolvedMatchTier}; tier1-start evidence incomplete`)
      check(count(r.calls) && count(r.settledWeeks) && r.settledWeeks <= r.calls && r.calls <= 480, `${label}: invalid week counts`)
      check(r.initial?.year === cell.year && r.initial?.week === 0 && finite(r.initial?.overall), `${label}: missing/invalid initial state`)
      check(r.final && finite(r.final.overall) && r.final.week === r.settledWeeks, `${label}: missing/invalid final state`)
      if (r.reason === 'target-year') {
        check(r.censored === false && r.final?.year === cell.endYear, `${label}: completed endpoint mismatch`)
        check(Array.isArray(r.yearly) && r.yearly.length === 8 && r.yearly.every((s, i) => s.year === cell.year + i + 1), `${label}: missing/duplicate annual checkpoints`)
      } else check(r.censored === true && r.final?.year < cell.endYear, `${label}: early end must be explicitly censored`)
      const w = r.weekly ?? {}
      check(['pre', 'tier2', 'tier1', 'other', 'bench', 'proSamples'].every(k => count(w[k])), `${label}: invalid weekly classes`)
      check(w.pre + w.tier2 + w.tier1 + w.other === r.calls, `${label}: week classes do not sum to calls`)
      check(w.proSamples === w.tier1 + w.tier2 && w.bench <= w.proSamples, `${label}: pro/bench denominator mismatch`)
      check(w.proSamples ? near(r.meanBond, w.bondSum / w.proSamples) && near(r.meanCoachTrust, w.coachTrustSum / w.proSamples)
        : r.meanBond === null && r.meanCoachTrust === null, `${label}: invalid bond/trust means`)
      const events = Array.isArray(r.roomEvents) ? r.roomEvents : []
      check(Array.isArray(r.roomEvents), `${label}: missing event records`)
      const eventKeys = events.map(e => `${e.observed?.year}:${e.observed?.week}:${e.year}:${e.day}:${e.text}`)
      check(new Set(eventKeys).size === eventKeys.length, `${label}: duplicate room events`)
      check(events.every(e => ['argue', 'unresolved'].includes(e.kind) && typeof e.text === 'string' && Array.isArray(e.sources)
        && e.sources.length > 0 && e.sources.every(s => ['state.news', 'me.weekNotes'].includes(s))), `${label}: invalid event provenance`)
      for (const k of ['argue', 'unresolved']) {
        check(r.roomCounts?.[k]?.all === events.filter(e => e.kind === k).length, `${label}: ${k} all count mismatch`)
        check(r.roomCounts?.[k]?.player === events.filter(e => e.kind === k && e.involvesPlayer).length, `${label}: ${k} player count mismatch`)
      }
      const matches = Array.isArray(r.officialMatches) ? r.officialMatches : []
      check(Array.isArray(r.officialMatches) && matches.filter(m => m.started).length === r.final?.officialStarts, `${label}: official starts mismatch`)
      check(matches.filter(m => m.started).every(m => [1, 2].includes(m.tier)), `${label}: unknown tier hidden in started match`)
      const firstStart = matches.filter(m => m.started && m.tier === 1).sort((a, b) => dateKey(a) - dateKey(b))[0]
      check(firstStart ? r.firstTier1Start?.fixtureId === firstStart.fixtureId && r.firstTier1Start?.year === firstStart.year
        : r.firstTier1Start === null, `${label}: first tier1 start does not match actual played match`)
      for (const k of ['firstSigned', 'firstTier1', 'firstTier1Start']) {
        const x = r[k]
        check(x === null || (Number.isInteger(x?.year) && finite(x?.day) && x.year >= cell.year && x.year <= cell.endYear), `${label}: malformed ${k}`)
      }
      for (const n of [80, 85, 90]) {
        const x = r.firstReached?.[n]
        check(x === null || (finite(x?.overall) && x.overall >= n && Number.isInteger(x.year) && count(x.week)
          && x.week <= r.settledWeeks && x.year >= cell.year && x.year <= r.final?.year), `${label}: invalid threshold ${n}`)
        const reached = [r.initial, ...(Array.isArray(r.yearly) ? r.yearly : []), r.final].find(s => s?.overall >= n)
        check(!reached || (x != null && dateKey(x) <= dateKey(reached)), `${label}: threshold ${n} missing/later than observed checkpoint`)
      }
      check(Array.isArray(r.titles) && r.titles.every(t => kinds.includes(t.cls) && typeof t.started === 'boolean' && typeof t.qualifier === 'boolean'
        && typeof t.finalStarted === 'boolean'), `${label}: invalid trophy classification`)
      check(finite(r.seconds) && r.seconds >= 0, `${label}: invalid elapsed time`)
    }
    if (pair.baseline && pair.candidate) check(isDeepStrictEqual(pair.baseline.initial, pair.candidate.initial), `case ${cell.caseIndex}: paired initial snapshots differ`)
    pairs.push(pair)
  }
  return { valid: errors.length === 0, errors, metadata, summary, pairs, rows }
}

const f = n => finite(n) ? n.toFixed(2) : 'NA'
const milestone = (x, censored) => x ? `${x.year}/D${x.day}${x.week != null ? `/W${x.week}` : x.observedWeek != null ? `/观测W${x.observedWeek}` : ''}` : censored ? '截尾前未观察到' : '8年未达到'
const incidence = (numerator, denominator) => `${numerator}/${denominator}职业周 = ${denominator ? f(100 * numerator / denominator) : 'NA'}/100职业周`
function titleCounts(row) {
  return kinds.map(k => {
    const xs = row.titles.filter(t => t.cls === k && !t.qualifier)
    return `${k}:${xs.length}(赛事首发${xs.filter(t => t.started).length}/决赛首发${xs.filter(t => t.finalStarted).length})`
  }).join(' ')
}
export function render(result) {
  if (!result.valid) return `FAIL：证据不能用于验收\n${result.errors.map(e => `- ${e}`).join('\n')}`
  const lines = ['PASS：16/16 配对证据完整，源码/包哈希、初始状态、周分母及实际首发核对通过。',
    `总耗时 ${f(result.summary.seconds)} 秒。以下仅描述8组配对，不推断所有玩家；位置/天赋/种子相互混杂。`,
    ...variants.map(v => `${v} commit ${result.metadata.sources[v].headSha} | source SHA256 ${result.metadata.sources[v].sourceSha256}`),
    'pre/t2/t1/other按每次推进的周初状态计数；替补为职业周的重叠子集，不参与合计。关系/信任按职业周加权。',
    '事件率同时展示玩家相关和全队新闻；宿怨指“关系还没缓和”提醒条数，不是独立关系数量。每100职业周可超过100。',
    '首次进入tier1不等于持续首发；冠军按真实类别统计，赛事首发不等于决赛首发。退休截尾不是失败或零分。', '']
  for (const { cell, baseline, candidate } of result.pairs) {
    lines.push(`Case ${cell.caseIndex}：${cell.year} ${cell.region} → ${baseline.actualStartRegion} | seed ${cell.seed} | ${cell.role} | ${cell.talent}`)
    for (const row of [baseline, candidate]) {
      const w = row.weekly
      lines.push(`  ${row.variant}：${row.censored ? `截尾(${row.reason})，观察到${row.final.year}/D${row.final.day}` : '完整8年'}，${row.settledWeeks}结算周/${row.calls}推进；${f(row.seconds)}秒`,
        `    首签 ${milestone(row.firstSigned, row.censored)}；首tier1 ${milestone(row.firstTier1, row.censored)}；实际tier1首发 ${milestone(row.firstTier1Start, row.censored)}`,
        `    周 pre/t2/t1/other=${w.pre}/${w.tier2}/${w.tier1}/${w.other}，替补${w.bench}；职业分母${w.proSamples}；平均关系${f(row.meanBond)} / 信任${f(row.meanCoachTrust)}`)
      for (const [key, label] of [['argue', '争执'], ['unresolved', '宿怨提醒']]) lines.push(
        `    ${label}：玩家 ${incidence(row.roomCounts[key].player, w.proSamples)}；全队 ${incidence(row.roomCounts[key].all, w.proSamples)}`)
      lines.push(`    ${row.censored ? '截尾时综合（不是8年终值）' : '8年综合'} ${row.final.overall}；首次80 ${milestone(row.firstReached[80], row.censored)}；85 ${milestone(row.firstReached[85], row.censored)}；90 ${milestone(row.firstReached[90], row.censored)}`,
        `    冠军 ${titleCounts(row)}；资格赛条目${row.titles.filter(t => t.qualifier).length}另列、不算冠军`)
    }
    lines.push(baseline.censored || candidate.censored ? '  配对8年终值差：NA（至少一侧截尾）' : `  配对8年综合差 candidate-baseline：${candidate.final.overall - baseline.final.overall}`,
      '')
  }
  lines.push('按版本描述性合计（不是独立因素或总体胜率估计）：')
  for (const v of variants) {
    const rs = result.rows.filter(r => r.variant === v), full = rs.filter(r => !r.censored)
    const pro = rs.reduce((s, r) => s + r.weekly.proSamples, 0)
    const sum = select => rs.reduce((s, r) => s + select(r), 0)
    lines.push(`  ${v}：完整${full.length}/8，截尾${8 - full.length}/8；仅完整8年综合均值${full.length ? f(full.reduce((s, r) => s + r.final.overall, 0) / full.length) : 'NA'}`,
      `    职业分母${pro}周；加权关系${pro ? f(sum(r => r.weekly.bondSum) / pro) : 'NA'} / 信任${pro ? f(sum(r => r.weekly.coachTrustSum) / pro) : 'NA'}`,
      `    玩家争执 ${incidence(sum(r => r.roomCounts.argue.player), pro)}；宿怨提醒 ${incidence(sum(r => r.roomCounts.unresolved.player), pro)}`)
    for (const key of ['firstSigned', 'firstTier1', 'firstTier1Start']) lines.push(
      `    ${key}：观察到${rs.filter(r => r[key]).length}/8；完整未到${rs.filter(r => !r.censored && !r[key]).length}；截尾未观察到${rs.filter(r => r.censored && !r[key]).length}`)
  }
  return lines.join('\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: node scripts/summarize_career_access.mjs <jsonl>')
    const text = readFileSync(resolve(process.argv[2]), 'utf8')
    const records = text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
      try { return JSON.parse(line) } catch { throw Error(`Invalid JSON at nonempty line ${index + 1}`) }
    })
    const result = analyze(records)
    console.log(render(result))
    if (!result.valid) process.exitCode = 1
  } catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1 }
}
