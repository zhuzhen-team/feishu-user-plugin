# 飞书开放平台开发者社区 投稿

**目标平台**：https://open.feishu.cn/community（开发者社区 Q&A 区）+ https://www.feishu.cn/community（飞行家 / 内容中心，正式投稿）
**长度**：~600-800 字
**状态**：📄 草稿 —— 等用户说 `发`

---

## 选项 A：开发者社区分享帖

**标题**：

```
[分享] feishu-user-plugin —— 84 工具的飞书 MCP 服务器
```

**正文**：

---

最近开源了一个飞书 MCP 服务器（[feishu-user-plugin](https://github.com/EthanQC/feishu-user-plugin)），把三层鉴权（cookie 协议路径 + 官方 app token + 用户 OAuth UAT）整合在一个 Node.js 进程里，给 Claude Code / Codex / Cursor 等 MCP 客户端用。84 个工具，MIT 协议。

写完上线两个月，分享一下做的过程中遇到的几个值得交流的点：

### 1. 关于消息发送的鉴权层

飞书开放 API 的消息发送目前都走机器人路径（`sender_type: "app"`）。本项目通过 cookie + protobuf 协议路径实现以用户身份发消息（参考了 [@cv-cat](https://github.com/cv-cat) 早期 LarkAgentX 的 web 协议研究工作）。

如果飞书后续在开放 API 提供 user-identity 消息发送的能力，我会切换到官方路径。

### 2. 关于 Wiki API 的 `delete_wiki_node`

飞书 SDK 没有暴露 `DELETE /wiki/v2/spaces/{id}/nodes/{token}` 这个端点的封装，但 API console 里确实存在。我在插件里直接调原始 HTTP 端点，能跑通。这个 endpoint 是否会持续维护？

### 3. 关于实时事件订阅

飞书 WSClient 当前只支持 feishu.cn 域，Lark 国际版（lark.com）连接报错。是否后续会支持？

---

附 GitHub：https://github.com/EthanQC/feishu-user-plugin
（如果以上几个点能讨论清楚，会反馈到 README / docs 里，给其他飞书开发者作参考。）

---

## 选项 B：内容中心正式投稿

**标题**：

```
打造一个 84 工具的飞书 MCP：从 IM 到 OKR，用 Claude Code 全自动化
```

**写作要点**：

- 不重提竞品 `lark-openapi-mcp` / `cso1z/Feishu-MCP`（**飞书自家产品 + 推过的合作项目**，硬怼会被官方流量打压）
- 定位为"补全 user-identity 消息路径 + 把全套 API 整合进一个 MCP"
- 突出实战场景（参照掘金主稿 3 个场景，但加一段"如何与 lark-openapi-mcp 协作使用"作为软化措辞）
- 展示飞书开放 API 的强大（这是飞书官方乐意看到的角度，会拿到推荐）
- 长度 4000-5000 字（飞书内容中心 sweet spot）

**审核周期**：飞书内容中心审核 1-2 周

**SEO 收益**：发布后 SEO 权重高于个人博客，对 "飞书 MCP" / "飞书 自动化" 相关搜索有显著加权
