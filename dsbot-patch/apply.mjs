/**
 * Re-apply the DSH 0.2.2 fix to ds-bot's `system-prompt/assemble` hook.
 *
 * Symptom when missing: every Bot chat turn fails at once with
 *   "Cannot read properties of undefined (reading 'filter')"
 * (diagnostics.jsonl: source=turn, code=UNKNOWN; the session log has
 *  turn/start followed ~10ms later by turn/end with kind=error, and never a
 *  step/start.)
 *
 * Cause: @deepseek-ai/dsh-system-prompt >= 0.2.2 runs the
 * `system-prompt/assemble` waterfall over `{ sections, contexts, variables }`
 * and appends `tools` only afterwards:
 *
 *     const assembly = { sections, contexts, variables }
 *     const transformed = await waterfall(..., assembly, ...)
 *     return { ...transformed, tools }
 *
 * ds-bot <= 0.2.6 (filterBotAssembly in src/host/tools.js) still did
 * `assembled.tools.filter(...)`, which is undefined on 0.2.2. Upstream 0.3.1
 * fixed it the same way this script does (see its comment "#814").
 *
 * Usage:  node apply.mjs [--check]
 * Targets every hardlinked copy under %USERPROFILE%\.dsh\profiles\*\node_modules\ds-bot.
 * Idempotent: an already-patched copy is reported and left alone.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const OLD = `      return {
        ...assembled,
        tools: assembled.tools.filter(tool => !HIDDEN_TOOLS.includes(tool.name)),
        sections: assembled.sections.filter(section => !HIDDEN_SECTIONS.has(section.name)),
      }`

const NEW = `      // DSH 0.2.2 adds the tool list after this waterfall (#814), so only an
      // older assembly still carries tools to drop here.
      return {
        ...assembled,
        ...Array.isArray(assembled.tools) ? { tools: assembled.tools.filter(tool => !HIDDEN_TOOLS.includes(tool.name)) } : {},
        sections: Array.isArray(assembled.sections) ? assembled.sections.filter(section => !HIDDEN_SECTIONS.has(section.name)) : assembled.sections,
      }`

const MARK = 'DSH 0.2.2 adds the tool list after this waterfall'
const checkOnly = process.argv.includes('--check')

const roots = ['desktop', 'web']
const seen = new Set()
let patched = 0
let healthy = 0
let missing = 0

for (const profile of roots) {
  const file = join(homedir(), '.dsh', 'profiles', profile, 'node_modules', 'ds-bot', 'src', 'host', 'tools.js')
  if (!existsSync(file)) continue
  // The profiles are pnpm hardlinks of the same inode; patch each inode once.
  const ino = statSync(file).ino
  if (seen.has(ino)) {
    console.log(`same inode       ${file}`)
    continue
  }
  seen.add(ino)
  const text = readFileSync(file, 'utf8')

  if (text.includes(MARK)) {
    console.log(`already patched  ${file}`)
    healthy++
    continue
  }
  if (!text.includes(OLD)) {
    console.error(`PATTERN NOT FOUND  ${file}`)
    console.error('  ds-bot changed shape here; re-read filterBotAssembly before patching by hand.')
    missing++
    continue
  }
  if (checkOnly) {
    console.log(`needs patch      ${file}`)
    missing++
    continue
  }
  writeFileSync(file, text.replace(OLD, NEW), 'utf8')
  console.log(`patched          ${file}`)
  patched++
}

console.log(`\npatched=${patched} already=${healthy} unmatched=${missing}`)
if (missing > 0) process.exitCode = 1
if (patched > 0) console.log('Restart DeepSeek Harness for the host plugin change to take effect.')
