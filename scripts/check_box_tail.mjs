/** JSONL 坏尾不能吞掉之后返回成功的建议。只使用临时目录和本地 HTTP。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { initBox, handleBoxApi } from '../box.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'valbox-tail-'))
const originalAppend = fs.appendFileSync
const server = http.createServer((req, res) => {
  if (!handleBoxApi(req, res, req.url, 'tail-test')) { res.writeHead(404); res.end() }
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}/api/box/`
async function api(action, body) {
  const response = await fetch(base + action, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ v: 1, ...body }),
  })
  return response.json()
}
const original = { o: 'new', id: 'abc12345', t: 1, dev: 'original', text: '原来的正常建议', s: 'shown' }
try {
  for (const [name, tail] of [
    ['normal', '\n'],
    ['valid-no-newline', ''],
    ['truncated', '\n{"o":"new","text":"没写完'],
    ['garbage', '\n坏掉的尾部'],
  ]) {
    const dir = path.join(tmp, name)
    fs.mkdirSync(dir)
    const file = path.join(dir, 'box.jsonl')
    const before = JSON.stringify(original) + tail
    fs.writeFileSync(file, before)
    initBox({ dir, volatile: false })
    const first = await api('new', { vid: name, text: `重启后仍应保留这条建议 ${name}` })
    assert.equal(first.ok, true, `${name}: 提交成功`)
    const second = await api('new', { vid: `${name}-second`, text: `连续追加也能保留 ${name}` })
    assert.equal(second.ok, true)
    assert.ok(fs.readFileSync(file, 'utf8').startsWith(before), '不截断已有字节')
    initBox({ dir, volatile: false })
    const mine = await api('list', { vid: name })
    assert.ok(mine.items.some(it => it.id === original.id), '旧记录保留')
    assert.ok(mine.mine.some(it => it.id === first.item.id), `${name}: 成功记录重放保留`)
    assert.ok((await api('list', { vid: `${name}-second` })).mine.some(it => it.id === second.item.id))
    console.log(`✓ ${name}: 原记录与后续两次成功提交在重放后保留`)
  }

  const dir = path.join(tmp, 'partial-write')
  fs.mkdirSync(dir)
  const file = path.join(dir, 'box.jsonl')
  fs.writeFileSync(file, JSON.stringify(original) + '\n')
  initBox({ dir, volatile: false })
  fs.appendFileSync = function (target, value, ...args) {
    if (target === file) {
      // 故意留下半条 JSON；不在客户端和失败后的下一次请求之间重启服务。
      originalAppend.call(fs, target, String(value).slice(0, 24), ...args)
      throw new Error('injected partial append failure')
    }
    return originalAppend.call(fs, target, value, ...args)
  }
  const failed = await api('new', { vid: 'partial-failed', text: '写了一半应提示失败' })
  fs.appendFileSync = originalAppend
  assert.equal(failed.ok, false)
  assert.equal((await api('list', { vid: 'partial-failed' })).mine.length, 0)
  const recovered = await api('new', { vid: 'partial-recovered', text: '写入恢复后这条必须保留' })
  assert.equal(recovered.ok, true)
  initBox({ dir, volatile: false })
  assert.ok((await api('list', { vid: 'partial-recovered' })).mine.some(it => it.id === recovered.item.id))
  assert.equal((await api('list', { vid: 'partial-failed' })).mine.length, 0)
  console.log('✓ 同进程写入中途失败后恢复，后续成功记录不被坏尾吞掉')
} finally {
  fs.appendFileSync = originalAppend
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  // 只清本次 mkdtemp 创建的临时目录，清理前验证绝对路径与专用前缀。
  const cleanup = path.resolve(tmp)
  assert.equal(path.dirname(cleanup), path.resolve(os.tmpdir()))
  assert.ok(path.basename(cleanup).startsWith('valbox-tail-'))
  fs.rmSync(cleanup, { recursive: true, force: true })
}
