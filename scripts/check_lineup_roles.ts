/**
 * The coach's five reads second roles, and a benching says why (reported 2026-09-24:
 * 「得多看点副位置，不然会出现能力低的当首发」「比赛打完后获胜了，让能力低的替补我有点没法理解」).
 *
 * 一 a weak specialist does not start over a better man when the job he covers is covered by somebody's second
 *    role — the match engine counts second roles the same (match.ts compositionScore)
 * 二 the four jobs still come first: the only man who can play one starts, however weak
 * 三 the caller still goes out with the team, and an injured man does not start over a fit one
 * 四 a benching names the man and the reason in words, never the bare 「本周你回到替补席。」: the sample
 *    discount, the trust, the form, the fatigue, the room, or the four jobs
 *
 *   npx tsx scripts/check_lineup_roles.ts
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { PROMISE_FLOOR, benchLine, coachStarters, weeklyLineup } from '../src/engine/me/coach'
import type { GameState, Player, Role } from '../src/engine/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
}
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

let bad = 0
const check = (ok: boolean, what: string) => { console.log(`  ${ok ? '✓' : '✗'} ${what}`); if (!ok) bad++ }

interface Spec { ign: string; role: Role; roles?: Role[]; ov: number; me?: boolean; igl?: boolean; hurt?: boolean; rounds?: number; form?: number; fatigue?: number }

/** my club, its roster replaced by these men — everyone seen for years, rested, on form, nobody's promise in the way */
function squad(specs: Spec[]): GameState {
  const s = createCareer({ name: 'Five', region: 'EMEA', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2024 })
  const me = s.me!
  const team = s.teams[s.myTeam]
  const others = Object.values(s.players).filter((p) => p.id !== me.id && !!p.teamId && p.teamId !== s.myTeam)
  const ids: string[] = []
  specs.forEach((sp, i) => {
    const p: Player = sp.me ? s.players[me.id] : others[i]
    if (!sp.me) {
      const old = s.teams[p.teamId!]
      if (old) { old.roster = old.roster.filter((x) => x !== p.id); old.starters = old.starters.filter((x) => x !== p.id) }
      p.teamId = team.id
    }
    p.ign = sp.ign; p.role = sp.role; p.roles = sp.roles ?? [sp.role]; p.overall = sp.ov
    p.rounds = sp.rounds ?? 20000; p.form = sp.form ?? 70; p.fatigue = sp.fatigue ?? 0
    p.injuredUntil = sp.hurt ? s.day + 30 : 0
    p.isIgl = !!sp.igl
    if (sp.igl) p.iglSource = undefined
    ids.push(p.id)
  })
  team.roster = ids
  team.starters = ids.slice(0, 5)
  me.proven = true
  me.coachTrust = 60
  me.trial = undefined
  me.benchLock = undefined
  me.promiseMatches = PROMISE_FLOOR
  me.historyArrivals = undefined
  me.graceMatches = 0
  return s
}
const names = (s: GameState, ids: string[]) => ids.map((id) => s.players[id].ign).sort().join(' ')

// 一 先锋 is covered by two men's second roles; the weak main-role 先锋 sat in the five before
{
  const s = squad([
    { ign: 'Duel', role: '决斗者', ov: 84 },
    { ign: 'Me', role: '决斗者', ov: 82, me: true },
    { ign: 'Flex', role: '控场', roles: ['控场', '先锋'], ov: 83 },
    { ign: 'Sent', role: '哨卫', roles: ['哨卫', '先锋'], ov: 81 },
    { ign: 'Weak', role: '先锋', ov: 66 },
    { ign: 'Smoke', role: '控场', ov: 70 },
  ])
  const five = coachStarters(s)
  check(!five.includes(Object.values(s.players).find((p) => p.ign === 'Weak')!.id),
    `一：先锋由副位置补上，弱的专职先锋不进首发（${names(s, five)}）`)
  check(five.includes(s.me!.id), '一：综合更高的我在首发里')
}

