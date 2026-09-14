/**
 * One sound: a short rising chime when a big moment's card comes up (decided
 * 2026-09-14: 「做，默认关」). Synthesized with WebAudio, so no audio file ships;
 * off until the player turns it on, remembered per browser and never in the save.
 * Everything fails quietly — a browser without audio just stays silent.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'valplayer.sfx'

let on = (() => {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
})()
const subs = new Set<() => void>()

export const soundOn = (): boolean => on

export function setSound(v: boolean): void {
  on = v
  try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* private mode: this visit only */ }
  subs.forEach((f) => f())
  if (v) chime()
}

export const useSound = (): [boolean, (v: boolean) => void] => [
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, soundOn, soundOn),
  setSound,
]

let ctx: AudioContext | null = null

/** Two notes a fifth apart, soft attack, a second of tail. Only when the switch is on. */
export function chime(): void {
  if (!on) return
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    ctx ??= new Ctx()
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime + 0.01
    const notes: [number, number][] = [[659.25, 0], [987.77, 0.12]]
    for (const [hz, at] of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = hz
      gain.gain.setValueAtTime(0, t0 + at)
      gain.gain.linearRampToValueAtTime(0.12, t0 + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 1.0)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + 1.05)
    }
  } catch { /* no audio here */ }
}
