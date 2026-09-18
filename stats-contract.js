/* 事件契约 —— 服务端收什么，就是这一份表。

   这是客户端 src/engine/me/telemetry.ts 里 TELEMETRY_EVENTS 和 TELEMETRY_VALUES 的纯 JS 镜像：
   16 个事件名、每个名字各自允许的属性名、每个属性的值长什么样。server.js 是零依赖的 node ESM，
   导不了 .ts，所以只能照抄。

   照抄一份是危险的——一份看着权威其实过期的表，比没有表还糟。所以它由
   scripts/check_stats.ts 兜底：那里会把这份表和客户端导出的 TELEMETRY_EVENTS / TELEMETRY_VALUES
   **逐个事件、逐个属性名、逐条值规则**对一遍，两个方向都对，对不上就把差异打出来并让核查挂掉。
   游戏那边加一个事件、改一个属性名、多一个枚举值，或者这份镜像自己放旧了，都会变成一条红线，
   而不是看板上某一节悄悄空掉——空图表看着和「还没人玩」一模一样，这种错能挂好几个
   星期没人发现。（原来这份表里写的是 career_end，而客户端发的是 ending。）
   scripts/check_telemetry.ts 管另一头：真跑一局发出去的每一个值，这里的规则都得收。

   属性名按事件收窄，不是一张大表：ending 的 key 不该能出现在 session_start 上。
   这也是「不记玩家打进去的文字」那条线的执行处——客户端那边的规矩是「只发这个游戏
   自己的枚举值和数字」，选手的 IGN 是全游戏唯一一个玩家自己打的字段，它永远不出门；
   服务端这一层是第二道闸，表外的键落不了盘。
   特别地：这里没有 msg / message / text 这类键。引擎的报错信息会把拿到的东西原样
   插进去，而那可以是任何东西——所以报错只报出错的文件和行号（errors 的 at）。

   值也按规则收（外部审查 2026-09-18）：原来只核属性名，值是任意 48 个字以内的字符串、任意
   有限数——region / role / start / 结局 key 能变成随便什么聚合键，active_s 能报 1e308，
   看板上的「人均在线」就成了 1.4e304 小时。现在每个属性都有一条规则：
     int  整数，落在 [min, max] 里。累计量的上限按「一个会话真走得到的」往宽里给，
          超出的那个值不认（丢掉这一个属性，事件本身照收）；
     bool 真假；
     enum 游戏自己的词表，一个字都不许差（客户端那边按引擎的联合类型逐个拼出来，漏一个编译不过）；
     str  没有固定词表的（域名、页面名、出错位置）：按正则收，不认就丢。 */

const int = (min, max) => ({ t: 'int', min, max })
const BOOL = { t: 'bool' }
const oneOf = (...of) => ({ t: 'enum', of })
const str = (re) => ({ t: 'str', re })

// ── 数字 ──
const YEAR = int(2000, 2100)
/** 赛季里的第几天（engine/season.ts 每个赛季从 0 数起） */
const DAY = int(0, 1000)
const AGE = int(0, 99)
/** 1 是 VCT，2 是 Challengers，0 是没有俱乐部 */
const TIER = int(0, 2)
/** 一段生涯里数得出来的东西：赛季、场次、冠军 */
const CAREER = int(0, 10000)
/** 一个会话里一行累计量的总数：一晚上点十万次页面已经不是人了 */
const SITTING = int(0, 100000)
/** 一个会话确认在玩的秒数：两天两夜，已经远远超过任何一次真的坐下来 */
const SECS = int(0, 172800)
const PX = int(0, 20000)

// ── 词表：和引擎一字不差（客户端 TELEMETRY_VALUES 按联合类型拼，check_telemetry 再对引擎的常量）──
const PHASE = oneOf('pre', 'pro', 'free', 'retired')
const REGION = oneOf(
  'Americas', 'EMEA', 'Pacific', 'China',
  'North America', 'Europe', 'Turkey', 'CIS', 'Brazil', 'LATAM',
  'Korea', 'Japan', 'SEA', 'Malaysia & Singapore', 'Indonesia',
  'Thailand', 'Philippines', 'Vietnam', 'Hong Kong & Taiwan',
  'MENA', 'South Asia', 'Oceania',
)
const ROLE = oneOf('决斗者', '先锋', '控场', '哨卫', '自由人')
const START = oneOf('pre', 'chal', 't1')
/** 新生涯页能选的出身卡（engine/me/origins.ts ORIGINS）；殿堂解锁的那两张已经收回，建档时不会再出现 */
const ORIGIN = oneOf(
  'netcafe', 'cs', 'streamer', 'radiant', 'rich', 'academy', 'campus',
  'town', 'korea', 'late', 'exchild', 'grinder',
)
const ENDING = oneOf(
  'breaker', 'dynasty', 'world', 'master', 'uncrowned', 'regional', 'ring',
  'oneclub', 'evergreen', 'abroad', 'titled', 'journeyman', 'flash', 'shore',
)
const RETIRE_WHY = oneOf('world_end', 'pre_unsigned', 'free_uncalled', 'age_cap', 'age_decline', 'chose', 'other')
const COMP = oneOf('champions', 'masters', 'lockin', 'qual', 'chal', 'league')
const CEREMONY = oneOf('draw', 'depart', 'final', 'media', 'rehab', 'farewell', 'awards', 'retire', 'patch', 'showmatch', 'tryout')
const PITCH_WHY = oneOf('full', 'import', 'nevpro', 'buyout', 'gap', 'starter', 'luck')
const THEME = oneOf('dark', 'light', 'cream')