// 二 only one man can play 哨卫: he starts, however weak
{
  const s = squad([
    { ign: 'Duel', role: '决斗者', ov: 84 },
    { ign: 'Me', role: '决斗者', ov: 82, me: true },
    { ign: 'Flex', role: '控场', roles: ['控场', '先锋'], ov: 83 },
    { ign: 'Init', role: '先锋', ov: 80 },
    { ign: 'OnlySent', role: '哨卫', ov: 62 },
    { ign: 'Duel2', role: '决斗者', ov: 79 },
  ])
  const five = coachStarters(s)
  check(five.includes(Object.values(s.players).find((p) => p.ign === 'OnlySent')!.id), `二：唯一的哨卫照样首发（${names(s, five)}）`)
}

// 三 the caller goes out with the team; the injured man does not start over a fit one
{
  const s = squad([
    { ign: 'Duel', role: '决斗者', ov: 84 },
    { ign: 'Me', role: '决斗者', ov: 82, me: true },
    { ign: 'Flex', role: '控场', roles: ['控场', '先锋'], ov: 83 },
    { ign: 'Sent', role: '哨卫', roles: ['哨卫', '先锋'], ov: 81 },
    { ign: 'Caller', role: '先锋', ov: 66, igl: true },
    { ign: 'Hurt', role: '哨卫', roles: ['哨卫', '决斗者'], ov: 90, hurt: true },
  ])
  const five = coachStarters(s)
  const id = (n: string) => Object.values(s.players).find((p) => p.ign === n)!.id
  check(five.includes(id('Caller')), `三：指挥照样跟队上场（${names(s, five)}）`)
  check(!five.includes(id('Hurt')), '三：伤着的人不排进首发')
}

// 四 a benching says why
{
  const s = squad([
    { ign: 'Duel', role: '决斗者', ov: 84 },
    { ign: 'Me', role: '决斗者', ov: 80, me: true, form: 50 },
    { ign: 'Flex', role: '控场', roles: ['控场', '先锋'], ov: 83 },
    { ign: 'Sent', role: '哨卫', roles: ['哨卫', '先锋'], ov: 81 },
    { ign: 'Vet', role: '决斗者', roles: ['决斗者', '先锋'], ov: 78 },
    { ign: 'Star', role: '哨卫', ov: 90 },
  ])
  const me = s.me!
  me.proven = false
  s.players[me.id].rounds = 500
  me.coachTrust = 40
  const team = s.teams[s.myTeam]
  team.starters = [...team.roster.filter((id) => s.players[id].ign !== 'Vet')]
  const before = me.log.length
  weeklyLineup(s)
  const line = me.log.slice(before).map((l) => l.text).find((t) => t.startsWith('本周你回到替补席')) ?? ''
  check(!team.starters.includes(me.id), '四：综合 80 的新人坐到替补，综合 78 的老将首发')
  check(line.includes('Vet') && line.includes('综合能力不如你') && /还没转正|不够信任|状态不如他/.test(line),
    `四：换下来的那一行说了是谁、为什么：「${line}」`)
  check(line !== '本周你回到替补席。', '四：不再只有一句「本周你回到替补席。」')
  // plainly the better man: said as that
  const t = squad([
    { ign: 'Duel', role: '决斗者', ov: 86 },
    { ign: 'Me', role: '决斗者', ov: 78, me: true },
    { ign: 'Duel2', role: '决斗者', ov: 85 },
    { ign: 'Smoke', role: '控场', ov: 80 },
    { ign: 'Init', role: '先锋', ov: 80 },
    { ign: 'Sent', role: '哨卫', ov: 80 },
  ])
  const tt = t.teams[t.myTeam]
  tt.starters = coachStarters(t)
  const l2 = benchLine(t)
  check(!tt.starters.includes(t.me!.id) && l2.includes('Duel2') && l2.includes('他现在整体比你强') && !l2.includes('不如你'),
    `四：明摆着更强的人首发，也照实说：「${l2}」`)
}

console.log(bad ? `\n${bad} 项不对` : '\n首发与副位置：全部通过')
process.exit(bad ? 1 : 0)
