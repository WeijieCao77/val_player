/**
 * What the game reports back about how it is being played.
 *
 * The career's own, as everything under engine/me/ is. It began as the manager
 * game's engine/telemetry.ts and was copied here rather than shared (「不要用
 * 任何经理模式的东西，如果有需要就复制一份」, 2026-09-11): that module still sits
 * where it is, still keyed to the manager's storage, and nothing in player mode
 * reaches it — scripts/check_boundary.ts is what keeps it that way. What was
 * worth keeping was kept: the anonymous id, the thirty-minute session gap, a
 * heartbeat that only counts a minute the tab was visible AND the player was
 * awake for, rolled-up counters instead of a row per click, a bounded queue,
 * and an entry point that swallows everything it throws.
 *
 * The author had no idea whether anyone came back a second time. This answers
 * that, and stops there: it records what someone did with the game, never who
 * they are.
 *
 * ── What may never go into an event ──────────────────────────────────────
 *
 * Only this game's own enumerated values and numbers. No free text the player
 * typed, no IGN, no club or team-mate name, nothing a person could be
 * recognised by — not in a prop, not in an id, not folded into a longer
 * string. The server must never log an IP address either: there is no ingest
 * endpoint yet, and whoever writes it is bound by the same rule.
 *
 * This is not a style note. A career's IGN is typed by the player and is often
 * the handle they use everywhere else; every other name in this game belongs to
 * a real professional. So names never leave: a competition goes out as its
 * class ('masters', 'chal'), a club as its tier (1 or 2), a reason as one of a
 * fixed list. When something has no enumerated form, it does not go.
 *
 * scripts/check_telemetry.ts drives a whole career with a distinctive IGN and
 * fails if that string — or any other player's handle — ever reaches a payload,
 * and fails on a prop that is not a number, a boolean or a short enumerated
 * token. Keep it that way.
 *
 * ── Who ──────────────────────────────────────────────────────────────────
 *
 * Identity is a random id generated in the browser on first visit. The server
 * never sees or stores an IP address. Two consequences worth stating plainly:
 * clearing site data makes someone a new person, and two people sharing a
 * phone are one person. For "did anyone come back", that is far more accurate
 * than an IP — Chinese carriers put hundreds of users behind one address and
 * move a single user between several in an evening.
 *
 * Nothing here can break the game. Every entry point swallows its own errors,
 * the queue is bounded, and a server that is down or blocked simply means the
 * events are dropped.
 */

const ENDPOINT = '/api/e'
const ID_KEY = 'val_player:vid'
const SEQ_KEY = 'val_player:vseq'

/**
 * The career's save and the ground it is drawn on, as engine/me/save.ts and
 * ui/me/theme.ts write them. Read raw, by their literal keys, and never
 * imported: the save reports its own failures through this module, so importing
 * it here would close a cycle.
 */
const SAVE_KEY = 'val_player:save:autosave'
const THEME_KEY = 'val_player.theme'
/** where the ground lived while the career was a mode of the manager game (ui/me/theme.ts) */
const OLD_THEME_KEY = 'valmgr.theme'

/** Longest gap that still counts as the same sitting. */
const SESSION_GAP_MS = 30 * 60 * 1000
/** How often an open tab confirms someone is still there. */
const HEARTBEAT_MS = 60 * 1000
/**
 * Playtime is the sum of confirmed minutes, not wall-clock between first and
 * last event. A tab left open overnight stops confirming — the page is hidden
 * and nothing is being clicked — so the night does not count as play.
 */
const IDLE_MS = 3 * 60 * 1000

type Props = Record<string, string | number | boolean | null | undefined>

interface Queued {
  name: string
  t: number
  /** monotonic within the session, so a re-delivered batch can be recognised */
  n: number
  props?: Props
}

