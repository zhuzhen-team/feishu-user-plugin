搜索飞书联系人或群组。

## 参数
- $ARGUMENTS: 搜索关键词

## 执行步骤
1. 使用 `search_contacts` 搜索 $ARGUMENTS
2. 将结果按类型分组展示：
   - 用户（user）：显示名称和 ID
   - 群组（group）：显示群名和 ID
   - 机器人（bot）：显示名称和 ID
3. 提示用户可用的后续操作：
   - `/send 用户名: 消息` 发送消息
   - `/reply 群名` 读取群聊并回复
   - `/digest 群名` 整理聊天摘要

## 通过邮箱或手机号查找
邮箱、手机号、姓名都可以作为 `query` 直接传给 `search_contacts`，不需要单独的工具：
```
search_contacts({ query: "xxx@xxx.com" })
search_contacts({ query: "+86xxx" })
```
