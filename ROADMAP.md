# feishu-user-plugin Roadmap

> 本文件只记**未来**计划。已发布版本的逐项变更见 [CHANGELOG.md](./CHANGELOG.md)。
>
> 战略定位：聚焦官方做不到 / 做不好的差异化（cookie + protobuf 用户身份路径 + 文档生态 + 实时事件 SSOT + 多 profile 自动切换 + MCP 协议原生）。明确**不再扩展**与官方重叠的业务系统域（mail / approval / attendance / hr / minutes 等）。详见 [docs/COMPARISON.md](./docs/COMPARISON.md)。

## v1.3.16+ 待办

- PR #110（uncaughtException 加固 + zombie 进程清理，外部贡献）：已 request changes（`ps comm` 匹配不到进程、SIGKILL 误杀 WS-owner 风险、重入计数不可达、index.js 边界契约、缺测试），等贡献者按建议拆分后再合 util.inspect 加固部分

v1.3.16 发现类读路径 UAT-first（list_files / search_docs / search_wiki / get_wiki_node + 分页游标 + protobufjs 8 / lark-sdk 1.66 依赖升级）已 ship — 见 [CHANGELOG.md v1.3.16 entry](./CHANGELOG.md)。前序版本 v1.3.14 / v1.3.15 见同 CHANGELOG。

## 已调研但暂不实施

### OKR 本体 CRUD
- 飞书侧 OKR 开放 API 不开放完整 CRUD（只暴露读 + 进展记录写）
- v1.3.7 已实现可补的部分（progress record 三件套），本体 create/update/delete 永远不会有

### Windsurf MCP Marketplace
- 无公开第三方提交渠道（仅官方 partnership 邀请）
- 靠 Official MCP Registry 同步覆盖即可

### OpenClaw plugin 形态
- `larksuite/openclaw-lark` 是飞书官方 OpenClaw 插件（2.16k stars 活跃维护，今天还在更新）
- OpenClaw 主仓 371k stars，是字节亲生 AI Agent 框架
- 第三方做 OpenClaw 飞书插件直接跟官方 openclaw-lark 竞争且无差异化优势
- 详见 [docs/COMPARISON.md](./docs/COMPARISON.md)

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
- ~~md ↔ 飞书 wiki 双向无损同步~~（v1.3.4 起多次推迟，v1.3.12 决定不做）
- ~~Mermaid / PlantUML → 飞书画板~~（依赖 md ↔ wiki 主线，主线删后一并删）
