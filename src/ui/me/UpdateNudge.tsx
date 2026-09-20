/**
 * A build that goes live under an open tab, taken by the tab itself
 * (asked 2026-09-14, after 破晓's update bar: demo/src/audio.ts updInit/updShow).
 *
 * The entry script's name carries the build's content hash, so the page reads
 * its own index now and then and compares: another name is a deploy. Asked
 * about every 70 seconds, and whenever the tab comes back into view, the
 * window takes the focus, or the network comes back; under the dev server the
 * entry has no hash and nothing runs. The career's own copy — the one in
 * src/ui/ is the manager game's (scripts/check_boundary.ts).
 *
 * It used to only ask. The author, 2026-09-20, was still clicking 「−」 on a
 * week board hours after the click-to-act build went live: 「我点了我还可以取消，
 * 这完全不合理。」 A page nobody is touching now saves and reloads itself
 * (ui/me/update.ts updateAct), with one line saying why the page blinked.
 *
 * 破晓's rules, kept: the save goes first and the reload waits for the write —
 * and does not happen at all when it did not go in; 稍后 quiets this build,
 * now for half an hour rather than for as long as the tab lives, and a newer
 * build asks again either way; the tour is never interrupted — the career says
 * so through `hushed`, because the tour's module reaches the whole game and the
 * home page this also sits on must not fetch it (reported 2026-09-18). Two of
 * ours: a match being played lives only in memory, so its bar says the page
 * will refresh when the match is over instead of offering a reload that would
 * lose it; and while the save notice or 游戏没载入成功 has the corner, this
 * says nothing at all (ui/me/SaveNotice.tsx, App.tsx).
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { AT_LEAST, EVERY, IDLE, QUIET, updateAct } from './update'

const ENTRY = /assets\/index-[^"'/\s]+\.js/
/** the line is read before the page blinks */
const SEEN = 900

// One checker for the page, however many bars mount: the home page and the career each draw one,
// and going from one to the other must not forget a build already found.
let mine: string | null = null
let newest: string | null = null
let quiet: { build: string; until: number } | null = null
let failed = false
let acted = 0
let last = 0
let started = false
let reloading = false
/** busy or hushed as of the last render: a match that started, or a notice that took the corner, while the save ran */
let held = false
let tick = 0
const subs = new Set<() => void>()
const emit = () => { tick++; subs.forEach((f) => f()) }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
const readTick = () => tick

/** a name being typed, a backup being pasted, a picker open: hands on the page, whatever the clock says */
function typing(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const t = el.tagName
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable
}

async function check(force = false): Promise<void> {
  if (!mine || (!force && Date.now() - last < AT_LEAST)) return
  last = Date.now()
  try {
    const r = await fetch(`./?u=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return
    const v = (await r.text()).match(ENTRY)?.[0]
    if (!v || v === newest) return
    newest = v
    // a build after the one whose save would not go in is a fresh question
    failed = false
    emit()
  } catch { /* offline, or mid-deploy: ask again next time */ }
}

function start(): void {
  if (started) return
  started = true
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]')
  mine = s?.getAttribute('src')?.match(ENTRY)?.[0] ?? null
  if (!mine) return
  acted = Date.now()
  const touched = () => { acted = Date.now() }
  window.setInterval(() => { void check() }, EVERY)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check() })
  window.addEventListener('focus', () => { void check() })
  // back from a dead network: ask at once rather than sit out the floor
  window.addEventListener('online', () => { void check(true) })
  window.addEventListener('pointerdown', touched, true)
  window.addEventListener('keydown', touched, true)
}

export default function UpdateNudge({ busy = false, hushed = false, onBeforeReload }: {
  /** something in memory a reload would lose — a match being played */
  busy?: boolean
  /** another notice has this corner, or the tour is walking: say nothing, do nothing */
  hushed?: boolean
  /** save before the reload and wait for the write to land (PlayerGame saveNow); false when it did not go in */
  onBeforeReload?: () => boolean | Promise<boolean>
}) {
  useEffect(() => { start() }, [])
  // read by the save-and-reload below, which takes a moment: what is true now, not what was true when it started
  useEffect(() => { held = busy || hushed }, [busy, hushed])
  const t = useSyncExternalStore(subscribe, readTick, readTick)
  const [saving, setSaving] = useState(false)
  const now = Date.now()
  const act = hushed ? 'none' : updateAct({
    mine, newest, busy, quiet, failed, now,
    acted: typing() ? now : acted,
  })

  // 'wait' and a quiet that is running out both come good on their own clock, without another fetch
  useEffect(() => {
    let wait = 0
    if (act === 'wait') wait = Math.max(300, IDLE - (Date.now() - acted) + 200)
    else if (act === 'none' && quiet && quiet.build === newest) wait = Math.max(0, quiet.until - Date.now() + 200)
    if (!wait) return
    const id = window.setTimeout(emit, wait)
    return () => window.clearTimeout(id)
  }, [act, t, busy])

  // nobody's hands on it and nothing to lose: save and take the new build
  useEffect(() => {
    if (act !== 'reload' || reloading) return
    reloading = true
    void (async () => {
      const seen = new Promise<void>((r) => { window.setTimeout(r, SEEN) })
      let saved = true
      try { saved = (await onBeforeReload?.()) ?? true } catch { /* the reload goes ahead on the last autosave */ }
      // the latest progress did not go in: no reload to lose it on. The bar takes over, and the save
      // notice takes this corner and says what to do (ui/me/SaveNotice.tsx)
      if (!saved) { failed = true; reloading = false; emit(); return }
      await seen
      // a hand came back to the page in that second, or a match started: leave it alone and ask again in a moment
      if (held || Date.now() - acted < IDLE) { reloading = false; emit(); return }
      location.reload()
    })()
  }, [act, onBeforeReload])

  if (act === 'reload') {
    return (
      <div className="update-nudge" role="status" aria-live="polite">
        <div className="update-body">
          <b>游戏更新了</b>
          <span>正在存档，马上自己刷新到新版本。改了什么，刷新后点右下角「更新日志」看。</span>
        </div>
      </div>
    )
  }
  if (act !== 'bar') return null

  const reload = async () => {
    setSaving(true)
    let saved = true
    try { saved = (await onBeforeReload?.()) ?? true } catch { /* the reload goes ahead on the last autosave */ }
    if (!saved) { failed = true; setSaving(false); emit(); return }
    location.reload()
  }
  const later = () => {
    quiet = { build: newest!, until: Date.now() + QUIET }
    emit()
  }
  return (
    <div className="update-nudge" role="status" aria-live="polite">
      <div className="update-body">
        <b>游戏更新了</b>
        <span>{busy
          ? '这局打完就会自己刷新到新版本，比赛不会中断。改了什么，刷新后点右下角「更新日志」看。'
          : '刷新一下就能用上新版本，刷新前会先存档。改了什么，刷新后点右下角「更新日志」看。'}</span>
      </div>
      <div className="update-acts">
        {/* a match being played lives only in memory: no reload is offered while it is on */}
        {!busy && <button className="primary sm" onClick={reload} disabled={saving}>{saving ? '存档中…' : '刷新'}</button>}
        <button className="sm ghost" onClick={later}>稍后</button>
      </div>
    </div>
  )
}
