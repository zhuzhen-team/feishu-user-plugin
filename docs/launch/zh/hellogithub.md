# HelloGitHub 月刊自荐

**目标平台**：https://hellogithub.com/periodical
**月刊收稿**：每月接受用户自荐项目，每月 28 日截稿
**审核**：编辑部审核，~1 周内反馈
**状态**：📄 草稿 —— 等用户说 `发`

---

## 自荐入口

https://hellogithub.com/periodical → 右上角 "推荐项目"

或走 GitHub issue（`521xueweihan/HelloGitHub` 仓库的 issue tracker）—— 编辑部从 issue 收集候选。

## 推荐项目表单字段

| 字段 | 内容 |
|---|---|
| **项目名称** | feishu-user-plugin |
| **项目地址** | https://github.com/EthanQC/feishu-user-plugin |
| **项目描述（一句话）** | 84 工具的飞书 MCP 服务器，让 Claude Code / Codex 以用户身份发消息 |
| **主要语言** | JavaScript |
| **License** | MIT |
| **作者** | [@EthanQC](https://github.com/EthanQC) |

## 推荐理由（120-300 字）

```
飞书官方开放 API 没有 send_as_user 权限点，机器人 token 发出的消息全部标 sender_type: "app"，在协作场景里 UX 受影响。

feishu-user-plugin 把三层鉴权（cookie + 官方 app token + 用户 OAuth UAT）整合在一个 MCP server 里，让 Claude Code、Codex、Cursor 等 MCP 客户端能以用户身份操作飞书：发消息、读群、操作文档 / 多维表格 / 知识库 / 云空间 / 日历 / 任务 / OKR，84 个工具一站式覆盖。

技术亮点：v1.3.9 起以用户身份发图片；机器级 SSOT 实时事件架构（全机所有 MCP 进程共享 events.jsonl，每条事件全机恰好一次送达）；多账号自动切换（按 chat / 资源归属选 profile，读路径自动 retry，写路径不切防错号）。

MIT 协议，npm 一行命令安装，跑在 Node.js ≥18。Active 维护，v1.3.9 刚 ship。
```

## 为什么适合 HelloGitHub

- 国产开源工具：飞书是国产产品
- AI 编程方向热度：MCP / Claude Code 是 2026 上半年话题热点
- 完整工程实践：3 套客户端兼容、4 级 CI gate

## 提交时机

每月 25 日前提交（28 日截稿，提前几天给编辑部审核）。建议在 v1.3.9 ship 后的当月内提交。

## 入选后操作

- HelloGitHub 月刊会被广泛转发到掘金 / 知乎 / V2EX / 飞书读者群 / WeChat 公众号
- 入选当月监控 GitHub stars 增长曲线，预期 +50-200 stars
- 编辑部如发反馈邮件，**24 小时内回复**，提高下个月再次入选概率
