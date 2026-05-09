# V2EX 自荐贴

**目标节点**：`/go/create`（创造，自创项目主对口）+ `/go/share`（分享，关联节点）
**最佳发布时间**：周五上午 9-11 点（北京时间）
**长度**：≤ 800 字
**状态**：📄 草稿 —— 等用户说 `发`

---

## 标题

**[分享创造] feishu-user-plugin —— 84 工具的飞书 MCP 服务器，支持以用户身份发消息**

## 正文

---

飞书官方开放 API 没有 `send_as_user` 权限点。机器人 token 发出的消息全部标 `sender_type: "app"`，群里看到机器人头像 + "由 [应用名] 发送"。这件事在很多自动化场景里有体感影响。

`feishu-user-plugin` 是开源（MIT）的飞书 MCP 服务器，把 cookie 协议路径 + 官方 API + 用户 OAuth UAT 整合在一个进程里。84 个工具，覆盖 IM / 文档 / 多维表格 / 知识库 / 云空间 / 日历 / 任务 v2 / OKR。

主要差异点：基于 cookie + protobuf 协议路径，支持以**用户本人身份**发消息——同事看到的是你的头像、你的名字。

## 安装

```bash
npx feishu-user-plugin setup --app-id <APP_ID> --app-secret <APP_SECRET>
npx feishu-user-plugin oauth
# 重启 Claude Code / Codex
```

然后在 Claude Code 里说："帮我以我身份给王小明发：今天的代码 review 我看完了，有 3 个 nit"。

## 主要特性

- **84 个工具**：覆盖飞书 IM / 文档 / 多维表格（500 条批量增删改）/ 知识库 / 云空间 / 日历 / 任务 v2 / OKR / 实时事件 WS
- **多账号自动切换**（v1.3.8）：单台机器配多套飞书账号，工具调用按 chat / 资源归属自动选 profile
- **机器级实时事件 SSOT**（v1.3.9）：全机所有 MCP 进程共享 `events.jsonl`，每条事件全机恰好一次送达
- **9 个 MCP prompts**：`/send` `/reply` `/digest` `/search` `/doc` `/table` `/wiki` `/drive` `/status`

## 链接

- GitHub: https://github.com/EthanQC/feishu-user-plugin
- npm: https://www.npmjs.com/package/feishu-user-plugin
- 官网: https://ethanqc.github.io/feishu-user-plugin/
- 兼容客户端：Claude Code / Codex / Cursor / Windsurf / VS Code / OpenClaw

---

## 发帖前 checklist

- [ ] 选 `/go/create` 主帖、关联 `/go/share`（V2EX 允许同帖关联多节点）
- [ ] 周五上午 9-11 点发，避开周末
- [ ] 准备好回复评论的精力 —— 首日内有人问技术问题，半小时内回答

## 发帖后

- 24 小时内能进首页推荐 = 流量符合预期
- 评论区如果有 "怎么对比 lark-openapi-mcp / cso1z 的飞书 MCP" 类问题，回答 "都是好项目，差异化在 send-as-user，开源出来给同样有这个需求的人用" 即可，不要踩竞品
