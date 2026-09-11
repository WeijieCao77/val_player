/**
 * The player career is its own game, not a mode of the manager game it was
 * forked from (作者 2026-09-11：「不要用任何经理模式的东西，如果有需要就复制一份」).
 *
 * Walks the import graph from the site's entry — src/main.tsx → App.tsx →
 * PlayerGame.tsx — and fails if a manager-mode module can be reached. Every
 * kind of import counts: static, dynamic, re-export, side-effect (the
 * stylesheets) and type-only, because a type kept in the manager's file is
 * still the manager's file.
 *
 * ALLOWED_FOR_NOW is what the career still reaches while the engine split is
 * in progress. It may only shrink: an entry that is no longer reachable fails
 * the check as well, so it is deleted the day it stops being true.
 *
 *   npx tsx scripts/check_boundary.ts          the verdict, with the chain that reaches each module
 *   npx tsx scripts/check_boundary.ts --all    and every module the career reaches
 */
import ts from 'typescript'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRIES = ['src/main.tsx']

/** The manager game's own modules: its shell, its engine, its card mode, its changelog and its stylesheet. */
const MANAGER = new Set([
  // the manager shell, the card mode, the dossier browser
  'src/ManagerGame.tsx', 'src/ui/CardMode.tsx', 'src/ui/Dossier.tsx',
  // the manager's engine that the career used to reach (audit group C)
  'src/engine/finance.ts', 'src/engine/commercial.ts', 'src/engine/leagueShare.ts', 'src/engine/staff.ts',
  'src/engine/manager.ts', 'src/engine/career.ts', 'src/engine/loyalty.ts', 'src/engine/life.ts',
  'src/engine/endings.ts', 'src/engine/actions.ts', 'src/engine/agenda.ts', 'src/engine/trust.ts',
  'src/engine/telemetry.ts',
  // the card game
  'src/engine/gacha.ts', 'src/engine/cards.ts', 'src/engine/arena.ts', 'src/engine/market.ts',
  // the manager's UI the career used to render (audit group C)
  'src/ui/PlayerModal.tsx', 'src/ui/ContractTerms.tsx', 'src/ui/useAction.ts',
  // the manager's release notes and stylesheet
  'src/data/changelog.ts', 'src/styles.css',
])
/** The card mode's screens. */
const MANAGER_TREES = ['src/ui/cards/']
/**
 * The shared UI the career has its own copies of in src/ui/me/ (common, ctx,
 * MatchModal, Standings, …): nothing in src/ui/ outside src/ui/me/ is the career's.
 */
const isSharedUi = (f: string) => f.startsWith('src/ui/') && !f.startsWith('src/ui/me/')

/**
 * Manager modules the career may still reach, and why. Only ever delete lines here.
 */
const ALLOWED_FOR_NOW: Record<string, string> = {
  // The engine split (a separate branch) takes these out of the career's week:
  // season.ts runs the club's books, the board, sponsors, staff and the
  // manager's wages; match.ts reads staff and the manager's skills; training
  // and transfer read trust, loyalty and staff; the endings' event names move
  // into the world core (rules 1, 7, 8 and 13 in the separation notes).
  'src/engine/finance.ts': 'engine split: season.ts',
  'src/engine/commercial.ts': 'engine split: season.ts',
  'src/engine/leagueShare.ts': 'engine split: season.ts',
  'src/engine/staff.ts': 'engine split: match.ts, training.ts, season.ts',
  'src/engine/manager.ts': 'engine split: match.ts, training.ts, season.ts',
  'src/engine/career.ts': 'engine split: season.ts',
  'src/engine/loyalty.ts': 'engine split: season.ts, training.ts, transfer.ts',
  'src/engine/life.ts': 'engine split: season.ts',
  'src/engine/endings.ts': 'engine split: season.ts; the event names ui/me/Schedule.tsx reads move to the world core',
  'src/engine/trust.ts': 'engine split: season.ts, training.ts',
  'src/engine/telemetry.ts': 'engine split: season.ts:42',
  // the manager's stylesheet, until the career's own copy is the one main.tsx loads
  'src/styles.css': 'player stylesheet pending',
}

type Kind = 'static' | 'dynamic' | 'reexport' | 'side-effect' | 'type'
interface Edge { to: string; line: number; kind: Kind }
interface Via { from: string; line: number; kind: Kind }

const posix = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/')

function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null // a package
  const base = path.resolve(ROOT, path.dirname(from), spec)
  const tries = [base, `${base}.ts`, `${base}.tsx`, `${base}.json`, `${base}.css`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
  for (const c of tries) if (existsSync(c) && statSync(c).isFile()) return posix(c)
  throw new Error(`${from}: cannot resolve '${spec}'`)
}

