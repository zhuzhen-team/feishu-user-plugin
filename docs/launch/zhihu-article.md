# 知乎主稿（专栏角度）

**目标平台**：zhihu.com
**载体**：建立专栏 `飞书 × AI Agent 实战`，文章作为专栏首篇
**长度目标**：2500+ 字
**与掘金主稿的差异度**：≥30% rewrite（避免重复内容降权）
**状态**：📄 Draft —— 等用户 `发`

---

## 标题

**两个月做了一个飞书 MCP 插件，让 Claude Code 用我本人身份发消息（84 工具实战）**

> 比掘金标题更"个人叙事"。知乎读者吃这套——他们更愿意点开"作者本人在做什么"而不是"产品介绍"。

## 正文

---

# 两个月做了一个飞书 MCP 插件，让 Claude Code 用我本人身份发消息（84 工具实战）

写在前面：本文是 [feishu-user-plugin](https://github.com/EthanQC/feishu-user-plugin) v1.3.9 的发版速记。项目开源 MIT，目的是把飞书的三层鉴权（cookie 反向工程、官方 app token、用户 OAuth UAT）融在一个 MCP server 里，让 Claude Code、Codex、Cursor 等 MCP 客户端能"以你本人身份操作飞书"，不再露出"机器人头像"。

## 起因

2026 年 3 月某一天，我让 Claude Code 帮我做飞书自动化——读群消息、写日报、发出去。技术上能跑，但有个让我没法接受的现象：消息发出来都是"由 [应用名] 发送"。

我换了个 prompt 试图让它"用我的身份发"，Claude 很诚实地回复：飞书官方开放 API 没有 `send_as_user` 权限点，机器人就是机器人。

那一刻我想起前几年 [@cv-cat](https://github.com/cv-cat) 的 LarkAgentX 项目，用 cookie + 反向工程飞书 web 协议实现过用户身份发消息。Python 写的，已经几年没维护。

于是开始自己重写：把 cv-cat 的反向工程思路移植到 Node.js MCP server，加上飞书官方开放 API 的全套覆盖（文档/多维表格/知识库/云空间/日历/任务/OKR），再加上用户 OAuth UAT 用于 P2P 私聊读取。

两个月做下来，84 个工具，跑了 v1.3.0 → v1.3.9 一共 14 个版本。

## 为什么三层鉴权都需要

很多人会问：直接用 cookie 不就行了吗？或者为什么不只用官方 API？

每一层都有它的不可替代性：

**Cookie 层（用户身份）** —— 唯一能让消息显示为"你本人发送"的路径。飞书后端识别消息发送者是看 cookie 里的 `session` / `sl_session`，不是看 token。所以把这俩 cookie 喂给消息接口，飞书就认你是真人。代价：cookie 12 小时过期，需要心跳维持；协议是反向工程的，飞书改了就可能挂掉。

**官方 API 层（机器人 token）** —— 文档、多维表格、知识库、云空间、日历、任务、OKR、群管理这些**只能**走官方 API。cookie 协议覆盖不到这些（飞书 web 客户端走的是不同接口栈）。代价：必须是机器人身份，发出来的消息有机器人头像。

**用户 OAuth UAT** —— 介于两者之间。读 P2P 私聊只能用 UAT（因为 P2P 不是机器人能访问的）；创建文档/Bitable/日历等资源时用 UAT 可以让"owner = 你"而不是"owner = 共享机器人"。

三层都需要，理由是它们能力**互相不重叠**。

## v1.3.9 几个真正解决的问题

### 1. cookie 通道发图片这件事

之前一直没做出来。文本消息的 protobuf payload 我们摸清了，但图片消息的 payload 比文本多十几个字段，挨个试组合太慢。

v1.3.9 写了一个**暴力探测脚本**：每次发一条最小 payload，逐字段加进去看哪个组合能通过飞书后端的字段校验。脚本在 `scripts/explore-image-minimize.js`。

发现：图片消息只需要 `imageKey` + `thumbnailKey` 两个字段就能通过（`thumbnailKey` 默认等于 `imageKey` 也行），`width` / `height` / `mime` / `size` 飞书后端会自动派生。

同样的方法试 CARD（卡片）消息，结果**所有组合都被拒**——cookie 通道发卡片是飞书服务端关闭的。所以 v1.3.9 把 `send_card_as_user` 重构成纯机器人通道（带 ⚠ 提示），cookie 通道代码全删。

### 2. 多 MCP 进程的 UAT race condition

最早期的 bug 是这样的：用户同时开着 Claude Code + Codex，每个进程都跑一个 MCP server 实例，UAT 过期时这俩进程**并发请求 refresh token**——飞书后端只接受第一个，剩下的用旧 refresh token 请求会被**直接拉黑**整个 refresh token 链。

用户表现：每隔 7 天就要 `npx feishu-user-plugin oauth` 重新授权一次，没人受得了。

修复（v1.3.5）：跨进程文件锁 `~/.claude/feishu-uat-refresh.lock` (O_CREAT|O_EXCL, 30s stale) + 锁持有者进入临界区前**重读一次持久化 config** —— 如果发现已有 peer 写入了新 token，**直接采用 peer 的，不再发新 refresh 请求**。

副效果：v1.3.7 顺势把这个机制泛化为机器级 SSOT 架构，到 v1.3.9 演化成**实时事件**也用同一套（机器上单进程持 WS owner 锁，写入到共享 `events.jsonl`，所有 MCP 进程从同一个 cursor 读）。每条飞书消息事件**全机恰好一次**送达。

### 3. 多账号自动切换

v1.3.8 加的能力。我自己有 2 个飞书账号（公司 + 个人项目），机器人也是 2 套 app credentials。之前每次切都要改 `.env`，重启 MCP，烦。

现在 `~/.feishu-user-plugin/credentials.json` 支持 profiles map，工具调用按 chat / 资源归属**自动选** profile —— 比如 chat 在 A 公司就用 A profile 的 cookie，资源 owner 是 B 个人就用 B 的 UAT。读路径失败码 `91403 / 1254301 / 1254000 / 99991672 / HTTP 403` 时自动跨 profile retry，写路径**永远不切**（避免错号创建资源）。

## 用起来怎么说

```bash
npx feishu-user-plugin setup --app-id <YOUR_APP_ID> --app-secret <YOUR_APP_SECRET>
npx feishu-user-plugin oauth
# 重启 Claude Code / Codex
```

然后在 Claude Code 里说人话：

> 我：把"研发组"群周一 14:00 之后的讨论提炼成会议纪要，存成飞书文档放到我们 Wiki 的"会议纪要 / 2026-Q2"目录下
>
> Claude：[调用 read_messages → 思考分类 → search_wiki 拿父节点 → create_doc 带 wiki_space_id 直接落 Wiki → manage_doc_block 写正文]
>
> ✓ 已创建 https://xxx.feishu.cn/docx/abc123（你是 owner，可直接编辑）

整个过程 60 秒。

更多场景（群消息日报、OKR 进展批量录入、多维表格批量更新等）见 [掘金主稿](https://juejin.cn/...) 详细拆解。

## 工程上几个值得讲的判断

**为什么不上 GitHub Pages 之外的官网？** 单页 SEO landing 已经覆盖飞书 MCP / Feishu MCP / Lark MCP / Claude Code 飞书 这几个关键词，多余的 docs site 维护成本高于价值。

**为什么坚持 Chinese-first README？** 飞书 95% 用户在中国 dev 圈，英文 README 是发现障碍。v1.3.9 已经把 README 主版本从英文翻成中文，英文降为 `README.en.md`。

**为什么删了 send_card_as_user 的 user-identity 路径？** v1.3.9 暴力探测确认服务端关闭。保留无效代码 = 维护负担 + 误导用户。删干净。

**为什么 OKR 本体不做 CRUD？** 飞书侧 OKR 开放 API 不开放完整 CRUD，只暴露读 + 进展记录写。本体 create/update/delete 永远不会有，所以"运营 OKR"够用，"建立 OKR" 这件事插件做不到。

## 链接

- GitHub: https://github.com/EthanQC/feishu-user-plugin（欢迎 star / issue / PR）
- npm: https://www.npmjs.com/package/feishu-user-plugin
- 官网: https://ethanqc.github.io/feishu-user-plugin/
- CHANGELOG: https://github.com/EthanQC/feishu-user-plugin/blob/main/CHANGELOG.md

## 合规边界

本项目仅用于个人与企业内部用途，不是商业 SaaS 产品。Cookie + protobuf 反向工程层未经飞书官方背书，请遵守飞书《开发者服务协议》和你所在企业的 IT 政策。官方 API 层使用飞书公开开放 API。

公开商业部署 / 多租户 SaaS 场景请自行评估法律合规风险。

## 后记：开源动力

写这玩意之前我从没想过开源能让我有持续动力。第一个外部 issue 来的那天我刷新了页面三次确认不是自己的小号。

如果你也在做飞书 + Claude Code 的自动化，欢迎一起：[issues](https://github.com/EthanQC/feishu-user-plugin/issues) / [discussions](https://github.com/EthanQC/feishu-user-plugin/discussions)。

下一篇文章会专门写 cookie + protobuf 反向工程的具体方法（暴力探测脚本是怎么跑的、哪些字段是 fingerprint、飞书后端的字段校验长什么样）。先定个专栏跟踪：[飞书 × AI Agent 实战](#)。

---

**专栏建议**：建一个新专栏 `飞书 × AI Agent 实战`，本文作为首篇。后续把 v1.3.7（multi-domain consolidation）、v1.3.8（multi-profile）的发版笔记也搬进来，每篇互链。一篇文章可以同时进 2 个专栏 —— 也建议挂到 `Claude Code 实战`（如果你有的话）。

**发布后操作**：
- 想法（短动态）发版公告：链接专栏 + 一句"v1.3.9 ship 了，84 工具，三层鉴权"
- 在已有高赞问题下回答（5+ 篇 / 见 zhihu-questions-to-answer.md），引流到专栏
- 一周后看专栏关注 / 文章阅读 / 收藏比，判断是否需要二次推
