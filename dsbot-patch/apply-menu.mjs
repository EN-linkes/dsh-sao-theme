/**
 * Bring back a one-click way from the DS Bot surface to the classic DSH agent UI.
 *
 * ds-bot 0.3.1 moved that control into Settings → Bot 设置 → 模式 → 经典 Agent 模式 → 切换.
 * Its sidebar `bt-return` button now goes the other way (`setSurface("bot")`), so a
 * user parked on the Bot surface has no direct way back. This adds a menu row right
 * under 「Bot 设置」 in the account (gear) menu that calls `setSurface("agent")` —
 * the same action the settings row uses.
 *
 * Edits node_modules/ds-bot/client.js, so a pnpm reinstall/upgrade drops it:
 *     node apply-menu.mjs          # patch
 *     node apply-menu.mjs --check  # report only
 *
 * Takes effect after DeepSeek Harness restarts (the client bundle is composed at boot).
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const OLD = `      [t("Bot settings"), GearIcon, () => actions.openSettings("general")]
    ].filter(Boolean)`

const NEW = `      [t("Bot settings"), GearIcon, () => actions.openSettings("general")],
      actions.setSurface ? [t("Classic Agent mode"), ChatsIcon, () => actions.setSurface("agent")] : null
    ].filter(Boolean)`

const MARK = `ChatsIcon, () => actions.setSurface("agent")`
const checkOnly = process.argv.includes('--check')

const profiles = ['desktop', 'web']
const seen = new Set()
let patched = 0
let healthy = 0
let missing = 0

for (const profile of profiles) {
  const file = join(homedir(), '.dsh', 'profiles', profile, 'node_modules', 'ds-bot', 'client.js')
  if (!existsSync(file)) continue
  const ino = statSync(file).ino
  if (seen.has(ino)) {
    console.log(`same inode       ${file}`)
    continue
  }
  seen.add(ino)

  const pkgFile = join(homedir(), '.dsh', 'profiles', profile, 'node_modules', 'ds-bot', 'package.json')
  let version = ''
  try {
    version = JSON.parse(readFileSync(pkgFile, 'utf8')).version ?? ''
  } catch {}
  const [major, minor] = version.split('.').map(Number)
  if (!(major > 0 || minor >= 3)) {
    console.log(`skip (ds-bot ${version || '?'} predates the move)  ${file}`)
    continue
  }

  const text = readFileSync(file, 'utf8')
  if (text.includes(MARK)) {
    console.log(`already patched  ${file}`)
    healthy++
    continue
  }
  if (!text.includes(OLD)) {
    console.error(`PATTERN NOT FOUND  ${file}`)
    console.error('  ds-bot changed its account menu; find `[t("Bot settings")` in client.js and re-derive.')
    missing++
    continue
  }
  if (checkOnly) {
    console.log(`needs patch      ${file}`)
    missing++
    continue
  }
  // Only the first hit: the string is the account menu's own group literal.
  writeFileSync(file, text.replace(OLD, NEW), 'utf8')
  console.log(`patched          ${file}`)
  patched++
}

console.log(`\npatched=${patched} already=${healthy} unmatched=${missing}`)
if (missing > 0) process.exitCode = 1
if (patched > 0) console.log('Restart DeepSeek Harness; the item appears under 「Bot 设置」 in the gear menu.')
