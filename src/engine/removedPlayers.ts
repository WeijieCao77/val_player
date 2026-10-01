import raw from '../data/removed_players.json'
import { hashStr } from './rng'

/**
 * The people the author took out of the game for good (src/data/removed_players.json).
 *
 * Decided 2026-09-25 after players reported what one professional had said: 「把这个选手直接踢出游戏」.
 * He is not retired and not a free agent — he is not in the game. Who he is, is in the list and
 * nowhere else under src/ (scripts/check_removed_players.ts holds that). The builders leave him out
 * of every file the game reads (scripts/removed.py), so a world made today never holds him;
 * this is the same list for the rest:
 *
 *  - every path that could put somebody into the player pool asks one predicate,
 *    engine/staffStints.ts offPoolOn, and a man on this list is off the pool on every day
 *  - a save from before leaves him as it loads (me/staffMigrate.ts migrateRemoved)
 */

export interface RemovedPlayer {
  vlr: string
  ign: string
  reason: string
  date: string
}

const PLAYERS = ((raw as { players?: RemovedPlayer[] }).players ?? []).filter((p) => /^\d+$/.test(p.vlr) && !!p.ign)

export const REMOVED_PLAYERS: readonly RemovedPlayer[] = PLAYERS

const BY_VLR = new Set(PLAYERS.map((p) => p.vlr))

/** The list as a stamp: a save brought up to it (WorldState.removedSync) is not brought up to it again. */
export const REMOVED_STAMP = hashStr(PLAYERS.map((p) => p.vlr).sort().join('|')).toString(36)

/** Is this vlr id one of theirs. */
export const removedVlr = (vlr: string): boolean => BY_VLR.has(vlr)

/** Is this player id one of theirs: the book's people carry their vlr id in it (V + id). */
export const removedPlayer = (playerId: string): boolean => /^V\d+$/.test(playerId) && BY_VLR.has(playerId.slice(1))

/** Their player ids, as a save holds them. */
export const removedPlayerIds = (): string[] => PLAYERS.map((p) => `V${p.vlr}`)

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Their handles in a text, in any case, as a whole word: 「<handle> 加盟」 matches, a handle that
 * merely contains the letters does not. Null when nobody is on the list.
 */
// Short handles may also be English words. Only their exact spelling identifies a
// player in prose; longer handles keep the existing case-insensitive cleanup.
const namePattern = (protectedNames: readonly string[] = []): RegExp | null => {
  const protectedSet = new Set(protectedNames.map((n) => n.toLowerCase()))
  const names = PLAYERS.filter((p) => !protectedSet.has(p.ign.toLowerCase())).map((p) =>
    p.ign.length <= 3 ? escape(p.ign) : [...p.ign].map((c) => /[a-z]/i.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : escape(c)).join(''))
  return names.length ? new RegExp(`(?<![A-Za-z0-9_])(?:${names.join('|')})(?![A-Za-z0-9_])`, 'g') : null
}
export const REMOVED_NAME: RegExp | null = namePattern()

/** Does this text name one of them. */
export function namesRemoved(text: string): boolean {
  if (!REMOVED_NAME) return false
  REMOVED_NAME.lastIndex = 0
  return REMOVED_NAME.test(text)
}

/** What a record kept from before says in place of his handle: a box score's line, a trophy's roster, a sentence. */
export const REMOVED_LABEL = '已移出选手'

/** A text with every mention of them in place of the handle. */
export const unname = (text: string): string => (REMOVED_NAME ? text.replace(REMOVED_NAME, REMOVED_LABEL) : text)

/**
 * Every string under `root` that names one of them, renamed in place (REMOVED_LABEL), and a key
 * that does too. A list in `feeds` — the news, the log: lists of `{ text }` — loses an entry whose
 * text names him instead, since a line that was about him says nothing once he is not in it.
 * Records keep their shape: a box score still has ten lines, a trophy's roster still five names.
 */
export function scrubNames(root: unknown, feeds: readonly unknown[] = [], protectedNames: readonly string[] = []): { renamed: number; dropped: number } {
  const out = { renamed: 0, dropped: 0 }
  const pattern = namePattern(protectedNames)
  if (!pattern) return out
  const matches = (text: string) => { pattern.lastIndex = 0; return pattern.test(text) }
  const replace = (text: string) => text.replace(pattern, REMOVED_LABEL)
  const feedSet = new Set(feeds.filter((f) => Array.isArray(f)))
  const stack: unknown[] = [root]
  const seen = new Set<object>()
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (Array.isArray(node)) {
      if (feedSet.has(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          const t = (node[i] as { text?: unknown } | null)?.text
          if (typeof t === 'string' && matches(t)) {
            node.splice(i, 1)
            out.dropped++
          }
        }
      }
      for (let i = 0; i < node.length; i++) {
        const v = node[i]
        if (typeof v === 'string') {
          if (matches(v)) { node[i] = replace(v); out.renamed++ }
        } else if (v && typeof v === 'object') stack.push(v)
      }
      continue
    }
    const o = node as Record<string, unknown>
    for (const k of Object.keys(o)) {
      let key = k
      if (matches(k)) {
        key = replace(k)
        if (!(key in o)) o[key] = o[k]
        delete o[k]
        out.renamed++
      }
      const v = o[key]
      if (typeof v === 'string') {
        if (matches(v)) { o[key] = replace(v); out.renamed++ }
      } else if (v && typeof v === 'object') stack.push(v)
    }
  }
  return out
}
