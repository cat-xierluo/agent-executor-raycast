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

## 2026-07-29 — 主动捕获前台选中文本（getSelectedText fallback）

### 背景

`fallbackText` 只在用户使用「Selected Text」机制时才能拿到。普通 Extension Hotkey（用户实际使用的快捷键）不会传入任何上下文。

`getSelectedFinderItems()` 是个特殊 API，不管 Finder 是否是前台都能读到选中文件；但 `getSelectedText()` 只读**当前**前台应用。Raycast 按下热键后会立刻抢焦点，所以理论上 `getSelectedText()` 大概率读不到浏览器文本。

但加一层 best-effort fallback 仍有意义：
- 部分用户的浏览器扩展可能在热键按下后保留「选中文本上下文」一小段时间
- 部分场景（按下热键时机较慢、或浏览器把焦点让出时序差异）能拿到

### 决策

在 `commands.tsx` 组件 mount 时调用 `getSelectedText()`，搜索栏仍为空时回填。

实现要点：

1. 通过 `loadSelectedTextRef` 在 mount 时调用，避免在 `useState` 初始化时引入 async
2. 用 functional `setNote` 判断搜索栏是否仍为空：用户已经输入则不覆盖
3. `getSelectedText()` 失败时（无选中文本或应用不支持）静默忽略
4. 不轮询：文本选择是一次性事件，不应周期性覆盖

### 优先级

```
fallbackText       (Selected Text 热键)
   ↓
arguments.url      (Quicklink / Universal Action)
   ↓
getSelectedText()  (mount 时前台仍持有选中文本)
   ↓
""                 (用户手动输入)
```

### 已知限制

- 普通热键按下后 Raycast 抢焦点，前台切换为 Raycast，浏览器文本读不到的概率较高
- 此时仍然只能依赖：
  1. 用户改用「Selected Text」热键
  2. 或手动在搜索栏输入 URL
  3. 或用剪贴板 fallback（暂未实现）

### 验证

- `npm run typescript` 通过
- `npm run lint` 仅遗留预先存在的 `package.json` author 404 警告（与本次改动无关）

## 2026-07-28 — 外部 URL 自动回填（LaunchProps 接入）

### 背景

当用户用快捷键触发 `commands` 命令时：
- 从 Finder 选中文件触发 → `getSelectedFinderItems()` 自动加载文件路径
- 从浏览器选中 URL 触发 → URL 既不写入搜索栏，也不被识别

不对称导致用户用网页 URL 走快捷键时反而比直接输入还麻烦。

### 决策

让 `commands` 命令接收 `LaunchProps`，从外部来源预填搜索栏。

实现要点：

1. `src/commands.tsx`：
   - `function CommandList(props: LaunchProps<{ arguments: CommandArguments }>)`
   - 预填优先级：`props.fallbackText` > `props.arguments.url` > `""`
   - `useState<string>(initialNote)` 初始化 `note`，保留用户后续编辑权

2. `package.json`：
   - `commands` 命令增加 `arguments: [{ name: "url", type: "text" }]`，让 Quicklink / Universal Action 可以传 URL 参数

### 三种 URL 来源

| 来源 | 触发方式 | 传递字段 |
|---|---|---|
| 浏览器 Selected Text | 选中 URL 后按 Raycast 热键 | `fallbackText` |
| Quicklink | Quicklink 触发命令并传参 | `arguments.url` |
| 直接输入 | Raycast 打开命令后键盘输入 | 搜索栏手动输入 |

### 兼容性

- `fallbackText` 为 `undefined` 时降级到 `arguments.url`，再降级到空字符串。
- `useState` 初值仅在首次渲染时生效，用户在搜索栏中编辑后不会被 LaunchProps 覆盖。

### 验证

- `npm run typescript` 通过
- `npm run lint` 仅遗留预先存在的 `package.json` author 404 警告（与本次改动无关）
