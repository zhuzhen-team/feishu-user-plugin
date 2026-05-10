# feishu-user-plugin 测试方法论

> **谁该读**：贡献者、跑 release-cycle 回归的 maintainer、写测试脚本的 AI agent。  
> **何时读**：加测试前、跑发版回归、看到 flaky failure、cleanup 测试残留资源、改 smoke baseline。

如何在不烧坏共享 sandbox 的前提下，用真实飞书 API 测试本插件。

插件横跨三种身份（cookie / app / UAT）和四个内容域（messaging / docx / bitable / drive）。每个测试都要明确：行使的是哪种身份、留下的是什么状态。

## 前置条件

- 至少 default profile 在 `~/.feishu-user-plugin/credentials.json` 有可工作凭证，5 个 env 全填齐（cookie + app + UAT）。跑 `npx feishu-user-plugin status` 确认
- 测试 sandbox 群：**飞书plugin测试群** （`oc_6ae081b457d07e9651d615493b7f1096`）。不要在真实工作群发测试流量
- bot 在 sandbox 群里。如果读不到消息，bot 在某个时点被踢了 —— 通过 `manage_members(action=add, chat_id, member_ids=[<bot open_id>])` 重新加入

## Sandbox 命名约定

所有测试资源**必须** `test-YYYY-MM-DD-` 前缀，cleanup grep 才能 catch 到。例：

```
test-2026-05-04-bitable-attachments
test-2026-05-04-doc-blocks
```

每个测试会话结束（或 release 时）清理：

```js
// 按日期前缀搜，删除底层 drive 资源
await manage_drive_file({ action: 'delete', file_token: 'XYZ', type: 'bitable' });
```

`manage_drive_file(action=delete)` 工具是幂等的 —— 如果资源已被删，返回飞书 1061007（"file has been delete"）我们当成功处理。

## Inline-vs-disk size 上限（下载工具）

Anthropic API 拒绝大于 5 MB 的响应。我们的两个工具 inline 返回二进制内容（base64 image / file bytes）；它们强制 **2 MiB 上限**留 multipart wrapping 余量：

| 工具 | inline 返回什么 |
|------|-----------------|
| `download_message_resource` | image（MCP `image` content block）或 file（base64，display 时截断） |
| `download_doc_image` | image content block |

载荷超过 2 MiB 时这两个工具都需要 `save_path`，响应只含简短摘要。**对任何不能 100% 确认 < 2 MiB 的生产资源都直接传 `save_path`** —— 比 debug cap-failure path 中途 fail 简单。

```js
// 对
await download_message_resource({
  message_id: 'om_xxx', key: 'file_xxx', kind: 'file',
  save_path: '/tmp/test-2026-05-04/sample.pdf',
});

// 错（文件 > 2 MiB 时挂）
await download_message_resource({ message_id: 'om_xxx', key: 'file_xxx', kind: 'file' });
```

## Playwright 截图策略

某些流程（cookie setup）驱动 Playwright。`browser_take_screenshot` 工具 inline 返回 base64 PNG。整页截图在话痨的飞书页面上轻易超 5 MB 被 Anthropic 拒。

规则：

- 尽量用 `browser_snapshot`（DOM accessibility tree，纯文本）而非 `browser_take_screenshot` —— 给模型同等语义信息但没字节
- 真要像素时**先 resize 到小视口**：`browser_resize({ width: 1280, height: 800 })`
- 用 viewport-only 截图模式（默认），不是 `fullPage: true`
- 需要保留产物时存盘：`browser_take_screenshot({ filename: '/tmp/feishu-qr.png' })`。Inline-only 模式应是例外

## 身份断言

每个写工具走 `_asUserOrApp` —— UAT first，bot fallback。响应带 `viaUser: true|false`。写测试后验证实际跑的是哪个身份：

```js
const r = await create_calendar_event({ ... });
// r 含 "(as user)" 或 "(as app — UAT unavailable...)"
```

如果"用户拥有的资源"测试落到 bot 路径，资源 owned by 共享 bot 而不是你 —— 用另一 profile 后续 read 会看到不同 ownership。这是真 bug：UAT 过期了或 scope 缺失。

