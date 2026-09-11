/**
 * Which ground the career is drawn on.
 *
 * The dark one is the game's own — agent select, broadcast overlays, the
 * tactical map — and it stays the default. Two lighter grounds are there for
 * long sessions: 浅色 is the stat sheet, white panels on a cool grey; 米色 is
 * the notebook, cream, a step below white and warmer.
 *
 * The choice belongs to the device, not the career. It is about the screen in
 * front of you, so it lives in localStorage and never rides along with a save.
 * index.html reads the same keys in a one-line script before the first paint,
 * so a light page never flashes dark on its way in.
 */
import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light' | 'cream'
export const THEME_KEY = 'val_player.theme'
/**
 * Where the choice lived while the career was a mode of the manager game.
 * Read once, when the new key has nothing, and copied over; left in place as a
 * backup.
 */
const OLD_THEME_KEY = 'valmgr.theme'

export const THEMES: { key: Theme; short: string; label: string; hint: string; bar: string }[] = [
  { key: 'dark', short: '深', label: '深色', hint: '默认，赛事转播那种黑底', bar: '#121c27' },
  { key: 'light', short: '浅', label: '浅色', hint: '白底，像一张数据表', bar: '#e6eaf0' },
  { key: 'cream', short: '米', label: '米色', hint: '米黄底，比白底柔和，看久了更舒服', bar: '#e9e1d0' },
]

const isTheme = (v: unknown): v is Theme => v === 'dark' || v === 'light' || v === 'cream'

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (isTheme(v)) return v
    const old = localStorage.getItem(OLD_THEME_KEY)
    if (isTheme(old)) {
      try { localStorage.setItem(THEME_KEY, old) } catch { /* read-only storage: the old key keeps answering */ }
      return old
    }
  } catch { /* storage denied: the default is fine */ }
  return 'dark'
}

/**
 * Paint the document: the attribute the stylesheet keys on and the colour the
 * browser paints its own chrome in. Dark is the absence of the attribute, so
 * the stylesheet's `:root` block is the dark theme and nothing has to be
 * undone to get back to it.
 */
export function paintTheme(t: Theme): void {
  const root = document.documentElement
  if (t === 'dark') delete root.dataset.theme
  else root.dataset.theme = t
  const bar = THEMES.find((x) => x.key === t)?.bar
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta && bar) meta.setAttribute('content', bar)
}

const listeners = new Set<() => void>()
let current: Theme = readTheme()

export function setTheme(t: Theme): void {
  if (t === current) return
  current = t
  try { localStorage.setItem(THEME_KEY, t) } catch { /* private mode: lasts the session */ }
  paintTheme(t)
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const read = () => current

export function useTheme(): [Theme, (t: Theme) => void] {
  return [useSyncExternalStore(subscribe, read, read), setTheme]
}
