#!/usr/bin/env node
// tools/audit.mjs — 主题可读性回归检查
//
// 这个皮肤会改大量令牌和选择器。历史上踩过同一个坑两次：
//   用 [class*='_button_1ulci_'] 这类「公共组件基础类」统一上色，
//   结果把「浅底 + 深字」的填充型变体一起染掉，文字直接隐形（对比度 1.00）。
//
// 四项检查：
//   ① 对比度：原厂所有「同一条规则里同时声明 background 与 color」的组合，
//      用主题令牌解析后算对比度，低于 3.0 的报出来。硬指标，决定退出码。
//   ② [class*='X'] 广度：命中多少个真实类名、跨几个组件命名空间。
//   ③ 浅底漏前景：主题自己画了浅色填充却没给 color 的规则。
//   ④ [class*='X'] + color !important：最容易误伤的组合，用基线快照比对。
//
// 用法：
//   node tools/audit.mjs [app.asar] [sao.css] [--verbose] [--write-baseline]
//   npm run audit
//
// 退出码：① 有问题，或 ②③④ 出现基线/白名单之外的新项 → 1。

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const flags = new Set(args.filter(a => a.startsWith('--')))
const positional = args.filter(a => !a.startsWith('--'))
const VERBOSE = flags.has('--verbose')
const WRITE_BASELINE = flags.has('--write-baseline')

const ASAR = positional[0] || 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app.asar'
const CSS_PATH = positional[1] || fileURLToPath(new URL('../lib/sao.css', import.meta.url))
const BASELINE_PATH = fileURLToPath(new URL('./audit-baseline.json', import.meta.url))

if (!existsSync(ASAR)) {
  console.error(`找不到 app.asar：${ASAR}\n请把 DSH 的 app.asar 路径作为第一个参数传入。`)
  process.exit(2)
}

const saoRaw = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const asar = readFileSync(ASAR, 'latin1')

/* ── 解析 ─────────────────────────────────────────────────────── */
const blocksOf = css => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(m => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] }))

const decls = body => {
  const d = {}
  for (const p of body.split(';')) {
    const i = p.indexOf(':')
    if (i > 0) d[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim()
  }
  return d
}

const saoBlocks = blocksOf(saoRaw)
const tokens = new Map()
for (const b of saoBlocks) {
  if (!/^html\.sao\b/.test(b.sel)) continue
  for (const d of b.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
    tokens.set(d[1].trim(), d[2].replace(/!important/, '').trim())
  }
}

const resolveVars = (v, depth = 0) => {
  if (depth > 12) return v
  return v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_, n, fb) => {
    if (tokens.has(n)) return resolveVars(tokens.get(n), depth + 1)
    if (n.startsWith('--sao-')) return '0,0,0'
    return fb !== undefined ? resolveVars(fb, depth + 1) : 'UNRESOLVED'
  })
}

/* ── 颜色 ─────────────────────────────────────────────────────── */
const PAGE = { r: 4, g: 8, b: 14, a: 1 }

const parseColor = s => {
  if (!s) return null
  const v = s.trim().toLowerCase()
  if (/unresolved/.test(v)) return 'UNRESOLVED'
  if (/^#[0-9a-f]{6}$/.test(v)) return { r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16), a: 1 }
  if (/^#[0-9a-f]{8}$/.test(v)) return { r: parseInt(v.slice(1, 3), 16), g: parseInt(v.slice(3, 5), 16), b: parseInt(v.slice(5, 7), 16), a: parseInt(v.slice(7, 9), 16) / 255 }
  const m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.%]+))?\s*\)$/)
  if (!m) return undefined
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
  return { r: +m[1], g: +m[2], b: +m[3], a }
}
const over = (fg, bg) => {
  const a = fg.a ?? 1
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }
}
const lum = c => {
  const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}
const contrast = (a, b) => {
  const x = lum(a), y = lum(b), hi = Math.max(x, y), lo = Math.min(x, y)
  return (hi + 0.05) / (lo + 0.05)
}

/* ── 原厂规则与类名 ───────────────────────────────────────────── */
const stockRules = []
for (const m of asar.matchAll(/([^{}@;]{3,240})\{([^{}]{0,600})\}/g)) {
  const sel = m[1].replace(/\s+/g, ' ').trim()
  const body = m[2]
  if (!/^\.[A-Za-z0-9_-]+|^[a-z]/.test(sel)) continue
  if (!/(^|;)\s*color\s*:/.test(body)) continue
  if (!/(^|;)\s*background/.test(body)) continue
  stockRules.push({ sel, body })
}

