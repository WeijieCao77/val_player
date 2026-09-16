/**
 * No ranking competitions by English name.
 *
 * The timeline books every competition under its Chinese name — engine/circuit.ts
 * writes `cn: `${year} 全球冠军赛`` and `${year} 第一站大师赛` — so a regex like
 * `/Champions/` or `/Masters/` matches nothing on any save made since 2023. Code
 * that ranks trophies that way silently drops every title into its bottom tier:
 * a world championship then renders, sorts and reads exactly like a Challengers
 * stage win.
 *
 * This has now been written four times. me/bottleneck.ts had it (fixed
 * 2026-09-11, the note is still at the top of its ceiling table), then
 * ui/me/Poster.tsx, ui/me/share.ts and me/nights.ts all shipped with it. Each was
 * found by eye, months apart. A fifth surface will do the same the day someone
 * writes it, so the rule is a check instead of a habit:
 *
 *   me/compclass.ts is the only place allowed to classify a competition by its
 *   name. Everywhere else asks compClass().
 *
 * Allowed, and why:
 *  - me/compclass.ts — the classifier itself, which must match the pre-2023
 *    English names (`Champions`, `Masters I`) because old worlds really do store
 *    them that way.
 *  - me/compname.ts — translates stored names for display; its English keys are
 *    string literals, not tests.
 *  - engine/circuit.ts — the naming boundary itself. It reads the real calendar,
 *    whose events genuinely are called `Valorant Champions 2024`, and it is the
 *    code that assigns `cn`. It matches English on the way in, never on a
 *    player's own `titles`.
 *  - any pattern that also carries the Chinese alternative (大师赛 / 冠军赛), which
 *    is a deliberate both-eras test rather than a tier rank — me/injury.ts asks
 *    that way to decide whether a match meant travel.
 *  - data/ — the changelog and the datasets. That is prose written for players,
 *    which says things like 「不再叫 Kickoff / Masters I / Stage 1」; it classifies
 *    nothing.
 *
 *   npx tsx scripts/check_compclass.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.argv[2] ?? 'src'
/** the three files that own competition names; everything else asks compClass() */
const ALLOW_FILES = ['engine/me/compclass.ts', 'engine/me/compname.ts', 'engine/circuit.ts']
/** a pattern that names the Chinese events too is testing for the event, not ranking by language */
const BOTH_ERAS = /大师赛|冠军赛|LOCK/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

/** `/.../flags`, escapes included, so `LOCK\/\/IN` stays in one piece */
const RE_LITERAL = /\/(?:[^/\\\n]|\\.)+\/[gimsuy]*/g

const bad: { file: string; line: number; text: string }[] = []
/** one line can hold both /Champions/ and /Masters/; it is still one place to fix */
const seen = new Set<string>()

for (const file of walk(ROOT)) {
  const rel = file.replace(/\\/g, '/').replace(new RegExp(`^${ROOT}/`), '')
  if (ALLOW_FILES.includes(rel)) continue
  if (rel.startsWith('data/')) continue
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((raw, i) => {
    // prose about the bug is not the bug
    const t = raw.trim()
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return
    for (const lit of raw.match(RE_LITERAL) ?? []) {
      if (!/Champions|Masters/.test(lit)) continue
      if (BOTH_ERAS.test(lit)) continue
      // `<TrophyChampions /> : … <TrophyMasters />` reads as a regex literal to
      // any scanner this simple; no test of a competition's name carries a tag
      if (/[<>]/.test(lit)) continue
      const at = `${ROOT}/${rel}:${i + 1}`
      if (seen.has(at)) continue
      seen.add(at)
      bad.push({ file: `${ROOT}/${rel}`, line: i + 1, text: t.slice(0, 110) })
    }
  })
}

if (bad.length) {
  console.log(`✗ ${bad.length} 处还在用英文赛事名给冠军分档：\n`)
  for (const b of bad) console.log(`  ${b.file}:${b.line}\n    ${b.text}\n`)
  console.log('赛程把赛事名记成中文（engine/circuit.ts：`${year} 全球冠军赛`），这些正则一个都匹配不上。')
  console.log('改成问 me/compclass.ts 的 compClass()——me/endings.ts 判定结局用的就是它。')
  process.exit(1)
}
console.log('✓ 没有人再用英文赛事名给冠军分档，分档一律走 compClass()。')
