/**
 * 「游戏更新了 → 刷新 / 稍后」 when a new build goes live under an open tab
 * (asked 2026-09-14, after 破晓's update bar: demo/src/audio.ts updInit/updShow).
 *
 * The entry script's name carries the build's content hash, so the page reads
 * its own index now and then and compares: another name is a deploy. Checked
 * every five minutes and whenever the tab comes back into view; under the dev
 * server the entry has no hash and nothing runs. The career's own copy — the
 * one in src/ui/ is the manager game's (scripts/check_boundary.ts).
 *
 * 破晓's rules, kept: 刷新 saves before it reloads; 稍后 quiets this build and
 * only a newer one asks again; it waits while the tour is walking (the career says
 * so through `busy`: the tour's module reaches the whole game, and the home page
 * this bar is also on must not fetch it, reported 2026-09-18). One more of
 * ours: a match being played lives only in memory, so the bar waits for the
 * match to end rather than offer a reload that would lose it. The save is
 * written after the commit (engine/me/save.ts), so 刷新 waits for it to land,
 * and does not reload at all when it did not go in: the save notice says so.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'

const ENTRY = /assets\/index-[^"'/\s]+\.js/
const EVERY = 5 * 60 * 1000
/** a tab flicked in and out of view does not fetch the page each time */
const AT_LEAST = 60 * 1000

// One checker for the page, however many bars mount: the home page and the career each draw one,
// and going from one to the other must not forget a build already found.
let mine: string | null = null
let found: string | null = null
let quiet: string | null = null
let last = 0
let started = false
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
const readFound = () => found

async function check() {
  if (!mine || Date.now() - last < AT_LEAST) return
  last = Date.now()
  try {
    const r = await fetch(`./?u=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return
    const v = (await r.text()).match(ENTRY)?.[0]
    if (!v || v === mine || v === found || v === quiet) return
    found = v
    emit()
  } catch { /* offline, or mid-deploy: ask again next time */ }
}

function start() {
  if (started) return
  started = true
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]')
  mine = s?.getAttribute('src')?.match(ENTRY)?.[0] ?? null
  if (!mine) return
  window.setInterval(() => { void check() }, EVERY)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check() })
}

export default function UpdateNudge({ busy = false, onBeforeReload }: {
  /** a match being played, a save not going in, the tour walking: the bar waits */
  busy?: boolean
  /** save before the reload and wait for the write to land (PlayerGame saveNow); false when it did not go in */
  onBeforeReload?: () => boolean | Promise<boolean>
}) {
  useEffect(() => { start() }, [])
  const v = useSyncExternalStore(subscribe, readFound, readFound)
  const [saving, setSaving] = useState(false)
  if (!v || busy) return null

  const reload = async () => {
    setSaving(true)
    let saved = true
    try { saved = (await onBeforeReload?.()) ?? true } catch { /* the reload goes ahead on the last autosave */ }
    // the latest progress did not go in: no reload to lose it on; the save notice takes this corner and says what to do (ui/me/SaveNotice.tsx)
    if (!saved) { setSaving(false); return }
    location.reload()
  }
  const later = () => {
    quiet = v
    found = null
    emit()
  }
  return (
    <div className="update-nudge" role="status" aria-live="polite">
      <div className="update-body">
        <b>游戏更新了</b>
        <span>刷新一下就能用上新版本，刷新前会先存档。改了什么，刷新后点右下角「更新日志」看。</span>
      </div>
      <div className="update-acts">
        <button className="primary sm" onClick={reload} disabled={saving}>{saving ? '存档中…' : '刷新'}</button>
        <button className="sm ghost" onClick={later}>稍后</button>
      </div>
    </div>
  )
}