const classList = [...new Set([
  ...asar.matchAll(/\.((?:[A-Za-z0-9]+_)?_?[A-Za-z][\w-]{0,40}_[a-z0-9]{4,6}(?:_\d+)?)/g),
  ...asar.matchAll(/\.((?:[A-Za-z0-9]{6})_[A-Za-z][\w-]{2,30})/g),
].map(m => m[1]))]

/* ── ① 对比度 ─────────────────────────────────────────────────── */
const WHITELIST = [/fortune-/, /listBox/] // Luckysheet / FortuneSheet 自带的浅色主题，本皮肤不接管

// 原厂规则的类若已被主题针对性地改过 color / background，单看原厂算出的
// 对比度就不是最终值，跳过（否则会误报已经修好的组件）。
const covered = new Map()
for (const b of saoBlocks) {
  if (!/^html\.sao/.test(b.sel)) continue
  const d = decls(b.body)
  const props = new Set()
  if (d.color) props.add('color')
  if (d.background || d['background-color']) props.add('background')
  if (!props.size) continue
  for (const m of b.sel.matchAll(/\.([A-Za-z][\w-]{2,})/g)) {
    if (!covered.has(m[1])) covered.set(m[1], new Set())
    for (const p of props) covered.get(m[1]).add(p)
  }
}
const themeHandled = (sel, prop) => {
  for (const m of sel.matchAll(/\.([A-Za-z][\w-]{2,})/g)) {
    if (covered.get(m[1])?.has(prop)) return true
  }
  return false
}

