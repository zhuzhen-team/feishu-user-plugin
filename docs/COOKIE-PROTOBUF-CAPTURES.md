# Cookie Protobuf Wire Format 抓包记录

> **谁该读**：扩展 cookie 协议路径的开发者（少数）—— 例如新增 user-identity 消息类型、扩 `proto/lark.proto` 字段。  
> **何时读**：要做协议反向、看到 user-identity 消息类型缺失字段、Feishu 协议变更时复盘。

活文档 —— 每抓到一种消息类型并解码后追加。

## 抓包方法论

飞书 Web 客户端把出站消息编码成 protobuf 包在 `Packet` wrapper 里，POST 到 `https://internal-api-lark-api.feishu.cn/im/gateway/`。Wire format 在 `proto/lark.proto` 文档化，但多个消息类型仍有未抓到的隐藏元数据字段。扩展 proto：

1. **跑一次抓包会话**（用 Playwright MCP —— agent 驱动 `mcp__plugin_playwright_playwright__*` 工具就是干这个）：
   - `browser_navigate('https://www.feishu.cn/messenger/')`
   - 通过 `browser_evaluate("document.cookie.includes('session=')")` 验证 session
   - 缺失时用 `LARK_COOKIE` env 注入所有 cookies（`browser_run_code` 走 `context.addCookies()`）
   - `browser_click` 在 chat 列表的自己（"我自己"）上
   - IMAGE：`browser_file_upload` 用一个小测试 PNG
   - AUDIO：点录音按钮（需要浏览器允许麦克风权限；headless Playwright 经常拒绝 —— 可能需要手动抓）
   - STICKER：打开 emoji 面板，点一个 sticker，点发送
   - CARD：web UI 可能不暴露 card 编排；从其他路由发的预制 card 抓（如经 `send_message_as_bot` 然后转发到自己 chat 抓 wire format）
   - **关键：发送之前 monkey-patch fetch** 抓 protobuf 载荷：

     ```javascript
     // browser_run_code: 先装 patcher
     const origFetch = window.fetch;
     window.__CAPTURED_GATEWAY_BODY__ = null;
     window.fetch = async (url, opts) => {
       if (typeof url === 'string' && url.includes('/im/gateway/') && opts?.method === 'POST') {
         let bytes;
         const body = opts.body;
         if (body instanceof Uint8Array) bytes = body;
         else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
         else if (body instanceof Blob) bytes = new Uint8Array(await body.arrayBuffer());
         if (bytes) window.__CAPTURED_GATEWAY_BODY__ = btoa(String.fromCharCode(...bytes));
       }
       return origFetch(url, opts);
     };
     ```

   - 然后 UI 发送，再 `browser_evaluate('window.__CAPTURED_GATEWAY_BODY__')`

2. **存原始字节**到 `/tmp/feishu-captures/<type>-N.b64`

3. **解码** `node scripts/decode-feishu-protobuf.js Packet --b64 "$(cat /tmp/feishu-captures/<type>-N.b64)"`。解码器显示已解码字段加上 wire 中找到的 proto 里还没有的未知 tag。把那些字段加到 `proto/lark.proto`

4. **迭代**：重新解码、识别更深层的未知字段（被识别为未知的字节自身可能是嵌套 message 带自己的未知字段）。重复直到解码器报告 `--- All fields known ---`

## IMAGE（cmd=5, type=5）

状态：**v1.3.9 会话 2026-05-08 尝试，因 UI 导航卡住搁置** —— 按用户指示（"先放一下"）暂停。抓包 pipeline 已验证，图片上传触发需要更深调查。

### 已取得的进展

- 通过 `context.addCookies()` 从 LARK_COOKIE env 注入 cookie 工作（从 `~/.claude.json` mcpServers env block 解析出 29 个 cookie，全部 inject 干净）
- `page.addInitScript()` 在页面加载**前**注册 fetch / XHR / WebSocket 抓取 patch 是正确模式（之前 attempt 在页面加载**后**安装 patch，错过了 bootstrap WS 连接）
- init-script + reload 后 **boot 时抓到 2 个 `/im/gateway/` POST**，确认飞书 web 客户端经 HTTP POST（不是 WebSocket）发到我们插件命中的同一个 `internal-api-lark-api.feishu.cn/im/gateway/` 端点

