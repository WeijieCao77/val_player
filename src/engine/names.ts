import type { GameState } from './types'

/**
 * The names clubs really went by, where vlr's is not it.
 *
 * vlr.gg shows a club under its name of today on every page of its past —
 * DRX's 2022 matches read 「KIWOOM DRX」, a naming deal of March 2026 — and
 * timeline.json, circuit.json and world_2021.json were all read off vlr. So a
 * club that changed its name while the book had it wore the later name years
 * early. (A rename vlr filed under a new team id — Sengoku Gaming to QT DIG∞ —
 * is a lineage entry instead: src/data/lineage.json.)
 *
 * Each entry is a vlr team id and the names it went by, oldest first, each
 * from the day it took effect ('' — already, when the timeline opens). Every
 * one was checked against a dated source; a rename that could not be dated is
 * not here. A tag is given only where a source gives one — otherwise the club
 * keeps the tag it has.
 *
 * Read wherever a name comes in: the 2021 world and its new-career list
 * (engine/world.ts, engine/me/career.ts), the roster book as each year opens
 * (engine/timeline.ts), each real event on the day it began (engine/circuit.ts),
 * and historyNames() below, which moves a club across on the day it changed.
 */
type Spell = readonly [from: string, name: string, tag?: string]

const HISTORY: Record<string, readonly Spell[]> = {
  // TSM FTX: the naming-rights deal of 2021-06-04, dropped 2022-11-16.
  // https://en.wikipedia.org/wiki/Team_SoloMid
  // https://www.washingtonpost.com/video-games/esports/2022/11/16/tsm-ftx-naming-deal-suspended/
  106: [['', 'TSM'], ['2021-06-04', 'TSM FTX'], ['2022-11-16', 'TSM']],
  // Rix.GG's main team became Rix.GG Thunder when it signed Rix.GG Lightning.
  // https://twitter.com/RixGG_/status/1386005175291289604 (2021-04-24) · https://liquipedia.net/valorant/Rix.GG_Thunder
  2373: [['', 'Rix.GG'], ['2021-04-24', 'Rix.GG Thunder']],
  // Crest Gaming DWFN until that roster left (2021-03-31); back in VALORANT as Crest Gaming, renamed Crest Gaming Zst.
  // https://twitter.com/crest_gaming/status/1468173785757069315 (2021-12-07)
  // https://twitter.com/crest_gaming/status/1519225156492828672 (2022-04-27) · https://liquipedia.net/valorant/Crest_Gaming_Zst
  294: [['', 'Crest Gaming DWFN'], ['2021-12-07', 'Crest Gaming'], ['2022-04-27', 'CREST GAMING Zst']],
  // LAZER became E-Xolos LAZER with Club Tijuana Xolos on 2021-10-08; Liquipedia's event pages have LAZER
  // through August 2021 and E-Xolos LAZER from October. (LazerKlan before March 2021, and the later return
  // to LAZER, have no date: not here.)
  // https://liquipedia.net/valorant/LAZER · https://www.youtube.com/watch?v=K165EhksIfQ
  724: [['', 'LAZER'], ['2021-10-08', 'E-Xolos LAZER']],
  // X10 Esports partnered with CRIT Esports as X10 CRIT, and went back to X10 Esports.
  // https://twitter.com/X10Esports_/status/1461320308179173381 (2021-11-18)
  // https://twitter.com/X10ESPORTS_TH/status/1543892575794241536 (2022-07-04) · https://liquipedia.net/valorant/X10_Esports
  2112: [['', 'X10 Esports'], ['2021-11-18', 'X10 CRIT'], ['2022-07-04', 'X10 Esports']],
  // Blaze Esports and SuperMassive merged as SuperMassive Blaze (2021-06-01), Papara SuperMassive from 2022-12-17.
  // https://twitter.com/SMBreports/status/1399687465221431300 · https://lol.fandom.com/wiki/Papara_SuperMassive
  4567: [['', 'SuperMassive Blaze'], ['2022-12-17', 'Papara SuperMassive']],
  // DetonatioN Gaming and TEAM GAMEWITH became DetonatioN FocusMe.
  // https://twitter.com/team_detonation/status/1602226856572305411 (2022-12-12) · https://liquipedia.net/valorant/DetonatioN_FocusMe
  278: [['', 'DetonatioN Gaming'], ['2022-12-12', 'DetonatioN FocusMe']],
  // 9z Team, 9z Globant for Globant's sponsorship: 「PRESENTACIÓN OFICIAL: 9Z GLOBANT」.
  // https://twitter.com/9zTeam/status/1763326685951426844 (2024-02-29) · https://liquipedia.net/valorant/9z_Team
  367: [['', '9z Team'], ['2024-02-29', '9z Globant']],
  // Shopify Rebellion's Challengers side renamed Shopify Rebellion Black at the Challengers NA organiser's request.
  // https://liquipedia.net/valorant/Shopify_Rebellion_Black · https://x.com/dionginge/status/1882361842032644260
  9353: [['', 'Shopify Rebellion'], ['2025-01-22', 'Shopify Rebellion Black']],
  // DRX's naming sponsorship with Kiwoom Securities, signed 2026-03-19; DRX announced 「키움 DRX」 and the
  // KRX tricode on 2026-03-20 KST.
  // https://x.com/VALO2ASIA/status/2034900785830772863 · https://spilled.gg/drx-krx-sponsorship-name-change/
  // https://www.vlr.gg/645471/drx-changed-their-name · https://x.com/drx_global/status/2034861240292446385
  8185: [['', 'DRX', 'DRX'], ['2026-03-19', 'KIWOOM DRX', 'KRX']],
}