const contrastIssues = []
let skippedOverridden = 0
function auditContrast(rules, label) {
  for (const r of rules) {
    const d = decls(r.body)
    if (!d.color) continue
    const bgRaw = d['background-color'] || d.background
    if (!bgRaw) continue
    if (/gradient\(/.test(bgRaw)) continue // 渐变多为局部高光，误报率高
    const bg = parseColor(resolveVars(bgRaw).replace(/!important/, '').split(/\s+/)[0])
    if (!bg || bg === 'UNRESOLVED' || bg === undefined) continue
    const fg = parseColor(resolveVars(d.color).replace(/!important/, '').trim())
    if (!fg || fg === 'UNRESOLVED' || fg === undefined) continue
    const base = bg.a < 1 ? over(bg, PAGE) : bg
    const ratio = contrast(over(fg, base), base)
    if (ratio >= 3.0) continue
    if (WHITELIST.some(w => w.test(r.sel))) continue
    if (label === 'dsh' && (themeHandled(r.sel, 'color') || themeHandled(r.sel, 'background'))) {
      skippedOverridden++
      continue
    }
    contrastIssues.push({ label, sel: r.sel, color: d.color.trim(), bg: bgRaw.trim(), ratio })
  }
}
auditContrast(saoBlocks.filter(b => /^html\.sao/.test(b.sel)), 'theme')
auditContrast(stockRules, 'dsh')

/* ── ② 通配广度 ───────────────────────────────────────────────── */
const CONFIRMED_WILD = {
  selected: '均被组件前缀锚定：.wnFoaW_sessionRow[class*=selected] 等，作用域不外溢',
  Active: '同上，只挂在 .an3WzG_tab 上',
  running: '只加 sao-pulse 动画（drop-shadow），不改颜色',
  _markdown_: '两处都是 markdown 容器本身，前景 #dcf2ff 在深底上对比 14:1',
}
const broad = []
for (const p of new Set([...saoRaw.matchAll(/\[class\*=['"]([^'"]+)['"]\]/g)].map(m => m[1]))) {
  const hit = classList.filter(c => c.includes(p))
  const groups = new Set(hit.map(c => {
    const h = c.match(/([a-z0-9]{5})_\d+$/) || c.match(/^([A-Za-z0-9]{6})_/)
    return h ? h[1] : c
  }))
  if (groups.size >= 2) broad.push({ p, groups: groups.size, n: hit.length, sample: hit.slice(0, 3) })
}

/* ── ③ 浅底漏前景 ─────────────────────────────────────────────── */
const CONFIRMED_NOFG = {
  'react-flow__handle': '节点端口圆点，内部无文字，前景由 SVG fill 决定',
}
const noFg = []
for (const b of saoBlocks) {
  if (!/^html\.sao/.test(b.sel)) continue
  const d = decls(b.body)
  if (d.color) continue
  const bgRaw = d['background-color'] || d.background
  if (!bgRaw || /gradient/.test(bgRaw)) continue
  const p = parseColor(resolveVars(bgRaw).replace(/!important/, '').trim())
  if (!p) continue
  if (lum(over(p, PAGE)) > 0.45) noFg.push({ sel: b.sel, bg: bgRaw.trim() })
}

/* ── ④ 通配 + 强制前景（基线比对）───────────────────────────────── */
// 没法用「通配模式」做白名单：同一条 :is() 里可能既有安全的通配（fD5ZVa_）
// 又有危险的（_button_1ulci_），按模式放行会整条带过。所以存整条规则签名。
const SIG = b => `${b.sel}||${b.color}`.replace(/\s+/g, ' ')
const wildcardColor = []
for (const b of saoBlocks) {
  if (!/^html\.sao/.test(b.sel)) continue
  const d = decls(b.body)
  if (!d.color || !/!important/.test(d.color)) continue
  if (!/\[class\*=/.test(b.sel)) continue
  wildcardColor.push({ sel: b.sel, color: d.color.replace(/\s*!important/, '') })
}

if (WRITE_BASELINE) {
  writeFileSync(BASELINE_PATH, JSON.stringify({ wildcardColor: wildcardColor.map(SIG).sort() }, null, 2) + '\n')
  console.log(`已写入基线：${wildcardColor.length} 条「通配 + color !important」规则`)
  console.log(`路径：${BASELINE_PATH}`)
  process.exit(0)
}

let baseline = []
if (existsSync(BASELINE_PATH)) {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).wildcardColor ?? []
} else {
  console.log('⚠ 未找到 tools/audit-baseline.json，④ 会全量列出。建基线：npm run audit -- --write-baseline')
}
const baselineSet = new Set(baseline)

/* ── 报告 ─────────────────────────────────────────────────────── */
const showConfirmed = (list, fmt, table, keyOf) => {
  if (!list.length) return
  if (!VERBOSE) { console.log(`   （${list.length} 条已人工确认，加 --verbose 查看理由）`); return }
  for (const r of list) console.log(`   · ${fmt(r)} —— ${table[keyOf(r)]}`)
}

let bad = 0
console.log(`\n令牌 ${tokens.size} 个 · 原厂「背景+文字」规则 ${stockRules.length} 条 · 组件类名 ${classList.length} 个`)

console.log('\n① 对比度 < 3.0')
if (!contrastIssues.length) console.log('   ✓ 无')
for (const f of contrastIssues) {
  bad++
  console.log(`   ✗ ${f.ratio.toFixed(2)}  [${f.label}] ${f.sel.slice(0, 88)}`)
  console.log(`        color=${f.color}  bg=${f.bg}`)
}
if (skippedOverridden) console.log(`   （${skippedOverridden} 条原厂规则已被主题改色接管，按最终值计）`)

console.log("\n② [class*='X'] 跨组件通配")
const freshWild = broad.filter(b => !CONFIRMED_WILD[b.p])
if (!freshWild.length) console.log('   ✓ 无新增')
for (const b of freshWild) {
  bad++
  console.log(`   ⚠ ${b.groups} 组 / ${b.n} 个  [class*='${b.p}']  例: ${b.sample.slice(0, 2).join(', ')}`)
}
showConfirmed(broad.filter(b => CONFIRMED_WILD[b.p]), b => `[class*='${b.p}']`, CONFIRMED_WILD, b => b.p)

console.log('\n③ 浅色填充但未声明 color')
const NOFG_KEY = n => Object.keys(CONFIRMED_NOFG).find(k => n.sel.includes(k))
const freshNoFg = noFg.filter(n => !NOFG_KEY(n))
if (!freshNoFg.length) console.log('   ✓ 无新增')
for (const n of freshNoFg) { bad++; console.log(`   ⚠ ${n.bg}\n        ${n.sel.slice(0, 110)}`) }
showConfirmed(noFg.filter(n => NOFG_KEY(n)), n => n.sel.slice(0, 60), CONFIRMED_NOFG, NOFG_KEY)

console.log("\n④ [class*='X'] + color !important（基线比对）")
const freshRisky = wildcardColor.filter(b => !baselineSet.has(SIG(b)))
if (!freshRisky.length) console.log('   ✓ 与基线一致')
for (const b of freshRisky) {
  bad++
  console.log(`   ⚠ color=${b.color}`)
  console.log(`        ${b.sel.slice(0, 110)}`)
}
if (freshRisky.length) console.log('   确认无误后执行 npm run audit -- --write-baseline 更新基线')

console.log(bad ? `\n共 ${bad} 处需要处理\n` : '\n全部通过\n')
process.exit(bad ? 1 : 0)
