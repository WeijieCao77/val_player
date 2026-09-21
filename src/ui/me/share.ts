import type { GameState } from '../../engine/types'
import { bondCardLines } from '../../engine/me/bond'
import { fanTier, fansCn } from '../../engine/me/fans'
import { originName, originOf } from '../../engine/me/origins'
import { rankAt, rankShort, serverAt } from '../../engine/me/rank'
import { QR_RUNS, QR_SIZE, QR_URL } from './qr'
import { compCn } from '../../engine/me/compname'
import { cny } from '../../engine/me/moneyfmt'
import { careerRewrites, retitledLine, shareLine } from '../../engine/me/rewrites'
import { TROPHY_RANK, trophyTier } from '../../engine/me/trophies'
import type { LookKey } from '../../engine/me/hall'
import { fmvpTotals } from '../../engine/me/fmvpRead'

/**
 * The career card as a picture you can keep.
 *
 * Ported from 破晓's share.ts. Its reason for existing was a player's
 * complaint, and it applies to us word for word: the ending screen said
 * 「截图就能发」, and a screenshot comes with the address bar, the browser
 * chrome and a scrollbar — it looks like a screenshot, and it has no way in
 * for whoever sees it.
 *
 * So the card is drawn by hand on a canvas at 1080×1620 — phone-poster shape,
 * the size a chat app will not recompress into mush. Everything on it is read
 * off the save: the verdict, the trophies, the year-by-year, the numbers, the
 * people, and now what the career actually earned, which the ledger finally
 * knows. The QR is drawn from a committed matrix (see ./qr.ts) rather than a
 * library, because the page's CSP will not load one.
 */

const W = 1080
const H = 1620
const PAD = 72

/**
 * The card's colours, one set per 卡面 (me/hall.ts LOOKS). The default is the
 * card as it always was, value for value; the others are the same card in the
 * 转播红 family's other dress (ui/me/looks.css is the career-end card's half).
 * `won` is a title year's row, `edge` the bar down its side, `r` scales the
 * corners (0 is the broadcast's sharp edge). `year` / `wonYear` colour a row's
 * year and `num` the five numbers where a look lights them differently (the
 * board's amber lamps); left out, they are ink2, gold and ink as always.
 */
interface Palette {
  bg: string; panel: string; line: string; ink: string; ink2: string; ink3: string
  gold: string; red: string; win: string; won: string; edge: string; r: number
  year?: string; wonYear?: string; num?: string
}

const STUDIO: Palette = {
  bg: '#0B1622',
  panel: '#122132',
  line: '#1E3247',
  ink: '#E8EEF5',
  ink2: '#9FB2C6',
  ink3: '#6B8199',
  gold: '#E8B559',
  red: '#FF4655',
  win: '#59C08A',
  won: '#1E2A1F',
  edge: '#E8B559',
  r: 1,
}

const PALETTES: Record<LookKey, Palette> = {
  studio: STUDIO,
  night: { bg: '#07090C', panel: '#10141A', line: '#262C35', ink: '#F5F5F3', ink2: '#AAB2BC', ink3: '#7F8994',
    gold: '#FFFFFF', red: '#FF4655', win: '#59C08A', won: '#2A1117', edge: '#FF4655', r: 0 },
  film: { bg: '#1B1611', panel: '#241D16', line: '#3D3428', ink: '#EFE4CB', ink2: '#C0B090', ink3: '#968669',
    gold: '#E3C27E', red: '#C4452F', win: '#A8C486', won: '#30261A', edge: '#E3C27E', r: 0.2 },
  paper: { bg: '#F3EFE5', panel: '#E8E2D3', line: '#BDB5A3', ink: '#17140F', ink2: '#463F35', ink3: '#6B6456',
    gold: '#B81F2A', red: '#C8232F', win: '#1D6B39', won: '#F1DCD6', edge: '#C8232F', r: 0 },
  led: { bg: '#050505', panel: '#0C0B09', line: '#2A2620', ink: '#F2EFE8', ink2: '#CFC3A6', ink3: '#978B72',
    gold: '#FFFFFF', red: '#FF4655', win: '#59C08A', won: '#1A0306', edge: '#FF4655', r: 0,
    year: '#FFB23E', wonYear: '#FF4655', num: '#FFB23E' },
  vault: { bg: '#0B0A08', panel: '#13110D', line: '#332C21', ink: '#F4EFE4', ink2: '#BDB198', ink3: '#968A73',
    gold: '#E9C77B', red: '#E0404D', win: '#A8C486', won: '#231D12', edge: '#E9C77B', r: 0 },
  split: { bg: '#F2EFE8', panel: '#E6E1D6', line: '#C9C2B3', ink: '#15171B', ink2: '#454A52', ink3: '#6B6F76',
    gold: '#CF2835', red: '#FF4655', win: '#1D6B39', won: '#F6DEDC', edge: '#CF2835', r: 0 },
  redline: { bg: '#0A0D12', panel: '#10151C', line: '#262D37', ink: '#EEF0F3', ink2: '#A3ACB8', ink3: '#808A97',
    gold: '#FFFFFF', red: '#FF4655', win: '#59C08A', won: '#261118', edge: '#FF4655', r: 0 },
}

const FONT = (w: number, s: number) =>
  `${w} ${s}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif`
/** the archive's intertitle and the front page's headline */
const SERIF = (w: number, s: number) =>
  `${w} ${s}px "Songti SC","STSong","SimSun","Noto Serif CJK SC","Source Han Serif SC",serif`

/** CJK has no spaces, so wrapping is per character. Returns lines drawn. */
function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines?: number): number {
  const cs = Array.from(String(text ?? ''))
  let line = ''
  let n = 0
  for (const c of cs) {
    const t = line + c
    if (g.measureText(t).width > maxW && line) {
      if (maxLines && n >= maxLines - 1) {
        g.fillText(line.slice(0, -1) + '…', x, y + n * lh)
        return n + 1
      }
      g.fillText(line, x, y + n * lh)
      n++
      line = c
    } else line = t
  }
  if (line) { g.fillText(line, x, y + n * lh); n++ }
  return n
}

/**
 * Lines for a box sized to its text, at most maxLines, the last cut with 「…」. Per character like wrap(), except that
 * a club's name stays whole: 「TUBEPLE Gaming」 is not broken into 「TUBEPLE Gamin」 and 「g」.
 */
