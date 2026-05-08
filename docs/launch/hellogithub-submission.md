# HelloGitHub 月刊自荐

**目标平台**：https://hellogithub.com/periodical（HelloGitHub 月刊）
**月刊收稿**：每月接受用户自荐项目，每月 28 日截稿
**审核**：编辑部审核，~1 周内反馈
**状态**：📄 Draft —— 等用户 `发`

---

## 自荐入口

https://hellogithub.com/periodical → 右上角 "推荐项目"

或直接走 GitHub issue（`521xueweihan/HelloGitHub` 仓库的 issue tracker）—— 编辑部从 issue 收集候选。

## 推荐项目表单字段

| 字段 | 内容 |
|---|---|
| **项目名称** | feishu-user-plugin |
| **项目地址** | https://github.com/EthanQC/feishu-user-plugin |
| **项目描述（一句话）** | 84 工具的飞书 MCP 服务器，让 Claude Code / Codex 以你本人身份发消息，不是机器人 |
| **主要语言** | JavaScript / TypeScript |
| **License** | MIT |
| **推荐理由** | 见下 |
| **作者** | [@EthanQC](https://github.com/EthanQC) |

## 推荐理由（120-300 字）

```
飞书官方开放 API 不支持 user-identity 消息发送（没 send_as_user 权限点），所有自动化机器人发的消息都标"由 [应用名] 发送"，在协作场景里 UX 严重受损。

feishu-user-plugin 把三层鉴权（cookie 反向工程 + 官方 app token + 用户 OAuth UAT）融在一个 MCP server 里，让 Claude Code、Codex、Cursor 等 MCP 客户端能"以你本人身份"操作飞书：发消息、读群、操作文档 / 多维表格 / 知识库 / 云空间 / 日历 / 任务 / OKR，84 个工具一站式覆盖。

技术亮点：cookie + protobuf 暴力探测发掘飞书 web 客户端的图片消息协议；机器级 SSOT 实时事件架构（全机所有 MCP 进程共享 events.jsonl，每条事件全机恰好一次）；多账号自动切换（按 chat / 资源归属选 profile，读路径自动 retry，写路径不自动切防错号）。

MIT 协议，npm 一行命令安装，跑在 Node.js ≥18。Active 维护，v1.3.9 刚 ship。
```

## 为什么适合 HelloGitHub

- **国产开源工具**：飞书是国产产品，HelloGitHub 偏好突出中文 dev 圈贡献
- **AI 编程方向热度**：MCP / Claude Code 是 2026 上半年话题热点
- **完整工程实践**：从协议反向工程到 84 工具产品化、3 套客户端兼容、4 级 CI gate，工程实践完整
- **合规边界自觉**：在 README 顶部就清楚标 ToS，符合 HelloGitHub 推崇的"开源价值观"

## 提交时机

每月 25 日前提交（28 日截稿，提前几天给编辑部审核）。建议在 v1.3.9 ship 后的当月内提交，搭车版本话题度。

## 入选后操作

- HelloGitHub 月刊会被广泛转发到掘金 / 知乎 / V2EX / 飞书读者群 / WeChat 公众号 — 自然流量爆发
- 入选当月监控 GitHub stars 增长曲线，预期 +50-200 stars
- 编辑部如果发反馈邮件，**24 小时内回复**，提高下个月再次入选概率