let visitorId = ''
let sessionId = ''
let sessionSeq = 0
let queue: Queued[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
let lastActivity = 0
/** confirmed active milliseconds this session */
let activeMs = 0
/** every event this session gets the next number, and keeps it across retries */
let eventNo = 0
let started = false
let disabled = false

const now = () => Date.now()

/** the same keys ui/me/theme.ts writes; read raw here so the engine never imports the ui */
const themeNow = (): string => {
  try { return localStorage.getItem(THEME_KEY) ?? localStorage.getItem(OLD_THEME_KEY) ?? 'dark' } catch { return 'dark' }
}

function readId(): string {
  try {
    let v = localStorage.getItem(ID_KEY)
    if (!v) {
      // crypto.randomUUID is unavailable on http:// origins in some browsers
      v = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
      localStorage.setItem(ID_KEY, v)
    }
    return v
  } catch {
    // private mode with storage denied: still usable, just never recognised again
    return `eph-${Math.random().toString(36).slice(2, 12)}`
  }
}

function bumpSession(): void {
  try {
    const n = Number(localStorage.getItem(SEQ_KEY) ?? '0') + 1
    localStorage.setItem(SEQ_KEY, String(n))
    sessionSeq = n
  } catch {
    sessionSeq = 1
  }
  sessionId = `${visitorId.slice(0, 8)}-${now().toString(36)}`
}

/** Roughly what kind of screen this is, which is all the layout work needs. */
function device(): string {
  const w = window.innerWidth
  return w < 720 ? 'phone' : w < 1100 ? 'tablet' : 'desktop'
}

function send(events: Queued[], keepalive: boolean): void {
  if (!events.length) return
  const body = JSON.stringify({
    v: 1,
    vid: visitorId,
    sid: sessionId,
    seq: sessionSeq,
    dev: device(),
    tz: -new Date().getTimezoneOffset(),
    events,
  })
  try {
    // sendBeacon survives the page being closed, which is exactly when the
    // session-end event fires and is the one we least want to lose
    if (keepalive && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive,
    }).catch(() => {})
  } catch {
    /* nothing here is worth breaking a game over */
  }
}

function flush(keepalive = false): void {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  const batch = queue
  queue = []
  send(batch, keepalive)
}

/**
 * The most a queue may hold before the oldest are dropped.
 *
 * track() already flushes at 20, so this only ever bites if a flush cannot
 * leave (offline, or the endpoint blocked) while a rollup adds its rows. A
 * dropped event is always better than a page whose memory grows all evening.
 */
const MAX_QUEUE = 200

function enqueue(name: string, props?: Props): void {
  queue.push({ name, t: now(), n: ++eventNo, props })
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
}

/**
 * Record something the player did.
 *
 * Batched: a phone on a flaky connection should not make a request per click,
 * and the queue is capped so a long offline stretch cannot grow without bound.
 */
