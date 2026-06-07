操作飞书云文档：搜索、读取或创建。

## 参数
- $ARGUMENTS：操作类型 + 文档标识或内容

## 执行步骤

### 搜索文档
1. 用 `search_docs` 搜索关键词
2. 展示文档列表（标题、文档 ID）

### 读取文档
1. 用 `read_doc` 读取文档内容（传入 document_id）
2. 展示内容摘要

### 创建文档
1. 用 `create_doc` 创建新文档（传入标题和可选 folder_id）
2. 返回文档 ID

### 在文档里建表格
1. 用 `manage_doc_block(action=create, document_id, parent_block_id, table={...})` 建表
   - `parent_block_id` 用 `document_id` 表示文档根（或某个块 ID 表示插在该块下）
   - `table` 形如 `{"rows":2,"columns":2,"cells":[["姓名","角色"],["Ann","PM"]]}`：`cells` 行优先，可省略或留空字符串表示空格
   - 插件内部建 `block_type=31` 表格、由飞书自动生成单元格（`block_type=32`）、逐格填内容——**不要自己用 `children` 拼 table block 或猜 block_type**（表格是 31 不是 40，猜错会报 `invalid_param`）
2. 返回 `tableBlockId` + 行优先的 `cells` 单元格 ID 网格
3. 若个别单元格填充失败（瞬态错误已自动重试），返回里会带 `failedCells:[{row,col,cellId,textBlockId?,reason}]`（row/col 0 起算）——逐格用 `manage_doc_block(action=update, block_id=<textBlockId>)` 补内容即可，**不必删表重建**

### 写决策树等纯文本结构
表格只用于真正的二维数据；决策树、流程、缩进结构用 `children` 里的文本块（`block_type=2`）+ 代码块（`block_type=14`）表达即可，不依赖表格线。

## 示例
- `/doc search MCP 协议`
- `/doc read doxcnXXXXXX`
- `/doc create 本周工作总结`
- `/doc 在 doxcnXXXX 里建一个 2×2 表格，表头 姓名/角色`

## 注意
- 文档操作使用 Official API（需要 LARK_APP_ID）
- 搜索结果受机器人权限范围限制
- 建表格走 `manage_doc_block` 的 `table` 模式，不要手拼 block——表格 `block_type=31`、单元格 `32`
- `manage_doc_block(action=update)` 的 `update_text_elements` 是**整段替换**（非 patch / append）：漏传的 element（加粗前缀、链接等）会永久丢失，改局部先 `get_doc_blocks` 读出原 elements、改完整组传回
- 读大文档：`get_doc_blocks` / `read_doc_markdown` 自动分页拉全量，`hasMore:false` 才代表拿到了完整块树
