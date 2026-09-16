/**
 * The career-end card, photographed — every case, both grounds, desktop and phone.
 *
 * Reaching a finished career by clicking is twenty minutes a shot, so the page
 * at /ending-preview.html builds the end state and mounts the real card with the
 * real game context (scripts/ending_preview.tsx). This drives it.
 *
 *   npx vite --port 5193 --strictPort
 *   node scripts/endcard_shots.mjs [--cases=champ,ring,none] [--themes=dark,light]
 *
 * Writes .cache/endcard/<case>-<theme>-<width>.png (.cache is gitignored).
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
const pick = (k, d) => (args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d).split(',')
const BASE = process.env.SHOT_URL ?? 'http://localhost:5193/'
const OUT = '.cache/endcard'

const CASES = pick('cases', 'champ,breaker,ring,regional,none')
const THEMES = pick('themes', 'dark,light,cream')
// the phone viewport is a real 375, but tall enough that the whole card paints
// in one pass — an element screenshot of something taller than the window comes
// back with the unpainted tail as black
const SIZES = [
  { w: 1280, h: 1000, tag: 'desktop' },
  { w: 375, h: 2600, tag: '375' },
]

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
let n = 0
const notes = []

for (const size of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => notes.push(`  ! pageerror ${e.message}`))
  for (const kase of CASES) {
    for (const theme of THEMES) {
      const url = `${BASE}ending-preview.html?case=${kase}&theme=${theme}`
      await page.goto(url, { waitUntil: 'load', timeout: 120000 })
      // the harness runs a whole career with the autopilot before it can draw
      await page.waitForSelector('.poster-me', { timeout: 180000 })
      await page.waitForTimeout(250)
      const verdict = await page.textContent('.pm-verdict').catch(() => '?')
      const tiles = await page.$$eval('.pm-t', (els) => els.map((e) => e.className).join(' | ')).catch(() => '')
      // what the player sees: the card inside the card the clock stopped on
      const el = (await page.$('.modal')) ?? (await page.$('.poster-me'))
      const file = `${OUT}/${kase}-${theme}-${size.tag}.png`
      await el.screenshot({ path: file })
      n++
      if (size.tag === 'desktop' && theme === 'dark') notes.push(`  ${kase.padEnd(9)} 「${verdict}」  ${tiles}`)
      // the document must never scroll sideways on a phone
      if (size.w === 375) {
        const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
        if (over) notes.push(`  ! ${kase}/${theme} 375px 横向溢出`)
      }
    }
  }
  await ctx.close()
}

await browser.close()
console.log(`\n${n} 张，写在 ${OUT}/`)
console.log(notes.join('\n'))
