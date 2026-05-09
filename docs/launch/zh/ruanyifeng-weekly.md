# 阮一峰科技爱好者周刊 自荐 Issue

**目标平台**：https://github.com/ruanyf/weekly
**渠道**：在 ruanyf/weekly 仓库提 issue，标题以 "推荐项目 / 推荐文章" 开头
**审核**：阮一峰本人审核，每周三发刊
**状态**：📄 草稿 —— 等用户说 `发`

---

## Issue 标题

```
[推荐项目] feishu-user-plugin —— 84 工具的飞书 MCP 服务器
```

## Issue 正文

```markdown
项目地址：https://github.com/EthanQC/feishu-user-plugin

简介：

开源（MIT）的飞书 MCP 服务器，把三层鉴权（cookie + 官方 app token + 用户 OAuth UAT）整合在一个 Node.js 进程里给 Claude Code / Codex / Cursor 等 MCP 客户端使用。84 个工具，覆盖 IM / 文档 / 多维表格 / 知识库 / 云空间 / 日历 / 任务 v2 / OKR。

主要差异点：飞书官方开放 API 没有 send_as_user 权限点，机器人 token 发出的消息一律标 sender_type: "app"。本项目基于 cookie + protobuf 协议路径，支持以用户本人身份发消息。

技术亮点：

- v1.3.9 起以用户身份发图片（cookie 通道）
- 机器级 SSOT 实时事件架构：单进程持 WS owner 锁，全机所有 MCP 进程共享 events.jsonl，每条事件全机恰好一次送达
- 多账号自动切换：按 chat / 资源归属选 profile，读路径失败自动 retry，写路径不切

中文 README + GitHub Pages 中文 SEO landing。npm 一行命令安装：

    npx feishu-user-plugin setup --app-id <X> --app-secret <Y>
    npx feishu-user-plugin oauth

兼容客户端：Claude Code（CLI / Desktop / Web / IDE 扩展）、Codex、Cursor、Windsurf、VS Code、OpenClaw。
```

## 提交方式

```bash
gh issue create --repo ruanyf/weekly \
  --title "[推荐项目] feishu-user-plugin —— 84 工具的飞书 MCP 服务器" \
  --body-file docs/launch/ruanyifeng-weekly-issue.md
```

或在网页 https://github.com/ruanyf/weekly/issues/new 粘贴上面的标题 + 正文。

## 入选率提升技巧

- **每周三早上 10 点前**提 issue（阮一峰当天发刊前最后一刻收稿）
- 一个项目只提一次 issue，不要重复
- 不要在评论区催
- 配图建议：如果有 docs/og.png，issue 正文里嵌一张提升点击率

## 入选后预期

- 周刊每期约 50k 阅读量
- 入选当周 GitHub stars 一般 +30-100
- 后续 1-2 个月持续有人 fork / issue / PR

## 历史参照

`ruanyf/weekly` 已收录的同类项目示例（用于格式对照）：

- issue #9202 — `chenhg5/cc-connect`（飞书 ↔ Claude Code Bridge）
- 其他飞书 / Claude Code 相关 issue 在 ruanyf/weekly 里搜 keyword 即可
