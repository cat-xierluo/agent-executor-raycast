# 决策记录 (Decisions)

记录本项目的重要技术决策与工作摘要。

## 2026-07-28 — 搜索栏支持 URL 输入（解绑必选文件）

### 背景

`commands` 命令一直依赖从 Finder / DEVONthink / VS Code 自动加载选中文件作为技能输入。
常见场景下用户拿到一个网页 PDF、远程 DOCX、DEVONthink 引用链接时，无法在没有 Finder 选中文件的情况下触发技能 —— 必须先去 Finder 拽一个文件，违背直觉。

### 决策

让搜索栏同时承担「附加留言」和「URL 输入」两职：URL 前缀自动识别，余下文本作为备注。

实现要点：

1. 新增 `src/utils/urlDetector.ts`：
   - `parseNoteInput(note)` → `{ url, note }`
   - 识别前缀：`http://` `https://` `file://` `x-devonthink-item://`
   - URL 内部不允许空格（避免吞掉后续备注）

2. `commands.tsx` 改造：
   - `executeSkill` / `executeFreeCommand` 起始处调用 `parseNoteInput` 拆分 URL 与备注
   - 当 `needsFile` 且既无文件又无 URL 时报「未选择文件」toast，提示改为「……或在搜索栏输入 URL」
   - prompt 构造：`/` + 技能名 + (文件 + URL 一起作为引号参数) + 剩余备注
   - URL 与 `selectedFiles` 并行：可同时作为多参数传给技能

3. UI 同步：
   - 搜索栏 placeholder 提示 URL 前缀
   - ListItem subtitle / Action 标题在识别到 URL 时显示「将对 URL 执行」或「将对 N 个文件 + URL 执行」
   - 每个技能旁的 accessory 展示 URL 缩略预览

### 备选方案

- **新增独立「URL 输入」表单命令**：与 `import-skill` 一致，但增加跳转次数，体验割裂。舍弃。
- **URL 原样下载到本地后传给文件路径**：增加 IO 复杂度和缓存管理，结果对绝大多数技能（txt/md/网页摘要）无差别。保留 URL 原样传递，依赖技能自身决定如何处理（curl/wget/Read 等）。
- **强制要求 URL 单独存在于搜索栏**：URL 与备注必须分两次输入，体验差。允许 `URL 备注` 合并输入。

### 兼容性

- 不破坏现有文件选择流程；URL 输入是叠加能力。
- DEVONthink item URL 已自动支持（不需要先在 DEVONthink 中选中）。
- 已选文件 + URL 共存时两者都作为参数，传给技能 prompt。

### 验证

- `npm run typescript` 通过
- `npm run lint` 仅遗留预先存在的 `package.json` author 404 警告（与本次改动无关）
