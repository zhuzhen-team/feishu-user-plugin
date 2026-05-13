# feishu-user-plugin Roadmap

> 本文件只记**未来**计划。已发布版本的逐项变更见 [CHANGELOG.md](./CHANGELOG.md)。
>
> 战略定位：聚焦官方做不到 / 做不好的差异化（cookie + protobuf 用户身份路径 + 文档生态 + 实时事件 SSOT + 多 profile 自动切换）。明确**不再扩展**与官方重叠的业务系统域（mail / approval / attendance / hr / minutes 等）。详见 [docs/COMPARISON.md](./docs/COMPARISON.md)。

## v1.3.12 待办

### 主线

- [ ] **C. 本地 md → 飞书知识库同步**（v1.3.4 起多次推迟；v1.3.12 主角）
  - md parser 选型（remark / markdown-it / unified）
  - `src/doc-blocks.js` 补齐 heading / bullet / ordered / code / quote / divider / table / todo / callout 构造器
  - wikilink `[[page]]` 解析：按 md 文件名 / 标题 / 用户自定义 mapping 三级策略
  - 图片内联：md `![alt](./img.png)` → `uploadMedia(parent_type='docx_image')` + `image_path` 快捷
  - 文件附件 inline：md `[xxx.pdf](./xxx.pdf)` → `file_path` 快捷
  - CLI 子命令 `sync-md <path>` vs MCP 工具 `sync_markdown_to_wiki` 取舍
  - 增量 diff：已存在 wiki 节点的更新策略（全量覆盖 / 按 block_id 精细 diff）

### Protobuf 阶段二

- [ ] **B.5 `search_messages`** —— 先试 UAT `/open-apis/im/v1/messages/search`，飞书未暴露则反向 cookie 路径

### 工程质量（不指望社群 PR，自己做）

- [ ] **CHANGELOG 回填 v1.3.0 - v1.3.5**：从 `git log v1.3.0...v1.3.5` + 对应 commit message 重写每版 entry，参考 v1.3.6+ 已有的 `### Added / Changed / Fixed` 风格。原 issue #61。
- [ ] **`read_doc_markdown` 测试覆盖**：加到 `scripts/test-all-tools.js`，准备一个含 image / file 块的 fixture docx 测占位符产出。原 issue #63。
- [ ] **客户端兼容性测试**：在 Cursor / Windsurf / OpenClaw 各跑 `/send` `/status` 两条 prompt，写测试报告。原 issue #64。
- [ ] **markdown link checker CI gate**：30 行 Node 脚本扫所有 .md，检查 `](path.md)` 指向文件存在 + anchor 存在；接进 `validate.yml`，防 cross-link 漂移。
- [ ] **依赖审计**：dependabot stale PR 处理（#80/#81/#82/#83）

### 战略性微调（受 docs/COMPARISON.md 启发）

- [ ] **`via` 参数全工具一致化**：当前 `read_messages` / `read_p2p_messages` 有 `via: bot|user|contacts`；写工具有 `via_profile`。考虑统一所有 user-identity 工具暴露 `via_user: true` 切换显式 cookie / UAT 路径（参考 lark-cli `--as user / --as bot`）
- [ ] **工具调用结果 JSON schema 一致化**：所有 send 工具返回 `{ok, viaUser, fallbackWarning?, messageId?}` 统一形状

## 已调研但暂不实施

### OKR 本体 CRUD
- 飞书侧 OKR 开放 API 不开放完整 CRUD（只暴露读 + 进展记录写）
- v1.3.7 已实现可补的部分（progress record 三件套），本体 create/update/delete 永远不会有

### Windsurf MCP Marketplace
- 无公开第三方提交渠道（仅官方 partnership 邀请）
- 靠 Official MCP Registry 同步覆盖即可

### 业务系统域（明确不做）

为聚焦差异化，本仓**不**扩展以下域。需要这些功能请用 [`@larksuiteoapi/lark-mcp`](https://github.com/larksuite/lark-openapi-mcp) 或 [`@larksuite/cli`](https://github.com/larksuite/cli)：

- 邮件（mail）
- 审批（approval）
- 考勤（attendance）
- HR / 招聘（corehr / hire）
- 会议录制 / 纪要（vc / minutes）
- 智能门禁（acs）
- 翻译 / OCR / 语音转文字（translation / ocr / speech-to-text）
- 应用市场 / 百科 / 智能门户（application / baike / workplace）

### 已删除（不会做）

- ~~`send_audio_as_user`~~（用户 2026-05-07 决定删除：使用频率低，反向工程成本不值）
- ~~`send_sticker_as_user`~~（用户 2026-05-07 决定删除：价值最低，且需先调研飞书 sticker pack API）
- ~~测试群解散 `oc_daaa6a50f2a97dc668aaf79ae4dc6e4e`~~（用户已不在该群，搁置）
- ~~CLI 化业务工具~~（v1.3.12 评估：官方 [`@larksuite/cli`](https://github.com/larksuite/cli) 已做且更成熟；本仓 CLI 仅保留运维表面）

## 上架提交（仓库已具备所有材料于 v1.3.11，等用户人肉表单提交）

- [ ] **Anthropic Connectors Directory 提交**：v1.3.11 ship 了 `PRIVACY.md` + `.mcpb/manifest.json` + `scripts/build-mcpb.js`。剩下的：`node scripts/build-mcpb.js` 产出 `.mcpb` → 在 https://clau.de/desktop-extention-submission 上传。详见 `docs/launch/submissions/anthropic-directory.md`
- [ ] **Cursor Marketplace 提交**：v1.3.11 ship 了 `.cursor-plugin/plugin.json`。剩下的：去 https://cursor.com/marketplace/publish 提交仓库 URL。详见 `docs/launch/submissions/cursor-marketplace.md`
