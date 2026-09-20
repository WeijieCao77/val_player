/**
 * 玩家信箱, the game's side: three calls to the author's server, and nothing else.
 *
 * The server half is box.js at the root of the repo, which holds the whole
 * design; this file only asks it things. What leaves this browser is what the
 * player typed into the mailbox and the same random device id the stats use
 * (engine/me/telemetry.ts deviceId) — no career, no IGN, no save, no name.
 *
 * Nothing here is allowed to matter to the game. Every call resolves to a
 * result object; a server that is down, blocked or behind a captive portal
 * comes back as `off` and the card says so. The career is played offline
 * exactly as before.
 *
 * The address is relative, like the stats endpoint and for the same reason:
 * the game also answers at vctgames.com/player/, passed through by the manager
 * game's server, where '/api/box' would be the other game's. './api/box' is
 * this server's at both addresses.
 */
import { deviceId } from '../../engine/me/telemetry'

const BASE = './api/box'

/** 状态 as the server spells it (box.js STATE_CN). pending / hidden are only ever this device's own. */
export type BoxState = 'pending' | 'shown' | 'taken' | 'fixed' | 'hidden' | 'merged'

export interface BoxMerge {
  availability: 'public' | 'private' | 'missing'
  /** Only a currently public final target is returned; private content never crosses this API. */
  target?: { id: string; text: string; state: 'shown' | 'taken' | 'fixed'; votes: number }
}

export interface BoxItem {
  id: string
  /** when it was sent, server time */
  t: number
  /** what the player wrote. DATA: render it as a string, never as markup */
  text: string
  votes: number
  state: BoxState
  pin: 0 | 1
  /** sent by this browser */
  mine: boolean
  /** this browser has voted for it */
  voted: boolean
  /** Owner-only receipt, resolved to the final target at list time. */
  merge?: BoxMerge
}

export interface BoxList {
  items: BoxItem[]
  mine: BoxItem[]
  /** the longest a suggestion may be, as the server counts it */
  max: number
  /** the box is full: new suggestions are refused until the author clears some */
  full: boolean
}

export const STATE_CN: Record<BoxState, string> = {
  pending: '待审核', shown: '已展示', taken: '已采纳', fixed: '已修复', hidden: '未展示', merged: '已合并',
}

/** how long a call may take before the card says the server is not answering */
const TIMEOUT_MS = 8000

async function call(path: string, body: Record<string, unknown>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; why: string; off?: boolean }> {
  let stop: ReturnType<typeof setTimeout> | null = null
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
    if (ctl) stop = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    const r = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, ...body }),
      signal: ctl ? ctl.signal : undefined,
    })
    // 429 and the like still carry a sentence to show: the server answers in JSON either way
    const j = (await r.json()) as Record<string, unknown>
    if (j && j.ok === true) return { ok: true, data: j }
    const why = typeof j?.why === 'string' && j.why ? j.why : '这一下没成，等会儿再试。'
    return { ok: false, why }
  } catch {
    return { ok: false, why: '连不上作者的信箱，等会儿再来。游戏不受影响。', off: true }
  } finally {
    if (stop) clearTimeout(stop)
  }
}

function asMerge(value: unknown): BoxMerge | undefined {
  if (!value || typeof value !== 'object') return undefined
  const m = value as Partial<BoxMerge>
  if (m.availability === 'private' || m.availability === 'missing') return { availability: m.availability }
  const t = m.target
  if (m.availability !== 'public' || !t || typeof t.id !== 'string' || typeof t.text !== 'string'
    || !['shown', 'taken', 'fixed'].includes(t.state)) return undefined
  return { availability: 'public', target: { id: t.id, text: t.text, state: t.state, votes: typeof t.votes === 'number' ? t.votes : 0 } }
}

const asItem = (v: unknown): BoxItem | null => {
  const o = v as Partial<BoxItem> | null
  if (!o || typeof o.id !== 'string' || typeof o.text !== 'string') return null
  return {
    id: o.id,
    t: typeof o.t === 'number' ? o.t : 0,
    text: o.text,
    votes: typeof o.votes === 'number' ? o.votes : 0,
    state: (typeof o.state === 'string' && o.state in STATE_CN ? o.state : 'shown') as BoxState,
    pin: o.pin ? 1 : 0,
    mine: !!o.mine,
    voted: !!o.voted,
    merge: o.state === 'merged' && o.mine === true ? asMerge(o.merge) : undefined,
  }
}
const asList = (v: unknown): BoxItem[] => (Array.isArray(v) ? v.map(asItem).filter((x): x is BoxItem => !!x) : [])

/** The board, and this browser's own entries whatever state they are in. */
export async function boxList(): Promise<{ ok: true; list: BoxList } | { ok: false; why: string; off?: boolean }> {
  const r = await call('list', { vid: deviceId() })
  if (!r.ok) return r
  return {
    ok: true,
    list: {
      items: asList(r.data.items).filter((it) => ['shown', 'taken', 'fixed'].includes(it.state)),
      mine: asList(r.data.mine),
      max: typeof r.data.max === 'number' ? r.data.max : 200,
      full: !!r.data.full,
    },
  }
}

/** Send one. It waits for the author to show it; the sender sees it under 我的 meanwhile. */
export async function boxNew(text: string): Promise<{ ok: true; item: BoxItem } | { ok: false; why: string; off?: boolean }> {
  const r = await call('new', { vid: deviceId(), text })
  if (!r.ok) return r
  const item = asItem(r.data.item)
  return item ? { ok: true, item } : { ok: false, why: '发出去了，但没收到回执，刷新看看。' }
}

/** One device, one vote, changeable. */
export async function boxVote(id: string, on: boolean): Promise<{ ok: true; votes: number; on: boolean } | { ok: false; why: string; off?: boolean }> {
  const r = await call('vote', { vid: deviceId(), id, on })
  if (!r.ok) return r
  return { ok: true, votes: typeof r.data.votes === 'number' ? r.data.votes : 0, on: !!r.data.on }
}
