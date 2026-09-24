/**
 * 信箱「随版本改的标签」（box.js releaseLabels）：上线后启动时自己改一次，原数据一个字不丢。
 *
 *  - 改之前 box.jsonl 原样备份一份，字节一模一样；
 *  - 只改还是「已展示」的；作者已经动过的（隐藏、已采纳、合并）不碰；不在名单上的不碰；
 *  - 每条的原文、时间、设备、票数、置顶一个不变，只有状态变；
 *  - 做过一次就记下，作者再改回「已展示」，重启不会又改掉；备份也不会被覆盖；
 *  - 空信箱第一次开张：不备份、不报错。
 *
 *   npx tsx scripts/check_box_release.ts
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error box.js is plain JS without types
import { initBox, _boxState } from '../box.js'

let bad = 0
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}
type Item = { id: string; t: number; dev: string; text: string; state: string; pin: number; votes: string[] }
const byId = (): Map<string, Item> => new Map((_boxState() as Item[]).map((it) => [it.id, it]))
const KEY = '2026-09-24-f7d06c2'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'valbox-release-'))
const file = path.join(dir, 'box.jsonl')
const ops = [
  { o: 'new', id: 'a17ca0ba', t: 1, dev: 'd1', text: '属性到99后自动分配还是会去练', s: 'shown' },
  { o: 'new', id: '7161c4da', t: 2, dev: 'd2', text: '周报旧事重提', s: 'shown', p: 1 },
  { o: 'new', id: '1bf81754', t: 3, dev: 'd3', text: '作者已经收起来的一条', s: 'hidden' },
  { o: 'new', id: '2ba131e5', t: 4, dev: 'd4', text: '作者已经标了已采纳的一条', s: 'taken' },
  { o: 'new', id: 'deadbeef', t: 5, dev: 'd5', text: '不在名单上的一条', s: 'shown' },
  { o: 'new', id: 'cafe0001', t: 6, dev: 'd6', text: '还没审的一条', s: 'pending' },
  { o: 'vote', id: 'a17ca0ba', dev: 'v1', on: true },
  { o: 'vote', id: 'a17ca0ba', dev: 'v2', on: true },
  { o: 'vote', id: '7161c4da', dev: 'v3', on: true },
]
fs.writeFileSync(file, ops.map((o) => `\n${JSON.stringify(o)}\n`).join(''))
const original = fs.readFileSync(file)

// 用重放出来的「改之前」做对照（不跑 releaseLabels：先在另一个目录放同一份日志和已完成记号）
const refDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valbox-ref-'))
fs.writeFileSync(path.join(refDir, 'box.jsonl'), original)
fs.writeFileSync(path.join(refDir, 'box-release.json'), JSON.stringify({ done: [KEY] }))
initBox({ dir: refDir, volatile: false })
const before = byId()

console.log('第一次启动：')
initBox({ dir, volatile: false })
const after = byId()
const bak = `${file}.bak-${KEY}`
check(fs.existsSync(bak) && Buffer.compare(fs.readFileSync(bak), original) === 0, '改之前原日志备份了一份，字节一模一样')
check(after.get('a17ca0ba')?.state === 'fixed', '已展示的 a17ca0ba → 已修复')
check(after.get('7161c4da')?.state === 'taken', '已展示的 7161c4da → 已采纳')
check(after.get('1bf81754')?.state === 'hidden', '作者收起来的 1bf81754 不碰，还是未展示')
check(after.get('2ba131e5')?.state === 'taken', '作者标过已采纳的 2ba131e5 不碰（名单里是已修复也不改）')
check(after.get('deadbeef')?.state === 'shown' && after.get('cafe0001')?.state === 'pending', '不在名单上的、待审核的都不碰')
check(after.size === before.size, `条目数不变：${after.size}`)
let same = true
for (const [id, b] of before) {
  const a = after.get(id)
  if (!a || a.text !== b.text || a.t !== b.t || a.dev !== b.dev || a.pin !== b.pin
    || [...a.votes].sort().join() !== [...b.votes].sort().join()) same = false
}
check(same, '每条的原文、时间、设备、置顶、票数一个不变，只有状态变')
check(fs.readFileSync(file).subarray(0, original.length).equals(original), '原日志只在末尾追加，前面一个字节没动')
const mark = JSON.parse(fs.readFileSync(path.join(dir, 'box-release.json'), 'utf8'))
check(Array.isArray(mark.done) && mark.done.includes(KEY), '做过的批次记下了')

console.log('作者改回已展示，再重启：')
fs.appendFileSync(file, `\n${JSON.stringify({ o: 'st', id: 'a17ca0ba', s: 'shown' })}\n`)
initBox({ dir, volatile: false })
check(byId().get('a17ca0ba')?.state === 'shown', '作者改回的已展示，重启后还是已展示，不会被再改一次')
check(Buffer.compare(fs.readFileSync(bak), original) === 0, '备份没有被覆盖')

console.log('空信箱第一次开张：')
const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'valbox-fresh-'))
initBox({ dir: fresh, volatile: false })
check(!fs.readdirSync(fresh).some((f) => f.includes('.bak-') || f === 'box-release.json'), '名单上的一条都不在：不备份、不留记号文件')
check(byId().size === 3, `三条开张预置照常放：${byId().size}`)

for (const d of [dir, refDir, fresh]) fs.rmSync(d, { recursive: true, force: true })
if (bad) { console.log(`\n✗ 信箱随版本改标签有 ${bad} 处不对。`); process.exit(1) }
console.log('\n✓ 信箱随版本改标签：先备份、只改还在展示的、原文票数不变、只做一次。')
