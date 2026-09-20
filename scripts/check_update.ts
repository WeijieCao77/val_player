/**
 * 开着的页面自己换到新版本. The author, 2026-09-20, was still clicking 「−」 on a
 * week board hours after the click-to-act build went live: 「我点了我还可以取消，
 * 这完全不合理，因为我点了之后我的数值已经增加了。」 That 「−」 had been gone from
 * the code since 1addcd8 — the page was the old build, kept alive in an open
 * tab. So the rule this checks is not about the week board at all: a page must
 * not be able to sit on a build that is no longer live.
 *
 *  一 the decision itself (ui/me/update.ts updateAct): same build, dev server, a
 *    new build with nobody's hands on it, a match being played, a save that did
 *    not go in, and hands on the page
 *  二 稍后 is quiet for a while and not forever, it comes back by hand, and a
 *    build newer than the one it was pressed on asks on its own again
 *  三 the clocks: found within about a minute and a half, asked often enough to
 *    matter, and no fetch storm when a tab is flicked in and out
 *  四 the old build's leftovers: a save written by the plan build has its week
 *    refunded the first time the new build opens it, and the player is told once
 *
 *   npx tsx scripts/check_update.ts
 */
import { AT_LEAST, EVERY, IDLE, QUIET, updateAct } from '../src/ui/me/update'
import type { UpdateNow } from '../src/ui/me/update'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { ACTION_BY_KEY } from '../src/engine/me/actions'
import { migratePlayerSave } from '../src/engine/me/save'
import type { GameState } from '../src/engine/types'

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

let fails = 0
const check = (ok: boolean, what: string): void => { console.log(`  ${ok ? '✓' : '✗'} ${what}`); if (!ok) fails++ }
const t0 = Date.now()

const NOW = 1_800_000_000_000
const OLD = 'assets/index-AAAAAAAA.js'
const NEW = 'assets/index-BBBBBBBB.js'
const NEWER = 'assets/index-CCCCCCCC.js'

/** a page that loaded OLD, has heard about NEW, and whose player let go of the mouse a minute ago */
const page = (over: Partial<UpdateNow> = {}): UpdateNow => ({
  mine: OLD, newest: NEW, busy: false, quiet: null, failed: false,
  acted: NOW - 60_000, now: NOW, ...over,
})

/* ---- 一 ---- */
console.log('\n一、开着的页面碰上新版本时怎么办')
{
  check(updateAct(page({ newest: OLD })) === 'none', '服务器还是这一版：什么都不做')
  check(updateAct(page({ newest: null })) === 'none', '还没问到是哪一版：什么都不做')
  check(updateAct(page({ mine: null })) === 'none', '开发服务器上（文件名没有版本号）：什么都不做')
  check(updateAct(page()) === 'reload', '有新版本、没人动这个页面：自己存档刷新，不用等人点')
  check(updateAct(page({ busy: true })) === 'bar', '正在打比赛：不刷新，只挂一条')
  check(updateAct(page({ failed: true })) === 'bar', '刚才那次自动刷新存档没存上：不刷新，只挂一条')
  check(updateAct(page({ acted: NOW - 1000 })) === 'wait', '玩家的手还在页面上：先等一下，别把页面抽走')
  check(updateAct(page({ acted: NOW - IDLE - 1 })) === 'reload', `松开 ${IDLE / 1000} 秒以后就可以自己刷新`)
}

/* ---- 二 ---- */
console.log('\n二、点了「稍后」以后')
{
  const quiet = { build: NEW, until: NOW + QUIET }
  check(updateAct(page({ quiet })) === 'none', '这半小时里不再打扰')
  check(updateAct(page({ quiet, now: NOW + QUIET - 1000 })) === 'none', '半小时没到，还是安静的')
  check(updateAct(page({ quiet, now: NOW + QUIET + 1000 })) === 'bar', '半小时过了再问一次——而且是挂一条让人点，不替他做主')
  check(updateAct(page({ quiet, newest: NEWER })) === 'reload', '又出了更新的一版：这是另一个问题，照样自己刷新')
  check(updateAct(page({ quiet, newest: NEWER, busy: true })) === 'bar', '更新的一版碰上正在打比赛：还是只挂一条')
  check(QUIET > 0 && QUIET <= 60 * 60 * 1000, `「稍后」是有期限的（${QUIET / 60000} 分钟），不是这辈子不再问`)
}

/* ---- 三 ---- */
console.log('\n三、多久能发现')
{
  check(EVERY <= 90 * 1000, `每 ${EVERY / 1000} 秒问一次服务器`)
  check(EVERY >= 45 * 1000, `也没有频到一直在问（${EVERY / 1000} 秒一次）`)
  check(EVERY + IDLE <= 95 * 1000, `从上线到这个页面自己刷新，最多 ${(EVERY + IDLE) / 1000} 秒`)
  check(AT_LEAST > 0 && AT_LEAST < EVERY, `标签页来回切也不会每次都去拉一遍（最少隔 ${AT_LEAST / 1000} 秒）`)
}

/* ---- 四 ---- */
console.log('\n四、老版本留下的那一周：新版本打开时退点，并且只说一次')
{
  const s: GameState = createCareer({
    name: '更新', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 7,
  })
  const me = s.me!
  // a save written by the plan build: the hours are on the plan and the points are already gone
  me.ap = 1
  me.plan = { aim: 2, vod: 1 }
  const owed = ACTION_BY_KEY.aim.cost * 2 + ACTION_BY_KEY.vod.cost
  migratePlayerSave(s)
  check(me.ap === Math.min(me.apMax, 1 + owed), `新版本一打开就把 ${owed} 点行动退了回来（1 → ${me.ap}）`)
  check(!me.plan.aim && !me.plan.vod, '排好的那些一件不做，也不留在这周的账上')
  const said = (me.weekLog ?? []).filter((l) => l.includes('退回了'))
  check(said.length === 1, `跟玩家说了一次：「${said[0] ?? '（没说）'}」`)
  // the same save opened again — a second reload, another tab — does not say it twice or hand out points twice
  const ap = me.ap
  migratePlayerSave(s)
  check(me.ap === ap, '再打开一次不会又退一遍点')
  check((me.weekLog ?? []).filter((l) => l.includes('退回了')).length === 1, '这句话也不会说第二遍')
}

console.log(fails
  ? `\n✗ ${fails} 项不对。`
  : `\n✓ 开着的页面会自己换到新版本：没人动它就存档刷新，打比赛时只挂一条，「稍后」只安静半小时，老版本排好的那一周退点并只说一次。（${((Date.now() - t0) / 1000).toFixed(1)} 秒）`)
process.exit(fails ? 1 : 0)
