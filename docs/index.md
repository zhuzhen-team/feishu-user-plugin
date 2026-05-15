---
title: feishu-user-plugin · 飞书 MCP 服务器（Claude Code / Codex）
description: 飞书 MCP 服务器，让 Claude Code、Codex、Cursor、Windsurf 等 MCP 客户端以用户身份操作飞书。85 工具，3 层鉴权。MIT 协议。
keywords: 飞书 MCP, Feishu MCP, Lark MCP, 飞书 Claude Code, Claude Code 飞书, 飞书插件, send as user, 用户身份发飞书, 飞书 AI agent
lang: zh-CN
---

# feishu-user-plugin

飞书 / Lark MCP 服务器，覆盖 IM、文档、多维表格、知识库、云空间、日历、任务 v2、OKR、实时事件。**85 tools · 3 auth layers · 9 MCP prompts · MIT licensed · Node ≥18**。

[GitHub](https://github.com/EthanQC/feishu-user-plugin){: .btn .btn-primary }
[npm](https://www.npmjs.com/package/feishu-user-plugin){: .btn }
[English](./en.html){: .btn }
[CHANGELOG](https://github.com/EthanQC/feishu-user-plugin/blob/main/CHANGELOG.md){: .btn }

兼容 Claude Code、Codex、Cursor、Windsurf、VS Code、Claude Desktop、OpenClaw 等 MCP 客户端。

与其他飞书 MCP 的区别：基于 cookie + protobuf 协议路径，支持以**用户本人身份**发消息——飞书官方开放 API 没有 `send_as_user` 权限点，机器人 token 发出的消息一律标 `sender_type: "app"`。

## 三层鉴权

| 鉴权层 | 凭证 | 覆盖能力 | 工具数 |
|---|---|---|---|
| 用户身份 | `LARK_COOKIE` | 以用户身份发文本 / 图片 / 文件 / 富文本 / @ / 批量 | 8 |
| 官方 API（机器人） | `LARK_APP_ID` + `LARK_APP_SECRET` | 群消息读写、文档、多维表格、知识库、云空间、日历、任务 v2、OKR、联系人、实时事件 WS | 70+ |
| 用户 OAuth UAT | `LARK_USER_ACCESS_TOKEN` + `LARK_USER_REFRESH_TOKEN` | P2P 私聊读取、用户 chat 列表；写入文档 / Bitable / 日历 资源时以用户为 owner | 2 显式 + 全工具 UAT-first |

三层独立 —— 配置任意一层，对应工具可用。

## 核心能力

**消息（用户身份）**
- `send_to_user` / `send_to_group` —— 发文本到任意 chat
- `send_image_as_user` —— 以用户身份发图片（v1.3.9）
- `send_file_as_user` / `send_post_as_user` —— 文件、富文本 Post（含 @ 提醒、超链）
- `batch_send` —— 一次发多条
- 全部自动解析 `oc_xxx` chat ID 到 numeric，缓存 10 分钟

**消息（官方 API）**
- `read_messages` / `read_p2p_messages` —— 读群消息 / 读私聊；外部群自动 fallback 到 UAT；merge_forward 自动展开；text 自动提取 URL + 飞书文档链接
- `reply_message` / `forward_message` / `update_message` / `pin_message` / `add_reaction` 等机器人能力齐全
- `download_message_resource` —— 下载消息附件

**文档生态**
- 文档：`search_docs` / `read_doc` / `read_doc_markdown`（v1.3.9 直接返回 markdown 节省 ~60% token）/ `manage_doc_block`（image / file 块快捷上传）
- 多维表格：`manage_bitable_app|table|field|view|record` + `upload_bitable_attachment`，500 条批量增删改
- 知识库：`list_wiki_spaces` / `search_wiki` / `create/update/move/copy/delete_wiki_node`
- 云空间：`list_files` / `create_folder` / `manage_drive_file` / `upload_drive_file`（支持直接上传到 Wiki 节点）

**协作工具**
- 日历：`list/create/update/delete/respond_calendar_event` + `get_freebusy`
- 任务 v2：`list/create/update/complete/delete_task` + `manage_task_members`
- OKR：`list_user_okrs` / `get_okrs` / `create/list/delete_okr_progress_record`

**实时事件（v1.3.9）**
- 机器级 SSOT：单进程持有 WS owner 锁，全机所有 MCP 进程共享 `events.jsonl`，每条事件全机恰好一次送达
- `get_new_events` 拉取增量；`manage_ws_status` 诊断 / 重连 / 抢锁 / 重配

**多账号**（v1.3.8 / v1.3.9）
- 单台机器配多套 cookie / app / UAT，工具调用按 chat / 资源归属自动选 profile
- 读路径失败自动跨 profile retry（错误码 91403 / 1254301 / 1254000 / 99991672 / HTTP 403）；写路径不切

## 9 个 MCP prompts（slash commands）

| Prompt | 说明 |
|---|---|
| `/send` | 以用户身份发消息 |
| `/reply` | 读最近消息然后回 |
| `/digest` | 群 / P2P 最近消息总结 |
| `/search` | 搜联系人 / 群 |
| `/doc` | 搜 / 读 / 建飞书文档 |
| `/table` | 操作多维表格 |
| `/wiki` | 搜知识库 |
| `/drive` | 列云空间 / 建文件夹 |
| `/status` | 检查三层鉴权状态 |

## 快速开始

```bash
npx feishu-user-plugin setup --app-id <APP_ID> --app-secret <APP_SECRET>
npx feishu-user-plugin oauth     # 拿用户 OAuth UAT
# 重启 Claude Code / Codex
```

cookie 获取：跟 Claude Code 说一句"帮我设置飞书 cookie"会自动经 Playwright 扫码登录抓取；或在 feishu.cn DevTools Network 标签从请求头 Cookie 整行复制（不要用 `document.cookie` —— HttpOnly 的 `session` / `sl_session` 拿不到）。

```
你：帮我以我身份给王小明发：今天的代码 review 我看完了，有 3 个 nit
Claude：[调用 send_to_user]  Sent
```

完整安装、各客户端配置、工具索引见 [GitHub README](https://github.com/EthanQC/feishu-user-plugin#readme)。

## 链接

- [GitHub 源码](https://github.com/EthanQC/feishu-user-plugin)
- [npm 包页](https://www.npmjs.com/package/feishu-user-plugin)
- [CHANGELOG](https://github.com/EthanQC/feishu-user-plugin/blob/main/CHANGELOG.md)
- [English landing](./en.html)
- [Issues / Discussions](https://github.com/EthanQC/feishu-user-plugin/issues)
- [MIT License](https://github.com/EthanQC/feishu-user-plugin/blob/main/LICENSE)
