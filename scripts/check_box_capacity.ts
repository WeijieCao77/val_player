/** 信箱满容量清理：只操作本次创建的临时目录和本地 HTTP，不碰线上数据。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { initBox, handleBoxAdmin, handleBoxApi, _boxState, counts, boxHtml } from '../box.js'

const HARD = 8 * 1024 * 1024
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'valbox-capacity-'))
const originalWrite = fs.writeFileSync
const originalRename = fs.renameSync
const originalAppend = fs.appendFileSync
const server = http.createServer((req, res) => {
  if (req.url === '/dash/box') void handleBoxAdmin(req, res, '/dash/box')
  else if (!handleBoxApi(req, res, req.url, 'capacity-test')) { res.writeHead(404); res.end() }
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const record = (id: string, votes = ['author', 'reader']) => ({
  o: 'set', id, t: 1, dev: 'author', text: `保留完整内容 ${id}`, s: 'shown', p: 1, v: votes,
})
const setup = (name: string, body: string) => {
  const dir = path.join(tmp, name)
  fs.mkdirSync(dir)
  const file = path.join(dir, 'box.jsonl')
  fs.writeFileSync(file, body)
  initBox({ dir, volatile: false })
  return { dir, file }
}
const padded = (lines: unknown[], tail = '') => {
  const body = lines.map(o => JSON.stringify(o)).join('\n') + '\n'
  return body + ' '.repeat(Math.max(0, HARD - Buffer.byteLength(body) - Buffer.byteLength(tail))) + tail
}
async function admin(act: string, id: string, extra: Record<string, string> = {}) {
  const response = await fetch(base + '/dash/box', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' },
    body: new URLSearchParams({ act, id, ...extra }),
  })
  return { status: response.status, text: await response.text() }
}
async function api(action: string, body: Record<string, unknown>) {
  const response = await fetch(`${base}/api/box/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, ...body }),
  })
  return response.json()
}
const restart = (dir: string, expected: unknown) => {
  initBox({ dir, volatile: false })
  assert.deepEqual(_boxState(), expected, '重启后的正文、状态、置顶和投票集合必须完全相同')
}

try {
  const { dir, file } = setup('at-hard-limit', padded([record('aaaaaaaa'), record('bbbbbbbb')], '\n{"o":"new","text":"坏尾'))
  const retained = _boxState().filter(it => it.id === 'bbbbbbbb')
  assert.equal((await admin('del', 'aaaaaaaa')).status, 303)
  assert.deepEqual(_boxState(), retained, '8 MB 满容量时管理员删除必须真的生效')
  assert.ok(fs.statSync(file).size < HARD)
  restart(dir, retained)
  assert.equal((await api('new', { vid: 'after-cleanup', text: '清理后恢复正常投稿' })).ok, true)
  restart(dir, _boxState())
  console.log('✓ 8 MB 日志含坏尾：删除、压实、恢复投稿及重启保留合法内容')

  for (const fault of ['write', 'rename'] as const) {
    const fixture = setup(`failure-${fault}`, padded([record('aaaaaaaa'), record('bbbbbbbb')]))
    const diskBefore = fs.readFileSync(fixture.file)
    const stateBefore = _boxState()
    const bytesBefore = counts().bytes
    if (fault === 'write') {
      fs.writeFileSync = ((target, value, ...args) => {
        if (String(target).startsWith(fixture.file + '.') && String(target).endsWith('.tmp')) {
          originalWrite.call(fs, target, String(value).slice(0, 40), ...args)
          throw new Error('injected partial snapshot write failure')
        }
        return originalWrite.call(fs, target, value, ...args)
      }) as typeof fs.writeFileSync
    } else {
      fs.renameSync = ((from, to) => {
        if (to === fixture.file) throw new Error('injected snapshot rename failure')
        return originalRename.call(fs, from, to)
      }) as typeof fs.renameSync
    }
    const failed = await admin('merge', 'aaaaaaaa', { to: 'bbbbbbbb' })
    fs.writeFileSync = originalWrite
    fs.renameSync = originalRename
    assert.equal(failed.status, 503, '写入/替换失败不能返回成功跳转')
    assert.ok(failed.text.includes('未能保存'))
    assert.deepEqual(fs.readFileSync(fixture.file), diskBefore, '失败不能改动原日志的任何字节')
    assert.deepEqual(_boxState(), stateBefore, '失败不能提前合并票数或删除内存条目')
    assert.equal(counts().bytes, bytesBefore)
    assert.deepEqual(fs.readdirSync(fixture.dir), ['box.jsonl'], '本次临时快照清理完毕')
    restart(fixture.dir, stateBefore)
    assert.equal((await admin('merge', 'aaaaaaaa', { to: 'bbbbbbbb' })).status, 303)
    assert.equal(_boxState().length, 2, '合并保留来源回执，不释放条目数')
    assert.equal(_boxState().find(it => it.id === 'aaaaaaaa')?.state, 'merged')
    assert.deepEqual(_boxState().find(it => it.id === 'bbbbbbbb')?.votes, ['author', 'reader'], '合并重复票去重')
    restart(fixture.dir, _boxState())
    console.log(`✓ ${fault} 故障：503、原文件/内存不变、重启不丢数据，恢复后可合并`)
  }

  // 实际有效内容超过上限（不是仅用空白填大的历史日志），一次删除仍未降到 8 MB。
  const voters = Array.from({ length: 5000 }, (_, i) => `reader-${String(i).padStart(5, '0')}`.padEnd(64, 'x'))
  const many = Array.from({ length: 28 }, (_, i) => record(i.toString(16).padStart(8, '0'), voters))
  const huge = setup('large-live-snapshot', many.map(o => JSON.stringify(o)).join('\n') + '\n')
  assert.ok(counts().bytes > HARD)
  assert.ok(boxHtml().includes('达到容量上限'), '启动就显示硬上限警告，不必先点失败按钮')
  const hugeBefore = _boxState()
  const denied = await api('new', { vid: 'full-new', text: '真实内容满容量时不许继续添加' })
  assert.equal(denied.ok, false)
  assert.deepEqual(_boxState(), hugeBefore)
  assert.equal((await admin('hide', '00000000')).status, 503)
  assert.deepEqual(_boxState(), hugeBefore)
  assert.equal((await admin('del', '00000000')).status, 303)
  assert.ok(counts().bytes > HARD, '首条删除后依然超过容量，仍应允许继续清理')
  assert.deepEqual(_boxState(), hugeBefore.slice(1))
  restart(huge.dir, hugeBefore.slice(1))
  assert.equal((await admin('merge', '00000001', { to: '00000002' })).status, 303)
  assert.ok(counts().bytes > HARD)
  assert.deepEqual(_boxState().filter(it => it.state !== 'merged'), hugeBefore.slice(2))
  assert.equal(_boxState().find(it => it.id === '00000001')?.state, 'merged')
  assert.equal((await api('vote', { id: '00000002', vid: voters[0], on: false })).ok, true, '超过上限仍允许减少一票')
  assert.equal(_boxState().find(it => it.id === '00000002')?.votes.length, 4999)
  restart(huge.dir, _boxState())
  for (const id of ['00000002', '00000003']) assert.equal((await admin('del', id)).status, 303)
  assert.ok(counts().bytes < HARD)
  assert.equal((await api('new', { vid: 'large-recovered', text: '真实内容释放空间后重新投稿' })).ok, true)
  restart(huge.dir, _boxState())
  console.log('✓ 有效快照本身超过 8 MB：阻止增加、允许渐进删除/合并/退票、释放后恢复投稿')

  const empty = setup('delete-last', padded([record('aaaaaaaa')]))
  assert.equal((await admin('del', 'aaaaaaaa')).status, 303)
  assert.deepEqual(_boxState(), [])
  assert.equal(fs.readFileSync(empty.file, 'utf8'), '\n', '空快照非零，避免误认为第一次开张')
  restart(empty.dir, [])
  console.log('✓ 满容量删除最后一条后，重启不重新生成预置建议')

  const boundary = setup('incoming-crosses-cap', padded([record('aaaaaaaa')]).slice(0, -1))
  assert.equal(counts().bytes, HARD - 1)
  const voted = await api('vote', { id: 'aaaaaaaa', vid: 'fresh-voter', on: true })
  assert.equal(voted.ok, true)
  assert.equal(voted.votes, 3, '满容量快照成功后响应必须返回更新后的票数')
  assert.ok(counts().bytes < HARD)
  restart(boundary.dir, _boxState())
  console.log('✓ 新操作会越过 8 MB 时，先压实再原子提交；投票回执与内存一致')

  const small = setup('admin-append-failure', JSON.stringify(record('aaaaaaaa')) + '\n')
  const smallBefore = _boxState()
  fs.appendFileSync = ((target, value, ...args) => {
    if (target === small.file) {
      originalAppend.call(fs, target, String(value).slice(0, 12), ...args)
      throw new Error('injected partial admin append failure')
    }
    return originalAppend.call(fs, target, value, ...args)
  }) as typeof fs.appendFileSync
  assert.equal((await admin('del', 'aaaaaaaa')).status, 503)
  fs.appendFileSync = originalAppend
  assert.deepEqual(_boxState(), smallBefore)
  assert.equal(counts().bytes, fs.statSync(small.file).size, '失败追加的残片也算入真实字节账')
  assert.equal((await admin('hide', 'aaaaaaaa')).status, 303)
  assert.equal(_boxState()[0].state, 'hidden')
  restart(small.dir, _boxState())
  console.log('✓ 非满容量管理员追加中途失败也返回 503；后续成功操作不被坏尾吞掉')

  const maintenance = setup('maintenance-failure', padded([record('aaaaaaaa')]).slice(0, 5 * 1024 * 1024))
  fs.renameSync = ((from, to) => {
    if (to === maintenance.file) throw new Error('injected optional maintenance failure')
    return originalRename.call(fs, from, to)
  }) as typeof fs.renameSync
  assert.equal((await admin('hide', 'aaaaaaaa')).status, 303, '追加已成功，后续整理失败不把成功误报为失败')
  fs.renameSync = originalRename
  assert.equal(_boxState()[0].state, 'hidden')
  restart(maintenance.dir, _boxState())
  console.log('✓ 常规追加已经成功时，后续可选压实失败不丢已提交操作')
} finally {
  fs.writeFileSync = originalWrite
  fs.renameSync = originalRename
  fs.appendFileSync = originalAppend
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  const cleanup = path.resolve(tmp)
  assert.equal(path.dirname(cleanup), path.resolve(os.tmpdir()))
  assert.ok(path.basename(cleanup).startsWith('valbox-capacity-'))
  fs.rmSync(cleanup, { recursive: true, force: true })
}