// ── 没有固定词表的 ──
/** 域名：来源页和进站的门（URL 的 hostname，已经是 ASCII；下划线不合规范，但真有域名这么起） */
const HOST = str('^[A-Za-z0-9_.-]{1,48}$')
/** 页面的键（PlayerGame 的 SCREENS 和几个直达的页），小写单词 */
const SCREEN = str('^[a-z][a-z0-9_]{0,23}$')
/** 出错的构建文件和行列（telemetry.ts errorSite），或者 promise / unknown。vite 的 hash 里有 _ 和 - */
const ERROR_AT = str('^(?:[A-Za-z0-9_.~%@+-]{1,40}:[0-9]{1,9}:[0-9]{1,9}|promise|unknown)$')

/** 每个事件、每个属性的值规则。逐行对应客户端的 TELEMETRY_VALUES。 */
export const PROP_RULES = {
  // ── 一次一条 ──
  session_start: { ref: HOST, host: HOST, w: PX, h: PX, new_id: BOOL, had_save: BOOL, theme: THEME },
  session_ping: { active_s: SECS },
  session_end: { active_s: SECS, reason: oneOf('pagehide', 'gap') },
  career_start: {
    year: YEAR, region: REGION, role: ROLE, start: START, origin: ORIGIN,
    talent_max: int(0, 100), talent_spread: int(0, 100), talent_points: int(0, 100),
  },
  career_resume: { day: DAY, year: YEAR, phase: PHASE, tier: TIER, pro_seasons: CAREER, age: AGE },
  season_done: { n: CAREER, year: YEAR, tier: TIER, matches: CAREER, starts: CAREER, titles: CAREER },
  ending: {
    key: ENDING, why: RETIRE_WHY, age: AGE, pro_seasons: CAREER, titles: CAREER, titles_started: CAREER,
    peak_tier: TIER, year: YEAR, entry_year: int(0, 2100),
  },
  save_fail: { what: oneOf('pack', 'write'), kb: int(0, 1000000), packed: BOOL, year: YEAR, day: DAY },
  // ── 累计量：每次报的是「到目前为止的总数」 ──
  screens: { to: SCREEN, hits: SITTING },
  turns: { turns: SITTING, many: SITTING, day: DAY, year: YEAR, phase: PHASE, tier: TIER },
  matches: { cls: COMP, played: SITTING, skip: SITTING, started: SITTING },
  ceremonies: { kind: CEREMONY, played: SITTING, skip: SITTING, gold: SITTING, bronze: SITTING },
  cups: { enter: SITTING, skip: SITTING, round: SITTING, forfeit: SITTING },
  offers: {
    deal_in: SITTING, invite_in: SITTING, accept: SITTING, decline: SITTING, aside: SITTING,
    expire: SITTING, pitch: SITTING, contact: SITTING, pitch_ok: SITTING, pitch_no: SITTING,
  },
  pitch_why: { why: PITCH_WHY, n: SITTING },
  // 一个渲染里抛的错每一帧都抛，一小时就是二十万次：这一行的上限给得比别的宽
  errors: { n: int(0, 10000000), at: ERROR_AT },
}

/** 每个事件各自允许的属性名（就是上面那张表的键）。逐行对应客户端的 TELEMETRY_EVENTS。 */
export const EVENT_PROPS = Object.fromEntries(Object.entries(PROP_RULES).map(([e, r]) => [e, Object.keys(r)]))

const RE = new Map()
/**
 * 一个值按它的规则收：收下返回这个值，不认返回 undefined。
 * 服务端在收事件和重放 JSONL 的时候都走这一个函数；check_telemetry 拿它核真跑一局发出去的每一个值。
 */
export function cleanValue(rule, v) {
  if (!rule) return undefined
  switch (rule.t) {
    case 'int': return Number.isInteger(v) && v >= rule.min && v <= rule.max ? v : undefined
    case 'bool': return typeof v === 'boolean' ? v : undefined
    case 'enum': return typeof v === 'string' && rule.of.includes(v) ? v : undefined
    case 'str': {
      if (typeof v !== 'string') return undefined
      let re = RE.get(rule.re)
      if (!re) { re = new RegExp(rule.re); RE.set(rule.re, re) }
      return re.test(v) ? v : undefined
    }
    default: return undefined
  }
}

/** 一次一条的那几个 */
export const ONE_OFF = [
  'session_start', 'session_ping', 'session_end',
  'career_start', 'career_resume', 'season_done', 'ending', 'save_fail',
]

/**
 * 累计量事件怎么读：服务端按 (会话, 组, 行键, 字段) 取见过的最大值再累加差值——
 * 重发的信标因此是空操作，「同一个总数再来一遍」加的是 0，迟到的那份也一秒都不加。
 * 会话的这张水位表跨天活着：过了零点报上来的还是这个会话的总数，只有涨出来的那一截算今天的。
 *
 * key：这一组按哪个属性分行（'' 表示整组只有一行）。有行键的组，行键不认的那一条整条不收——
 *      不然它会落进一个「没有名字的行」里，和别的会话攒的数混在一起。
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
