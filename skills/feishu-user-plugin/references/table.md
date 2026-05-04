操作飞书多维表格（Bitable）。

## 参数
- $ARGUMENTS：操作类型 + 表格标识

## 执行步骤

### 查询数据
1. 用 `manage_bitable_table(action=list, app_token=...)` 获取表格列表
2. 用 `manage_bitable_field(action=list, app_token=..., table_id=...)` 获取字段结构
3. 用 `manage_bitable_record(action=search, app_token=..., table_id=..., filter?, sort?)` 查询记录
4. 格式化展示查询结果

### 写入数据
1. 先用 `manage_bitable_field(action=list)` 确认字段结构
2. 用 `manage_bitable_record(action=create, records=[{fields:{...}}])` 创建记录（可批量，最多 500/次）
   ```
   manage_bitable_record({
     action: 'create',
     app_token,
     table_id,
     records: [{ fields: {"状态":"进行中","标题":"新任务"} }]
   })
   ```

### 更新数据
1. 先用 `manage_bitable_record(action=search)` 定位目标记录的 record_id
2. 用 `manage_bitable_record(action=update, records=[{record_id, fields:{...}}])` 更新

### 删除数据
- 用 `manage_bitable_record(action=delete, record_ids=[...])`（可批量）

## 示例
- `/table query appXxx` — 列出所有表格
- `/table query appXxx tblXxx` — 查询表格记录
- `/table create appXxx tblXxx {"状态":"进行中"}` — 创建记录

## 注意
- 需要知道 app_token（从多维表格 URL 中获取，或调 `manage_bitable_app(action=create)` 新建）
- 字段名必须与表格中的字段名完全匹配
- 字段创建/修改 (`manage_bitable_field`) 都必须传 `type`，即使只改 field_name