const edgeCache = new Map<string, Edge[]>()
function edgesOf(file: string): Edge[] {
  const had = edgeCache.get(file)
  if (had) return had
  const out: Edge[] = []
  edgeCache.set(file, out)
  if (!/\.(ts|tsx)$/.test(file)) return out // a stylesheet or a dataset imports nothing
  const text = readFileSync(path.join(ROOT, file), 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const add = (spec: ts.Node | undefined, at: ts.Node, kind: Kind) => {
    if (!spec || !ts.isStringLiteralLike(spec)) return
    const to = resolve(file, spec.text)
    if (to) out.push({ to, kind, line: sf.getLineAndCharacterOfPosition(at.getStart(sf)).line + 1 })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const c = node.importClause
      const named = c?.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : undefined
      const typeOnly = !!c && (c.isTypeOnly || (!c.name && !!named?.length && named.every((e) => e.isTypeOnly)))
      add(node.moduleSpecifier, node, !c ? 'side-effect' : typeOnly ? 'type' : 'static')
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const named = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : undefined
      add(node.moduleSpecifier, node, node.isTypeOnly || (!!named?.length && named.every((e) => e.isTypeOnly)) ? 'type' : 'reexport')
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0], node, 'dynamic')
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, node, 'type')
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** Breadth first, so the chain printed for a module is its shortest way in. */
function reach(runtimeOnly: boolean): Map<string, Via | null> {
  const seen = new Map<string, Via | null>(ENTRIES.map((e) => [e, null]))
  const queue = [...ENTRIES]
  while (queue.length) {
    const f = queue.shift()!
    for (const e of edgesOf(f)) {
      if (runtimeOnly && e.kind === 'type') continue
      if (seen.has(e.to)) continue
      seen.set(e.to, { from: f, line: e.line, kind: e.kind })
      queue.push(e.to)
    }
  }
  return seen
}

function chainOf(seen: Map<string, Via | null>, f: string): string {
  const parts = [f]
  for (let via = seen.get(f); via; via = seen.get(via.from)) {
    parts.push(`${via.from}:${via.line}${via.kind === 'static' ? '' : ` (${via.kind})`}`)
  }
  return parts.join('  ←  ')
}

const managerReason = (f: string): string | null =>
  MANAGER.has(f) || MANAGER_TREES.some((t) => f.startsWith(t)) ? 'manager module'
    : isSharedUi(f) ? 'shared or manager UI — the career draws only from src/ui/me/'
      : null

const runtime = reach(true)
const all = reach(false)
const listAll = process.argv.includes('--all')

const hits = [...all.keys()].filter((f) => managerReason(f)).sort()
const allowed = hits.filter((f) => f in ALLOWED_FOR_NOW)
const forbidden = hits.filter((f) => !(f in ALLOWED_FOR_NOW))
const stale = Object.keys(ALLOWED_FOR_NOW).filter((f) => !all.has(f)).sort()
const notManager = Object.keys(ALLOWED_FOR_NOW).filter((f) => !managerReason(f)).sort()

const describe = (f: string) => {
  const seen = runtime.has(f) ? runtime : all
  return `  ${chainOf(seen, f)}${runtime.has(f) ? '' : '  [types only]'}`
}

console.log(`boundary: ${all.size} modules reachable from ${ENTRIES.join(', ')} (${runtime.size} at runtime)`)
if (listAll) {
  for (const f of [...all.keys()].sort()) console.log(`  ${f}${runtime.has(f) ? '' : '  [types only]'}`)
}
if (allowed.length) {
  console.log(`\nallowed for now (${allowed.length}) — the list in scripts/check_boundary.ts may only shrink:`)
  for (const f of allowed) console.log(`${describe(f)}\n      ${ALLOWED_FOR_NOW[f]}`)
}
if (forbidden.length) {
  console.log(`\nFORBIDDEN (${forbidden.length}) — the career reaches manager-mode code:`)
  for (const f of forbidden) console.log(`${describe(f)}\n      ${managerReason(f)}`)
}
if (stale.length) {
  console.log(`\nSTALE allow-list entries (${stale.length}) — no longer reachable, delete them from ALLOWED_FOR_NOW:`)
  for (const f of stale) console.log(`  ${f}`)
}
if (notManager.length) {
  console.log(`\nallow-list entries that are not manager modules (${notManager.length}) — they do not belong in ALLOWED_FOR_NOW:`)
  for (const f of notManager) console.log(`  ${f}`)
}

const failed = forbidden.length + stale.length + notManager.length > 0
console.log(`\n${failed ? 'FAIL' : 'ok'}: ${forbidden.length} forbidden, ${allowed.length} allowed for now, ${stale.length} stale`)
process.exit(failed ? 1 : 0)
