import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { TRACKS } from '../../data/music_me'
import './music.css'

/**
 * The career's own copy of Val Manager's music window (作者 2026-09-18：「我需要仿照
 * val manager加入音乐功能，音乐直接使用他的，音乐功能浮窗也直接照抄」), taken whole
 * from Val_Manager dc8e60c src/ui/MusicPlayer.tsx. The track list is the career's
 * (data/music_me.ts), the choices are kept under the career's own key, and where
 * it stands is said in music.css. It is a control of its own, apart from 音效
 * (sfx.ts): turning one off leaves the other as it was.
 *
 * Background music, and a record in the corner to run it from. Reported
 * 2026-09-19 by the author: 「网页里的音乐播放器可以做成浮窗吗？现在这个太大了，
 * 影响游玩」. Val Manager's window stood open by default, a 529×52 bar at the
 * bottom of the page (327×98 on a phone), and at 1920×1000 it lay over 推进一周
 * and 按推荐安排; on a 360px phone over the 下一步 card and its 去挑一家. Now the
 * record is all there is until it is pressed: 42px (40 on a phone), turning
 * while a song plays, with a small ▶ or ❚❚ on its edge. Pressed, it opens a
 * small card beside it — the song, play and pause, the songs either side, the
 * volume, the loop, the list — which closes on a press anywhere else, on Esc,
 * or on the record again. The card is not a dialog that holds the page: the
 * focus goes into it and comes back to the record, Tab walks on out of it, and
 * layer.ts never makes it inert.
 *
 * It starts off (作者 2026-09-18：「改成默认关点一下才放」): nothing plays and
 * nothing is fetched until the listener presses play in the window. Choices
 * kept before that rule (prefs without `v`) read as off too — the few hours the
 * music started by itself chose nothing for anyone. Once they have pressed
 * play, it resumes on their next visit where the browser allows that, and where
 * it does not — every phone — it waits for the first tap anywhere on the page
 * and starts then, which is the only way a web page is permitted to make a
 * sound. Until that tap the card says so instead of the artist's name.
 *
 * Everything the listener chooses stays on the device: the volume, whether
 * they turned it off, the loop mode, which track, whether the card is open,
 * and where the record was dragged to. Turned off means off — the next visit
 * does not even fetch the file. Like the theme, this is about the room the
 * screen is in, not the account, so it never rides along with a save.
 *
 * The <audio> is made by hand rather than rendered, so a track change is a
 * src-and-play inside the click that asked for it. Safari only trusts a play()
 * it can trace back to a gesture, and a React re-render cannot be traced back
 * to anything. A song still downloading gets the click's play() on the empty
 * element instead — see `load`.
 */
export type Loop = 'all' | 'one' | 'off'
const KEY = 'valplayer.music'

/** Where the player sits, in CSS pixels from the top-left, once it has been dragged. */
interface Pos { x: number; y: number }

interface Prefs {
  /** 0..1 */
  vol: number
  muted: boolean
  loop: Loop
  track: number
  /** the listener pressed pause; nothing plays, nothing loads, until they press play */
  off: boolean
  /** the card is open beside the record (false: just the record) */
  open: boolean
  /** absent until the first drag: the stylesheet's corner until then */
  pos?: Pos
  /**
   * The prefs' own version: 2 from the day music started off, 3 from the day the
   * window became a record (see the top of this file). Choices kept with no
   * version read as off; under 3, as folded — the open bar was everyone's
   * default, so an `open: true` from then says nothing about this card.
   */
  v?: number
}
const PREFS_V = 3
const DEFAULTS: Prefs = { vol: 0.35, muted: false, loop: 'all', track: 0, off: true, open: false, v: PREFS_V }

/** The gap the player keeps from the screen's edge. */
const EDGE = 12
/** A press that travels less than this is a tap, not a drag. */
const TAP = 6
/** The record's size before it has been drawn (base.css; 40 on a phone, music.css). */
const DISC = 42
/** The card's width, and its gap from the record. */
const POP_W = 288
const POP_GAP = 8
/** The card keeps this far from the screen's edge: a phone's record stands 8px in, and the card lines up with it. */
const POP_EDGE = 8

