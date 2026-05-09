# Launch Materials

v1.3.10 Growth track 的全部 launch 草稿与提交模板。**没有任何文件会自动外发** —— 中文社区 / 国际平台的内容都需要你审完说"发"再上线。

## 目录结构

```
docs/launch/
├── zh/              # 中文社区 / 平台（用中文写）
│   ├── juejin.md            掘金主稿（实战流程角度，3500-5000 字）
│   ├── zhihu-column.md      知乎专栏文章（与掘金 ≥30% 重写）
│   ├── zhihu-answers.md     知乎答题目标清单 + 模板
│   ├── v2ex.md              V2EX 自荐贴（短，周五上午发）
│   ├── feishu-community.md  飞书开放平台开发者社区 投稿
│   ├── hellogithub.md       HelloGitHub 月刊自荐
│   └── ruanyifeng-weekly.md 阮一峰科技爱好者周刊 issue 自荐
├── en/              # International platforms (English)
│   └── x-thread.md          X (Twitter) 4-tweet long thread
└── submissions/     # MCP discovery channel submission templates
    ├── awesome-mcp-servers.md   punkpeye/awesome-mcp-servers PR 收录材料
    ├── mcp-registry.md          Official MCP Registry 提交记录（v1.3.10 已 publish）
    ├── anthropic-directory.md   Anthropic Connectors Directory（v1.4 推迟，阻塞清单）
    └── cursor-marketplace.md    Cursor Marketplace（v1.4 推迟，阻塞清单）
```

## 已完成的（v1.3.10 这次 ship 的部分）

| 渠道 | 状态 |
|---|---|
| Official MCP Registry | ✅ active, isLatest, v1.3.10 |
| HelloGitHub 月刊自荐 issue #3254 | ✅ 已提交（`521xueweihan/HelloGitHub`） |
| 阮一峰 weekly 自荐 issue #9888 | ✅ 已提交（`ruanyf/weekly`） |
| Glama listing 提交 | ✅ 已提交，bot label `has-glama` 已识别（Docker introspection 处理中）|
| punkpeye/awesome-mcp-servers PR #6090 | ✅ Ready for review，含 Glama badge |
| GitHub repo Social preview | ✅ 上传 docs/og.png |

## 等你 dispatch 的（按建议顺序）

### 中文（cost 由低到高）

| 渠道 | 文件 | 建议时机 |
|---|---|---|
| V2EX | `zh/v2ex.md` | 周五上午 9-11 点北京时间 |
| 知乎想法 + 专栏 | `zh/zhihu-column.md` + `zh/zhihu-answers.md` | 想法 = 当天发版公告；专栏 + 答题 = 一周内分批 |
| 掘金 | `zh/juejin.md` | 任意工作日上午（"AI 编程"频道） |
| 飞书开放平台社区 | `zh/feishu-community.md` | 选项 A 即时发；选项 B 内容中心审核 1-2 周 |

### 国际

| 渠道 | 文件 | 备注 |
|---|---|---|
| X (Twitter) | `en/x-thread.md` | 4 推 thread，主帖发后 5-10 分钟再 reply tag `@alexalbert__` `@AI_Jasonyu` |

## 推迟到 v1.4

| 渠道 | 阻塞 | 文件 |
|---|---|---|
| Anthropic Connectors Directory | 缺 `.mcpb` 打包 + Privacy Policy + manifest.json | `submissions/anthropic-directory.md` |
| Cursor Marketplace | 缺 `.cursor-plugin/plugin.json` manifest | `submissions/cursor-marketplace.md` |

## 差异化锚点（所有内容统一口径）

**基于 cookie + protobuf 协议路径，支持以用户本人身份发消息——飞书官方开放 API 没有 `send_as_user` 权限点，机器人 token 发出的消息一律标 `sender_type: "app"`。**

竞品（**不要**在文章里点名挑战，只是知道存在）：
- `larksuite/lark-openapi-mcp`（飞书官方维护）
- `cso1z/Feishu-MCP`（文档方向）
- `ztxtxwd/feishu-mcp-server`
- `qingpingwang/remote-claude-code` + `chenhg5/cc-connect`（Bridge 路线）
