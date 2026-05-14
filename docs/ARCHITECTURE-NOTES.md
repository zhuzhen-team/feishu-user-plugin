# Architecture Notes

> 前瞻性技术设计记录。和 [REFACTOR-NOTES.md](REFACTOR-NOTES.md) 不同 —— 那是已完成的重构历史，本文是**尚未实施但已经定位的架构债**，给未来版本的实施留 reference。

## 背景

2026-05 一次大规模诊断会话定位了 plugin 的 4 个 architectural root cause（不是症状）：

| 编号 | 名称 | 状态 |
|------|------|------|
| A | Scope hardcode + 三方 drift | ✅ v1.3.12 实施（`scripts/check-scopes.js` + `src/oauth.js` SCOPES 修正 + `docs/AUTH-SETUP.md` 完整 scope table） |
| B | Silent fallback 掩盖状态机错误 | ⏸ 设计完成，待实施 |
| C | LLM-unfriendly 数据呈现 | ✅ v1.3.12 实施（`displayLabel` + 5 个新 sender 字段 + merge_forward `forwardedFromChatName`） |
| D | "长跑 MCP server" hot-reload 缺失 | ⏸ 设计完成，待实施 |

本文件记录 B 和 D 的设计，便于未来 v1.3.13+ 直接实施。

---

## B. IdentityState — 取代 silent fallback

### 现状（v1.3.12）

`src/auth/uat.js::asUserOrApp()` 走 "UAT 优先 → bot fallback → 双侧失败抛错"。问题：

- 失败原因被静默吞掉，最终 caller 只知道"两条路都不行"，不知道是 UAT 永久 revoked / scope 缺 / bot 看不见用户 / 网络抖动 中的哪一种
- `_populateSenderNames` 的 `Promise.allSettled` 完全不读 `result.status` —— 即使所有 contact API 调用都 fail，下游也只看到 `senderName: null`
- `classifyError + FAILURE_MAP` 是好 pattern 但**只在 1 处使用**（`readMessagesWithFallback`），15+ 个其它域（calendar / okr / bitable / docs / wiki）都不用
- `FAILURE_MAP` 缺口：`20064`（UAT revoke）、`91403`（跨 tenant bot）、`1254xxx`（upload errors）都没分类

真实代价：2026-05 用户的 UAT refresh_token 被 revoke 至少几周，但因为所有工具都静默退回 bot 路径凑合工作，**用户完全不知道 UAT 死了**，直到 sender 解析持续 100% null 才察觉。

### 设计

引入 5（或 6）态枚举作为一等公民：

```text
IdentityState:
  VALID_USER            // UAT works
  UAT_EXPIRED           // 99991663 — refresh ok
  UAT_REVOKED           // invalid_grant 20064 — need oauth re-run
  UAT_MISSING_SCOPE     // 99991668 + scope check
  BOT_ONLY              // no UAT configured
  NO_CREDENTIALS        // neither cookie nor app token
```

最小 API surface：

```text
// src/auth/identity-state.js
resolveIdentity(client): Promise<IdentityState>   // active probe + 30s cache

// 取代 asUserOrApp 但向后兼容签名
withIdentityFallback(opts: {
  uatFn: () => Promise<any>,
  botFn: () => Promise<any>,
  label: string,
}): Promise<{
  data: any,
  via: 'uat' | 'bot',
  identity: IdentityState,
  via_reason?: string,
}>
```

**关键设计要点（提炼自 Phase 2 调研）**：

1. **Explicit classification** — error 对象上挂 `classification: 'permanent_bot_failure' | 'transient' | 'auth_expired'`，调用方无需 grep 日志
2. **Via-reason observability** — return 值带 `via` + `via_reason`，LLM 端可直读
3. **Dual-sided diagnosis** — 失败时同时保留 `uatError` 和 `botError`
4. **Result status propagation** — 替换 `Promise.allSettled` 不读 status 的所有位置
5. **Hot-reload compat** — `resolveIdentity` 30s 缓存，但 D 改造完成后可被主动 invalidate

### Minimal test

1. 单测：mock `_uatREST` 返回 `invalid_grant` → `resolveIdentity` 应返回 `UAT_REVOKED`
2. 单测：mock bot 返回 91403 → `resolveIdentity` 应返回 `BOT_CROSS_TENANT_BLOCKED`
3. e2e：跑 `read_messages`，输出 `identity: "VALID_USER"` 字段（LLM 看到当前身份状态）

### Migration plan（不是 big-bang）

- Step 1: 加 `identity-state.js` 独立模块 + 单测，不改任何 caller
- Step 2: `asUserOrApp` 内部改用 `withIdentityFallback`，签名保持不变，所有现有 caller 无感
- Step 3: 扩展 `FAILURE_MAP` 加 20064 / 91403 / 1254xxx
- Step 4: 渐进迁移 15+ 个域的 fallback caller，**一次一个域**（calendar 先，最小风险），每次跑 smoke 验证不回归
- Step 5: `_populateSenderNames` 的 `Promise.allSettled` 改为读 status + log failed ids

### Blast radius