### 阻塞

点击 `飞书plugin测试群` chat 时打开了**Lark Editor "Pin" 面板**作为右侧 pane（无穷的 contenteditable 包在 `editor-kit-container` 和 `code-block-zone-container` 里），**不是**带底部工具栏的标准 chat input。可能原因：

1. `/next/messenger/` URL 走到一个 docs-first 接口；chat input 可能在不同布局里通过 UI tab 选中
2. Chat input contenteditable 可能在 shadow DOM root 里，`document.querySelectorAll('[contenteditable="true"]')` 穿不过
3. 飞书的图片上传可能用 Electron 风格原生文件对话框（经私有 API `window.electronAPI` / `feishuBridge`）完全绕开标准 `<input type="file">`

工具栏按钮（input 行 y≈794 处找到 14 个）点击时**不创建** file input —— 点击它们要么打开 emoji/sticker 面板要么没可观察 DOM 效果。

合成的 `paste` 和 `drop` 事件带含 File 对象的 `DataTransfer` **没**触发上传 —— 飞书的 paste handler 大概要求 user-trusted event flag，Playwright 的合成事件不带。

### 建议下一步

1. **直接用 Chrome DevTools Protocol（CDP）** —— `page.context()._connection.send('Network.enable')` 加订阅 `Network.requestWillBeSentExtraInfo` 会独立于 UI 导航抓 POST body。配合手动用户驱动发送（脚本化 Playwright session 暂停，用户手动导航实际飞书 Desktop app 或另一浏览器 tab，抓包发生在 Playwright tab 通过共享 cookie —— 跨进程不工作）
2. **找到真的 chat input** —— 试 `page.locator('textarea, [role="textbox"]').all()` 而不是 `[contenteditable]`；或从页面顶部按 Tab 后采样渲染后 DOM 找可聚焦 input 候选；或用 `el.shadowRoot` 遍历穿透 shadow DOM
3. **跳过 web 客户端，从飞书 Desktop 客户端抓** —— 启 mitmproxy 或 Charles，配飞书 desktop app 用它，直接抓到 `internal-api-lark-api.feishu.cn/im/gateway/` 的 HTTPS 流量。更干净，因为 desktop 客户端是和我们已有工作 text/file/post wire format 同源的进程
4. **对 protobuf brute-force** —— 鉴于 v1.3.7 已经只用 `Content.imageKey` 编码 IMAGE 拿到 HTTP 400，写一个小 harness 一次试加单个字段（`imageKey` + `width`，再 `+ height`，再 `+ mimeType`，等等）观察 200 vs 400 响应收敛到必需字段集。慢但不需要 web 客户端抓包就能 work

### 抓包 pipeline 产物

抓包 init-script 模板在 `.playwright-mcp/init-script.js`（或从本文档重生）。三个测试 PNG 预生成在 `.playwright-mcp/captures/test-{small,medium,large}.png`（50×50 / 200×150 / 1200×800）。

## AUDIO（cmd=5, type=7）

状态：pending。v1.3.9 scope 按 Spec 2 删除（使用率低）。

## STICKER（cmd=5, type=10）

状态：pending。v1.3.9 scope 按 Spec 2 删除（价值最低）。

## CARD（cmd=5, type=14）

状态：**v1.3.9 会话 2026-05-08 尝试；未启动**。同 IMAGE 阻塞 —— UI 导航到 card 编辑器失败因为右侧 pane 被 Lark Editor / Pin 框架占据。Spec 2 §2.4 文档了三条 fallback 路径（forward 已存在 bot card / web SDK embed / 直接协议注入）。Path iii（brute-force 协议）最有可能不靠 web UI 抓包就成功。

## search_messages

状态：pending。在反向工程之前先 UAT-first 尝试 —— 见 Phase 6（v1.3.10 推迟）。