function linesOf(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const out: string[] = []
  let line = ''
  for (const tok of String(text ?? '').match(/[\p{Script=Latin}\d'’.&-]+ ?|./gu) ?? []) {
    const t = line + tok
    if (g.measureText(t).width > maxW && line) {
      out.push(line.trimEnd())
      line = tok.trimStart()
    } else line = t
  }
  if (line) out.push(line)
  if (out.length <= maxLines) return out
  const cut = out.slice(0, maxLines)
  let last = cut[maxLines - 1]
  while (last.length > 1 && g.measureText(`${last}…`).width > maxW) last = last.slice(0, -1)
  cut[maxLines - 1] = `${last}…`
  return cut
}

/**
 * The trophy line (reported 2026-09-18): each name whole on a line where it fits — 「2031 VCT欧洲 第二赛段」 used
 * to break as 「2031 V」 / 「CT欧洲 …」, because wrap() goes a character at a time — and a name wider than a line
 * breaks between words (linesOf). At most maxLines: the names that do not fit, and `extra` more past the list,
 * are counted, 「另有 N 个」.
 */
function titleLines(g: CanvasRenderingContext2D, names: string[], maxW: number, maxLines: number, extra = 0): string[] {
  for (let k = names.length; k >= 1; k--) {
    const rest = names.length - k + extra
    const out: string[] = []
    let line = ''
    for (let i = 0; i < k; i++) {
      const piece = names[i] + (i < k - 1 ? '、' : rest > 0 ? `，另有 ${rest} 个` : '')
      if (line && g.measureText(line + piece).width > maxW) { out.push(line); line = piece } else line += piece
      if (g.measureText(line).width > maxW) {
        const parts = linesOf(g, line, maxW, 99)
        out.push(...parts.slice(0, -1))
        line = parts[parts.length - 1] ?? ''
      }
    }
    if (line) out.push(line)
    if (out.length <= maxLines) return out
  }
  return linesOf(g, names[0] ?? '', maxW, maxLines)
}

/**
 * The three cups of ui/me/art/fx.tsx, the same path data, for the canvas: 3 is 冠军赛, 2 大师赛, 1 a league's, 0 the
 * bare plinth a cup would stand on. Outlined in `color` over a faint fill of it, as the SVGs are.
 */
const CUPS: Record<number, { fill: string[]; thin?: string[]; lines?: string[]; disc?: boolean; star?: string }> = {
  3: { fill: ['M19 5h26l-3 21-7 7h-6l-7-7z', 'M29 33h6v11h-6z', 'M24 44h16v4H24zM20 48h24v4H20zM16 52h32v6H16z'], thin: ['M25 12h14M26 18h12'] },
  2: { fill: ['M28 41h8l6 16H22z'], disc: true, star: 'M32 10l3.5 9.5L45 23l-9.5 3.5L32 36l-3.5-9.5L19 23l9.5-3.5z' },
  1: { fill: ['M21 10h22l-2 19a9 9 0 0 1-18 0z', 'M29 38h6v8h-6zM22 46h20v11H22z'], lines: ['M21 15h-6c0 8 3 12 8 12M43 15h6c0 8-3 12-8 12'] },
  0: { fill: ['M24 44h16v4H24zM20 48h24v4H20zM16 52h32v6H16z'] },
}

function drawCup(g: CanvasRenderingContext2D, tier: number, x: number, y: number, size: number, color: string, wash = 0.16): void {
  const c = CUPS[tier] ?? CUPS[0]
  g.save()
  g.translate(x, y)
  g.scale(size / 64, size / 64)
  g.fillStyle = color
  g.strokeStyle = color
  g.lineWidth = 2
  g.lineJoin = 'miter'
  const shape = (p: Path2D) => {
    g.globalAlpha = wash
    g.fill(p)
    g.globalAlpha = 1
    g.stroke(p)
  }
  if (c.disc) { const d = new Path2D(); d.arc(32, 23, 17, 0, Math.PI * 2); shape(d) }
  for (const d of c.fill) shape(new Path2D(d))
  for (const d of c.lines ?? []) g.stroke(new Path2D(d))
  if (c.star) g.fill(new Path2D(c.star))
  g.globalAlpha = 0.6
  g.lineWidth = 1.2
  for (const d of c.thin ?? []) g.stroke(new Path2D(d))
  g.restore()
}

/**
 * Words in lamps, for the 场馆大屏: the text drawn on its own canvas, kept only where a dot of the board's grid
 * falls, then set down with a glow of its own colour. Shrinks to fit maxW like fitText.
 */
function ledText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, maxW: number, align: CanvasTextAlign = 'left'): void {
  let sz = size
  g.font = FONT(900, sz)
  while (sz > 24 && g.measureText(text).width > maxW) { sz -= 2; g.font = FONT(900, sz) }
  const tw = Math.min(maxW, g.measureText(text).width)
  const pad = 24
  const off = document.createElement('canvas')
  off.width = Math.ceil(tw + pad * 2)
  off.height = Math.ceil(sz * 1.4 + pad * 2)
  const o = off.getContext('2d')
  const left = align === 'center' ? x - tw / 2 : x
  if (!o) { g.fillStyle = color; g.fillText(text, left, y); return }
  const base = pad + sz * 1.05
  o.font = FONT(900, sz)
  o.fillStyle = color
  o.fillText(text, pad, base, tw)
  o.globalCompositeOperation = 'destination-in'
  const pitch = Math.max(5, Math.round(sz / 13))
  const r = pitch * 0.4
  o.beginPath()
  for (let yy = pitch / 2; yy < off.height; yy += pitch) {
    for (let xx = pitch / 2; xx < off.width; xx += pitch) { o.moveTo(xx + r, yy); o.arc(xx, yy, r, 0, Math.PI * 2) }
  }
  o.fill()
  g.save()
  g.shadowColor = color
  g.shadowBlur = 24
  g.drawImage(off, left - pad, y - base)
  g.shadowBlur = 8
  g.drawImage(off, left - pad, y - base)
  g.restore()
}

/** Shrink until it fits, then truncate if it still does not. */
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, weight = 700, face = FONT): void {
  let t = String(text ?? '')
  let sz = size
  while (sz > 16) {
    g.font = face(weight, sz)
    if (g.measureText(t).width <= maxW) break
    sz -= 2
  }
  g.font = face(weight, sz)
  while (t.length > 1 && g.measureText(t).width > maxW) t = t.slice(0, -1)
  if (g.measureText(String(text ?? '')).width > maxW && t.length > 1) t = t.slice(0, -1) + '…'
  g.fillText(t, x, y)
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** Expand the run-length matrix from qr.ts and draw it as squares. */
function drawQr(g: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const runs = QR_RUNS.split(',').map(Number)
  const cell = size / QR_SIZE
  g.fillStyle = '#fff'
  roundRect(g, x - 12, y - 12, size + 24, size + 24, 10)
  g.fill()
  g.fillStyle = '#000'
  let i = 0
  let on = false
  for (const run of runs) {
    if (on) {
      for (let k = 0; k < run; k++) {
        const idx = i + k
        // +0.5 on the size so neighbouring cells meet with no hairline gap
        g.fillRect(x + (idx % QR_SIZE) * cell, y + Math.floor(idx / QR_SIZE) * cell, cell + 0.5, cell + 0.5)
      }
    }
    i += run
    on = !on
  }
}

/**
 * 冠军赛 > 大师赛 > 赛区冠军, off what the event is rather than off an English
 * word in its name. It used to be `/Champions/i` and `/Masters/i`, and the
 * timeline books a competition under its Chinese name (engine/circuit.ts:
 * `${year} 全球冠军赛`) — so on every modern save the picture ranked a world
 * title level with a Challengers stage, and named it first only by luck of the
 * year. Only the pre-2023 English names ever matched.
 *
 * The call is the trophy case's (engine/me/trophies.ts), counted upwards here
 * because the card draws a bigger cup for a bigger number: one ranking of a
 * trophy, read three ways.
 */
const tierOf = (t: string) => 3 - TROPHY_RANK[trophyTier(t)]

/**
 * The ending's first sentence: the verdict in words, under its headline. The
 * whole ending grew the lifestyle and money lines (me/endings.ts) and no longer
 * fits three lines at this size — cut at three, the card ended mid-sentence in
 * 「…」. The card says the headline and this; the ending screen keeps the rest.
 */
const firstSentence = (text: string): string => /^[^。！？]*[。！？]/.exec(text)?.[0] ?? text

/* ------------------------------------------------------------------ */
/*  卡面: the ground and the head of the card, per look                 */
/* ------------------------------------------------------------------ */

/** A fixed scatter of specks — film grain, newsprint — the same on every draw, so a card is the same picture twice. */
function grain(g: CanvasRenderingContext2D, n: number, color: string, size: number): void {
  let s = 20260918
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
  g.fillStyle = color
  for (let i = 0; i < n; i++) g.fillRect(rnd() * W, rnd() * H, size, size)
}

/** The slant band of the 转播红 family: a red wedge across the top, with its fine stripes. */
function slantBand(g: CanvasRenderingContext2D, left: number, right: number, from: string, to: string): void {
  const grad = g.createLinearGradient(0, 0, W, right)
  grad.addColorStop(0, from)
  grad.addColorStop(1, to)
  g.fillStyle = grad
  g.beginPath()
  g.moveTo(0, 0)
  g.lineTo(W, 0)
  g.lineTo(W, right)
  g.lineTo(0, left)
  g.closePath()
  g.fill()
  g.save()
  g.clip()
  g.strokeStyle = 'rgba(255,255,255,0.07)'
  g.lineWidth = 3
  for (let x = -left; x < W + left; x += 26) {
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x + left * 0.18, left)
    g.stroke()
  }
  g.restore()
}