中。`asUserOrApp` 签名不变是关键约束。但 FAILURE_MAP 扩展涉及 retry 行为变化，要小心。

---

## D. CredentialsMonitor — 取代"重启 Claude Code 才能 reload"

### 现状（v1.3.12）

v1.3.9 已经做了**部分** hot-reload：

| State | 现状 |
|---|---|
| `currentProfile` | ✅ stat `credentials.json` mtime 触发 reload |
| `officialClient` / `userClient` singleton | ✅ profile switch 时 nullify |
| `resolver` wiki cache | ✅ `clearCache()` on switch |
| WS subscriptions | ✅ owner heartbeat reconfigure |
| **`_userNameCache`** | ❌ 无 TTL 无 hook |
| **UAT in-memory token** | ⚠️ 只在 refresh 流程时 adopt 文件 |
| **cookie session** | ⚠️ 重启才重 |

真实代价：用户跑 `npx feishu-user-plugin oauth` 把新 UAT 写到 `~/.claude.json`，但**当前 MCP server 进程内存里仍是旧 env**（spawn 时注入的）。`get_login_status` 持续显示 UAT INVALID，直到用户**重启 Claude Code**。

### 设计

抽 `src/auth/credentials-monitor.js` 单例 + invalidation hook registry：

```text
class CredentialsMonitor:
  sync(): void                         // 每个 tool call entry 调用
  onUatChange(callback): void
  onCookieChange(callback): void
  onProfileSwitch(callback): void      // v1.3.9 已有
  onCacheInvalidate(callback): void    // 通用 hook
```

`sync()` 行为：

1. stat `credentials.json` mtime + 内容 hash（不止 mtime，避免 touch 误触发）
2. 比对 active profile / UAT field hash / cookie field hash
3. 任何变化 → fire 对应 hook chain
4. 所有 cache（含 `_userNameCache`）的 owner 在初始化时注册 hook
5. UAT token in-memory 在 hook fire 时被新值替换

附加改造（D 必须配套）：

- `_userNameCache` → LRU(max=500) + TTL(10 min)
- WS owner lock 改成 explicit PID liveness check + auto-takeover（取代当前 "alive but dead" 的 heartbeat 仅靠 mtime）

### Minimal test

1. 跑 `npx oauth` 写新 UAT → **不重启进程**，下次 `get_login_status` 立即 Valid
2. profile switch → `_userNameCache` 清空验证
3. 模拟 owner process 死亡（kill -9）→ 60s 内 new process 自动 takeover

### Migration plan

- Step 1: 写 `CredentialsMonitor` 单例 + 单测（mock fs.stat），不接入任何 caller
- Step 2: server.js 的 `_syncActiveProfileFromDisk` 改为调 `monitor.sync()`，行为不变
- Step 3: 加 `onUatChange` hook，注册一个 reload UAT 的 callback（读 `credentials.json` 的 UAT field 替换 client 内存）
- Step 4: `_userNameCache` 改 LRU + TTL，profile switch hook 清空
- Step 5: WS owner lock 改造（最复杂，最后做）

### Blast radius

中-高。改动 server.js dispatcher + uat.js + base.js + lockfile.js 协调，但每步都是兼容的（callers 无感）。

---

## 9 + 5 个根因清单（完整背景）

参见 2026-05 诊断会话的 9 个症状级根因 + 5 个 code-overview 新发现。简表：

| # | 类别 | 状态 |
|---|------|------|
| 1 | SCOPES 3 个 name 错 | ✅ A 修复 |
| 2 | 15 个 user-side scope 未开通 | ✅ 手工开 |
| 3 | 6 个 tenant-side scope 未开通 | ✅ 手工开 |
| 4 | UAT refresh_token revoked | ✅ 重 oauth |
| 5 | UAT refresh race（多进程并发） | ⏸ 等 B + D |
| 6 | `_populateSenderNames` 不用 mentions name | ✅ C 修复 |
| 7 | `_userNameCache` 无 TTL | ⏸ 等 D |
| 8 | `Promise.allSettled` 静默吞错 | ⏸ 等 B |
| 9 | merge_forward children.chatId 跨群 | ✅ C 修复（surface `forwardedFromChatName` + tool desc warning） |
| 10 | senderType=app 无 label | ✅ C 修复（`displayLabel: [Bot] Claude聊天助手`；依赖 tenant-side `application:application:self_manage` scope，免审） |
| 11 | WS owner stale lock | ⏸ 等 D |
| 12 | `JSON.parse` 静默 catch | ⏸ low priority |
| 13 | `withUAT` retry 集合窄 | ⏸ 等 B（FAILURE_MAP 扩展） |
| 14 | thread (rootId/parentId) 没线性化 | ✅ C 部分修复（`isThreadReply` flag），完整线性化等后续 |

C 完成后 senderName 100% 填充 + displayLabel 覆盖 5 种 sender 形态 + merge_forward 跨群有显式警告。剩下 6 个隐患（5/7/8/11/12/13）都不影响日常使用，但**多进程并发**或**长跑超过 1 周**场景会逐渐触发。
