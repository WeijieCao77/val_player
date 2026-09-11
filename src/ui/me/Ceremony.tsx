import { useEffect, useRef, useState } from 'react'
import { useGame } from '../ctx'
import { Modal } from '../common'
import { CEREMONIES, TIER_CN, cerClose, cerFinish, cerNext, cerSkip } from '../../engine/me/ceremony'
import type { CerTier } from '../../engine/me/types'

/**
 * The one place in the game where your own hand decides something.
 *
 * Everything else is the character's numbers. These three little games are
 * yours, which is why they are hung on ceremonies — four or five nights a
 * career, at moments that already matter — and never on the training week.
 *
 * They use `Math.random` and wall-clock time on purpose. The match engine
 * replays identically from a seed and must keep doing so; your reflexes on
 * one particular night are not part of that record.
 *
 * Every one of them can be walked past, and walking past lands on 银档 —
 * the same as playing it and doing fine. A player who does not want to play
 * a reflex game is not punished for it.
 */
export default function CeremonyModal({ onDone }: { onDone: () => void }) {
  const { game, commit } = useGame()
  const cer = game.me!.cer
  const [, force] = useState(0)
  if (!cer) return null
  const def = CEREMONIES[cer.kind]
  const step = cer.step

  const bump = () => { force((n) => n + 1); commit() }
  const close = () => { cerClose(game); commit(); onDone() }
  const skip = () => { cerSkip(game); commit(); onDone() }

  return (
    // the × walks past it too, which is silver — never a dead end
    <Modal title={def.name} onClose={step === 2 ? close : skip} onBgClose={() => {}}>
      {step === 0 && (
        <>
          <p className="cer-story">{def.story(game, cer.about ?? '')}</p>
          <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 14 }}>
            {def.game === 'none'
              ? <button className="primary" onClick={close}>知道了</button>
              : <>
                <button onClick={skip}>直接过去</button>
                <button className="primary" onClick={() => { cerNext(game); bump() }}>
                  {def.game === 'choice' ? '面对镜头' : '上'}
                </button>
              </>}
          </div>
          {def.game !== 'none' && (
            <p className="tiny faint" style={{ textAlign: 'center', margin: '10px 0 0' }}>
              「直接过去」按银档算，不扣任何东西——只是拿不到金档。
            </p>
          )}
        </>
      )}

      {step === 1 && def.game === 'focus' && <FocusGame onEnd={(t, d) => { cerFinish(game, t, d); bump() }} />}
      {step === 1 && def.game === 'rhythm' && <RhythmGame onEnd={(t, d) => { cerFinish(game, t, d); bump() }} />}
      {step === 1 && def.game === 'react' && <ReactGame onEnd={(t, d) => { cerFinish(game, t, d); bump() }} />}
      {step === 1 && def.game === 'choice' && <MediaChoice onEnd={(t, d) => { cerFinish(game, t, d); bump() }} />}

      {step === 2 && (
        <>
          {/* A tone is not a grade. Printing 金档 over 「冠军」 would say it was
              the right answer, when the whole point is that it costs something. */}
          <div className={`cer-tier ${cer.tier ?? 'silver'}`}>
            {def.game === 'choice'
              ? (TONES.find((t) => t.key === cer.detail?.tone)?.name ?? '说完了')
              : TIER_CN[cer.tier ?? 'silver']}
          </div>
          <p className="cer-story" style={{ textAlign: 'center' }}>{def.blurb[cer.tier ?? 'silver']}</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
            <button className="primary" onClick={close}>走了</button>
          </div>
        </>
      )}
    </Modal>
  )
}

type Ended = (tier: CerTier, detail: { score?: number; ms?: number; hits?: number; tone?: string }) => void

/* ------------------------------------------------------------------ */
/*  专注：抽签台上，镜头和弹幕都在你身后                                */
/* ------------------------------------------------------------------ */

const FOCUS_MS = 8000