const clampPos = (p: Pos, w: number, h: number): Pos => ({
  x: Math.min(Math.max(EDGE, p.x), Math.max(EDGE, window.innerWidth - w - EDGE)),
  y: Math.min(Math.max(EDGE, p.y), Math.max(EDGE, window.innerHeight - h - EDGE)),
})

/** Against whichever side is nearer, like a phone's floating button. */
const snapPos = (p: Pos, w: number, h: number): Pos => clampPos({
  x: p.x + w / 2 < window.innerWidth / 2 ? EDGE : window.innerWidth - w - EDGE,
  y: p.y,
}, w, h)

const readPrefs = (): Prefs => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw) as Partial<Prefs>
    const v = typeof p.v === 'number' ? p.v : 0
    return {
      vol: typeof p.vol === 'number' && p.vol >= 0 && p.vol <= 1 ? p.vol : DEFAULTS.vol,
      muted: p.muted === true,
      loop: p.loop === 'one' || p.loop === 'off' ? p.loop : 'all',
      track: typeof p.track === 'number' && p.track >= 0 && p.track < TRACKS.length ? Math.floor(p.track) : 0,
      // kept before music started off: off, whatever it says (see the top of this file). Only then: a listener
      // who pressed play under 2 keeps playing through the move to 3, which changed where the controls are and nothing else
      off: p.off === true || v < 2,
      // kept while the bar stood open by default: folded, once (see `v`)
      open: p.open === true && v >= 3,
      v: PREFS_V,
      pos: p.pos && typeof p.pos.x === 'number' && typeof p.pos.y === 'number'
        && Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y)
        ? { x: p.pos.x, y: p.pos.y } : undefined,
    }
  } catch { return DEFAULTS }
}

const srcOf = (i: number): string =>
  `${typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : './'}${TRACKS[i].file}`

/**
 * Each song is downloaded once per device, not once per visit.
 *
 * Pointed straight at the file, an <audio> asks for it in ranges, and a
 * browser seldom answers a range from its cache: every visit and every reload
 * fetched the whole song again, and some browsers fetched it more than once
 * for a single play. That was nine tenths of everything the server sent —
 * 80 GB a day on 2026-09-10, the biggest line on the bill. Fetched whole into
 * Cache Storage and played from a blob, a returning visit sends nothing.
 * Wherever that cannot work (no Cache Storage in an in-app browser, a private
 * window, a full disk, a player that refuses blobs) the element gets the plain
 * URL, which is what every visit did before.
 */
const SONGS = 'bgm'
const HAS_CACHE = typeof caches !== 'undefined'

/** one key per recording whichever page asked; a new `?v=` is a new recording */
const keyOf = (i: number): string => `${location.origin}/${TRACKS[i].file}`

/** a song already on this device, as a URL the element can play */
async function fromCache(i: number): Promise<string | null> {
  if (!HAS_CACHE) return null
  try {
    const hit = await (await caches.open(SONGS)).match(keyOf(i))
    return hit ? URL.createObjectURL(await hit.blob()) : null
  } catch {
    return null
  }
}

