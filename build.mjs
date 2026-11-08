/**
 * build.mjs —— 把 lib/sao.css 内联进 lib/client.js 的 SAO_CSS 标记区。
 * 改完 CSS 跑一次 `node build.mjs` 即可，产物是自包含的客户端包（不需要 dev server）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const cssPath = join(root, 'lib', 'sao.css')
const jsPath = join(root, 'lib', 'client.js')

const BEGIN = '/* @sao-css:begin */'
const END = '/* @sao-css:end */'

const css = readFileSync(cssPath, 'utf8')
if (css.includes('`')) throw new Error('sao.css 含反引号，无法内联进模板字符串')
if (css.includes('${')) throw new Error('sao.css 含 ${，无法内联进模板字符串')

const src = readFileSync(jsPath, 'utf8')
const i = src.indexOf(BEGIN)
const j = src.indexOf(END)
if (i < 0 || j < 0) throw new Error('client.js 缺少 @sao-css 标记')

const block = `${BEGIN}\n    const SAO_CSS = String.raw\`\n${css}\n\`\n    `
const next = src.slice(0, i) + block + src.slice(j)

writeFileSync(jsPath, next, 'utf8')

// 产物必须是合法 JS：模板一旦被截断，插件会整体不加载，界面静默回退宿主原生深色。
try {
  execFileSync(process.execPath, ['--check', jsPath], { stdio: 'pipe' })
} catch (error) {
  console.error('[build] client.js 语法检查失败：\n' + (error.stderr?.toString() ?? error.message))
  process.exit(1)
}

console.log(`[build] inlined ${(css.length / 1024).toFixed(1)} KB CSS -> lib/client.js`)