export function track(name: string, props?: Props): void {
  if (disabled || !started) return
  try {
    lastActivity = now()
    enqueue(name, props)
    if (queue.length >= 20) { flush(); return }
    if (!flushTimer) flushTimer = setTimeout(() => flush(), 5000)
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/*  the rolled-up counters                                             */
/* ------------------------------------------------------------------ */

/**
 * Everything that repeats is counted here and reported as running totals, not
 * as one row per click.
 *
 * Measured on a week of the manager game's real traffic: 341 rows per visitor,
 * of which `screen` was 52% and the turn 23% — three quarters of the table
 * spent on two events that nothing ever reads individually. The dashboard asks
 * 「哪个页面被打开了多少次」 and 「最深推到第几天、人均多少回合」, both of which
 * are aggregates, and an aggregate does not need one row per click.
 *
 * So they are counted and reported the way the playtime ping already works:
 * cumulative, sent when the tab goes away and occasionally during a long
 * sitting, and read back as a max per session. That shape is what makes a
 * re-delivered beacon harmless — a repeat of a total is the same total, and
 * applying it twice changes nothing.
 *
 * Only the rows that CHANGED since the last report go out, which is what stops
 * a long session from turning the saving back into a cost.
 */
interface Group {
  /** one row per key — the key's own fields are written into the row */
  rows: Map<string, Props>
  /** what was last reported for that key, so an unchanged row is not sent again */
  sent: Map<string, string>
}
const groups = new Map<string, Group>()

/**
 * A runaway key would grow the report without bound. No group in this game has
 * more than a dozen: eleven screens, six competition classes, eleven ceremony
 * kinds, seven reasons a club says no.
 */
const MAX_KEYS = 40

function groupOf(name: string): Group {
  let g = groups.get(name)
  if (!g) { g = { rows: new Map(), sent: new Map() }; groups.set(name, g) }
  return g
}

/**
 * Add to one row of a rolled-up group. Numbers accumulate; strings are the
 * row's own key fields and are simply written.
 */
function bump(group: string, key: string, add: Props): void {
  if (disabled || !started) return
  try {
    lastActivity = now()
    const g = groupOf(group)
    let row = g.rows.get(key)
    if (!row) {
      if (g.rows.size >= MAX_KEYS) return
      row = {}
      g.rows.set(key, row)
    }
    for (const [k, v] of Object.entries(add)) {
      if (typeof v === 'number') row[k] = ((row[k] as number) ?? 0) + v
      else row[k] = v
    }
  } catch {
    /* a counter is never worth an exception */
  }
}

/** One screen opened. Counted, not sent. */
export function countScreen(to: string): void {
  if (!to) return
  bump('screens', to, { to, hits: 1 })
}

/**
 * One week advanced, and how deep the career had got by then.
 *
 * `many` is a multi-week run (「推进到赛段末」) rather than one press of
 * 推进一周: the two are different enough that an average over both says
 * nothing about either.
 */
export function countTurn(o: { day: number; year: number; phase: string; tier: number; many?: boolean }): void {
  if (disabled || !started) return
  lastActivity = now()
  turnCount++
  if (o.many) manyCount++
  if (Number.isFinite(o.day) && o.day > deepDay) deepDay = o.day
  if (Number.isFinite(o.year) && o.year > deepYear) deepYear = o.year
  if (o.phase) lastPhase = o.phase
  // 1 是 VCT，2 是 Challengers：越小越高，0 是还没有俱乐部
  if (o.tier === 1) bestTier = 1
  else if (o.tier === 2 && bestTier !== 1) bestTier = 2
}

let turnCount = 0
let manyCount = 0
let deepDay = 0
let deepYear = 0
let bestTier = 0
let lastPhase = ''
let turnsSent = ''

/**
 * A match of my club's, by what kind of competition it was: played through
 * round by round, or fast-forwarded to the result, and whether I started.
 *
 * The competition is its class (engine/me/compclass.ts), never its name — the
 * name is a real event in a real year, and the class is the whole of what the
 * question 「他们在打什么比赛」 needs.
 */
export function countMatch(cls: string, played: boolean, starter: boolean): void {
  bump('matches', cls || 'league', {
    cls: cls || 'league',
    played: played ? 1 : 0,
    skip: played ? 0 : 1,
    started: starter ? 1 : 0,
  })
}

/**
 * A ceremony: walked past (「直接过去」) or played, and what it landed on.
 * Skipping lands on silver by design (engine/me/ceremony.ts cerSkip), so a
 * skip is counted as a skip and not as a bronze.
 */
export function countCeremony(kind: string, played: boolean, tier: string): void {
  if (!kind) return
  bump('ceremonies', kind, {
    kind,
    played: played ? 1 : 0,
    skip: played ? 0 : 1,
    gold: played && tier === 'gold' ? 1 : 0,
    bronze: played && tier === 'bronze' ? 1 : 0,
  })
}

/** A cup: entered, walked past, a round played, or given up on its day. */
export function countCup(what: 'enter' | 'skip' | 'round' | 'forfeit'): void {
  bump('cups', '', {
    enter: what === 'enter' ? 1 : 0,
    skip: what === 'skip' ? 1 : 0,
    round: what === 'round' ? 1 : 0,
    forfeit: what === 'forfeit' ? 1 : 0,
  })
}

/**
 * The transfer market, in one row: what arrived and what was done with it.
 *
 * `deal_in` / `invite_in` are counted where the card is put in front of me
 * (engine/me/pending.ts), and each offer only the first time — an offer set
 * aside and reopened from the 转会 page goes through the same door twice.
 */
const seenOffers = new Set<string>()

export function countOffer(
  what: 'deal_in' | 'invite_in' | 'accept' | 'decline' | 'aside' | 'expire' | 'pitch' | 'contact' | 'pitch_ok' | 'pitch_no',
  id?: string,
): void {
  if (disabled || !started) return
  if (what === 'deal_in' || what === 'invite_in') {
    const k = `${what}:${id ?? ''}`
    if (!id || seenOffers.has(k)) return
    // a career cannot produce this many offers; the guard is against a loop, not against play
    if (seenOffers.size < 2000) seenOffers.add(k)
  }
  bump('offers', '', { [what]: 1 })
}

/**
 * Why a club said no to a 自荐 or a 主动接触 — one of the seven the engine
 * weighs (engine/me/types.ts PitchWhy). This is the one thing that says whether
 * 自荐 is a road or a wall.
 */
export function countPitchWhy(why: string): void {
  if (!why) return
  bump('pitch_why', why, { why, n: 1 })
}

/**
 * An uncaught error reached the window.
 *
 * The message is deliberately NOT reported: an engine message interpolates
 * whatever it was given, and that can be anything. The build file and line are
 * enough to find it with a source map, and they are the build's, not the
 * player's.
 */
export function countError(at: string): void {
  bump('errors', '', { n: 1, at })
}

/** Everything the rollups hold, forgotten when a new sitting begins. */
function resetRollups(): void {
  groups.clear()
  turnCount = 0
  manyCount = 0
  deepDay = 0
  deepYear = 0
  bestTier = 0
  lastPhase = ''
  turnsSent = ''
  seenOffers.clear()
}

/**
 * Queue whatever moved since last time.
 *
 * Deliberately NOT through track(): track() stamps lastActivity, and a report
 * is not the player doing something — the same trap the playtime ping fell
 * into once already.
 */
function queueRollups(): void {
  for (const [name, g] of groups) {
    for (const [key, row] of g.rows) {
      const shot = JSON.stringify(row)
      if (g.sent.get(key) === shot) continue
      g.sent.set(key, shot)
      enqueue(name, { ...row })
    }
  }
  if (turnCount) {
    const row: Props = {
      turns: turnCount, many: manyCount,
      day: deepDay, year: deepYear, phase: lastPhase, tier: bestTier,
    }
    const shot = JSON.stringify(row)
    if (turnsSent !== shot) {
      turnsSent = shot
      enqueue('turns', row)
    }
  }
}

/** How often a long sitting reports its totals anyway, in heartbeats. */
const ROLLUP_EVERY = 15

let sinceReport = 0
let sinceRollup = 0

/**
 * One confirmed minute.
 *
 * The accumulated total is also reported every few minutes, not only at the
 * end. iOS Safari drops `pagehide` often enough that a session-end-only design
 * loses the playtime of exactly the users this game has most of — so the total
 * is sent as it grows, and the dashboard takes the largest figure it has seen
 * for a session rather than requiring a final one.
 */
function tick(): void {
  const idle = now() - lastActivity
  if (document.visibilityState !== 'visible' || idle > IDLE_MS) return
  activeMs += HEARTBEAT_MS
  sinceReport += HEARTBEAT_MS
  sinceRollup += 1
  // a sitting long enough to be worth insuring against a lost pagehide
  if (sinceRollup >= ROLLUP_EVERY) { sinceRollup = 0; queueRollups() }
  if (sinceReport >= 3 * HEARTBEAT_MS) {
    sinceReport = 0
    // Deliberately NOT through track(): track() stamps lastActivity, so the
    // heartbeat kept resetting the very idle timer that is supposed to stop
    // it. A tab left open and untouched reported four hours of "active" play.
    enqueue('session_ping', { active_s: Math.round(activeMs / 1000) })
    flush()
  }
}

function end(reason: string): void {
  if (!started) return
  queueRollups()
  enqueue('session_end', { active_s: Math.round(activeMs / 1000), reason })
  flush(true)
}

/** The build file and line an error came from — never its message. */
function errorSite(file: unknown, line: unknown, col: unknown): string {
  try {
    const name = String(file ?? '').split(/[?#]/)[0].split('/').pop() ?? ''
    return name ? `${name}:${Number(line) || 0}:${Number(col) || 0}` : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Start reporting. Safe to call twice; does nothing when the page is served
 * from a file:// origin or a dev server, so local play is never counted.
 */
export function startTelemetry(): void {
  if (started || typeof window === 'undefined') return
  if (location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    disabled = true
    return
  }
  started = true
  visitorId = readId()
  bumpSession()
  eventNo = 0
  lastActivity = now()
  resetRollups()

  let hadSave = false
  let freshId = false
  try {
    hadSave = !!localStorage.getItem(SAVE_KEY)
    freshId = sessionSeq === 1
  } catch { /* storage denied */ }
  track('session_start', {
    // WeChat and Xiaohongshu webviews strip the referrer, so this is mostly
    // null for the audience that matters — kept because when it is there it
    // is the only thing that says where someone came from
    ref: document.referrer ? new URL(document.referrer).hostname : null,
    // Which door they came in by. The game answers on more than one domain and
    // they all reach the same server and the same table, so without this the
    // author cannot tell whether a domain is carrying any traffic at all — a
    // referrer only ever names somewhere else.
    host: location.hostname,
    w: window.innerWidth,
    h: window.innerHeight,
    // a first-ever id sitting next to an existing save means the id churned
    new_id: freshId,
    had_save: hadSave,
    // which ground the page is drawn on — the light themes were asked for by
    // people the black page made dizzy, and this is whether they found them
    theme: themeNow(),
  })

  heartbeat = setInterval(tick, HEARTBEAT_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // a long time away is a new sitting, not a continuation of the old one
      if (now() - lastActivity > SESSION_GAP_MS) {
        end('gap')
        activeMs = 0
        sinceReport = 0
        sinceRollup = 0
        bumpSession()
        eventNo = 0
        // the totals are per session and are read back as a max per session,
        // so a new session has to start them over or the first report of the
        // new one would carry the old one's numbers
        resetRollups()
        track('session_start', {
          ref: null, host: location.hostname, w: window.innerWidth, h: window.innerHeight,
          theme: themeNow(),
        })
      }
      lastActivity = now()
    } else {
      // going away is the reliable moment on a phone — iOS drops pagehide
      // often enough that a rollup which only left at session end would be
      // lost for exactly the audience this game has most of
      queueRollups()
      flush(true)
    }
  })
  window.addEventListener('pagehide', () => end('pagehide'))

  // There is no React error boundary in this game (ui/me/ has none), so the
  // window is the only place an uncaught error can be noticed at all. Counted,
  // never one row each: a render that throws throws on every frame.
  window.addEventListener('error', (e) => {
    const ev = e as unknown as { filename?: unknown; lineno?: unknown; colno?: unknown }
    countError(errorSite(ev.filename, ev.lineno, ev.colno))
  })
  window.addEventListener('unhandledrejection', () => countError('promise'))
}

/** Only for tests. */
export function _stopTelemetry(): void {
  if (heartbeat) clearInterval(heartbeat)
  heartbeat = null
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  started = false
  disabled = false
  queue = []
  activeMs = 0
  sinceReport = 0
  sinceRollup = 0
  resetRollups()
}

/** Only for tests: what the rollups are holding right now. */
export function _rollupState() {
  const out: Record<string, Props[]> = {}
  for (const [name, g] of groups) out[name] = [...g.rows.values()].map((r) => ({ ...r }))
  return { groups: out, turnCount, manyCount, deepDay, deepYear, bestTier, lastPhase, queued: queue.length }
}

/** Only for tests: report the totals now, the way a tab going away does. */
export function _rollupNow(): void {
  queueRollups()
}