/** the whole file, kept for next time; the plain URL if any step of that fails */
async function fromNetwork(i: number): Promise<string> {
  try {
    const r = await fetch(srcOf(i))
    if (!r.ok) return srcOf(i)
    const blob = await r.blob()
    try {
      const c = await caches.open(SONGS)
      await c.put(keyOf(i), new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mp4' } }))
      // A recording whose ?v= has moved on will never be asked for again. ONLY that: an older ?v= of a song on
      // this list. At vctgames.com/player/ this game shares the origin — and this cache, on purpose: same
      // songs, same keys, so a song either game fetched is there for the other — with Val Manager, and
      // sweeping everything that is not on THIS list would throw out the other game's songs the day the two
      // lists stop being the same, and each game would download them again every time the player came back
      // from the other (the 80 GB a day of 2026-09-10, by another road).
      const paths = new Set(TRACKS.map((t) => `${location.origin}/${t.file.split('?')[0]}`))
      for (const old of await c.keys()) {
        const mine = paths.has(old.url.split('?')[0])
        if (mine && !TRACKS.some((t) => old.url === `${location.origin}/${t.file}`)) void c.delete(old)
      }
    } catch { /* full, or refused: it still plays this visit */ }
    return URL.createObjectURL(blob)
  } catch {
    return srcOf(i)
  }
}

/** iOS owns the volume: the slider is ignored there, so it is not shown */
const IOS = typeof navigator !== 'undefined'
  && (/iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

const LOOPS: Record<Loop, { label: string; hint: string; next: Loop }> = {
  all: { label: '列表', hint: '列表循环', next: 'one' },
  one: { label: '单曲', hint: '单曲循环', next: 'off' },
  off: { label: '顺序', hint: '顺序播放，放完就停', next: 'all' },
}

export default function MusicPlayer() {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs)
  const [playing, setPlaying] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const patch = useCallback((p: Partial<Prefs>) => setPrefs((c) => ({ ...c, ...p })), [])

  const el = useCallback((): HTMLAudioElement => {
    if (!audio.current) {
      const a = new Audio()
      a.preload = 'auto'
      audio.current = a
    }
    return audio.current
  }, [])

  /** play, and remember whether the browser let us */
  const tryPlay = useCallback((a: HTMLAudioElement) => {
    a.play().then(() => setBlocked(false)).catch(() => { setBlocked(true); setPlaying(!a.paused) })
  }, [])

  /** the track the element holds, -1 while it holds none */
  const held = useRef(-1)
  /** songs in hand, as the URL to give the element */
  const ready = useRef(new Map<number, string>())
  /** songs on their way, so a second ask does not fetch the file twice */
  const coming = useRef(new Map<number, Promise<string>>())
  /** the latest ask: a song that lands after the listener has moved on is not played */
  const want = useRef(-1)
  /** this browser will not play a blob, so it gets the plain URL from here on */
  const plain = useRef(!HAS_CACHE)

  /** a song the element no longer holds gives its bytes back; coming back reads the cache again */
  const release = useCallback((j: number) => {
    const u = ready.current.get(j)
    if (!u?.startsWith('blob:')) return
    URL.revokeObjectURL(u)
    ready.current.delete(j)
    coming.current.delete(j)
  }, [])

  const point = useCallback((a: HTMLAudioElement, i: number, url: string) => {
    if (held.current === i) return
    const was = held.current
    a.src = url
    a.load()
    held.current = i
    release(was)
  }, [release])

  /** point the element at a track; `go` plays it too */
  const load = useCallback((i: number, go: boolean) => {
    const a = el()
    want.current = i
    if (plain.current) ready.current.set(i, srcOf(i))
    const url = ready.current.get(i)
    if (url) {
      point(a, i, url)
      if (go) tryPlay(a)
      return
    }
    // Not in hand yet. Safari lets an element play later only if it was asked
    // to play inside the tap, so the tap spends its play() now, on an empty
    // element, which then starts by itself once the song lands.
    if (go && a.paused) {
      const was = held.current
      if (a.getAttribute('src')) { a.removeAttribute('src'); a.load(); held.current = -1 }
      release(was)
      a.play().catch(() => { /* nothing to play yet: the call was for the permission */ })
    }
    let p = coming.current.get(i)
    if (!p) {
      p = fromCache(i).then((u) => u ?? fromNetwork(i))
      coming.current.set(i, p)
    }
    void p.then((u) => {
      ready.current.set(i, u)
      if (want.current !== i) return
      point(a, i, u)
      if (go && !prefsRef.current.off) tryPlay(a)
    })
  }, [el, point, release, tryPlay])

  // A browser that will not play a blob gets the plain URL for the rest of the visit.
  useEffect(() => {
    const a = el()
    const onError = () => {
      if (!a.src.startsWith('blob:')) return
      plain.current = true
      const blobs = [...ready.current.values()].filter((u) => u.startsWith('blob:'))
      ready.current.clear()
      coming.current.clear()
      const i = held.current
      if (i >= 0) {
        ready.current.set(i, srcOf(i))
        a.src = srcOf(i)
        a.load()
        if (!prefsRef.current.off) tryPlay(a)
      }
      blobs.forEach((u) => URL.revokeObjectURL(u))
    }
    a.addEventListener('error', onError)
    return () => a.removeEventListener('error', onError)
  }, [el, tryPlay])

  // the element, its listeners, and the first attempt at playing
  useEffect(() => {
    const a = el()
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => {
      const p = prefsRef.current
      const n = TRACKS.length
      const next = p.track + 1
      if (next < n) { patch({ track: next }); load(next, true); return }
      if (p.loop === 'off') { patch({ off: true }); return }
      if (n === 1) { a.currentTime = 0; tryPlay(a); return }
      patch({ track: 0 }); load(0, true)
    }
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    a.addEventListener('ended', onEnded)
    const p = prefsRef.current
    a.volume = p.vol
    a.muted = p.muted
    a.loop = p.loop === 'one'
    // The game's own chunks and pictures go first. The music waits for the
    // page to finish loading and a moment more, so a multi-megabyte file is
    // not fetched alongside the bundle on a phone connection — with the
    // file competing from the first byte, the song was reported as
    // stuttering. A page whose load event never comes (one slow picture is
    // enough) still gets its music a few seconds in. A tap before any of
    // this starts it at once, through the gesture effect below.
    let timer = 0
    const begin = () => {
      window.clearTimeout(timer)
      window.removeEventListener('load', onLoad)
      if (!prefsRef.current.off && a.paused) load(prefsRef.current.track, true)
    }
    const onLoad = () => { window.clearTimeout(timer); timer = window.setTimeout(begin, 1500) }
    if (!p.off) {
      if (document.readyState === 'complete') onLoad()
      else { window.addEventListener('load', onLoad); timer = window.setTimeout(begin, 5000) }
    }
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('load', onLoad)
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
      a.removeEventListener('ended', onEnded)
      a.pause()
    }
  }, [el, load, patch, tryPlay])

  // Should be playing and is not: the next gesture anywhere on the page is
  // the one we were waiting for — a phone refuses every play() that cannot
  // be traced to a tap, so the tap has to do the playing itself. Not a tap
  // on the window's own buttons: those know what they want, and a play
  // button that had already been played by this listener would read as a
  // pause and turn the music off. Gone once playback is under way.
  useEffect(() => {
    if (prefs.off || playing) return
    const go = (e: Event) => {
      if (e.target instanceof Element && e.target.closest('.bgm')) return
      if (!prefsRef.current.off) load(prefsRef.current.track, true)
    }
    const evs: (keyof WindowEventMap)[] = ['click', 'keydown', 'touchend']
    evs.forEach((e) => window.addEventListener(e, go, true))
    return () => evs.forEach((e) => window.removeEventListener(e, go, true))
  }, [prefs.off, playing, load])

  useEffect(() => { const a = el(); a.volume = prefs.vol; a.muted = prefs.muted }, [prefs.vol, prefs.muted, el])
  useEffect(() => { el().loop = prefs.loop === 'one' }, [prefs.loop, el])
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* private mode: lasts the session */ }
  }, [prefs])

  const track = TRACKS[prefs.track]

  // what the lock screen and the keyboard's media keys see
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: '猪之家游戏' })
    } catch { /* an older browser: no lock-screen card, nothing lost */ }
  }, [track])

  const toggle = useCallback(() => {
    const a = el()
    if (a.paused) { patch({ off: false }); load(prefsRef.current.track, true) } else { patch({ off: true }); a.pause() }
  }, [el, load, patch])

  const step = useCallback((d: 1 | -1) => {
    const n = TRACKS.length
    if (n < 2) return
    const i = (prefsRef.current.track + d + n) % n
    patch({ track: i, off: false })
    load(i, true)
  }, [load, patch])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const set = (k: MediaSessionAction, f: (() => void) | null) => { try { ms.setActionHandler(k, f) } catch { /* unsupported action */ } }
    // idempotent, unlike the button: the OS repeats itself, and a 'play'
    // arriving while already playing must not read as a pause
    set('play', () => { if (el().paused) toggle() })
    set('pause', () => { if (!el().paused) toggle() })
    set('previoustrack', TRACKS.length > 1 ? () => step(-1) : null)
    set('nexttrack', TRACKS.length > 1 ? () => step(1) : null)
    return () => { set('play', null); set('pause', null); set('previoustrack', null); set('nexttrack', null) }
  }, [toggle, step, el])

  const loop = LOOPS[prefs.loop]
  const many = TRACKS.length > 1
  const pct = Math.round(prefs.vol * 100)
  const waiting = blocked && !prefs.off

  // The record goes where it is put: drag it anywhere, let go and it settles
  // against the nearer side, like a phone's floating button. A press that does
  // not travel is a tap, and opens or closes the card; the position is
  // remembered with the other preferences; turning the phone keeps it on screen.
  const root = useRef<HTMLDivElement | null>(null)
  const fab = useRef<HTMLButtonElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  const [live, setLive] = useState<Pos | undefined>(undefined)
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const dragged = useRef(false)
  const pos = live ?? prefs.pos

  const settle = useCallback((p: Pos) => {
    const r = root.current?.getBoundingClientRect()
    const s = snapPos(p, r?.width ?? DISC, r?.height ?? DISC)
    setLive(undefined)
    patch({ pos: s })
  }, [patch])

  const onDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const r = root.current?.getBoundingClientRect()
    if (!r) return
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* an old browser: the drag still works while the pointer stays on the button */ }
  }, [])
  const onMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < TAP) return
    d.moved = true
    const r = root.current?.getBoundingClientRect()
    setLive(clampPos({ x: d.ox + dx, y: d.oy + dy }, r?.width ?? DISC, r?.height ?? DISC))
  }, [])
  const onUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (!d.moved) return
    // the click that follows this release must not open or close anything
    dragged.current = true
    window.setTimeout(() => { dragged.current = false }, 0)
    const r = root.current?.getBoundingClientRect()
    settle({ x: r?.left ?? d.ox, y: r?.top ?? d.oy })
  }, [settle])

  // a moved record stays on screen when the window changes (a record kept from the open bar, 529px wide, settles too)
  useEffect(() => {
    if (!prefs.pos) return
    const fix = () => {
      const r = root.current?.getBoundingClientRect()
      if (!r) return
      const s = snapPos({ x: r.left, y: r.top }, r.width, r.height)
      if (Math.abs(s.x - r.left) > 0.5 || Math.abs(s.y - r.top) > 0.5) patch({ pos: s })
    }
    fix()
    window.addEventListener('resize', fix)
    return () => window.removeEventListener('resize', fix)
  }, [prefs.pos, patch])

  // ---- the card beside the record
  const popId = useId()
  const [list, setList] = useState(false)
  /** opened by a press just now, so the focus goes in (a card kept open from the last visit takes none) */
  const opening = useRef(false)
  const setOpen = useCallback((open: boolean, focusBack = false) => {
    opening.current = open
    patch({ open })
    if (!open && focusBack) fab.current?.focus({ preventScroll: true })
  }, [patch])

  // Where the card opens: above the record in the screen's lower half, below it in the upper half, along the
  // record's side and never past the screen's edge; as tall as the room on that side, the rest scrolling inside it.
  const [place, setPlace] = useState<{ up: boolean; x: number; w: number; max: number }>({ up: true, x: 0, w: POP_W, max: 480 })
  useLayoutEffect(() => {
    if (!prefs.open) return
    const at = () => {
      const r = root.current?.getBoundingClientRect()
      if (!r) return
      const W = window.innerWidth
      const H = window.innerHeight
      const up = r.top + r.height / 2 > H / 2
      const w = Math.min(POP_W, W - 2 * POP_EDGE)
      const want = r.left + r.width / 2 < W / 2 ? r.left : r.right - w
      const x = Math.round(Math.min(Math.max(POP_EDGE, want), W - POP_EDGE - w) - r.left)
      const max = Math.max(120, Math.floor(up ? r.top - POP_GAP - POP_EDGE : H - r.bottom - POP_GAP - POP_EDGE))
      setPlace((p) => (p.up === up && p.x === x && p.w === w && p.max === max ? p : { up, x, w, max }))
    }
    at()
    window.addEventListener('resize', at)
    return () => window.removeEventListener('resize', at)
  }, [prefs.open, pos?.x, pos?.y])

  // opened by a press: the focus goes to play / pause
  useEffect(() => {
    if (!prefs.open || !opening.current) return
    opening.current = false
    pop.current?.querySelector<HTMLElement>('.bgm-ib.main')?.focus({ preventScroll: true })
  }, [prefs.open])

  // Closed by a press anywhere else, by Esc, or by the focus moving on to something outside it. A press elsewhere
  // does what it presses as well; nothing is swallowed. Esc from inside the card stops there — a card behind it
  // (an event, the changelog) does not close with it — and the focus goes back to the record.
  useEffect(() => {
    if (!prefs.open) return
    const inside = (t: EventTarget | null) => t instanceof Node && !!root.current?.contains(t)
    const down = (e: PointerEvent) => { if (!inside(e.target)) setOpen(false) }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const mine = inside(document.activeElement)
      setOpen(false, mine)
      if (mine) { e.preventDefault(); e.stopPropagation() }
    }
    // Only a focus that lands on something else — Tab walking on past the card, a card of the game taking it. Not
    // the focus merely leaving: Safari leaves a pressed button unfocused, so a press on the card's own buttons moves
    // the focus to nothing, and Tab past the page's last control moves it to the browser's own bar.
    const moved = (e: FocusEvent) => { if (!inside(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    document.addEventListener('focusin', moved, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      document.removeEventListener('focusin', moved, true)
    }
  }, [prefs.open, setOpen])

  const pick = useCallback((i: number) => {
    if (i === prefsRef.current.track && !el().paused) return
    patch({ track: i, off: false })
    load(i, true)
  }, [el, load, patch])

  const placed = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } as const : undefined
  const state = playing ? '正在播放' : waiting ? '等你点一下页面' : '已暂停'

  return (
    <div className={`bgm${prefs.open ? ' open' : ''}${playing ? ' playing' : ''}`} ref={root} style={placed}>
      <button
        ref={fab}
        type="button"
        className="bgm-fab"
        onClick={() => { if (!dragged.current) setOpen(!prefs.open, prefs.open) }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        style={{ touchAction: 'none', cursor: 'grab' }}
        aria-expanded={prefs.open}
        aria-controls={prefs.open ? popId : undefined}
        aria-label={`背景音乐：${track.title}，${state}`}
        title={`${track.title} · ${playing ? '播放中' : '已暂停'} · 点开控制，按住拖动`}
      >
        <i className={`bgm-vinyl${playing ? ' spin' : ''}`} aria-hidden="true" />
        <span className="bgm-badge" aria-hidden="true">
          {playing ? <Svg d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <Svg d="M8 5v14l11-7z" />}
        </span>
      </button>
      {prefs.open && (
        <div
          ref={pop}
          id={popId}
          className={`bgm-pop ${place.up ? 'up' : 'down'}`}
          role="dialog"
          aria-label="背景音乐"
          style={{ left: place.x, width: place.w, maxHeight: place.max }}
        >
          {/* the song on one line, the whole of it on hover; until a phone's first tap, what it is waiting for */}
          <p className="bgm-now" title={`${track.title} — ${track.artist}`}>
            <b className="bgm-title">{track.title}</b>
            <span className="bgm-sub">{waiting ? '点一下页面就开始播' : track.artist}</span>
          </p>
          <div className="bgm-row">
            <div className="bgm-ctl" role="group" aria-label="播放控制">
              <button type="button" className="bgm-ib" onClick={() => step(-1)} disabled={!many} aria-label="上一首" title={many ? '上一首' : '只有一首歌'}>
                <Svg d="M6 5h2v14H6zM19 5v14L9 12z" />
              </button>
              <button type="button" className="bgm-ib main" onClick={toggle} aria-label={playing ? '暂停' : '播放'} title={playing ? '暂停' : '播放'}>
                {playing ? <Svg d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <Svg d="M8 5v14l11-7z" />}
              </button>
              <button type="button" className="bgm-ib" onClick={() => step(1)} disabled={!many} aria-label="下一首" title={many ? '下一首' : '只有一首歌'}>
                <Svg d="M16 5h2v14h-2zM5 5v14l10-7z" />
              </button>
            </div>
            <button
              type="button"
              className={`bgm-loop${prefs.loop === 'off' ? '' : ' on'}`}
              onClick={() => patch({ loop: loop.next })}
              aria-label={`循环方式：${loop.hint}。点击换成${LOOPS[loop.next].label}`}
              title={loop.hint}
            >
              <Svg d="M17 7H7v3L3 6l4-4v3h12v6h-2zM7 17h10v-3l4 4-4 4v-3H5v-6h2z" />
              {loop.label}
            </button>
          </div>
          <div className="bgm-row bgm-vol" role="group" aria-label="音量">
            <button
              type="button"
              className="bgm-ib"
              onClick={() => patch({ muted: !prefs.muted })}
              aria-label={prefs.muted ? '取消静音' : '静音'}
              title={prefs.muted ? '取消静音' : '静音'}
              aria-pressed={prefs.muted}
            >
              {prefs.muted || prefs.vol === 0
                ? <Svg d="M4 9v6h4l5 4V5L8 9zm12.5 3 2.5-2.5-1.4-1.4L15 10.6 12.4 8 11 9.4l2.6 2.6L11 14.6l1.4 1.4 2.6-2.6 2.6 2.6 1.4-1.4z" />
                : <Svg d="M4 9v6h4l5 4V5L8 9zm11.5 3A4.5 4.5 0 0 0 13 8v8a4.5 4.5 0 0 0 2.5-4zM13 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" />}
            </button>
            {IOS ? <span className="bgm-hint">音量用设备侧面的按键调</span> : (
              <input
                type="range"
                min={0}
                max={100}
                value={prefs.muted ? 0 : pct}
                onChange={(e) => patch({ vol: Number(e.target.value) / 100, muted: false })}
                aria-label={`音量 ${pct}%`}
                title={`音量 ${pct}%`}
              />
            )}
          </div>
          {/* The list opens on the far side of its button from the record, so the button stays under the finger that
              pressed it: a card above the record grows upwards (base.css draws the list above the button there, the
              button coming first for Tab all the same), and a press that opened the list cannot land on a song. */}
          {many && (
            <>
              <button type="button" className="bgm-list-t" onClick={() => setList(!list)} aria-expanded={list} aria-controls={`${popId}-list`}>
                <span>曲目</span>
                <span className="bgm-count">{prefs.track + 1} / {TRACKS.length}</span>
                <Svg d={list === place.up ? 'M7.4 8.6 6 10l6 6 6-6-1.4-1.4-4.6 4.6z' : 'M7.4 15.4 6 14l6-6 6 6-1.4 1.4-4.6-4.6z'} />
              </button>
              {list && (
                <ol className="bgm-list" id={`${popId}-list`}>
                  {TRACKS.map((t, i) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        className={i === prefs.track ? 'on' : undefined}
                        aria-current={i === prefs.track ? 'true' : undefined}
                        onClick={() => pick(i)}
                        title={`${t.title} — ${t.artist}`}
                      >
                        <span className="bgm-n">{i + 1}</span>
                        <span className="bgm-t">{t.title}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Svg({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={d} fill="currentColor" />
    </svg>
  )
}