## 测试资源 manifest

测试会话创建资源时记到 manifest 文件，cleanup pass 才知道删什么。例：

```js
// 测试开始
const manifest = [];
function record(kind, token, type) { manifest.push({ kind, token, type }); }

// 测试中
const bitable = await manage_bitable_app({ action: 'create', name: 'test-2026-05-04-bitable' });
record('bitable', bitable.appToken, 'bitable');

// 结束（或 afterAll hook）
for (const { token, type } of manifest.reverse()) {
  await manage_drive_file({ action: 'delete', file_token: token, type })
    .catch((e) => console.error('cleanup failed:', token, e.message));
}
```

`reverse()` 在嵌套资源（folder 含 doc）时重要 —— 先删子再删父。

## Smoke baseline 漂移

工具 / prompt schema 钉在 `tests/baseline/{tools-list,login-status-shape,prompts-list}.json`。Pre-commit hook 在 stage `src/` 文件时跑 `scripts/smoke.js diff`；CI 每个 PR 都重跑。

如果有意添加 / 删除 / 重命名工具，**同 commit** 重生 baseline：

```bash
npm run smoke:baseline   # 写新 baseline
npm run smoke            # 验证 diff 为空
git add tests/baseline/ src/...
git commit -m "..."
```

如果意外漂移，hook 拦住 commit。**别 `--no-verify` 绕过** —— 查根因。

## Live 回归 checklist（release 时）

跑 `node scripts/test-all-tools.js` 走半自动路径；该脚本覆盖读工具和无害写工具（sandbox 群、可丢的 bitable）。脚本不覆盖的写工具（群成员变更、在真日历建事件），用脚本打印的 per-tool snippet 手动跑。

每个 release tag 后练习：

1. `get_login_status` —— 三种身份都过
2. `read_messages(chat=飞书plugin测试群, page_size=5)` —— 5 条最新消息，sender 名解析
3. `send_to_user(<self>, "test")` —— 消息到自己 DM
4. `manage_bitable_app(action=create, name=test-YYYY-MM-DD-bitable)` → `manage_bitable_table(action=create)` → `manage_bitable_record(action=create)` → `manage_bitable_record(action=search)` → cleanup
5. `create_calendar_event` 在 sandbox 日历（**不要** primary）→ `delete_calendar_event`
6. `download_message_resource` image 和 file 两种 kind，带 `save_path`
7. `download_doc_image` 一篇含 image block 的 docx

任何失败 → 检查 `~/.feishu-user-plugin/credentials.json`，再跑 `npx feishu-user-plugin status` 诊断。

## switch_profile e2e（v1.3.9 F.1）

`src/test-switch-profile.js` 验证 `switch_profile` 正确：

1. 原子更新 `~/.feishu-user-plugin/credentials.json::active`
2. 让当前进程缓存的 `userClient` / `officialClient` 失效
3. 下次访问用新 profile 凭证重建 client

**测试临时修改 `~/.feishu-user-plugin/credentials.json`** —— backup 自动（`try/finally` restore），但测试中途 crash 的话 `cred-backup-<ts>.json` 留在 `/tmp/`。

**跑前**：停所有运行中的 MCP 进程（`pkill -f feishu-user-plugin`）避免它们经 v1.3.9 A.2 跨进程同步机制反应到凭证变更。

CI 跑这个测试不需要真实飞书凭证 —— 用 dummy（`alt` profile，`LARK_APP_ID=cli_test_alt_xxxxxxxx`），永远不打网络。

```bash
node src/test-switch-profile.js
# 期望 stdout：switch-profile-e2e: PASS
# 期望 stderr：backup + restore note
# 跑完后：~/.feishu-user-plugin/credentials.json 与跑前字节相同
```

## 另见

- [docs/CREDENTIALS-FORMAT.md](./CREDENTIALS-FORMAT.md) —— credentials.json schema
- [docs/REFACTOR-NOTES.md](./REFACTOR-NOTES.md) —— 文件职责矩阵（post-Phase-A 谁住哪里）
- `scripts/smoke.js` —— 协议级 smoke（tools/prompts/login_status snapshot）
- `scripts/test-all-tools.js` —— 半自动工具回归
