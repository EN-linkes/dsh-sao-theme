/**
 * dev.mjs —— 本地 CSS 热更服务（127.0.0.1:9700）。
 * 客户端每秒拉一次 /sao.css，改完直接落盘就在窗口里生效，不用重启 dsh。
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const cssPath = join(root, 'lib', 'sao.css')
const PORT = 9700

createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'text/css; charset=utf-8',
  }
  if (req.url.startsWith('/sao.css')) {
    try {
      res.writeHead(200, cors)
      res.end(readFileSync(cssPath, 'utf8'))
    } catch (e) {
      res.writeHead(500, cors)
      res.end('/* read failed */')
    }
    return
  }
  res.writeHead(404, cors)
  res.end('/* not found */')
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[dev] http://127.0.0.1:${PORT}/sao.css`)
})