function FocusGame({ onEnd }: { onEnd: Ended }) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 50, y: 50 })
  const [left, setLeft] = useState(FOCUS_MS)
  const inside = useRef(false)
  const held = useRef(0)
  const total = useRef(0)

  useEffect(() => {
    const t0 = performance.now()
    let last = t0
    let raf = 0
    // the dot drifts on two slow sines, so it is followable but never still
    const tick = (now: number) => {
      const dt = now - last
      last = now
      const el = now - t0
      total.current += dt
      if (inside.current) held.current += dt
      setPos({
        x: 50 + 34 * Math.sin(el / 900) * Math.cos(el / 2300),
        y: 50 + 30 * Math.sin(el / 1300 + 1.2),
      })
      setLeft(Math.max(0, FOCUS_MS - el))
      if (el >= FOCUS_MS) {
        const score = total.current ? held.current / total.current : 0
        onEnd(score >= 0.85 ? 'gold' : score >= 0.6 ? 'silver' : 'bronze', { score: Math.round(score * 100) })
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [onEnd])

  return (
    <div className="cer-game">
      <p className="cer-hint">把光标压在圆点上，别松，别看别处。<b>{(left / 1000).toFixed(1)}s</b></p>
      <div className="cer-stage" ref={box}>
        <Barrage />
        <div
          className="cer-dot"
          style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          onPointerEnter={() => { inside.current = true }}
          onPointerLeave={() => { inside.current = false }}
        />
      </div>
    </div>
  )
}

/** The chat wall behind the stage. Pure decoration — and that is the point. */
function Barrage() {
  const lines = useRef(
    ['这队怎么进来的', '一轮游预定', '我押他们', '这位是谁', '教练该下课了',
      '上一场太难看', '看好这个新人', '抽到死亡之组', '稳住', '别再让他打了']
      .map((t) => ({ t, top: 6 + Math.random() * 84, delay: Math.random() * 6, dur: 5 + Math.random() * 4 })),
  ).current
  return (
    <div className="cer-barrage" aria-hidden="true">
      {lines.map((l, i) => (
        <span key={i} style={{ top: `${l.top}%`, animationDelay: `${l.delay}s`, animationDuration: `${l.dur}s` }}>{l.t}</span>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  节奏：手腕，不是准星                                                */
/* ------------------------------------------------------------------ */

const RHYTHM_N = 5
/** one sweep of the bar */
const SWEEP = 1400

function RhythmGame({ onEnd }: { onEnd: Ended }) {
  const [x, setX] = useState(0)
  const [hits, setHits] = useState<number[]>([])
  const start = useRef(performance.now())
  const done = useRef(false)

  useEffect(() => {
    let raf = 0
    const tick = (now: number) => {
      const ph = ((now - start.current) % SWEEP) / SWEEP
      // ping-pong: 0 → 1 → 0
      setX(ph < 0.5 ? ph * 2 : 2 - ph * 2)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const tap = () => {
    if (done.current) return
    // how far the marker is from the centre, expressed as the time it would
    // take to get there — so the number the player sees is in milliseconds
    const off = Math.abs(x - 0.5) * SWEEP
    const next = [...hits, off]
    setHits(next)
    if (next.length >= RHYTHM_N) {
      done.current = true
      const mean = next.reduce((a, b) => a + b, 0) / next.length
      onEnd(mean <= 70 ? 'gold' : mean <= 150 ? 'silver' : 'bronze', { ms: Math.round(mean) })
    }
  }

  return (
    <div className="cer-game">
      <p className="cer-hint">光标扫到中间那条线的时候按下去。<b>{hits.length}/{RHYTHM_N}</b></p>
      <div className="cer-bar" onPointerDown={tap} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); tap() } }}>
        <i className="cer-target" />
        <i className="cer-runner" style={{ left: `${x * 100}%` }} />
      </div>
      <div className="cer-taps">
        {hits.map((h, i) => (
          <span key={i} className={h <= 70 ? 'good' : h <= 150 ? '' : 'bad'}>{Math.round(h)}ms</span>
        ))}
      </div>
      <p className="tiny faint" style={{ margin: '8px 0 0' }}>点条上任意位置，或者按空格。</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  反应：入场前最后一次靶场                                            */
/* ------------------------------------------------------------------ */

const REACT_N = 6
const REACT_TIMEOUT = 1300

function ReactGame({ onEnd }: { onEnd: Ended }) {
  const [target, setTarget] = useState<{ x: number; y: number; at: number } | null>(null)
  const [n, setN] = useState(0)
  const times = useRef<number[]>([])
  const misses = useRef(0)
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    if (n >= REACT_N) {
      done.current = true
      const hits = times.current.length
      const mean = hits ? times.current.reduce((a, b) => a + b, 0) / hits : 9999
      const tier: CerTier = hits === REACT_N && mean <= 420 ? 'gold'
        : hits >= 4 && mean <= 600 ? 'silver' : 'bronze'
      onEnd(tier, { ms: Math.round(mean), hits })
      return
    }
    // a beat of nothing, then it appears somewhere new
    const wait = 350 + Math.random() * 550
    const show = setTimeout(() => {
      setTarget({ x: 10 + Math.random() * 80, y: 14 + Math.random() * 72, at: performance.now() })
    }, wait)
    return () => clearTimeout(show)
  }, [n, onEnd])

  useEffect(() => {
    if (!target) return
    const t = setTimeout(() => { misses.current++; setTarget(null); setN((k) => k + 1) }, REACT_TIMEOUT)
    return () => clearTimeout(t)
  }, [target])

  const hit = () => {
    if (!target) return
    times.current.push(performance.now() - target.at)
    setTarget(null)
    setN((k) => k + 1)
  }

  const lastMs = times.current[times.current.length - 1]
  return (
    <div className="cer-game">
      <p className="cer-hint">
        靶出来就打。<b>{n}/{REACT_N}</b>
        {lastMs !== undefined && <span className="tiny muted"> · 上一发 {Math.round(lastMs)}ms</span>}
        {misses.current > 0 && <span className="tiny bad"> · 空 {misses.current}</span>}
      </p>
      <div className="cer-stage">
        {target && <button className="cer-target-dot" style={{ left: `${target.x}%`, top: `${target.y}%` }} onPointerDown={hit} aria-label="靶" />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  媒体日：不是小游戏，是一句话                                        */
/* ------------------------------------------------------------------ */

const TONES: { key: string; name: string; label: string; blurb: string; tier: CerTier }[] = [
  { key: 'bold', name: '狂', label: '「冠军。别的没什么好说的。」', blurb: '热度大涨。话说出去了，就得打回来。', tier: 'gold' },
  { key: 'steady', name: '稳', label: '「一场一场打，先进季后赛。」', blurb: '热度小涨。挑不出毛病，也没人写你。', tier: 'silver' },
  { key: 'blame', name: '指向别人', label: '「我个人状态没问题。」', blurb: '热度涨了，但队友们看得懂你在说谁。', tier: 'bronze' },
]

function MediaChoice({ onEnd }: { onEnd: Ended }) {
  return (
    <div className="cer-game">
      <p className="cer-hint">三台机位在等你开口。</p>
      <div className="cer-tones">
        {TONES.map((t) => (
          <button key={t.key} className="cer-tone" onClick={() => onEnd(t.tier, { tone: t.key })}>
            <b>{t.label}</b>
            <span className="tiny muted">{t.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
