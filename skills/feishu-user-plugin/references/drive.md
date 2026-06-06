管理飞书云盘文件和文件夹。

## 参数
- $ARGUMENTS：操作类型 + 文件夹标识

## 执行步骤

### 列出文件
1. 用 `list_files` 列出文件夹内容
   - 不传 folder_token 则列出根目录（配置了 UAT 时是**你的**"我的空间"根目录）
   - 传入 folder_token 则列出指定文件夹
   - 结果多时用 `page_token`（来自上一页的 `nextPageToken`）翻页

### 创建文件夹
1. 用 `create_folder` 创建新文件夹
   - 传入 name 和可选的 parent_token

### 删除 / 移动 / 复制文件
1. 用 `list_files` 找到目标的 token
2. 用 `manage_drive_file` 操作（action=delete/move/copy，必传 type）

## 示例
- `/drive list` — 列出根目录文件
- `/drive list folderXxx` — 列出指定文件夹
- `/drive create 项目资料` — 在根目录创建文件夹
- `/drive 删掉根目录里的 xxx.pdf` — list_files 找 token 后 manage_drive_file 删除

## 注意
- 使用 Official API，需要 LARK_APP_ID
- `list_files` UAT-first（v1.3.16+）：配置了 UAT 就以你的身份列文件（个人空间可见）；否则以 bot 身份，只能看到共享给 bot 的文件夹。返回的 `viaUser` 标明视角归属
