搜索和管理飞书知识库。

## 参数
- $ARGUMENTS：操作类型 + 关键词或节点标识

## 执行步骤

### 列出空间
1. 用 `list_wiki_spaces` 列出所有可访问的知识库空间

### 搜索内容
1. 用 `search_wiki` 搜索知识库内容
2. 找到节点后可用 `read_doc` 读取其文档内容

### 浏览节点
1. 用 `list_wiki_nodes` 列出指定空间的节点树（每页 50 个；`hasMore:true` 时把返回的 `pageToken` 传回 `page_token` 翻页）
2. 可传 `parent_node_token` 浏览子节点

## 示例
- `/wiki list` — 列出所有知识库空间
- `/wiki search MCP 协议` — 搜索知识库
- `/wiki browse spaceXxx` — 浏览空间节点树

## 注意
- 使用 Official API，需要 LARK_APP_ID
- 搜索结果受机器人权限范围限制
