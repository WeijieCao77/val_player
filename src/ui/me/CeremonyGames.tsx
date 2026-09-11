import { useEffect, useMemo, useRef, useState } from 'react'
import type { CerPick } from '../../engine/me/ceremony'
import type { CerTier, Ceremony } from '../../engine/me/types'

/**
 * The little games of the last five nights (engine/me/nights.ts).
 *
 * Same rules as the first three in Ceremony.tsx: wall-clock time and
 * Math.random, never the seeded Rng; well under thirty seconds; every one of
 * them can be walked past on the screen before it, and that is 银档.
 */

export type Ended = (tier: CerTier, detail: NonNullable<Ceremony['detail']>) => void

const shuffle = <T,>(a: T[]): T[] => {
  const out = a.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** A button that answers the finger on the way down, and a keyboard's Enter too. */
const press = (fn: () => void) => ({
  onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); fn() },
  onClick: (e: React.MouseEvent) => { if (e.detail === 0) fn() },
})

/* ------------------------------------------------------------------ */
/*  致辞：念到你的名字，上台把那句话说完                                */
/* ------------------------------------------------------------------ */

const SPEECH_MS = 14000
const SPEECH_GOLD_MS = 6500

export function SpeechGame({ parts, fillers, onEnd }: { parts: string[]; fillers: string[]; onEnd: Ended }) {
  // keyed on the words, not the arrays: a parent re-render hands in new arrays and must not reshuffle mid-sentence
  const key = `${parts.join('|')}#${fillers.join('|')}`
  const chips = useMemo(
    () => shuffle([...parts.map((t, i) => ({ t, i })), ...fillers.map((t) => ({ t, i: -1 }))]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  const [next, setNext] = useState(0)
  const [bad, setBad] = useState<number | null>(null)
  const [left, setLeft] = useState(SPEECH_MS)
  const stumbles = useRef(0)
  const t0 = useRef(performance.now())
  const done = useRef(false)
  const end = useRef(onEnd)
  end.current = onEnd

  const finish = (said: boolean) => {
    if (done.current) return
    done.current = true
    const ms = Math.round(performance.now() - t0.current)
    const s = stumbles.current
    end.current(said && s === 0 && ms <= SPEECH_GOLD_MS ? 'gold' : said && s <= 2 ? 'silver' : 'bronze', { ms, stumbles: s })
  }

  useEffect(() => {
    const id = setInterval(() => {
      const l = Math.max(0, SPEECH_MS - (performance.now() - t0.current))
      setLeft(l)
      // the room waited, and then the host took the microphone back
      if (l <= 0) finish(false)
    }, 100)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the ref is the truth: two taps inside one frame must not both read the same `next`
  const said = useRef(0)
  const tap = (k: number) => {
    if (done.current) return
    const c = chips[k]
    if (c.i === said.current) {
      said.current++
      setNext(said.current)
      if (said.current >= parts.length) finish(true)
      return
    }
    if (c.i >= 0 && c.i < said.current) return
    stumbles.current++
    setBad(k)
    window.setTimeout(() => setBad((b) => (b === k ? null : b)), 260)
  }

  return (
    <div className="cer-game">
      <p className="cer-hint">按顺序点，别点「呃」。<b>{(left / 1000).toFixed(1)}s</b></p>
      <p className="cer-line">{parts.map((t, i) => <span key={i} className={i < next ? 'said' : ''}>{t}</span>)}</p>
      <div className="cer-chips">
        {chips.map((c, k) => {
          const used = c.i >= 0 && c.i < next
          return (
            <button key={k} className={`cer-chip${used ? ' used' : ''}${bad === k ? ' bad' : ''}`} disabled={used} {...press(() => tap(k))}>
              {c.t}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  表演赛：五个靶一起亮，全点掉就是一次五杀                            */
/* ------------------------------------------------------------------ */

const ACE_WAVES = 3
const ACE_N = 5
const ACE_WINDOW = 2600
const ACE_GAP = 700

interface Dot { x: number; y: number; hit: boolean }

function placeFive(width: number, height: number): Dot[] {
  const out: Dot[] = []
  let guard = 0
  while (out.length < ACE_N && guard++ < 200) {
    const x = 10 + Math.random() * 80
    const y = 14 + Math.random() * 72
    // 56px apart at least, so a thumb never covers two
    const clear = out.every((d) => Math.hypot(((d.x - x) / 100) * width, ((d.y - y) / 100) * height) >= 56)
    if (clear || guard > 160) out.push({ x, y, hit: false })
  }
  return out
}

export function AceGame({ onEnd }: { onEnd: Ended }) {
  const box = useRef<HTMLDivElement>(null)
  const [wave, setWave] = useState(0)
  const [dots, setDots] = useState<Dot[] | null>(null)
  // the ref is the truth, as in the speech: two fingers inside one frame must both count
  const live = useRef<Dot[] | null>(null)
  const put = (d: Dot[] | null) => { live.current = d; setDots(d) }
  const [aces, setAces] = useState(0)
  const hits = useRef(0)
  const done = useRef(false)
  const end = useRef(onEnd)
  end.current = onEnd

  useEffect(() => {
    if (done.current) return
    if (wave >= ACE_WAVES) {
      done.current = true
      const h = hits.current
      end.current(aces >= 2 && h >= 13 ? 'gold' : aces >= 1 || h >= 10 ? 'silver' : 'bronze', { aces, hits: h })
      return
    }
    const show = window.setTimeout(() => {
      const el = box.current
      put(placeFive(el?.clientWidth || 300, el?.clientHeight || 240))
    }, ACE_GAP)
    const close = window.setTimeout(() => { put(null); setWave((w) => w + 1) }, ACE_GAP + ACE_WINDOW)
    return () => { window.clearTimeout(show); window.clearTimeout(close) }
  }, [wave, aces])

  const hit = (i: number) => {
    const cur = live.current
    if (done.current || !cur || !cur[i] || cur[i].hit) return
    hits.current++
    const next = cur.map((d, k) => (k === i ? { ...d, hit: true } : d))
    if (next.every((d) => d.hit)) {
      // all five: the wave is over early, and the room gets its clip
      put(null)
      setAces((a) => a + 1)
      setWave((w) => w + 1)
      return
    }
    put(next)
  }

  return (
    <div className="cer-game">
      <p className="cer-hint">五个靶一起亮，全打掉。<b>{Math.min(wave + 1, ACE_WAVES)}/{ACE_WAVES}</b>
        {aces > 0 && <span className="tiny muted"> · 五杀 {aces}</span>}</p>
      <div className="cer-stage" ref={box}>
        {dots?.map((d, i) => (
          <button key={`${wave}:${i}`} className={`cer-ace${d.hit ? ' hit' : ''}`} style={{ left: `${d.x}%`, top: `${d.y}%` }}
            aria-label="靶" {...press(() => hit(i))} />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  选择：发布会上的池子，退役那晚的最后一件事                          */
/* ------------------------------------------------------------------ */

export function PickGame({ hint, picks, onEnd }: { hint: string; picks: CerPick[]; onEnd: Ended }) {
  return (
    <div className="cer-game">
      <p className="cer-hint">{hint}</p>
      <div className="cer-tones">
        {picks.map((p) => (
          <button key={p.key} className="cer-tone" onClick={() => onEnd(p.tier, { pick: p.key })}>
            <b>{p.label}</b>
            {p.sub && <span className="tiny muted">{p.sub}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
