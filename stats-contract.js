/* 事件契约 —— 服务端收什么，就是这一份表。

   这是客户端 src/engine/me/telemetry.ts 里 TELEMETRY_EVENTS 的纯 JS 镜像：16 个事件名，
   每个名字各自允许的属性名。server.js 是零依赖的 node ESM，导不了 .ts，所以只能照抄。

   照抄一份是危险的——一份看着权威其实过期的表，比没有表还糟。所以它由
   scripts/check_stats.ts 兜底：那里会把这份表和客户端导出的 TELEMETRY_EVENTS
   **逐个事件、逐个属性名**对一遍，两个方向都对，对不上就把差异打出来并让核查挂掉。
   游戏那边加一个事件、改一个属性名，或者这份镜像自己放旧了，都会变成一条红线，
   而不是看板上某一节悄悄空掉——空图表看着和「还没人玩」一模一样，这种错能挂好几个
   星期没人发现。（原来这份表里写的是 career_end，而客户端发的是 ending。）

   属性名按事件收窄，不是一张大表：ending 的 key 不该能出现在 session_start 上。
   这也是「不记玩家打进去的文字」那条线的执行处——客户端那边的规矩是「只发这个游戏
   自己的枚举值和数字」，选手的 IGN 是全游戏唯一一个玩家自己打的字段，它永远不出门；
   服务端这一层是第二道闸，表外的键落不了盘。
   特别地：这里没有 msg / message / text 这类键。引擎的报错信息会把拿到的东西原样
   插进去，而那可以是任何东西——所以报错只报出错的文件和行号（errors 的 at）。 */

/** 每个事件各自允许的属性名。逐行对应客户端的 TELEMETRY_EVENTS。 */
export const EVENT_PROPS = {
  // ── 一次一条 ──
  session_start: ['ref', 'host', 'w', 'h', 'new_id', 'had_save', 'theme'],
  session_ping: ['active_s'],
  session_end: ['active_s', 'reason'],
  career_start: ['year', 'region', 'role', 'start', 'origin', 'talent_max', 'talent_spread', 'talent_points'],
  career_resume: ['day', 'year', 'phase', 'tier', 'pro_seasons', 'age'],
  season_done: ['n', 'year', 'tier', 'matches', 'starts', 'titles'],
  ending: ['key', 'why', 'age', 'pro_seasons', 'titles', 'titles_started', 'peak_tier', 'year', 'entry_year'],
  save_fail: ['what', 'kb', 'packed', 'year', 'day'],
  // ── 累计量：每次报的是「到目前为止的总数」 ──
  screens: ['to', 'hits'],
  turns: ['turns', 'many', 'day', 'year', 'phase', 'tier'],
  matches: ['cls', 'played', 'skip', 'started'],
  ceremonies: ['kind', 'played', 'skip', 'gold', 'bronze'],
  cups: ['enter', 'skip', 'round', 'forfeit'],
  offers: ['deal_in', 'invite_in', 'accept', 'decline', 'aside', 'expire', 'pitch', 'contact', 'pitch_ok', 'pitch_no'],
  pitch_why: ['why', 'n'],
  errors: ['n', 'at'],
}

/** 一次一条的那几个 */
export const ONE_OFF = [
  'session_start', 'session_ping', 'session_end',
  'career_start', 'career_resume', 'season_done', 'ending', 'save_fail',
]

/**
 * 累计量事件怎么读：服务端按 (会话, 组, 行键, 字段) 取见过的最大值再累加差值——
 * 重发的信标因此是空操作，「同一个总数再来一遍」加的是 0，迟到的那份也一秒都不加。
 *
 * key：这一组按哪个属性分行（'' 表示整组只有一行）。
 * nums：该行里哪些字段是累计的数字。其余字段（at、phase 之类）是标签，取最后一次。
 */
export const ROLLUPS = {
  screens: { key: 'to', nums: ['hits'] },
  turns: { key: '', nums: ['turns', 'many'] },
  matches: { key: 'cls', nums: ['played', 'skip', 'started'] },
  ceremonies: { key: 'kind', nums: ['played', 'skip', 'gold', 'bronze'] },
  cups: { key: '', nums: ['enter', 'skip', 'round', 'forfeit'] },
  offers: {
    key: '',
    nums: ['deal_in', 'invite_in', 'accept', 'decline', 'aside', 'expire', 'pitch', 'contact', 'pitch_ok', 'pitch_no'],
  },
  pitch_why: { key: 'why', nums: ['n'] },
  errors: { key: '', nums: ['n'] },
}

export const ROLLUP_NAMES = Object.keys(ROLLUPS)

/** 收得下的事件名，就这 16 个 */
export const EVENTS = new Set(Object.keys(EVENT_PROPS))

/** 所有属性名的并集（按事件收窄的那份在 EVENT_PROPS 里，这个只给核查用） */
export const PROP_KEYS = new Set(Object.values(EVENT_PROPS).flat())
