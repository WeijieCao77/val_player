import type { GameState } from '../../engine/types'
import { bondCardLines } from '../../engine/me/bond'
import { fanTier, fansCn } from '../../engine/me/fans'
import { originOf } from '../../engine/me/origins'
import { QR_RUNS, QR_SIZE, QR_URL } from './qr'

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

const CO = {
  bg: '#0B1622',
  panel: '#122132',
  line: '#1E3247',
  ink: '#E8EEF5',
  ink2: '#9FB2C6',
  ink3: '#6B8199',
  gold: '#E8B559',
  red: '#FF4655',
  win: '#59C08A',
}

const FONT = (w: number, s: number) =>
  `${w} ${s}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif`

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

/** Shrink until it fits, then truncate if it still does not. */
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, weight = 700): void {
  let t = String(text ?? '')
  let sz = size
  while (sz > 16) {
    g.font = FONT(weight, sz)
    if (g.measureText(t).width <= maxW) break
    sz -= 2
  }
  g.font = FONT(weight, sz)
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

const tierOf = (t: string) => (/Champions/i.test(t) ? 3 : /Masters/i.test(t) ? 2 : 1)

/** Draw the whole thing. Returns null where there is no canvas to draw on. */
export function drawCareerCard(state: GameState): HTMLCanvasElement | null {
  const me = state.me
  if (!me || typeof document === 'undefined') return null
  const p = state.players[me.id]
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')
  if (!g) return null

  g.fillStyle = CO.bg
  g.fillRect(0, 0, W, H)
  g.fillStyle = CO.red
  g.fillRect(0, 0, W, 8)
  g.textBaseline = 'alphabetic'
  g.textAlign = 'left'

  const first = me.seasons[0]?.year ?? state.year
  // the last season on the card, not state.year — retirement lands in the
  // year after the last one played, and the header must match the rows
  const last = me.seasons[me.seasons.length - 1]?.year ?? state.year
  let y = 112

  g.font = FONT(700, 40)
  g.fillStyle = CO.red
  g.fillText('无畏契约 · 选手生涯', PAD, y)
  g.font = FONT(400, 24)
  g.fillStyle = CO.ink3
  const head = `${first}–${last}`
  g.fillText(head, W - PAD - g.measureText(head).width, y - 3)

  // the verdict, which is the whole point of the card
  y += 94
  g.fillStyle = CO.ink
  fitText(g, `「${me.ending?.title ?? '生涯'}」`, PAD, y, W - PAD * 2, 72)
  y += 52
  g.font = FONT(400, 28)
  g.fillStyle = CO.ink2
  y += wrap(g, me.ending?.text ?? '', PAD, y, W - PAD * 2, 44, 3) * 44

  // who this was
  y += 30
  g.font = FONT(600, 30)
  g.fillStyle = CO.gold
  const clubs = Array.from(new Set((p.clubHist ?? []).map((h) => state.teams[h.team]?.tag ?? h.team)))
  fitText(g, [p.ign, p.role, originOf(me.originKey).name, `${p.age} 岁`, `综合 ${p.overall}`].join(' · '),
    PAD, y, W - PAD * 2, 30, 600)

  // trophies
  y += 62
  const titles = me.titles.slice().sort((a, b) => tierOf(b.title) - tierOf(a.title) || a.year - b.year)
  g.font = FONT(400, 26)
  g.fillStyle = CO.ink3
  if (titles.length) {
    g.fillText('冠军', PAD, y)
    g.font = FONT(600, 26)
    g.fillStyle = CO.gold
    // a decorated career overruns three lines; name the big ones and count
    // the rest, because a trophy list ending in 「…」 says nothing
    const big = titles.slice(0, 5)
    const rest = titles.length - big.length
    const text = big.map((t) => `${t.year} ${t.title}${t.started ? '' : '（随队）'}`).join('、')
      + (rest > 0 ? `，另有 ${rest} 个` : '')
    y += wrap(g, text, PAD, y + 40, W - PAD * 2, 40, 3) * 40 + 40
  } else {
    g.fillText('没有奖杯', PAD, y)
    y += 40
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
    g.fillStyle = won ? '#1E2A1F' : CO.panel
    roundRect(g, PAD, yy, W - PAD * 2, rh - 10, 10)
    g.fill()
    if (won) { g.fillStyle = CO.gold; g.fillRect(PAD, yy, 5, rh - 10) }
    const mid = yy + (rh - 10) / 2 + rowFs / 3
    g.font = FONT(700, rowFs)
    g.fillStyle = won ? CO.gold : CO.ink2
    g.fillText(String(s.year), PAD + 24, mid)
    g.fillStyle = CO.ink
    fitText(g, s.team, PAD + 130, mid, 330, rowFs, 400)
    g.font = FONT(400, rowFs)
    g.fillStyle = CO.ink2
    const right = s.tier ? `${s.starts}/${s.matches} 首发 · ACS ${s.acs || '—'} · ${s.overallTo}`
      : `天梯 ${Math.round(me.pre.ladderPeak)} · ${s.overallTo}`
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
    ['冠军', String(titles.length)],
    ['粉丝', `${fansCn(me.fans)} · ${fanTier(me.fans).name}`],
    ['生涯总收入', earned >= 1_000_000 ? `$${(earned / 1_000_000).toFixed(2)}M` : `$${Math.round(earned / 1000)}K`],
  ]
  const cw = (W - PAD * 2) / stats.length
  g.fillStyle = CO.panel
  roundRect(g, PAD, y, W - PAD * 2, 140, 12)
  g.fill()
  stats.forEach(([k, v], i) => {
    const cx = PAD + cw * i + cw / 2
    g.textAlign = 'center'
    g.font = FONT(400, 22)
    g.fillStyle = CO.ink3
    g.fillText(k, cx, y + 48)
    g.fillStyle = CO.ink
    fitText(g, v, cx, y + 102, cw - 24, 32)
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
export function careerCardUrl(state: GameState): string | null {
  const cv = drawCareerCard(state)
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
