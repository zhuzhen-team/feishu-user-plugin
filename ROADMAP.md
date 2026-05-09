# feishu-user-plugin Roadmap

> 本文件只记**未来**计划。已发布版本的逐项变更见 [CHANGELOG.md](./CHANGELOG.md)。

## v1.3.12 待办

### 主线

- [ ] **C. 本地 md → 飞书知识库同步**（v1.3.4 / 1.3.6 / 1.3.7 / 1.3.8 / 1.3.9 / 1.3.10 / 1.3.11 持续推迟；v1.3.12 主角）
  - md parser 选型（remark / markdown-it / unified）
  - `src/doc-blocks.js` 补齐 heading / bullet / ordered / code / quote / divider / table / todo / callout 构造器
  - wikilink `[[page]]` 解析：按 md 文件名 / 标题 / 用户自定义 mapping 三级策略
  - 图片内联：md `![alt](./img.png)` → `uploadMedia(parent_type='docx_image')` + `image_path` 快捷
  - 文件附件 inline：md `[xxx.pdf](./xxx.pdf)` → `file_path` 快捷
  - CLI 子命令 `sync-md <path>` vs MCP 工具 `sync_markdown_to_wiki` 取舍
  - 增量 diff：已存在 wiki 节点的更新策略（全量覆盖 / 按 block_id 精细 diff）

### Protobuf 阶段二

- [ ] **B.5 `search_messages`** — 先试 UAT `/open-apis/im/v1/messages/search`，不暴露则尝试 cookie 路径

### 工程债务

- [ ] **E. `src/config/` 目录化拆分**（条件触发：等 config.js 真长大或多 harness 配置规则差异变多再做。届时拆 `discovery.js` / `persistence.js` / `setup.js`）
- [ ] **G. OpenClaw 偏好文件**

### 上架提交（仓库已具备所有材料于 v1.3.11，等用户人肉表单提交）

- [ ] **Anthropic Connectors Directory 提交**：v1.3.11 ship 了 `PRIVACY.md` + `.mcpb/manifest.json` + `scripts/build-mcpb.js`。剩下的：`node scripts/build-mcpb.js` 产出 `.mcpb` → 在 https://clau.de/desktop-extention-submission 上传。详见 `docs/launch/submissions/anthropic-directory.md`
- [ ] **Cursor Marketplace 提交**：v1.3.11 ship 了 `.cursor-plugin/plugin.json`。剩下的：去 https://cursor.com/marketplace/publish 提交仓库 URL。详见 `docs/launch/submissions/cursor-marketplace.md`

## 已调研但暂不实施

### OKR 本体 CRUD
- 飞书侧 OKR 开放 API 不开放完整 CRUD（只暴露读 + 进展记录写）
- v1.3.7 已实现可补的部分（progress record 三件套），本体 create/update/delete 永远不会有

### Windsurf MCP Marketplace
- 无公开第三方提交渠道（仅官方 partnership 邀请）
- 靠 Official MCP Registry 同步覆盖即可

### 已删除（不会做）

- ~~`send_audio_as_user`~~（用户 2026-05-07 决定删除：使用频率低，反向工程成本不值）
- ~~`send_sticker_as_user`~~（用户 2026-05-07 决定删除：价值最低，且需先调研飞书 sticker pack API）
- ~~测试群解散 `oc_daaa6a50f2a97dc668aaf79ae4dc6e4e`~~（用户已不在该群，搁置）
