# 飞书开放平台开发者社区 软帖

**目标平台**：https://open.feishu.cn/community（开发者后台 Q&A 区）+ https://www.feishu.cn/community（飞行家 / 内容中心，正式投稿）
**姿态**：求技术反馈 > 直接 promotion（社区接受第三方工具但不喜欢硬推）
**长度**：~600-800 字
**状态**：📄 Draft —— 等用户 `发`

---

## 选项 A：开发者社区 Q&A 帖（先发这个）

**标题**：

```
[请教] 基于飞书开放 API 做的 user-identity MCP，请教鉴权 & 合规建议
```

**正文**：

---

各位飞书开发者朋友，最近开源了一个飞书 MCP server（[feishu-user-plugin](https://github.com/EthanQC/feishu-user-plugin)），把三层鉴权融在一个 Node.js 进程里给 Claude Code / Codex 等 AI 客户端用。84 个工具，MIT 协议。

写完上线两个月，发现一些技术 / 合规上想请教的点，希望开放平台的工程师 / 资深开发者帮看一下：

### 1. 关于 `send_as_user` 路径

飞书官方开放 API 目前**没有 `send_as_user` 权限点**：哪怕拿到 `user_access_token`，发出来的消息也是 `sender_type: "app"`。我目前用的方案是 cookie + protobuf 反向工程飞书 web 客户端的内部协议（参考 [@cv-cat](https://github.com/cv-cat) 的 LarkAgentX 早期工作）。

请教：

- 飞书未来有没有计划开放官方的 user-identity 消息发送权限？（比如让 OAuth UAT 能 sender_type: "user"）
- 当前 cookie 反向工程方案对企业内部 IT 合规有没有特别需要避免的边界？（我已在 README 加了"个人与企业内部用途，非商业 SaaS"的 ToS 段）

### 2. 关于 Wiki API 的 `delete_wiki_node`

飞书 Wiki 开放 API 的 SDK 没有 `DELETE /wiki/v2/spaces/{id}/nodes/{token}` 这个端点的封装，但 API console 里**确实存在**这个接口。我在插件里直接调了原始 HTTP，能跑通。

请教：

- 这个 endpoint 是否会持续维护？还是说 SDK 里没暴露代表官方未来会移除？
- 删除 wiki 节点后，底层 drive 资源是否需要单独删？（我目前的实现是只删 wiki 节点指针，drive 资源保留，因为有时用户希望保留底文件）

### 3. 关于实时事件订阅

飞书 WSClient 当前似乎只支持 feishu.cn 域，Lark 国际版（lark.com）连接报错。

请教：是否后续会支持 Lark 国际版？或者有 workaround？

---

附 GitHub：https://github.com/EthanQC/feishu-user-plugin
（如果上面这几个问题能讨论清楚，我会反馈到我的 README / docs 里，让其他开发者少踩坑。谢谢！）

---

## 选项 B：内容中心正式投稿（一周后再发）

**标题**：

```
打造一个 84 工具的飞书 MCP：从 IM 到 OKR，用 Claude Code 全自动化
```

**写作要点**：

- 不重提竞品 lark-openapi-mcp / cso1z/Feishu-MCP（**飞书自家产品 + 推过的合作项目，硬怼会被官方流量打压**）
- 定位为"补全官方没覆盖的 user-identity 路径 + 把全套 API 整合进一个 MCP"
- 突出实战场景（参照掘金主稿 3 个场景，但加一段"如何与 lark-openapi-mcp 协作使用"作为软化措辞）
- 展示飞书开放 API 的强大（这是飞书官方乐意看到的角度，会拿到推荐）
- 长度 4000-5000 字（飞书内容中心 sweet spot）

**审核周期**：飞书内容中心审核 1-2 周

**SEO 收益**：发布后 SEO 权重高于个人博客，对 "飞书 MCP" / "飞书 自动化" 相关搜索有显著加权

---

## 注意事项

- 在选项 A 中**绝对不要**踩 lark-openapi-mcp（飞书官方维护）—— 即使技术对比也措辞中性
- 选项 A 求教姿态比直接介绍产品转化率高 3-5 倍（我观察过几个第三方工具的发帖）
- 选项 B 投稿后如果飞书工程师评论 / 反馈技术问题，**积极回复 + 修改文章**，建立持续可见度