function ground(g: CanvasRenderingContext2D, look: LookKey, CO: Palette): void {
  g.fillStyle = CO.bg
  g.fillRect(0, 0, W, H)
  if (look === 'night') {
    // scan lines, then the band the head sits in
    g.fillStyle = 'rgba(255,255,255,0.022)'
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1)
    slantBand(g, 236, 160, '#FF4655', '#A51D29')
    return
  }
  if (look === 'film') {
    grain(g, 14000, 'rgba(255,236,200,0.05)', 2)
    grain(g, 6000, 'rgba(0,0,0,0.12)', 2)
    const v = g.createRadialGradient(W / 2, H * 0.42, H * 0.3, W / 2, H * 0.42, H * 0.78)
    v.addColorStop(0, 'rgba(0,0,0,0)')
    v.addColorStop(1, 'rgba(0,0,0,0.55)')
    g.fillStyle = v
    g.fillRect(0, 0, W, H)
    // two long scratches, the way an old print wears
    g.fillStyle = 'rgba(239,228,203,0.06)'
    g.fillRect(W * 0.31, 0, 1.5, H)
    g.fillRect(W * 0.77, H * 0.18, 1, H * 0.6)
    // the strip's edges and its sprocket holes
    for (const x of [0, W - 40]) {
      g.fillStyle = '#0B0907'
      g.fillRect(x, 0, 40, H)
      g.fillStyle = '#D8C9A8'
      for (let y = 18; y < H; y += 50) { roundRect(g, x + 12, y, 16, 26, 3); g.fill() }
    }
    g.fillStyle = 'rgba(239,228,203,0.14)'
    g.fillRect(40, 0, 1, H)
    g.fillRect(W - 41, 0, 1, H)
    return
  }
  if (look === 'led') {
    // the board: a lamp every six pixels, dark until lit
    g.fillStyle = 'rgba(255,178,62,0.07)'
    for (let y = 3; y < H; y += 6) for (let x = 3; x < W; x += 6) g.fillRect(x, y, 1.6, 1.6)
    // the ticker along the top: the red band, made of lamps
    const grad = g.createLinearGradient(0, 0, W, 110)
    grad.addColorStop(0, '#FF4655')
    grad.addColorStop(1, '#A51D29')
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(W, 0)
    g.lineTo(W, 78)
    g.lineTo(0, 108)
    g.closePath()
    g.fill()
    g.save()
    g.clip()
    g.fillStyle = 'rgba(0,0,0,0.34)'
    for (let x = 0; x < W; x += 5) g.fillRect(x, 0, 1.4, 110)
    for (let y = 0; y < 110; y += 5) g.fillRect(0, y, W, 1.4)
    g.restore()
    return
  }
  if (look === 'vault') {
    // the light from above, a cone onto the plinth, and the dark closing in at the floor
    const cone = g.createLinearGradient(0, 0, 0, 560)
    cone.addColorStop(0, 'rgba(255,240,205,0.17)')
    cone.addColorStop(1, 'rgba(255,240,205,0)')
    g.fillStyle = cone
    g.beginPath()
    g.moveTo(W / 2 - 70, 0)
    g.lineTo(W / 2 + 70, 0)
    g.lineTo(W / 2 + 330, 560)
    g.lineTo(W / 2 - 330, 560)
    g.closePath()
    g.fill()
    const glow = g.createRadialGradient(W / 2, 0, 10, W / 2, 0, 520)
    glow.addColorStop(0, 'rgba(255,236,190,0.18)')
    glow.addColorStop(1, 'rgba(255,236,190,0)')
    g.fillStyle = glow
    g.fillRect(0, 0, W, 560)
    const floor = g.createLinearGradient(0, H * 0.6, 0, H)
    floor.addColorStop(0, 'rgba(0,0,0,0)')
    floor.addColorStop(1, 'rgba(0,0,0,0.5)')
    g.fillStyle = floor
    g.fillRect(0, H * 0.6, W, H * 0.4)
    g.strokeStyle = 'rgba(233,199,123,0.22)'
    g.lineWidth = 2
    g.strokeRect(14, 14, W - 28, H - 28)
    return
  }
  if (look === 'split') return
  if (look === 'redline') {
    // a short red slash over the top-left corner
    g.fillStyle = CO.red
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(W * 0.44, 0)
    g.lineTo(W * 0.44 - 10, 10)
    g.lineTo(0, 10)
    g.closePath()
    g.fill()
    return
  }
  if (look === 'paper') {
    grain(g, 16000, 'rgba(0,0,0,0.035)', 2)
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75)
    v.addColorStop(0, 'rgba(120,96,50,0)')
    v.addColorStop(1, 'rgba(120,96,50,0.12)')
    g.fillStyle = v
    g.fillRect(0, 0, W, H)
    return
  }
  g.fillStyle = CO.red
  g.fillRect(0, 0, W, 8)
}

