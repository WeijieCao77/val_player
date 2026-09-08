/* val_player —— 零依赖静态服务器
   游戏是 vite 打出来的纯静态产物（dist/），没有后端。这个文件只做一件事：
   把 dist/ 里的文件按路径发出去，找不到的路径回 index.html（/manager、/cards 是前端路由）。

   · 只从 dist/ 出，路径规范化后不在 dist/ 下的一律 403；
   · assets/ 下是带 hash 的文件，缓存一年；index.html 每次校验（no-cache）；
   · /healthz 给 Railway 探活；
   · Railway 注入 PORT，本地默认 3000。 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(ROOT, 'dist')
const PORT = Number(process.env.PORT) || 3000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

function resolve(pathname) {
  let rel
  try { rel = decodeURIComponent(pathname) } catch { return null }
  const file = path.normalize(path.join(DIST, rel))
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return null
  return file
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/healthz') return send(res, 200, 'ok')

  const file = resolve(url.pathname)
  if (!file) return send(res, 403, 'forbidden')

  let target = file
  let st = null
  try { st = fs.statSync(target) } catch { st = null }
  if (st && st.isDirectory()) { target = path.join(target, 'index.html'); try { st = fs.statSync(target) } catch { st = null } }
  if (!st) {
    // a missing asset is a 404; a missing page is the app (front-end routes)
    if (path.extname(url.pathname)) return send(res, 404, 'not found')
    target = path.join(DIST, 'index.html')
    try { st = fs.statSync(target) } catch { return send(res, 503, 'dist/ 还没构建：先跑 npm run build') }
  }

  const ext = path.extname(target).toLowerCase()
  const type = MIME[ext] ?? 'application/octet-stream'
  const hashed = target.split(path.sep).includes('assets')
  res.writeHead(200, {
    'content-type': type,
    'content-length': st.size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(target).pipe(res)
})

server.listen(PORT, () => {
  console.log(`val_player static server on :${PORT}, serving ${DIST}`)
})
