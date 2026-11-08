# Bot 对话「Cannot read properties of undefined (reading 'filter')」— 已解决

**结论：ds-bot 从 0.2.6 升到 0.3.1 解决。** 本目录保留根因记录，以及一个可复用的补丁/校验脚本。

## 症状

Bot 对话里每一轮立刻失败：

```
本轮运行失败
Cannot read properties of undefined (reading 'filter')
```

`%USERPROFILE%\.dsh\bot\logs\diagnostics.jsonl`：

```json
{"level":"error","source":"turn","text":"Cannot read properties of undefined (reading 'filter')","code":"UNKNOWN","bot":"…","where":"own chat"}
```

## 根因

`@deepseek-ai/dsh-system-prompt` 从 0.2.2 起，`system-prompt/assemble` 瀑布看到的 assembly **没有 `tools`**，`tools` 是瀑布之后才补上的：

```js
const assembly = { sections, contexts, variables }        // 没有 tools
const transformed = await this.ctx.waterfall(..., assembly, context, () => Promise.resolve(assembly))
return { ...transformed, tools }                          // tools 在这里才加
```

ds-bot ≤ 0.2.6 的 `filterBotAssembly`（`src/host/tools.js`）仍按旧形状写 `assembled.tools.filter(...)`
→ undefined → TypeError → `preStep` 抛错 → 整轮在第一步之前就失败。

ds-bot 0.3.1 上游已修（注释里写着 `#814`），用的是 `Array.isArray` 守卫。

## 定位过程（可复用）

1. `diagnostics.jsonl` 的 **error 行没有 stack**（`turnFailure` 把 stack 丢了），`warn` 行有 —— 用它确认调用链是 `kick → turn → preStep → ctx.on.prepend`。
2. 真正有用的是会话日志 `~/.dsh/sessions/<workspace>/session-*/session.v4.jsonl.zstd`。
   它是**逐帧追加的 zstd**，Node 的 `zstdDecompressSync` / `createZstdDecompress` 只解第一帧。切帧办法：扫 `28 B5 2F FD` 魔数，逐帧 `zstdDecompressSync`，失败就并入下一帧重试。
3. 判据：`turn/start` 之后约 **10ms** 就 `turn/end (kind:"error")`，且**没有 `step/start`、没有 `system/message`**
   → 抛在 `preStep` 之内（`inbox.claim` / `tools.resolve` / `systemPrompt.assemble` / `agent/pre-step` 瀑布），不是模型调用失败。
4. 直接看内核真实形状：`node /c/tmp/asar-x.cjs <app.asar> <outdir> <路径包含串>`，
   类型定义可 `grep -a -o "interface PromptAssembly.\{0,400\}" app.asar`。

## 本目录文件

| 文件 | 用途 |
| --- | --- |
| `apply-menu.mjs` | 在齿轮菜单「Bot 设置」下面补一项「经典 Agent 模式」，点它 `setSurface("agent")` 回到经典 DSH 界面。幂等，`--check` 只检查；ds-bot < 0.3 的 profile 自动跳过。 |
| `apply.mjs` | 给 **0.2.6** 的 `filterBotAssembly` 打 `Array.isArray` 守卫。幂等。`--check` 只检查。0.3.1 上会报 `already patched`（因为已有同样的注释标记）。 |
| `backup-2026…/` | 升级前的 `.dsh/bot` 状态、`package.json`、`pnpm-lock.yaml`、`cordis.patch.yml` 备份。 |
| `README.md` | 本文。 |

---

# 补充：ds-bot 0.3.1 把「返回对话」收进了设置（已补一键入口）

0.2.6 侧栏底部有「返回对话」，一键回到经典 DSH 界面。0.3.1 把它挪进了
**设置 → Bot 设置 → 模式 → 经典 Agent 模式 → 切换**，而侧栏那个 `bt-return` 按钮
改成了反方向（`setSurface("bot")`，即「进入 DS Bot」），于是停在 Bot 界面的人没有直接出口。

`apply-menu.mjs` 在账户（齿轮）菜单里、紧挨「Bot 设置」下面加一项「经典 Agent 模式」，
调用的就是设置页那一行同一个动作 `actions.setSurface("agent")`：

```js
[t("Bot settings"), GearIcon, () => actions.openSettings("general")],
actions.setSurface ? [t("Classic Agent mode"), ChatsIcon, () => actions.setSurface("agent")] : null
].filter(Boolean)
```

改的是 `node_modules/ds-bot/client.js`（前端包），重装或升级 ds-bot 会丢，重跑脚本即可。
`Classic Agent mode` 这个 i18n 键包里本来就有（`"经典 Agent 模式"`），所以不用另加文案。


升级命令（在 `~/.dsh/profiles/desktop` 下）：

```bash
NPM_CONFIG_REGISTRY=https://registry.npmjs.org pnpm add ds-bot@0.3.1
```

`profiles/desktop` 与 `profiles/web` 的 ds-bot 原本是同一 inode 的硬链接；升级后 desktop 已是 0.3.1，**`profiles/web` 仍是旧的 0.2.5**（那个 profile 桌面版用不到，若要用 web 模式需单独升级）。

## 验证

重启后 `金策EA` 的一轮对话走了完整链路：`request/header`(model=hy3) → 多次 `assistant/message` → 连续 `tool/call` → 多步推进，`diagnostics.jsonl` 无新增 error。