interface Head {
  first: number
  last: number
  title: string
  story: string
  /** IGN, role, origin, age, 综合 */
  who: string[]
  /** seasons on the card: the archive counts them as reels */
  reels: number
  /** 奖杯室's cup: the heaviest trophy started for (3 冠军赛, 2 大师赛, 1 a league's), else the heaviest, else 0 */
  cup: number
  /** trophies on the shelf, for the showcase's count */
  trophies: number
  /** 另一条世界线's axis: each season, what the ledger kept retitled, and the cups I started for */
  seasons: { year: number; retitled: number; cups: number[] }[]
}

/**
 * The head of the card — the brand, the years, the verdict, its first sentence
 * and who this was — per look. Returns the baseline of the who-line, where the
 * trophies start from; the default's is exactly the card as it always was.
 */
function head(g: CanvasRenderingContext2D, look: LookKey, CO: Palette, h: Head): number {
  const span = `${h.first}–${h.last}`
  if (look === 'night') {
    let y = 96
    g.font = FONT(800, 38)
    g.fillStyle = '#FFFFFF'
    g.fillText('无畏契约 · 选手生涯', PAD, y)
    g.font = FONT(500, 24)
    g.fillStyle = 'rgba(255,255,255,0.82)'
    g.fillText(span, W - PAD - g.measureText(span).width, y - 3)
    // the slate: a black tab with its red light
    y += 50
    g.font = FONT(700, 22)
    const slate = '生 涯 重 播'
    const sw = g.measureText(slate).width + 62
    g.fillStyle = '#06080B'
    g.fillRect(PAD, y - 30, sw, 42)
    g.fillStyle = CO.red
    g.beginPath()
    g.arc(PAD + 20, y - 9, 7, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#FFFFFF'
    g.fillText(slate, PAD + 38, y)
    // the verdict, white, on the band's edge
    y += 88
    g.save()
    g.shadowColor = 'rgba(0,0,0,0.45)'
    g.shadowBlur = 14
    g.shadowOffsetY = 3
    g.fillStyle = '#FFFFFF'
    fitText(g, h.title, PAD, y, W - PAD * 2, 78, 900)
    g.restore()
    y += 52
    g.font = FONT(400, 28)
    g.fillStyle = CO.ink2
    y += wrap(g, h.story, PAD, y, W - PAD * 2, 44, 3) * 44
    // who this was, as a broadcast lower third: the name on red, the rest on a white strip
    y += 40
    const [name, ...rest] = h.who
    g.font = FONT(800, 30)
    const nw = Math.min(360, g.measureText(name).width + 40)
    const line = rest.join(' · ')
    g.font = FONT(600, 25)
    const rw = Math.min(W - PAD * 2 - nw + 10, g.measureText(line).width + 56)
    g.fillStyle = '#F5F5F3'
    g.beginPath()
    g.moveTo(PAD + nw - 10, y - 36)
    g.lineTo(PAD + nw - 10 + rw, y - 36)
    g.lineTo(PAD + nw - 24 + rw, y + 14)
    g.lineTo(PAD + nw - 10, y + 14)
    g.closePath()
    g.fill()
    g.fillStyle = CO.red
    g.fillRect(PAD, y - 36, nw, 50)
    g.fillStyle = '#FFFFFF'
    fitText(g, name, PAD + 20, y, nw - 30, 30, 800)
    g.fillStyle = '#2A2F37'
    fitText(g, line, PAD + nw + 12, y - 1, rw - 44, 25, 600)
    return y + 8
  }
  if (look === 'film') {
    let y = 104
    g.font = FONT(700, 34)
    g.fillStyle = '#D0654F'
    g.fillText('无畏契约 · 选手生涯', PAD, y)
    g.font = FONT(400, 24)
    g.fillStyle = CO.ink3
    g.fillText(span, W - PAD - g.measureText(span).width, y - 3)
    // the intertitle: the verdict and its sentence in a double-ruled card, the reel count on a faded red tab
    const top = y + 38
    g.textAlign = 'center'
    y = top + 92
    g.fillStyle = CO.ink
    fitText(g, `「${h.title}」`, W / 2, y, W - PAD * 2 - 60, 70, 900, SERIF)
    y += 54
    g.font = SERIF(400, 28)
    g.fillStyle = CO.ink2
    const n = wrap(g, h.story, W / 2, y, W - PAD * 2 - 80, 44, 3)
    const bottom = y + (n - 1) * 44 + 34
    g.textAlign = 'left'
    g.strokeStyle = 'rgba(239,228,203,0.5)'
    g.lineWidth = 3
    g.strokeRect(PAD, top, W - PAD * 2, bottom - top)
    g.lineWidth = 1.5
    g.strokeRect(PAD + 9, top + 9, W - PAD * 2 - 18, bottom - top - 18)
    const tab = `生涯档案 · 共 ${h.reels} 卷`
    g.font = FONT(700, 22)
    const tw = g.measureText(tab).width + 48
    const tx = (W - tw) / 2
    g.fillStyle = 'rgba(196,69,47,0.92)'
    g.beginPath()
    g.moveTo(tx + 10, top - 18)
    g.lineTo(tx + tw, top - 18)
    g.lineTo(tx + tw - 10, top + 18)
    g.lineTo(tx, top + 18)
    g.closePath()
    g.fill()
    g.fillStyle = '#F6ECD6'
    g.fillText(tab, tx + 24, top + 8)
    y = bottom + 50
    g.fillStyle = CO.gold
    fitText(g, h.who.join(' · '), PAD, y, W - PAD * 2, 28, 600)
    return y
  }
  if (look === 'paper') {
    // the masthead, its double rule and the dateline
    let y = 86
    g.textAlign = 'center'
    g.fillStyle = CO.ink
    fitText(g, '无畏契约 · 选手生涯', W / 2, y, W - PAD * 2, 44, 900, SERIF)
    g.textAlign = 'left'
    g.fillRect(PAD, y + 18, W - PAD * 2, 4)
    g.fillRect(PAD, y + 26, W - PAD * 2, 1.5)
    y += 58
    g.font = SERIF(600, 21)
    g.fillStyle = CO.ink2
    g.fillText(span, PAD, y)
    const ed = `体育版 · 生涯 ${h.reels} 季`
    g.fillText(ed, W - PAD - g.measureText(ed).width, y)
    g.fillStyle = CO.line
    g.fillRect(PAD, y + 12, W - PAD * 2, 1)
    // the red flag, then the headline
    y += 34
    g.font = FONT(800, 22)
    const flag = '头 条'
    const fw = g.measureText(flag).width + 46
    g.fillStyle = CO.red
    g.beginPath()
    g.moveTo(PAD, y)
    g.lineTo(PAD + fw, y)
    g.lineTo(PAD + fw - 12, y + 36)
    g.lineTo(PAD, y + 36)
    g.closePath()
    g.fill()
    g.fillStyle = '#FFFFFF'
    g.fillText(flag, PAD + 16, y + 26)
    y += 114
    g.fillStyle = CO.ink
    fitText(g, h.title, PAD, y, W - PAD * 2, 84, 900, SERIF)
    y += 54
    g.font = SERIF(400, 28)
    g.fillStyle = CO.ink2
    y += wrap(g, h.story, PAD, y, W - PAD * 2, 44, 3) * 44
    // the byline, between rules
    y += 22
    g.fillStyle = CO.ink
    g.fillRect(PAD, y - 34, W - PAD * 2, 1.5)
    g.fillRect(PAD, y + 16, W - PAD * 2, 1.5)
    g.fillStyle = CO.ink2
    fitText(g, h.who.join(' · '), PAD, y, W - PAD * 2, 27, 600)
    return y + 6
  }
  if (look === 'led') {
    let y = 62
    g.font = FONT(800, 32)
    g.fillStyle = '#FFFFFF'
    g.fillText('无畏契约 · 选手生涯', PAD, y)
    g.font = FONT(600, 22)
    g.fillStyle = 'rgba(255,255,255,0.85)'
    g.fillText(span, W - PAD - g.measureText(span).width, y - 2)
    // the board: black, amber brackets at its corners, the verdict in red lamps
    const top = 146
    g.font = FONT(400, 28)
    const story = linesOf(g, h.story, W - PAD * 2 - 80, 3)
    const bottom = top + 232 + (story.length - 1) * 44
    g.fillStyle = '#000000'
    g.fillRect(PAD, top, W - PAD * 2, bottom - top)
    g.fillStyle = '#FFB23E'
    for (const [cx, cy, dx, dy] of [[PAD, top, 1, 1], [W - PAD, top, -1, 1], [PAD, bottom, 1, -1], [W - PAD, bottom, -1, -1]]) {
      g.fillRect(dx > 0 ? cx : cx - 30, dy > 0 ? cy : cy - 3, 30, 3)
      g.fillRect(dx > 0 ? cx : cx - 3, dy > 0 ? cy : cy - 30, 3, 30)
    }
    g.textAlign = 'center'
    g.font = FONT(700, 22)
    g.save()
    g.shadowColor = 'rgba(255,178,62,0.7)'
    g.shadowBlur = 10
    g.fillStyle = '#FFB23E'
    g.fillText('现 场 大 屏', W / 2, top + 50)
    g.restore()
    ledText(g, h.title, W / 2, top + 146, 96, '#FF4655', W - PAD * 2 - 80, 'center')
    g.textAlign = 'center'
    g.font = FONT(400, 28)
    g.fillStyle = CO.ink2
    story.forEach((l, i) => g.fillText(l, W / 2, top + 202 + i * 44))
    g.textAlign = 'left'
    y = bottom + 52
    g.fillStyle = '#FFB23E'
    fitText(g, h.who.join(' · '), PAD, y, W - PAD * 2, 28, 600)
    return y
  }
  if (look === 'vault') {
    g.textAlign = 'center'
    g.font = FONT(700, 24)
    g.fillStyle = CO.gold
    g.fillText('无畏契约 · 选手生涯', W / 2, 62)
    g.font = FONT(400, 20)
    g.fillStyle = CO.ink3
    g.fillText(span, W / 2, 92)
    // the cup, white, lit from above, on its shelf
    g.save()
    g.shadowColor = 'rgba(255,240,205,0.6)'
    g.shadowBlur = 40
    drawCup(g, h.cup, W / 2 - 64, 100, 128, h.cup ? '#FFFFFF' : '#BDB198', h.cup ? 0.22 : 0.16)
    g.restore()
    const shelf = g.createLinearGradient(W / 2 - 180, 0, W / 2 + 180, 0)
    shelf.addColorStop(0, 'rgba(233,199,123,0)')
    shelf.addColorStop(0.5, 'rgba(233,199,123,1)')
    shelf.addColorStop(1, 'rgba(233,199,123,0)')
    g.fillStyle = shelf
    g.fillRect(W / 2 - 180, 226, 360, 2)
    g.font = FONT(600, 22)
    g.fillStyle = CO.gold
    g.fillText(h.trophies ? `奖 杯 室 · ${h.trophies} 座` : '奖 杯 室 · 展 位 空 着', W / 2, 262)
    // the verdict on its red plate
    const top = 280
    g.font = FONT(900, 54)
    const tw = Math.min(W - PAD * 2 - 120, g.measureText(h.title).width)
    const pw = tw + 120
    const px = (W - pw) / 2
    const plate = g.createLinearGradient(0, top, 0, top + 80)
    plate.addColorStop(0, '#E0404D')
    plate.addColorStop(1, '#A51D29')
    g.fillStyle = plate
    g.beginPath()
    g.moveTo(px + 20, top)
    g.lineTo(px + pw, top)
    g.lineTo(px + pw - 20, top + 80)
    g.lineTo(px, top + 80)
    g.closePath()
    g.fill()
    g.fillStyle = '#FFFFFF'
    fitText(g, h.title, W / 2, top + 60, tw, 54, 900)
    g.font = FONT(400, 28)
    g.fillStyle = CO.ink2
    let y = top + 80 + 50
    y += (wrap(g, h.story, W / 2, y, W - PAD * 2, 44, 3) - 1) * 44
    y += 52
    g.fillStyle = CO.gold
    fitText(g, h.who.join(' · '), W / 2, y, W - PAD * 2, 28, 600)
    g.textAlign = 'left'
    return y
  }
  if (look === 'split') {
    // measure first: the dark half ends under the who-line, wherever the sentence leaves it
    g.font = FONT(400, 28)
    const story = linesOf(g, h.story, W - PAD * 2, 3)
    const who = 302 + (story.length - 1) * 44 + 58
    const cut = who + 62
    const fall = 72
    g.fillStyle = '#0B0E13'
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(W, 0)
    g.lineTo(W, cut - fall)
    g.lineTo(0, cut)
    g.closePath()
    g.fill()
    g.save()
    g.clip()
    g.fillStyle = 'rgba(255,255,255,0.022)'
    for (let y = 0; y < cut; y += 4) g.fillRect(0, y, W, 1)
    g.restore()
    // the red band along the cut
    const band = g.createLinearGradient(0, cut, W, cut - fall)
    band.addColorStop(0, '#FF4655')
    band.addColorStop(1, '#C21F2C')
    g.fillStyle = band
    g.beginPath()
    g.moveTo(0, cut)
    g.lineTo(W, cut - fall)
    g.lineTo(W, cut - fall + 20)
    g.lineTo(0, cut + 20)
    g.closePath()
    g.fill()
    g.font = FONT(800, 36)
    g.fillStyle = '#FFFFFF'
    g.fillText('无畏契约 · 选手生涯', PAD, 96)
    g.font = FONT(500, 24)
    g.fillStyle = '#8A94A0'
    g.fillText(span, W - PAD - g.measureText(span).width, 93)
    g.font = FONT(800, 22)
    const flag = '对 开'
    const fw = g.measureText(flag).width + 46
    g.fillStyle = '#FF4655'
    g.beginPath()
    g.moveTo(PAD, 126)
    g.lineTo(PAD + fw, 126)
    g.lineTo(PAD + fw - 12, 162)
    g.lineTo(PAD, 162)
    g.closePath()
    g.fill()
    g.fillStyle = '#FFFFFF'
    g.fillText(flag, PAD + 16, 152)
    fitText(g, h.title, PAD, 252, W - PAD * 2, 84, 900)
    g.font = FONT(400, 28)
    g.fillStyle = '#AAB2BC'
    story.forEach((l, i) => g.fillText(l, PAD, 302 + i * 44))
    g.fillStyle = '#DDE2E8'
    fitText(g, h.who.join(' · '), PAD, who, W - PAD * 2, 28, 600)
    return cut - 16
  }
  if (look === 'redline') {
    g.font = FONT(800, 34)
    g.fillStyle = '#FFFFFF'
    g.fillText('无畏契约 · 选手生涯', PAD, 72)
    // the two lines: history grey and straight, mine red, leaving it the year the career began (the axis carries the years)
    const n = Math.max(1, h.seasons.length)
    const xs = (i: number) => PAD + ((i + 0.5) / n) * (W - PAD * 2)
    const RED = 160
    const GREY = 202
    const x0 = xs(0)
    g.strokeStyle = '#5B6674'
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(PAD, GREY)
    g.lineTo(W - PAD, GREY)
    g.stroke()
    g.save()
    g.strokeStyle = CO.red
    g.lineWidth = 5
    g.shadowColor = 'rgba(255,70,85,0.6)'
    g.shadowBlur = 10
    g.beginPath()
    g.moveTo(PAD, GREY)
    g.lineTo(Math.max(PAD, x0 - 44), GREY)
    g.bezierCurveTo(x0 - 8, GREY, x0 - 8, RED, x0 + 18, RED)
    g.lineTo(W - PAD, RED)
    g.stroke()
    g.restore()
    h.seasons.forEach((s, i) => {
      const x = xs(i)
      g.beginPath()
      g.arc(x, RED, s.retitled ? 13 : 8, 0, Math.PI * 2)
      g.fillStyle = s.retitled ? '#FFFFFF' : CO.red
      g.fill()
      g.lineWidth = s.retitled ? 5 : 6
      g.strokeStyle = s.retitled ? CO.red : CO.bg
      g.stroke()
      if (s.cups.length) {
        drawCup(g, Math.max(...s.cups), x - 19, RED - 62, 38, '#FFFFFF', 0.2)
        if (s.cups.length > 1) {
          g.font = FONT(700, 18)
          g.fillStyle = '#FFFFFF'
          g.fillText(`×${s.cups.length}`, x + 18, RED - 34)
        }
      }
      g.font = FONT(500, 19)
      g.fillStyle = CO.ink3
      g.textAlign = 'center'
      g.fillText(String(s.year), x, GREY + 32)
      g.textAlign = 'left'
    })
    // the key
    let kx = PAD
    const ky = GREY + 72
    g.font = FONT(400, 20)
    for (const [c, label] of [['#5B6674', '真实历史'], [CO.red, '你的世界线']] as const) {
      g.fillStyle = c
      g.fillRect(kx, ky - 8, 30, 4)
      g.fillStyle = CO.ink3
      g.fillText(label, kx + 40, ky)
      kx += 40 + g.measureText(label).width + 28
    }
    g.fillText('大点：这一季有奖杯换了主人', kx, ky)
    let y = ky + 82
    g.fillStyle = '#FFFFFF'
    fitText(g, h.title, PAD, y, W - PAD * 2, 72, 900)
    y += 50
    g.font = FONT(400, 28)
    g.fillStyle = CO.ink2
    y += wrap(g, h.story, PAD, y, W - PAD * 2, 44, 3) * 44
    y += 30
    g.fillStyle = CO.gold
    fitText(g, h.who.join(' · '), PAD, y, W - PAD * 2, 30, 600)
    return y
  }
  // 演播室, the card as it always was
  let y = 112
  g.font = FONT(700, 40)
  g.fillStyle = CO.red
  g.fillText('无畏契约 · 选手生涯', PAD, y)
  g.font = FONT(400, 24)
  g.fillStyle = CO.ink3
  g.fillText(span, W - PAD - g.measureText(span).width, y - 3)

  // the verdict, which is the whole point of the card
  y += 94
  g.fillStyle = CO.ink
  fitText(g, `「${h.title}」`, PAD, y, W - PAD * 2, 72)
  y += 52
  g.font = FONT(400, 28)
  g.fillStyle = CO.ink2
  y += wrap(g, h.story, PAD, y, W - PAD * 2, 44, 3) * 44

  // who this was
  y += 30
  g.font = FONT(600, 30)
  g.fillStyle = CO.gold
  fitText(g, h.who.join(' · '), PAD, y, W - PAD * 2, 30, 600)
  return y
}

/** Draw the whole thing, in the 卡面 given (me/hall.ts LOOKS). Returns null where there is no canvas to draw on. */
export function drawCareerCard(state: GameState, look: LookKey = 'studio'): HTMLCanvasElement | null {
  const me = state.me
  if (!me || typeof document === 'undefined') return null
  const p = state.players[me.id]
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')
  if (!g) return null
  const CO = PALETTES[look] ?? STUDIO

  ground(g, look, CO)
  g.textBaseline = 'alphabetic'
  g.textAlign = 'left'

  const first = me.seasons[0]?.year ?? state.year
  // the last season on the card, not state.year — retirement lands in the
  // year after the last one played, and the header must match the rows
  const last = me.seasons[me.seasons.length - 1]?.year ?? state.year
  const clubs = Array.from(new Set((p.clubHist ?? []).map((h) => state.teams[h.team]?.tag ?? h.team)))
  const origin = originName(originOf(me.originKey), serverAt(me.region, me.entryYear ?? me.seasons[0]?.year ?? state.year, 0))
  const titles = me.titles.slice().sort((a, b) => tierOf(b.title) - tierOf(a.title) || a.year - b.year)
  let y = head(g, look, CO, {
    first, last, title: me.ending?.title ?? '生涯', story: firstSentence(me.ending?.text ?? ''),
    who: [p.ign, p.role, origin, `${p.age} 岁`, `综合 ${p.overall}`], reels: me.seasons.length,
    cup: tierOf((titles.find((t) => t.started) ?? titles[0])?.title ?? '') * (titles.length ? 1 : 0),
    trophies: titles.length,
    seasons: me.seasons.map((s) => ({
      year: s.year, retitled: s.retitled ?? 0,
      cups: me.titles.filter((t) => t.year === s.year && t.started).map((t) => tierOf(t.title)),
    })),
  })

  // trophies
  y += 62
  g.font = FONT(400, 26)
  g.fillStyle = CO.ink3
  if (titles.length) {
    g.fillText('冠军', PAD, y)
    g.font = FONT(600, 26)
    g.fillStyle = CO.gold
    // a decorated career overruns three lines; name the big ones and count
    // the rest, because a trophy list ending in 「…」 says nothing. 「2032 全球冠军赛」
    // carries its year already: it was drawn 「2032 2032 全球冠军赛」 (2026-09-18).
    const names = titles.slice(0, 5).map((t) => {
      const cn = compCn(t.title)
      return `${cn.includes(String(t.year)) ? cn : `${t.year} ${cn}`}${t.started ? '' : '（随队）'}`
    })
    const more = titles.length - names.length
    const lines = titleLines(g, names, W - PAD * 2, 3, more)
    lines.forEach((l, i) => g.fillText(l, PAD, y + 40 + i * 40))
    y += lines.length * 40 + 40
  } else {
    g.fillText('没有奖杯', PAD, y)
    y += 40
  }

  // 在你的世界线里 (engine/me/rewrites.ts, the author's brief of 2026-09-18): one strip, the heaviest rewrite I started
  // in or whose title went to my club, as a broadcast lower third in the card's red — the count on the red name strip,
  // the entry under it. What the world did without me is never put on this card as mine; with nothing, no strip.
  const rw = careerRewrites(me)
  if (rw?.share) {
    const top = y + 4
    const tw = W - PAD * 2 - 52
    const strip = shareLine(rw.share)
    g.font = FONT(500, 26)
    const rows = linesOf(g, strip, tw, 3)
    const h = 72 + rows.length * 38
    g.fillStyle = CO.panel
    roundRect(g, PAD, top, W - PAD * 2, h, 10 * CO.r)
    g.fill()
    g.fillStyle = CO.red
    g.fillRect(PAD, top, 6, h)
    const label = retitledLine(rw) || '你的世界线'
    g.font = FONT(700, 22)
    const lw = Math.min(W - PAD * 2 - 30, g.measureText(label).width + 44)
    g.beginPath()
    g.moveTo(PAD + 6, top + 14)
    g.lineTo(PAD + 6 + lw, top + 14)
    g.lineTo(PAD + 6 + lw - 12, top + 48)
    g.lineTo(PAD + 6, top + 48)
    g.closePath()
    g.fill()
    g.fillStyle = '#fff'
    fitText(g, label, PAD + 22, top + 39, lw - 40, 22, 700)
    g.font = FONT(500, 26)
    g.fillStyle = CO.ink
    rows.forEach((l, i) => g.fillText(l, PAD + 26, top + 90 + i * 38))
    y = top + h
  }

  // Year by year. This is the part that has to fit whatever the career was:
  // a two-season flameout and a twelve-season veteran land on the same page.
  // The rows take what is left after the fixed furniture, and if twelve rows
  // still will not fit, the lines about teammates give way first — they are
  // the one block on the card that is nice to have rather than the record.
  y += 34
  const rows = me.seasons
  const bondAll = bondCardLines(state)
  const FOOT = H - 250 - 40        // the divider above the site line
  const FIXED = 30 + 140 + 24      // gap, the five numbers, breathing room
  let bondN = Math.min(3, bondAll.length)
  let rh = 0
  for (;; bondN--) {
    const bondH = bondN ? 22 + bondN * 36 : 0
    rh = Math.floor((FOOT - y - FIXED - bondH) / Math.max(1, rows.length))
    if (rh >= 40 || bondN === 0) break
  }
  rh = Math.max(38, Math.min(104, rh))
  const bond = bondAll.slice(0, Math.max(0, bondN))
  // the type shrinks with the row, or a fourteen-season card runs into itself
  const rowFs = rh >= 62 ? 26 : rh >= 50 ? 24 : 21
  rows.forEach((s, i) => {
    const yy = y + i * rh
    const won = titles.some((t) => t.year === s.year)
    if (look === 'paper' && !won) {
      // the front page sets the seasons as a box score: ruled, not boxed
      g.fillStyle = CO.line
      g.fillRect(PAD, yy + rh - 10, W - PAD * 2, 1)
    } else {
      g.fillStyle = won ? CO.won : CO.panel
      roundRect(g, PAD, yy, W - PAD * 2, rh - 10, 10 * CO.r)
      g.fill()
    }
    if (won) { g.fillStyle = CO.edge; g.fillRect(PAD, yy, 5, rh - 10) }
    const mid = yy + (rh - 10) / 2 + rowFs / 3
    g.font = FONT(700, rowFs)
    g.fillStyle = won ? CO.wonYear ?? CO.gold : CO.year ?? CO.ink2
    g.fillText(String(s.year), PAD + 24, mid)
    g.fillStyle = CO.ink
    fitText(g, s.team, PAD + 130, mid, 330, rowFs, 400)
    g.font = FONT(400, rowFs)
    g.fillStyle = CO.ink2
    const right = s.tier ? `${s.starts}/${s.matches} 首发 · ACS ${s.acs || '—'} · ${s.overallTo}`
      : `天梯 ${rankShort(rankAt(state, me.pre.ladderPeak))} · ${s.overallTo}`
    g.fillText(right, W - PAD - 24 - g.measureText(right).width, mid)
  })
  y += rows.length * rh + 30

  // five numbers
  const starts = me.seasons.reduce((s, x) => s + x.starts, 0)
  const matches = me.seasons.reduce((s, x) => s + x.matches, 0)
  const wins = me.seasons.reduce((s, x) => s + x.wins, 0)
  const earned = me.ledger?.lifetimeIn ?? 0
  const stats: [string, string][] = [
    ['首发 / 出场', `${starts}/${matches}`],
    ['首发胜场', String(wins)],
    ['冠军 / FMVP', `${titles.length} / ${fmvpTotals(me.titles).confirmed}`],
    ['粉丝', `${fansCn(me.fans)} · ${fanTier(me.fans).name}`],
    ['生涯总收入', cny(earned)],
  ]
  const cw = (W - PAD * 2) / stats.length
  if (look === 'paper') {
    g.fillStyle = CO.ink
    g.fillRect(PAD, y, W - PAD * 2, 3)
    g.fillRect(PAD, y + 130, W - PAD * 2, 1.5)
  } else {
    g.fillStyle = CO.panel
    roundRect(g, PAD, y, W - PAD * 2, 140, 12 * CO.r)
    g.fill()
    // the broadcast's score bar: a red rule along its top; the board's amber, the showcase's brass, the line's red
    if (look === 'night') { g.fillStyle = CO.red; g.fillRect(PAD, y, W - PAD * 2, 4) }
    if (look === 'led') { g.fillStyle = '#FFB23E'; g.fillRect(PAD, y, W - PAD * 2, 2) }
    if (look === 'vault') { g.fillStyle = CO.gold; g.fillRect(PAD, y, W - PAD * 2, 3) }
    if (look === 'redline') { g.fillStyle = CO.red; g.fillRect(PAD, y, W - PAD * 2, 2) }
  }
  stats.forEach(([k, v], i) => {
    const cx = PAD + cw * i + cw / 2
    g.textAlign = 'center'
    g.font = FONT(400, 22)
    g.fillStyle = CO.ink3
    g.fillText(k, cx, y + 48)
    g.fillStyle = CO.num ?? CO.ink
    if (look === 'led') { g.save(); g.shadowColor = 'rgba(255,178,62,0.6)'; g.shadowBlur = 12 }
    fitText(g, v, cx, y + 102, cw - 24, 32)
    if (look === 'led') g.restore()
    if (i) { g.fillStyle = CO.line; g.fillRect(PAD + cw * i, y + 32, 1, 76) }
  })
  g.textAlign = 'left'
  y += 140

  // the people, by name
  if (bond.length) {
    y += 22
    bond.forEach((line, i) => {
      g.fillStyle = CO.ink2
      fitText(g, line, PAD, y + i * 36, W - PAD * 2, 24, 400)
    })
    y += bond.length * 36
  }

  // the way in
  const qy = H - 250
  g.fillStyle = CO.line
  g.fillRect(PAD, qy - 40, W - PAD * 2, 1)
  g.font = FONT(700, 34)
  g.fillStyle = CO.ink
  g.fillText('无畏契约 · 选手生涯模拟', PAD, qy + 42)
  g.font = FONT(400, 26)
  g.fillStyle = CO.ink2
  g.fillText('扫码开一局，从青训打到冠军赛', PAD, qy + 90)
  g.font = FONT(400, 23)
  g.fillStyle = CO.gold
  g.fillText(QR_URL.replace(/^https?:\/\//, ''), PAD, qy + 138)
  drawQr(g, W - PAD - 168, qy - 4, 168)

  // effort, in the corner, so a stranger knows how long this took
  g.font = FONT(400, 20)
  g.fillStyle = CO.ink3
  const foot = `${clubs.join(' · ') || '没有效力过俱乐部'} · 成就 ${me.achievements.length}`
  fitText(g, foot, PAD, H - 44, W - PAD * 2, 20, 400)
  return cv
}

export const CARD_FILE = '无畏契约-生涯名片.png'

/** A data URL for the card, or null on a device that cannot draw one. */
export function careerCardUrl(state: GameState, look: LookKey = 'studio'): string | null {
  const cv = drawCareerCard(state, look)
  if (!cv) return null
  try { return cv.toDataURL('image/png') } catch { return null }
}

/** iOS only offers "save to photos" through the share sheet, and that needs a File. */
export function dataUrlToFile(url: string, name: string): File | null {
  try {
    if (typeof File !== 'function' || typeof atob !== 'function') return null
    const i = url.indexOf(',')
    if (i < 0) return null
    const bin = atob(url.slice(i + 1))
    const buf = new Uint8Array(bin.length)
    for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k)
    return new File([buf], name, { type: 'image/png' })
  } catch { return null }
}

export function canShareFile(file: File): boolean {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : null
    return !!(nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] }))
  } catch { return false }
}
