# 掘金主稿（实战流程角度）

**目标平台**：juejin.cn
**频道**：AI 编程
**标签（最多 3 个）**：`AI 编程` + `Claude` + `飞书`
**长度目标**：3500-5000 字
**封面图**：建议用 docs/og.png
**状态**：📄 Draft —— 等用户 `发`

---

## 标题候选

1. **飞书 MCP 加强版：让 Claude Code 用你本人身份发消息（84 工具 / 三层鉴权 / 实战 3 场景）**（推荐）
2. **84 工具的飞书 MCP：从读群消息到 OKR 进展，三场景实战拆解**
3. **让 Claude Code 接管飞书工作流：feishu-user-plugin v1.3.9**

> 推荐选 1：占满 SEO 关键词（飞书 MCP / Claude Code / 84 工具 / 三层鉴权），强调差异化（"用你本人身份"），数字化（84/3/3）。

## 正文

---

# 飞书 MCP 加强版：让 Claude Code 用你本人身份发消息（84 工具 / 三层鉴权 / 实战 3 场景）

## 起因

飞书官方开放 API **没有 `send_as_user` 权限点**：哪怕拿到 `user_access_token`（OAuth），发出来的消息也是 `sender_type: "app"`。群里看到的是机器人头像 + "由 [应用名] 发送"。

如果你试过把 Claude Code 接到飞书做自动化——读群消息、写日报、发出去——大概率撞过这堵墙。机器人代发的消息和你本人发的消息，在收件人侧的呈现完全不同。

