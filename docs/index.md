---
title: feishu-user-plugin · 飞书 MCP 服务器（Claude Code / Codex）
description: 让 Claude Code / Codex 接管你的飞书工作流 — 84 个工具、3 层鉴权、以你本人身份发消息（不是机器人）。开源 MIT。
keywords: 飞书 MCP, Feishu MCP, Lark MCP, 飞书 Claude Code, Claude Code 飞书, 飞书插件, 飞书机器人替代, send as user, 用户身份发飞书, 飞书 AI agent
lang: zh-CN
---

# feishu-user-plugin

> **All-in-one 飞书 MCP 服务器** —— 让 Claude Code、Codex、Cursor、Windsurf 等 MCP 客户端**以你本人身份**操作飞书。

**84 个工具 · 3 层鉴权 · 9 个 MCP prompts · MIT 协议 · Node ≥18**

[GitHub 仓库](https://github.com/EthanQC/feishu-user-plugin){: .btn .btn-primary }
[npm](https://www.npmjs.com/package/feishu-user-plugin){: .btn }
[English Docs](./en.html){: .btn }
[更新日志](https://github.com/EthanQC/feishu-user-plugin/blob/main/CHANGELOG.md){: .btn }

---

## 这玩意解决什么问题

飞书官方开放 API **没有 `send_as_user` 权限点**：哪怕拿到 `user_access_token`，发出来的消息一律标记 `sender_type: "app"`，群里看到的是机器人头像 + "由 [应用名] 发送"。

很多场景里这不是 UX 问题，是阻断器：

- 机器人发的"周报"同事直接划走，没有"@真人"的存在感
- 自动化代你发的私聊一眼能看出来不是你写的
- 做飞书 RAG 时，用户身份和机器人身份混在一起也是合规雷区
- 想让 Claude Code 当你的飞书副驾驶，结果它发的所有消息都"露馅"

`feishu-user-plugin` 把三层鉴权融在一个 MCP server 里，让 Claude Code / Codex 既能**用机器人能力做苦活**（读群、爬文档、批量更新表格），又能**用你本人身份做沟通**（发消息、@同事、回复 review）。

## 三层鉴权一表看懂

| 鉴权层 | 凭证 | 干什么 | 工具数 |
|---|---|---|---|
| **用户身份** | `LARK_COOKIE`（cookie + protobuf 反向工程） | 以你本人身份发文本 / 图片 / 文件 / 富文本 / 卡片 / @ / 批量 | 8 |
| **官方 API** | `LARK_APP_ID` + `LARK_APP_SECRET` | 群消息读写 · 文档 · 多维表格 · 知识库 · 云空间 · 日历 · 任务 v2 · OKR · 联系人 · 实时事件 WS | 70+ |
| **用户 OAuth UAT** | `LARK_USER_ACCESS_TOKEN` + `LARK_USER_REFRESH_TOKEN` | P2P 私聊历史读取 · 用户 chat 列表 · 文档/Bitable/日历 资源以你为 owner 创建 | 2 显式 + 全工具 UAT-first |

三层全配齐，能力相加；只配一层，对应能力可用。

## 核心能力速览

**消息（用户身份）**
- `send_to_user` / `send_to_group` —— 发文本到任意 chat
- `send_image_as_user` —— v1.3.9 起以你身份发图片（cookie protobuf 暴力探测得到的协议）
- `send_file_as_user` / `send_post_as_user` —— 发文件、富文本 Post（含 @ 提醒、超链）
- `batch_send` —— 一次发多条
- 全部自动解析 `oc_xxx` chat ID 到 numeric，缓存 10 分钟

**消息（官方 API）**
- `read_messages` / `read_p2p_messages` —— 读群消息 / 读私聊；外部群自动 fallback 到 UAT；merge_forward 自动展开；text 自动提取 URL + 飞书文档链接
- `reply_message` / `forward_message` / `update_message` / `pin_message` / `add_reaction` 等机器人能力齐全
- `download_message_resource` —— 下载消息里的图片 / 文件

**文档生态**
- 文档：`search_docs` / `read_doc` / `read_doc_markdown` (v1.3.9 直接返回 markdown 节省 60% token) / `manage_doc_block`（支持 image / file 块快捷上传）
- 多维表格：`manage_bitable_app|table|field|view|record` + `upload_bitable_attachment`，500 条批量增删改
- 知识库：`list_wiki_spaces` / `search_wiki` / `create/update/move/copy/delete_wiki_node`
- 云空间：`list_files` / `create_folder` / `manage_drive_file` / `upload_drive_file`（支持直接上传到 Wiki 节点）

**协作工具**
- 日历：`list/create/update/delete/respond_calendar_event` + `get_freebusy`
- 任务 v2：`list/create/update/complete/delete_task` + `manage_task_members`
- OKR：`list_user_okrs` / `get_okrs` / `create/list/delete_okr_progress_record`

**实时事件（v1.3.9）**
- 机器级 SSOT 架构：单进程持有 WS owner 锁，全机所有 MCP 进程共享 `events.jsonl`，每条事件**全机恰好一次**送达
- `get_new_events` 拉取增量；`manage_ws_status` 诊断 / 重连 / 抢锁 / 重配

**多账号**（v1.3.8 / v1.3.9 多 profile 自动切换）
- 单台机器配多套 cookie / app / UAT，工具调用自动按 chat / 资源归属选 profile
- 失败自动跨 profile retry（错误码 91403 / 1254301 / 1254000 / 99991672 / HTTP 403）

## 9 个 MCP prompts（slash commands）

Claude Code / Codex / Cursor / OpenClaw / Windsurf 直接用：

| Prompt | 干什么 |
|---|---|
| `/send` | 以你身份发消息 |
| `/reply` | 读最近消息然后回 |
| `/digest` | 群 / P2P 最近消息总结 |
| `/search` | 搜联系人 / 群 |
| `/doc` | 搜 / 读 / 建飞书文档 |
| `/table` | 操作多维表格 |
| `/wiki` | 搜知识库 |
| `/drive` | 列云空间文件 / 建文件夹 |
| `/status` | 检查三层鉴权状态 |

## 快速开始

```bash
# 1. 跑 setup 向导，写入 ~/.claude.json
npx feishu-user-plugin setup --app-id <YOUR_APP_ID> --app-secret <YOUR_APP_SECRET>

# 2. 通过 OAuth 拿 UAT
npx feishu-user-plugin oauth

# 3. 重启 Claude Code / Codex
```

在 Claude Code 里直接说人话：

> 你：「帮我以我身份给王小明发：今天的代码 review 我看完了，有 3 个 nit」
>
> Claude：*[调用 send_as_user]* 已发送 ✓

更详细的安装、Cookie 获取（Playwright 自动化）、多客户端配置见 [GitHub README](https://github.com/EthanQC/feishu-user-plugin#readme)。

## 兼容客户端

- **Claude Code**（CLI / Desktop / Web / IDE 扩展）
- **Codex**
- **Cursor**, **Windsurf**, **OpenClaw**, 任何 MCP 兼容客户端

## 合规与使用边界

⚠️ **本项目仅用于个人与企业内部用途，不是商业 SaaS 产品。**

- **Cookie + protobuf 反向工程层**未经飞书官方背书。请遵守飞书《开发者服务协议》和你所在企业的 IT 政策。
- **官方 API 层**完全使用飞书公开开放 API，需要在飞书开放平台创建企业自建应用并申请相应权限。
- 不要把 `LARK_COOKIE` / `LARK_USER_REFRESH_TOKEN` 提交到任何公开仓库（`~/.feishu-user-plugin/credentials.json` 默认 0600，文件存权限即可）。
- 公开商业部署 / 多租户 SaaS 场景请自行评估法律合规风险。

## 链接

- [GitHub 源码](https://github.com/EthanQC/feishu-user-plugin)
- [npm 包页](https://www.npmjs.com/package/feishu-user-plugin)
- [更新日志（CHANGELOG.md）](https://github.com/EthanQC/feishu-user-plugin/blob/main/CHANGELOG.md)
- [English landing](./en.html)
- [Issues / Discussions](https://github.com/EthanQC/feishu-user-plugin/issues)
- [MIT License](https://github.com/EthanQC/feishu-user-plugin/blob/main/LICENSE)

---

<small>由 [Claude Code](https://claude.com/claude-code) + [feishu-user-plugin](https://github.com/EthanQC/feishu-user-plugin) 维护。</small>
