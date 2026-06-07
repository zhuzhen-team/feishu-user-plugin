# 工具引用（85 tools）

> **谁该读**：在本仓写新工具的开发者、在仓内干活的 AI agent、想知道某工具具体能力的高级用户。  
> **何时读**：写新工具前对照域分布、调用某工具不确定参数、查跨域 caveat / 已知错误码。

每个工具的具体参数说明在 MCP `inputSchema.description` 字段里（运行时可见）。本文档列工具名 + 跨域 caveat + 常见用法 pattern。

## 目录

- [User Identity — Messaging（cookie protobuf，8 tools）](#user-identity--messagingcookie-protobuf8-tools)
- [User Identity — Contacts & Info（5 tools）](#user-identity--contacts--info5-tools)
- [User OAuth UAT — P2P Chat（2 tools）](#user-oauth-uat--p2p-chat2-tools)
- [Official API — IM（16 tools）](#official-api--im16-tools)
- [Official API — Docs（7 tools）](#official-api--docs7-tools)
- [Official API — Bitable（5 tools，v1.3.7 整合）](#official-api--bitable5-toolsv137-整合)
- [Official API — Wiki（9 tools）](#official-api--wiki9-tools)
- [Official API — Drive（5 tools）](#official-api--drive5-tools)
- [Official API — OKR（6 tools）](#official-api--okr6-tools)
- [Official API — Calendar（8 tools）](#official-api--calendar8-tools)
- [Official API — Tasks v2（7 tools，v1.3.7 新域）](#official-api--tasks-v27-toolsv137-新域)
- [Plugin — Diagnostics & Profiles（4 tools）](#plugin--diagnostics--profiles4-tools)
- [Plugin — Realtime Events（2 tools，v1.3.9）](#plugin--realtime-events2-toolsv139)
- [常见用法 patterns](#常见用法-patterns)

## User Identity — Messaging（cookie protobuf，8 tools）
`send_to_user` / `send_to_group` / `send_as_user` / `send_image_as_user` / `send_file_as_user` / `send_post_as_user` / `send_card_as_user` / `batch_send`

- 所有 cookie 发送自 v1.3.7 起自动把 `oc_xxx` chat ID 解析为 numeric（C1.4：`getChatInfo → search → numeric`，带缓存）
- 纯文本发送支持 `ats:[{userId,name}]` —— 标记 `@<name>` 必须出现在 `text` 内；插件把它拼接成真实 AT 元素以触发通知
- `send_post_as_user` 段落支持 `{tag:"text"}` / `{tag:"a",href,text}` / `{tag:"at",userId,name}` 元素；`at` 元素触发真实通知
- `send_image_as_user` 自 v1.3.9 起可用（cookie protobuf 通过 brute-force probe 反向出来 —— 见 `scripts/explore-image-minimize.js`）。Content 必填字段：`imageKey` + `thumbnailKey`。caller 不传 thumbnailKey 时插件默认等于 imageKey。可选元数据：width / height / mime / size —— 全部由飞书侧自动推导，无需 pre-compute
- `send_card_as_user` 仅走机器人通道。User-identity（cookie protobuf）卡片发送在 v1.3.9 通过 brute-force 确认服务端禁用。`as_user` 后缀作历史命名保留

## User Identity — Contacts & Info（5 tools）
`search_contacts` / `create_p2p_chat` / `get_chat_info` / `get_user_info` / `get_login_status`

- `get_chat_info` 接受 `oc_xxx` 和 numeric chat_id（Official API + protobuf fallback）
- `search_contacts` 的 `query` 字段接受任意字符串：姓名 / 邮箱 / 手机号都可以

## User OAuth UAT — P2P Chat（2 tools）
`read_p2p_messages` / `list_user_chats`

- `list_user_chats` 仅返回**群聊**（飞书 API 限制）。P2P 列表请走 `search_contacts` → `create_p2p_chat`
- docx / bitable / drive / wiki / OKR / calendar / tasks 的 create+edit 默认 UAT-first —— UAT 优先、bot fallback，被迫走 bot 时返回里带 ⚠ warning。资源 ownership 与 caller 一致
- 发现类读路径同样 UAT-first（v1.3.16+）：`list_files` / `search_docs` / `search_wiki` / `get_wiki_node`。此前这四个走纯 app token，bot 看不到个人空间（"我的空间"403 / 搜索不索引），导致用户上传的文件**找不到也删不掉**；现在返回里带 `viaUser` 标明视角归属

## Official API — IM（16 tools）
`list_chats` / `read_messages` / `search_messages` / `send_message_as_bot` / `reply_message` / `forward_message` / `delete_message` / `update_message` / `add_reaction` / `delete_reaction` / `pin_message` / `create_group` / `update_group` / `list_members` / `manage_members` / `download_message_resource`

- `search_messages`（v1.3.12, B.5）UAT-only：包 `POST /open-apis/search/v2/message`，需 OAuth scope `search:message`（飞书 bot path 不暴露搜索）。Filter 支持 `chat_ids` / `from_ids` / `at_user_ids` / `message_types` / `from_types` + 分页。返回 message-id 指针（不是 full bodies），跨多群搜索时 response token 友好

- `read_messages` 解析 chat 名 → bot 群列表 → `im.chat.search` → cookie `search_contacts`。外部群自动 fallback 到 UAT。`merge_forward` 自动展开；text 消息会抽取 `urls[]` + `feishuDocs[]`（用 `expand_merge_forward=false` 关闭）
- `update_message` 仅支持 `msg_type=text|interactive`（飞书限制；调 API 前就会被拒绝）
- `forward_message` 自动从前缀识别 `receive_id_type`（`ou_` / `on_` / `email` / ...）
- `manage_members` 要求 `member_id_type` 与传入的 ID 类型匹配（默认 `open_id`；显式传 `union_id` / `user_id` 避免 9499）
- `download_message_resource(kind=image|file)` 当 payload > 2 MiB 时**必须传** `save_path`（Anthropic 5 MB inline 上限）。`merge_forward` 子消息要用 `parentMessageId`，不是子消息 id

## Official API — Docs（7 tools）
`search_docs` / `read_doc` / `read_doc_markdown` / `get_doc_blocks` / `create_doc` / `manage_doc_block` / `download_doc_image`

- `search_docs` UAT-first（v1.3.16）：用户身份下搜索范围覆盖**你**可见的全部文档（含个人空间上传的 PDF 等）；bot 身份只覆盖共享给 bot 的文档。返回带 `viaUser`
- `read_doc_markdown` 返回 markdown 字符串而非结构化 JSON —— RAG / digest / 摘要类调用省 ~60% token。嵌入图片 / 文件以 `feishu://image_token/<TOKEN>` / `feishu://file_token/<TOKEN>` 占位符保留；二进制内容配合 `download_doc_image` 取。`document_id` 同样接受 native token / wiki node / 飞书 URL
- `manage_doc_block(action=create)` 提供图片（`image_path` / `image_token`）和文件（`file_path` / `file_token`）快捷参数；FILE 块（block_type=23）会被自动包到 VIEW 容器（block_type=33），插件在 `replace_file` PATCH 前先走入容器内的文件块
- `get_doc_blocks` / `read_doc_markdown` **跟进分页拉全量**（v1.3.17）：内部循环 `page_token` 直到取完，`hasMore:false` 保证整棵块树都在返回里（此前静默截断在 500 块——大文档尾部"消失"的根因）。超大文档可传 `max_blocks` 限定单次返回，配合返回的 `nextPageToken` 作为 `page_token` 续拉；被限定的返回带 `truncated:true` + `hasMore:true`，绝不静默
- `manage_doc_block` mode F（table）填格**部分失败不再整体抛错**（v1.3.17）：瞬态错误（code=2200 scope-check 抖动 / 限频 / 5xx）自动退避重试；重试后仍失败的格子记录在 `failedCells:[{row,col,cellId,textBlockId?,reason,skipped?}]`（row/col 0 起算）随成功结果一起返回，连续 3 格失败后剩余格子跳过并标 `skipped:true`。逐格用 `action=update`（block_id 传 `textBlockId`）补内容，不必重建表
- **`update_text_elements` 是整段替换**：`manage_doc_block(action=update)` 的 `update_text_elements` 全量覆盖该块的 elements 数组（**不是** patch / append）——漏传的 element（加粗前缀、链接等）会永久丢失。只想改一部分时，先 `get_doc_blocks` 读出原 elements，改完后整组传回
- `download_doc_image` 同 `download_message_resource` 的 2 MiB 上限
- 所有 `document_id` / `app_token` 都接受 native token / wiki node token / 完整飞书 URL（通过 `getWikiNode` 解析，10 分钟缓存）

## Official API — Bitable（5 tools，v1.3.7 整合）
`manage_bitable_app(action=create|copy|get_meta)` / `manage_bitable_table` / `manage_bitable_field` / `manage_bitable_view` / `manage_bitable_record` / `upload_bitable_attachment`

- `manage_bitable_field(action=update)` 即使只改 field name 也必须传 `type`（飞书 API 限制）
- `manage_bitable_record` create / update / delete 接受数组（单条或最多 500 条）
- `manage_bitable_app(action=create)` 接受可选 `wiki_space_id`（+ `wiki_parent_node_token`）直接挂到 Wiki
- `upload_bitable_attachment` 返回 `file_token` → 通过 `manage_bitable_record(action=create|update, records=[{fields:{<field>:[{file_token:"..."}]}}])` 写入附件字段

## Official API — Wiki（9 tools）
`list_wiki_spaces` / `search_wiki` / `list_wiki_nodes` / `get_wiki_node` / `create_wiki_node` / `update_wiki_node` / `move_wiki_node` / `copy_wiki_node` / `delete_wiki_node`

- `list_wiki_spaces` / `list_wiki_nodes` / `search_wiki` / `get_wiki_node` 都是 UAT-first（后两个 v1.3.16 起）；bot 路径返回空时 `list_wiki_spaces` 附 `scopeHint`（一般是缺 `wiki:wiki:readonly`）
- `get_wiki_node` 同时接受 wiki node token 和 `search_wiki` 返回的底层 `obj_token`（合成 node-shape）
- `update_wiki_node` 只能 patch `title`（飞书 wiki API 不接收内容编辑 —— 内容走 docx / bitable / sheet 工具）
- `delete_wiki_node` 只删 wiki 节点指针；底层 drive 资源需另外 `manage_drive_file(action=delete)` 删

## Official API — Drive（4 tools）+ Uploads 辅助（3 tools）
`list_files` / `create_folder` / `manage_drive_file(action=copy|move|delete)` / `upload_drive_file` — Drive 域（4）
`upload_image` / `upload_file` / `upload_bitable_attachment` — 跨域上传辅助（3，分别用于 cookie 消息 / docx 媒体 / bitable 附件）

- `list_files` UAT-first（v1.3.16）：UAT 身份下空 `folder_token` 列**你的**"我的空间"根目录；bot 身份只能看被显式共享的文件夹（个人空间 403）。支持 `page_size` / `page_token` 分页（返回 `nextPageToken`），空结果 + bot 路径时附 `scopeHint`。上传→`list_files` 拿 token→`manage_drive_file(action=delete)` 的删除闭环由此打通
- `manage_drive_file` 必传 `type`（`file/folder/docx/sheet/bitable/mindnote/slides`）—— 否则飞书报 1061002 / 1062501
- `upload_drive_file` 带 `wiki_space_id` 时调 `attachToWiki(obj_type=file)` 把上传作为 Wiki 节点原子放置

## Official API — OKR（6 tools）
`list_user_okrs` / `get_okrs` / `list_okr_periods` / `create_okr_progress_record` / `list_okr_progress_records` / `delete_okr_progress_record`

- 写需要 `okr:okr.content:writeonly` scope
- `list_okr_progress_records` 从 `get_okrs` 提取 triples（飞书无 native list 接口）
- 飞书开放 API 不暴露 OKR 本体 CRUD（仅暴露读 + 进展记录写）

## Official API — Calendar（8 tools）
`list_calendars` / `list_calendar_events` / `get_calendar_event` / `create_calendar_event` / `update_calendar_event` / `delete_calendar_event` / `respond_calendar_event` / `get_freebusy`

- 写需要 `calendar:calendar.event:{create,update,delete,reply}` scope
- 读 UAT-first（primary + 共享 + 订阅）；bot 只能看到自己被显式邀请的日历

## Official API — Tasks v2（7 tools，v1.3.7 新域）
`list_tasks` / `get_task` / `create_task` / `update_task` / `complete_task` / `delete_task` / `manage_task_members`

- 标识符是 `task_guid`，不是 v1 的 numeric `task_id`
- `update_task` 必传显式 `update_fields=["summary","due","completed_at",...]` 数组 —— 飞书只 patch 列出的字段
- 需要 `task:task` scope

## Plugin — Diagnostics & Profiles（4 tools）
`get_login_status` / `list_profiles` / `switch_profile` / `manage_profile_hints`

- `switch_profile` 让缓存的 client 实例失效；下次调用按新 profile 重建。多 profile 通过 `LARK_PROFILES_JSON` env 或 `credentials.json` profiles map 注册
- `manage_profile_hints(action=list|set|clear, resource_key?, profile?)`（v1.3.8）查 / 改 自动切换中间件用的 resourceKey → profile 缓存。当 credentials.json 不存在时是 no-op

## Plugin — Realtime Events（2 tools，v1.3.9）
`get_new_events` / `manage_ws_status`

- **v1.3.9 机器级 SSOT**：单 MCP 进程持有 WS owner（通过 `~/.feishu-user-plugin/ws-owner.lock`）。事件写 `~/.feishu-user-plugin/events.jsonl`（append-only，10 MB 软 / 20 MB 硬上限）。所有 harness 共享 `events.cursor.json` —— **每条事件全机精确投递一次**，无重复
- WS 在 MCP 启动时连飞书（前提是配了 APP_ID + APP_SECRET）。仅支持 feishu.cn —— Lark 国际版不支持
- 默认订阅 `["im.message.receive_v1"]`。要订阅其他事件（`approval.instance.created_v4` / `calendar.calendar.event.changed_v4` 等），编辑 `credentials.json::profiles[<active>].events` 然后 `manage_ws_status(action=reconfig)` 不重启重新订阅
- `get_new_events` 通过 `event_type` / `event_types` / `chat_id` / `since_seconds` / `profile` 过滤。`peek=true` 不推进 cursor。**默认 `profile` 过滤 = 当前活跃**
- `manage_ws_status(action=info|reconnect|claim|rotate|reconfig)` —— 诊断 / 控制 WS owner。`claim --force` 抢一个活锁；`rotate` 强制 events.jsonl 轮转

---

## 常见用法 patterns

### Wiki-hosted content（docx / bitable / sheet）

所有 docx 和 bitable 工具的 `document_id` / `app_token` 参数都接受三种形式：

- Native token（不变）：`doccnXXX`、`docxXXX`、`bascnXXX`、...
- Wiki node token：`wikcnXXX`、`wikmXXX`、`wiknXXX`
- 完整飞书 URL：`https://xxx.feishu.cn/docx/XXX`、`.../wiki/XXX`、`.../base/XXX`

插件通过 `getWikiNode` 把 wiki 节点解析成底层 `obj_token`，再调正常的 docx / bitable 接口。结果缓存 10 分钟避免重复 lookup。

直接在 Wiki 空间下创建内容：

- `create_doc` / `manage_bitable_app(action=create)` 接受可选 `wiki_space_id`（+ `wiki_parent_node_token`）。插件先在 drive 创建资源，再调 `wiki/v2/spaces/{space_id}/nodes/move_docs_to_wiki` 挂上去 —— 立即成功时返回 `wikiNodeToken`，飞书排队时返回 `wikiAttachTaskId`

### 文档图片

读 —— `download_doc_image(image_token, doc_token?, save_path?)` 把图片作为 MCP image content 返回（base64 + mimeType）。`doc_token` 接受 native id / wiki node / URL。> 2 MiB 时强制传 `save_path`。

写 —— `manage_doc_block(action=create)` 提供图片快捷：

- `image_path`（绝对本地路径）→ 插件创建图片块、用 `drive/v1/medias/upload_all` 上传像素、用上传后的 token 把块 patch 上
- `image_token`（已上传）→ 插件创建块并附上 token

`manage_doc_block(action=update, image_token=...)` 替换已存在图片块的图。

### OKR

1. `list_okr_periods` —— 找当前季度的 period id
2. `list_user_okrs(user_id=<open_id>, period_ids=[...])` —— 列目标用户的 OKR
3. `get_okrs(okr_ids)` —— 批量取完整 objective + key result 结构 + 进度 + 对齐

`user_id` 必填 —— 用自己的 open_id（从 `get_login_status` / `search_contacts`）读自己 OKR，或同事的 open_id（受权限限制）。

写（v1.3.7，需要 `okr:okr.content:writeonly` scope）：

4. `create_okr_progress_record(target_id, target_type=1|2, content_text, source_title?, source_url?, progress_percent?)` —— `target_type` 1 表 objective，2 表 key result。`content_text` 自动包成飞书要求的 block 格式；要更复杂载荷（list / mention / docs link / gallery）直接传 `content`
5. `list_okr_progress_records(okr_id)` —— 从 `get_okrs` 提取 `{progress_id, target_id, target_type}` triples
6. `delete_okr_progress_record(progress_id)`

### Calendar

1. `list_calendars` —— 拿日历列表，`type=primary` 是个人日历
2. `list_calendar_events(calendar_id, start_time=<unix_sec>, end_time=<unix_sec>)` —— 列时间窗口内事件
3. `get_calendar_event(calendar_id, event_id)` —— 完整详情（参与人 / 地点 / 附件 / 会议链接）
4. `create_calendar_event(calendar_id, summary, start_time, end_time, ...)` —— `start_time` / `end_time` 是对象：`{timestamp:"<unix-seconds>", timezone?:"Asia/Shanghai"}` 或 `{date:"YYYY-MM-DD"}`（全天）。v1.3.7+ 需要 `calendar:calendar.event:{create,update,delete,reply}` scope
5. `update_calendar_event(calendar_id, event_id, ...patch)` —— 只传要改的字段
6. `delete_calendar_event(calendar_id, event_id, need_notification?)` —— 传 `meeting_chat_id` 同时解散关联会议群
7. `respond_calendar_event(calendar_id, event_id, rsvp_status=accept|decline|tentative)` —— 用当前 UAT 身份 RSVP
8. `get_freebusy(time_min, time_max, user_ids=[...])` —— 多人 freebusy 查询；找会议时间用

### Tasks（v2，v1.3.7）

全新域。标识符是 `task_guid`（不是 v1 的 numeric `task_id`）。需要 `task:task` scope。

1. `list_tasks(completed?, type?)` —— 当前用户任务，分页
2. `get_task(task_guid)` —— 完整详情
3. `create_task(summary, due?, members?, ...)` —— `summary` 必填；`due` 是 `{timestamp:"<unix-millis>", is_all_day?}`
4. `update_task(task_guid, update_fields=["summary","due","completed_at"], task={...})` —— 飞书只 patch 列出字段
5. `complete_task(task_guid, completed=true|false)` —— `completed_at` 切换的便捷封装
6. `delete_task(task_guid)`
7. `manage_task_members(action=add|remove, task_guid, members=[{id,role:"assignee"|"follower",type?:"user",name?}])`

### 外部群消息读取

`read_messages` / `read_p2p_messages` 暴露 `via` 字段（`"bot"` / `"user"` / `"contacts"`）。已知 bot 失败码（外部租户 / 无权限 / 不在群）直接 hop 到 UAT；瞬时错误（rate limit / 5xx / ECONNRESET / timeout）2 秒后重试一次再 fallback。没配 UAT 时错误信息指向 `npx feishu-user-plugin oauth`。

### 多 profile auto-switch（v1.3.8）

`~/.feishu-user-plugin/credentials.json` 配 ≥2 profile 的用户，读路径工具（`read_*` / `list_*` / `get_*` / `search_*` / `download_*`）遇 `91403 / 1254301 / 1254000 / 99991672 / HTTP 403` 时自动跨 profile retry。写路径**绝不**自动切。

单调用覆盖：传 `via_profile: "<name>"` 钉到指定 profile，传 `via_profile: "auto"` 给写路径开放自动切换。Hints 持久化到 `credentials.json::profileHints`，可通过 `manage_profile_hints` 检查。

v1.3.9：`FEISHU_PLUGIN_PROFILE` env 是 bootstrap-only —— `credentials.json::active` 是唯一权威。跨进程同步通过 dispatcher mtime check（~10μs/call）。

### 多 profile 注册

要注册更多 profile，在 MCP env 设 `LARK_PROFILES_JSON`（或用 `credentials.json` profiles map）：

```json
{"alt": {"LARK_COOKIE":"...","LARK_APP_ID":"...","LARK_APP_SECRET":"...","LARK_USER_ACCESS_TOKEN":"...","LARK_USER_REFRESH_TOKEN":"..."}}
```