[feishu-user-plugin](https://github.com/EthanQC/feishu-user-plugin) 解决这个问题：把三层鉴权（cookie + 官方 app token + 用户 OAuth UAT）整合在一个 MCP 服务器里。84 个工具，9 个 MCP prompts，覆盖 IM / 文档 / 多维表格 / 知识库 / 云空间 / 日历 / 任务 v2 / OKR 全套。MIT 协议。

这篇文章按三个实战场景展开——让你看清这玩意能干什么。

## 一图看懂：三层鉴权解决三类问题

| 鉴权层 | 凭证 | 覆盖能力 |
|---|---|---|
| 用户身份（cookie + protobuf 协议路径） | `LARK_COOKIE` | 以用户身份发文本 / 图片 / 文件 / 富文本 / @ / 批量 |
| 官方 API（机器人 token） | `LARK_APP_ID` + `LARK_APP_SECRET` | 群消息读写 · 文档 · 多维表格 · 知识库 · 云空间 · 日历 · 任务 v2 · OKR |
| 用户 OAuth UAT | `LARK_USER_ACCESS_TOKEN` + `refresh_token` | P2P 私聊读取 · 创建文档 / Bitable / 日历 资源时以你为 owner |

三层全配齐 = 完整能力。只配一层 = 该层工具可用。

## 安装

```bash
# 1. 创建配置（写到 ~/.claude.json mcpServers）
npx feishu-user-plugin setup --app-id <YOUR_APP_ID> --app-secret <YOUR_APP_SECRET>

# 2. OAuth 拿 UAT
npx feishu-user-plugin oauth

# 3. 重启 Claude Code / Codex
```

cookie 获取：跟 Claude Code 说一句"帮我设置一下飞书 cookie"会自动经 Playwright 扫码登录抓取；手动方式在 feishu.cn DevTools Network 标签从请求头复制（不要用 `document.cookie`，HttpOnly cookie 拿不到）。

接下来三个真实场景。

---

## 场景一：群消息日报（读 + 总结 + 用户身份发出）

每天下班前要把"AI 技术解决"群里的讨论梳理成日报发到 #日报频道。

**Claude Code 提示**：

> 帮我把"AI 技术解决"群今天 9 点之后的讨论总结一份日报，发到 #AI 日报频道，以我身份发，前面写"今日 AI 日报 · YYYY-MM-DD"

**Claude 实际调用**（按顺序）：

1. `search_contacts({query: "AI 技术解决"})` —— 解析群名拿 `chat_id`
2. `read_messages({chat_id: "oc_...", since_seconds: $(now-9*3600)})` —— 拉今日消息
3. **Claude 自己思考**：把 read_messages 返回的若干 text + post 消息梳理成主题列表
4. `search_contacts({query: "AI 日报"})` —— 拿目标群 ID
5. `send_to_group({chat_id_or_name: "AI 日报", text: "今日 AI 日报 · 2026-05-09\n\n1. ..."})` —— 以用户身份发出

群里其他人看到的是你的头像、你的名字、一条普通消息。

**实测耗时**：从"开始"到日报发出，平均 12 秒（M2 Pro，网络正常）。

**踩坑提醒**：
- `read_messages` 默认限 50 条；要看完整一天，传 `count: 500` 或 `since_seconds`
- 外部群 bot 没有 `im:message:readonly` 权限会失败 —— v1.3.7 起自动 fallback 到 UAT 路径，看到 `via: "user"` 字段就是 fallback 成功了
- merge_forward（合并转发）会自动展开，不需要手动遍历

---

## 场景二：OKR 进展记录（list + 自然语言录入）

周五下班前要给本季度三个 KR 各加一条进展。手动操作：打开飞书 OKR 页面、点开 KR、选择"添加进展"、写文字、保存——三个 KR 来回点 6 分钟。

**Claude Code 提示**：

> 给我本季度 OKR 的三个 KR 各加一条进展记录，内容如下：
>
> KR1（v1.3.9 ship）：完成 v1.3.9 ship，含 send_image_as_user / multi-profile 跨进程同步 / 实时事件机器级 SSOT。npm download +30%。
>
> KR2（社区互动）：本周收到 3 个外部 issue + 1 个 PR。
>
> KR3（学习）：研究了 cookie protobuf 协议，写成 docs/COOKIE-PROTOBUF-CAPTURES.md。

**Claude 实际调用**：

1. `get_login_status()` —— 拿当前用户 open_id
2. `list_okr_periods()` —— 找当前季度 period_id
3. `list_user_okrs({user_id: "ou_...", period_ids: [<curr>]})` —— 列我的 OKR
4. `get_okrs({okr_ids: [...]})` —— 拿 KR 详细 + 找到 target_id
5. **三个并行**：
   - `create_okr_progress_record({target_id: <kr1>, target_type: 2, content_text: "..."})`
   - `create_okr_progress_record({target_id: <kr2>, target_type: 2, content_text: "..."})`
   - `create_okr_progress_record({target_id: <kr3>, target_type: 2, content_text: "..."})`

**实测耗时**：30 秒（手动 6 分钟）。

**踩坑提醒**：
- `target_type: 1` 是 objective，`target_type: 2` 是 key result，别搞混
- 飞书 OKR 开放 API **没有完整 CRUD**——只暴露读 + 进展记录写。本体 create/update/delete 永远不会有
- 写需要 `okr:okr.content:write` scope（自建应用权限管理里勾），UAT 也要重新授权一次

---

## 场景三：会议纪要落库（读消息 + 创建文档 + 写 Wiki）

每周组会有 30 分钟讨论，群里同步聊了一堆。会后要把核心决定整理成会议纪要、放到团队知识库的"会议纪要"目录下。

**Claude Code 提示**：

> 把"研发组"群周一 14:00 之后的讨论提炼成会议纪要，重点抓【已决定】、【待跟进】、【未决议题】三段，存成飞书文档放到我们 Wiki 的"会议纪要 / 2026-Q2"目录下。

**Claude 实际调用**：

1. `read_messages({chat_id: "oc_<研发组>", start_time: <Mon14h>, count: 200})` —— 拉讨论
2. **Claude 思考**：分类提炼
3. `search_wiki({query: "会议纪要 / 2026-Q2"})` —— 找父节点 token
4. `create_doc({title: "研发组周会纪要 · 2026-05-04", wiki_space_id: "<space>", wiki_parent_node_token: "<parent>"})` —— 直接创建到 Wiki 路径下
5. `manage_doc_block({document_id: <new>, action: "create", parent_block_id: <root>, children: [<heading 已决定>, <bullets...>, <heading 待跟进>, ...]})` —— 写正文
6. **Claude 反馈**：返回文档 URL + 提示"你是 owner（UAT 路径），可直接编辑"

**实测耗时**：60 秒。

**为什么 owner 是你不是机器人？** v1.3.6 起所有 docx / bitable / wiki / drive 创建路径都是 UAT-first，bot 是 fallback。资源所有者是当前 UAT 身份（你），不是共享的应用机器人。意味着：删除权限在你、链接发出去同事看到"由 [你的名字] 创建"、合规清晰。

**踩坑提醒**：
- `create_doc` 的 `wiki_space_id` + `wiki_parent_node_token` 是 v1.3.6 起的快捷路径，否则需要先 `create_doc` → `manage_drive_file(action=move)` → `move_docs_to_wiki` 三步走
- `manage_doc_block(action=create)` 支持 `image_path` / `file_path` 快捷上传，块树构造看 [CLAUDE.md "Document images" 段](https://github.com/EthanQC/feishu-user-plugin/blob/main/CLAUDE.md#document-images)

---

## 还能干什么（速览）

| 类别 | 几个关键工具 |
|---|---|
| 多维表格 | `manage_bitable_record` 单次最多 500 条增删改、`upload_bitable_attachment` 附件上传 |
| 日历 | `create/update/delete/respond_calendar_event` + `get_freebusy` 找会议时段 |
| 任务 v2 | `create_task` / `complete_task` / `manage_task_members` |
| 云空间 | `upload_drive_file` 可选 `wiki_space_id` 直接挂 Wiki |
| 实时事件 | v1.3.9 机器级 SSOT，全机所有 MCP 进程共享 events.jsonl，每条消息事件全机恰好一次送达 |
| 多账号 | v1.3.8 起单台机器配多套账号，工具调用按 chat / 资源归属自动选 profile |

完整 84 工具表见 [README](https://github.com/EthanQC/feishu-user-plugin#工具索引84-个)。

## 工程上几个值得讲的细节

### 1. UAT 多进程 race condition

最早期（v1.3.4 之前）有一个怪 bug：用户同时开 Claude Code + Codex，每个进程都跑一个 MCP server 实例，UAT 过期触发 refresh，多个进程并发请求 refresh token——飞书后端只接受第一个，剩下用旧 refresh token 请求会被直接拉黑整个 refresh token 链。结果用户每隔 7 天就要重新 OAuth。

修复（v1.3.5）：跨进程文件锁 `~/.claude/feishu-uat-refresh.lock`（`O_CREAT|O_EXCL`，30s stale）+ 锁持有者进入临界区前**重读一次持久化的 config**——如果发现已有 peer 写入了新 token，直接采用 peer 的，不再发新 refresh 请求。

### 2. v1.3.9 机器级实时事件 SSOT

之前每个 MCP 进程都自己开 WS 监听 + 维护 in-memory event buffer，结果用户被一条消息事件 N 个 MCP 进程通知 N 次。

v1.3.9 重构：**整机一把锁**（`~/.feishu-user-plugin/ws-owner.lock`），单进程持锁后开 WS，写入到 `~/.feishu-user-plugin/events.jsonl`（10 MB 软 / 20 MB 硬限轮转），所有 MCP 进程通过共享的 `events.cursor.json` 推进 cursor，**全机每条事件恰好一次**。

`manage_ws_status` 工具暴露了 info / reconnect / claim / rotate / reconfig 五个 action，可以从 Claude Code 里直接诊断和操作。

### 3. 多账号自动切换

v1.3.8 加的能力。同一台机器配多个飞书账号 / 多套 app credentials 时，按 chat / 资源归属自动选 profile。读路径失败码 `91403 / 1254301 / 1254000 / 99991672 / HTTP 403` 时自动跨 profile retry，写路径**永远不切**（避免错号创建资源）。

## 安装、文档、链接

```bash
npx feishu-user-plugin setup --app-id <APP_ID> --app-secret <APP_SECRET>
npx feishu-user-plugin oauth
# 重启 Claude Code / Codex
npx feishu-user-plugin status   # 看登录状态
```

- **GitHub**：https://github.com/EthanQC/feishu-user-plugin
- **npm**：https://www.npmjs.com/package/feishu-user-plugin
- **官网**：https://ethanqc.github.io/feishu-user-plugin/
- **English README**：https://github.com/EthanQC/feishu-user-plugin/blob/main/README.en.md
- **CHANGELOG**：https://github.com/EthanQC/feishu-user-plugin/blob/main/CHANGELOG.md

## 致谢

- [@cv-cat](https://github.com/cv-cat) 的 LarkAgentX / OpenFeiShuApis 项目，早期飞书 web 协议研究参照
- [Model Context Protocol](https://modelcontextprotocol.io) —— Anthropic / PulseMCP / GitHub / Stacklok 共维的 MCP 标准

如果试用碰到问题，[issues 区](https://github.com/EthanQC/feishu-user-plugin/issues) 或 [discussions](https://github.com/EthanQC/feishu-user-plugin/discussions)（v1.3.9 起开了）见。

---

**封面图建议**：用 docs/og.png（中文 stat 卡，1200×630）。

**评论区第一条置顶**：贴 GitHub + npm + 官网链接（掘金推荐流不显示外链，评论区会显示）。

**发布后 1-2 小时检查**：阅读完成率（< 30% 说明开头不抓人，要改 hook）；点赞 / 评论比；标签是否进了"AI 编程"频道推荐流。