/** year and day of the year (0 = 1 January) as one comparable number */
const keyOf = (year: number, day: number): number => year * 1000 + day

const fromKey = (iso: string): number => {
  if (!iso) return -Infinity
  const y = Number(iso.slice(0, 4))
  return keyOf(y, Math.round((Date.UTC(y, Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) - Date.UTC(y, 0, 1)) / 864e5))
}

function spellOn(vlr: string, year: number, day: number): Spell | undefined {
  const k = keyOf(year, day)
  let hit: Spell | undefined
  for (const s of HISTORY[vlr] ?? []) if (fromKey(s[0]) <= k) hit = s
  return hit
}

/** The name club `vlr` went by on `day` of `year`, and its tag where a source gives one; null where vlr's own stands. */
export function realName(vlr: string, year: number, day: number): { name: string; tag?: string } | null {
  const s = spellOn(vlr, year, day)
  return s ? { name: s[1], tag: s[2] } : null
}

/**
 * Each club listed takes the name it had today — the club history carried it
 * on as, where the player's club did (engine/timeline.ts inherit). A name that
 * changed today is news, and a note when it is the player's club; anything
 * else is a quiet correction: a world made from vlr's names, or a save from
 * before this table. A world with no such club — the manager game's 2026 —
 * is not touched.
 */
export function historyNames(state: GameState, notes: string[]): void {
  for (const vlr of Object.keys(HISTORY)) {
    const id = `V21T${vlr}`
    const heir = state.heirs?.[id]
    const t = state.teams[heir && state.teams[heir] ? heir : id]
    const now = spellOn(vlr, state.year, state.day)
    if (!t || !now || (t.name === now[1] && (!now[2] || t.tag === now[2]))) continue
    const old = t.name
    t.name = now[1]
    if (now[2]) t.tag = now[2]
    if (old === t.name || t.dormant || fromKey(now[0]) !== keyOf(state.year, state.day)) continue
    const mine = t.id === state.myTeam
    const line = `🔁 ${old} 更名为 ${t.name}。`
    state.news.push({ day: state.day, kind: 'club', important: mine, text: line })
    if (mine) notes.push(`${line}你的俱乐部跟着真实历史改名。`)
  }
}
