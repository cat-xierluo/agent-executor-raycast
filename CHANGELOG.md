# 更新日志 (Changelog)

所有重要的变更都会记录在此文件中。

## [Unreleased]

### 新增 (Added)

- **Hermes Profile 动态选择器**：新增「选择 Hermes Profile」命令（select-profile），动态扫描 `~/.hermes/profiles/` 列出所有 profile（含 description 与 skill 数），回车即切换；LocalStorage 持久化，后续新增 bot（新建 profile 目录）自动出现在列表中，无需改代码。
  - 主界面 ActionPanel 新增「Hermes Profile：当前值」指示（`Cmd+Shift+P` 跳转选择器）；当前选中的 profile 显示 ✓。
  - `commands.tsx` 组件层新增 `activeProfileHome` 状态：异步读 LocalStorage 后**覆盖 textfield 偏好**，7 处执行/扫描路径统一生效；清空选择即回主 Hermes。
  - 未选择任何 profile 时默认主 Hermes（`~/.hermes/`），行为与 PR #4 一致。
- **Hermes 后端适配（无头模式）**：执行后端新增 Hermes Agent CLI，与 Claude Code / CodeBuddy 并列，可在偏好或 UI 中三方切换（`Cmd+Shift+B` 轮换）。
  - 新增 Raycast 偏好「Hermes CLI 可执行文件路径」（`hermesBin`，textfield，默认 `~/.local/bin/hermes`）；`backend` dropdown 增加 `Hermes` 选项。
  - `src/utils/claude.ts` 新增 `buildHermesArgs()` 与 `parseHermesOutput()`：Hermes 走 `chat -q <query> --oneshot -Q --pass-session-id --in <workDir>` 参数体系（与 Claude 的 `--print --output-format stream-json` 完全不同）；输出为纯文本，`session_id:` 行位置不稳定（带 `--in` 时在末尾，否则在开头），解析器做全量位置无关匹配并从正文剔除该行；成败判定用 exitCode（Hermes 无 `is_error` 字段）。
  - **技能内容直嵌 query（绕开目录错配）**：Hermes 与 Claude Code 的技能目录布局不同（Hermes 为 `.hermes/skills/<分类>/<技能>/`，深一层；且 `-s` 只认 Hermes 自身索引，Raycast 扫到的技能传入会 `Unknown skill` 实测报错）。因此 Hermes 后端不传 `/skill-name` slash 前缀，改为把 SKILL.md 全文读出嵌入 query（`skillContent` 字段），语义对齐 Claude Code 的 Skill 工具注入。
  - **技能扫描按后端分流**：`scanSkills()` 新增 `backend` 参数——Hermes 后端扫项目 `.hermes/skills` + `.agents/skills` 及用户级 `~/.hermes/skills/<分类>/`（逐分类展开）；Claude 后端维持 `.claude/skills` 不变。`isValidProjectDir()` 同时接受三种布局。
  - `taskQueue.ts` 的 `QueuedTask` 增加 `skillFile`/`hermesBin`，排队回放时按需读取 SKILL.md 嵌入；`raycast-env.d.ts` 同步偏好类型。
- **Hermes profile 切换（隔离岛操作）**：新增 Raycast 偏好「Hermes profile」（`hermesProfile`，textfield，默认空 = 主 profile）。填了名（如 `info-assistant`）则一切换到 `~/.hermes/profiles/<name>/` 下的 skills/、state/、sessions/，互不污染；profile 路径必须存在才生效（不存在时静默回退主 profile）。
  - `getProjectEnv(projectDir, hermesHome?)`：若传入 `hermesHome`，通过 spawn 的 `env` 字段注入到 Hermes 子进程的 `HERMES_HOME`（**不污染父进程 shell 环境变量**——hermes_cli/AGENTS.md 明文规定 "never hardcode `~/.hermes`"，profile 隔离岛 by design）。
  - `scanSkills(projectDirs, skillsDirs, backend, hermesProfileHome?)`：profile 模式下扫 `~/.hermes/profiles/<name>/skills/<分类>/<技能>/`（隔离岛），不再扫主 `~/.hermes/skills/`。路径不存在或解析失败回退到主 skills。
  - `executeClaudeCommand` / `executeClaudeStreaming` / 队列执行器 / enqueue（两条路径共 7 个调用点）全部透传 `hermesProfileHome`。
  - **端到端实测**：`HERMES_HOME=~/.hermes/profiles/info-assistant hermes chat -q ...` spawn 出来的子进程正常加载 profile 的 `zai/glm-5.3` + `GLM_API_KEY`，返回完整 session_id + 正文（exit 0），证明 profile 路径切换、env 注入、skill 索引三处都对。

### 改进 (Improved)

- **CodeBuddy 后端适配（无头模式）**：执行后端不再局限于 Claude Code，可在 Raycast 偏好中切换默认后端，也可在插件 UI 中临时切换为 CodeBuddy CLI。
  - 新增 Raycast 偏好「执行后端」（`backend`，dropdown，默认 `claude`）与「CodeBuddy CLI 可执行文件路径」（`codebuddyBin`，textfield，默认 `~/.local/bin/codebuddy`）。
  - **UI 内执行后端切换**：`commands.tsx` 新增 `selectedBackend` 状态（默认取全局偏好），列表级、自由指令、每个技能的 ActionPanel 均提供「执行后端：Claude Code / CodeBuddy」切换按钮（快捷键 `Cmd+Shift+B`），执行时以当前选中后端为准，无需进设置页。
  - `src/utils/claude.ts` 新增 `AgentBackend` 类型、`resolveBackendBin()` 与 `codebuddyBin`/`backend` 配置项；`executeClaudeCommand` / `executeClaudeStreaming` 按后端路由到对应二进制（两者 CLI 标志与 `--output-format json`/`stream-json` 输出结构兼容）。
  - 适配 CodeBuddy 的 `--output-format json` 返回**数组**（末尾为 `result` 对象）的差异：解析时统一从对象/数组中提取 `session_id`、`is_error`、`result`；流式模式改为直接从 `result` 行读取 `is_error`，替换原先对 fullOutput 的正则匹配。
  - `taskQueue.ts` 的 `QueuedTask` 与 `commands.tsx` 的直接执行/排队两条路径均透传 `backend`/`codebuddyBin`。
  - Skill 调用沿用 `/<skill.name>` 前缀，CodeBuddy 同样支持 `/skill-name` 手动触发项目级 `.codebuddy/skills/` 下的技能。
- **无头模式系统级前置指令注入**：后台（无头）启动 Agent 时通过 Claude CLI 的 `--append-system-prompt` 注入一段系统级前置指令，解决此前 Agent 频繁回头向用户提问/要求确认（如 OCR 敏感材料外传授权）的问题。
  - 新增 Raycast 偏好「无头模式前置指令」（`headlessPreamble`，textarea，可选）：用户可在设置中整体覆盖；留空使用内置默认。
  - `src/utils/claude.ts` 新增 `DEFAULT_HEADLESS_PREAMBLE` 常量与 `resolveHeadlessPreamble()`，在流式（`-p`）与无头 print（`--print`）两个 spawn 点条件追加 `--append-system-prompt`；非无头的终端窗口路径不注入（用户在场可正常交互）。因在 `claude.ts` 内部读取偏好，直接执行与排队执行两条路径自动覆盖。
  - 内置默认指令：声明无头模式用户不在线、不提问/不征求确认；**任何需外传的已配置后端/服务默认视为已授权**（不限于 PaddleOCR/MinerU，含其他联网 API），仅当用户留言明确要求保密/本地时才改纯本地；优先级高于 skill 正文中「先询问/等待确认」的说明；命名产出按 `YYMMDD 原名.扩展名` 写入输入文件目录。
  - 已验证 `--append-system-prompt` 被接受且系统级指令可覆盖其他指令。
- **commandMetadata 泛型化**：`applyMetadataToCommands` 和 `applyMetadataToSkills` 函数改为泛型签名，保留调用者的具体类型信息。
- **pdf-processor skill**：新增 pdf-processor 技能到 `.claude/skills/`。
- **tingwu-asr 自动 watcher**：`--async` 提交后自动 fork `watch_active.sh`（15s 高频轮询 + 状态日志 + macOS 完成通知），不再依赖用户手动启动 `poll_tasks.py --monitor`。
- **搜索栏直接输入 URL（解绑文件）**：主界面搜索栏现在自动识别 URL 前缀（`http://` `https://` `file://` `x-devonthink-item://`），识别后跳过必选文件检查，把 URL 与选中文件一起作为参数传给技能 prompt。
  - 新增 `src/utils/urlDetector.ts`：`parseNoteInput()` 解析搜索栏，`isUrlOrPath()` 判定是否 URL 输入。
  - `commands.tsx` 的 `executeSkill` / `executeFreeCommand` 同步接入 URL 解析；URL 之后的文本作为额外备注。
  - 顶部 placeholder、ListItem subtitle、Action 标题提示同步更新，反映 URL 模式。
- **外部 URL 自动回填搜索栏**：`commands` 命令接入 `LaunchProps`，从 `fallbackText`（Raycast Selected Text 机制，浏览器选中 URL 后按热键）或 `arguments.url`（Quicklink / Universal Action 参数）预填搜索栏。`package.json` 中 `commands` 命令新增 `url` 文本参数。
- **getSelectedText 主动捕获前台选中文本**：作为 fallbackText 之外的最佳努力补底，组件 mount 时调用 `getSelectedText()`。仅在搜索栏仍为空时回填，避免覆盖用户输入；promise reject 静默忽略。

### 修复 (Fixed)

- **Hotkey/Quicklink/Universal Action 触发命令时被 Raycast 强制弹出「Welcome to Agent Executor — Before you can start using this command, you will need to add a few things to the settings」拦截页，每次都要按 ⌘↩ 才能进主界面**：根因不是偏好缺失（`projectDir1` 已正常配置），而是 `package.json` 中 `preferences.headlessPreamble.type` 误写为 `"textarea"` —— Raycast manifest schema 合法的 preference `type` 仅 `textfield` / `password` / `dropdown` / `checkbox` / `appPicker` / `file` / `directory`（官方 docs/information/manifest.md），`textarea` 不在枚举内。schema 校验失败后 Raycast 把整个 manifest 判为 invalid，每次启动 `commands` 命令都会回落到系统 Welcome 拦截页。本地 `ray lint` 此前一直在报的 `144:14 must be equal to one of the allowed values` 警告就是这个根因的直白提示。修复：`type: "textarea" → "textfield"`，description 同步说明「Raycast preference 无 textarea 类型，长文本可粘贴进 textfield」。验证：本地 `npm run lint` 在切换后不再报 `144:14 allowed values`；实际生效需 `ray develop` 重读 manifest 后用 Hotkey 触发一次。
- **无头执行结果/会话捕获丢失（stdout 为空 + 进程变僵尸导致任务卡死，Claude 与 CodeBuddy 均存在）**：非流式路径原本用 `--output-format json`，该格式会把最终结果**缓冲到最后一次性写入 stdout**，进程异常退出/未回收时 stdout 为空，导致结果文本和 `session_id` 全部丢失，`executeClaudeCommand` 的 promise 永久挂起，任务在 UI 里一直显示「执行中」、日志停在 `executing`，事后靠状态页 `pid_detection` 兜底恢复成 `failed`（8/12、8/13 的 `/pdf-processor` 任务即此现象）。修复：
  - `src/utils/claude.ts` 的 `executeClaudeCommand`：**Claude 与 CodeBuddy 统一改用 `--output-format stream-json --verbose`** 逐行输出（实测两者均稳定吐最终 `result` 行，含 `result`/`is_error`/`session_id`；Claude 的 stream-json 要求带 `--verbose`）。
  - 新增 `parsePrintOutput()` 统一解析三种格式（Claude 单对象 / CodeBuddy json 数组 / stream-json 行），取最后一个 `result` 行。
  - 新增 30 分钟超时兜底（`execTimeoutTimer`）：进程长时间不退出/close 不触发时强制 `SIGKILL` 并返回超时错误，避免任务永远停在「执行中」；正常完成时 `clearTimeout`。`executeClaudeCommand` 与 `executeClaudeStreaming` 两条路径均覆盖。
- **技能列表出现重复 id 报错（`Found list item with duplicated ids`）**：当同一项目目录被重复配置（或从多个来源扫描到同一 skill 目录）时，`scanSkills` 会返回 `skillDir` 相同的多个条目，导致 Raycast `List` 的 `id` 冲突直接抛 API Exception。修复：
  - `src/utils/claude.ts` 的 `loadConfig()` 对展开 `~` 后的项目目录做 `Set` 去重，避免同一目录被配置多次时重复扫描。
  - `src/utils/skills.ts` 的 `scanSkills()` 在收集完所有 skill 后按 `skillDir` 去重，作为兜底防止任何来源的重复条目。
- **DEVONthink 多文件选择导出失败**：在 DEVONthink 中选中 ≥2 个文件触发技能时报「导出文件失败: Command failed: osascript ...」。根因为三处缺陷叠加：
  - **多记录分隔符（主因）**：`getSelectedDevonThinkRecords` 用 `resultList as string` 返回多条记录，假设分隔符为 `", "`，但 AppleScript 默认 `text item delimiters` 为空串，多记录会**粘连**。JS 端 `.split(", ")` 只得到 1 条字段错位的记录，使本有文件系统路径的记录被误判为 `x-devonthink-item://` URL，误触发 export 分支（单文件不受影响，故长期未暴露）。
  - **export AppleScript 语法**：`get record at id "..."` 编译报 `-2741`；正确写法为 `get record with uuid "..."`，且取 `uuid of theRecord`（字符串）而非数字 `id`。
  - **export 参数**：`export theRecord to file thePath` 漏掉命名参数 `record`，报「参数丢失」；依 sdef 签名应为 `export record <rec> to "<POSIX 目录>"`，命令返回实际导出路径（同名时自动加序号）。
  - 附带修复 shell 单引号转义：`replace(/'/g, "\\'")` 在 shell 单引号串内无效，改为正确的 `'\''`，使含单引号的 AppleScript（如 `AppleScript's text item delimiters`）能正确传递；export 失败时一并透出 osascript 完整 stderr，便于后续诊断。

### 优化 (Improved)

- **TypeScript 类型安全**：为 logs-viewer、status、logger 添加 `JsonLogEvent`/`JsonLogEntry` 接口，替换 `any` 为具体类型；移除未使用的导入和变量。
- **tingwu-asr 单任务查询**：`poll_tasks.py` 新增 `--once` 和 `--task-id <id>` 参数，新 session 续做时一句命令即可查询单任务状态；`watch_active.sh` 跨 session 持久化状态日志。

## [0.9.1] - 2026-05-20

### 修复 (Fixed)

- **Raycast 命令入口图标不显示**：为三个命令入口补充 `icon` 配置，并将项目内已设计的 `terminal.png` 同步到 Raycast 会读取的 `assets/terminal.png`。
- **类型检查失败**：修复 `Action.SubmitForm`、`List.Section`、`getPreferenceValues` 的 API 使用问题，`npm run typescript` 现已通过。
- **Lint 配置缺失**：补充 ESLint 9 使用的 `eslint.config.js`，避免 Raycast lint 找不到配置文件。
- **命令执行转义问题**：后台和流式执行改为直接传递参数给 Claude CLI，避免附加留言中的引号、反引号、美元符号等破坏 shell 命令。
- **运行状态误判**：修复状态恢复逻辑把工作目录当作目标文件检测的问题，降低已结束任务被误判为成功的风险。
- **取消执行失效**：执行开始后立即记录真实 PID，使”取消执行”可以终止正在运行的任务。

### 优化 (Improved)

- **运行 ID 唯一性**：Run ID 增加毫秒和随机片段，避免同一秒内并发任务写入同一个日志分组。
- **默认 Skills 目录**：`~/.claude/skills/` 偏好设置现在会参与技能扫描，并兼容符号链接和小写 `skill.md`。

## [0.9.0] - 2026-05-04

### 新增 (Added)

- **Skill 导入支持 URL 和本地路径**：导入表单新增地址栏，支持直接输入地址导入 Skill
  - 本地路径（如 `~/skills/my-skill`）：直接创建符号链接到目标项目
  - GitHub 仓库链接（如 `https://github.com/user/repo`）：自动 clone 仓库后创建符号链接
  - 支持 GitHub 子路径链接（如 `https://github.com/user/repo/tree/main/.claude/skills/my-skill`）
  - 文件选择器作为备选方式保留，地址栏输入优先

- **独立「导入 Skill」命令**：新增独立的 Raycast 命令入口
  - 可直接从 Raycast 命令面板访问「导入 Skill」
  - 不再仅限于 Agent Executor 页面内部进入

### 变更 (Changed)

- **移除 Agent Executor 页面中的导入入口**：导入 Skill 不再作为 Agent Executor 列表的一个选项，统一通过独立命令访问

## [0.8.0] - 2026-05-01

### 新增 (Added)

- **任务队列与并发控制**：支持配置最大并发数（1/3/5/10/15，默认 5），超出部分自动排队等待
  - 新增 `src/utils/taskQueue.ts` 队列模块，基于文件持久化，窗口关闭后队列不丢失
  - 任务完成后自动调度队列中的下一个任务
  - 技能列表显示队列位置（"队列 #N"），支持取消排队
  - 状态页面新增"排队中"分区
  - 通过 Raycast 偏好设置配置最大并发数

### 修复 (Fixed)

- **移除 CLI 执行的 5 分钟超时限制**：部分 skill（如法律文书分析）执行时间较长，超时会误杀正常进程。改为依赖进程自然退出来判断任务完成

### 优化 (Improved)

- **性能优化**：`devonthink.ts` execSync 改为 execAsync 避免阻塞事件循环；`skills.ts` 添加 10 秒缓存；`countRunningCommands()` 添加 5 秒缓存

## [0.5.1] - 2026-04-09

### 修复 (Fixed)

- **SessionEnd hook 失败**：修复 `notify.cjs` 因 `/usr/bin/env node` 找不到 node 而执行失败的问题
  - MyAgents 环境下 node 不在系统默认 PATH 中，改用 `node` 直接调用即可
  - 修复前：hook 失败导致 agent-executor 无法收到任务完成通知，需等待超时（~400秒）
  - 修复后：SessionEnd hook 正常触发，任务完成信号及时传递

## [0.5.0] - 2026-04-05

- **移除 Commands 支持，统一为 Skills**：扩展不再扫描 `.claude/commands/` 目录，只使用 `.claude/skills/` 目录
  - 删除 `src/utils/commands.ts`（命令扫描、@include 解析等逻辑）
  - `commands.tsx` 移除 `executeCommand()` 函数，统一使用 `executeSkill()`
  - `isValidProjectDir()` 改为检查 `.claude/skills/` 而非 `.claude/commands/`
  - 移除 `ClaudeCommand` 类型和 `ExecutorItem` 联合类型，列表直接使用 `ClaudeSkill[]`
  - UI 移除 Command/Skill 类型标签区分（都是 Skill）
  - 空状态提示更新为"请在 .claude/skills/ 目录中添加技能"
- **保留兼容层**：特定名称的 Skill 仍享有特殊处理
  - `deepresearch`：不需要文件选择即可执行
  - `sync-external`：执行前弹出确认对话框
  - 通过 `SKILLS_NO_FILE_REQUIRED` 和 `SKILLS_REQUIRE_CONFIRM` 常量配置
- **移除**：`src/utils/commands.ts`：命令扫描、@include 解析、`ClaudeCommand` 接口等全部移除
  - `scanCommands()`、`readCommandContent()`、`readFileWithIncludes()` 函数
  - `toggleCommandPinned()`、`toggleCommandNew()` 调用（UI 统一使用 Skill 版本）

## [0.4.0] - 2026-04-04

### 新增 (Added)

- **流式输出模式**：实时显示 Claude 的执行输出
  - 新增 `executeClaudeStreaming()` 函数，使用 `--output-format stream-json` 获取实时 JSON 流
  - 通过 `onChunk` 回调逐步更新 UI，用户无需等待命令完成即可看到输出
  - 支持提取 `session_id`，可用于后续恢复对话
  - 流式输出视图支持 `Cmd+W` 关闭和清空操作
  - Commands 和 Skills 均支持流式输出

- **流式输出组件**：新增 `StreamingOutput.tsx` 组件
  - 使用 Raycast `Detail` 组件渲染 markdown 格式的流式内容
  - 显示执行状态（执行中/已完成）
  - 自动适配 Raycast 环境，不依赖浏览器 DOM API

- **流式输出配置项**：新增 `streamingMode` 偏好设置
  - 在 Raycast 扩展设置中可开启/关闭（默认关闭）
  - 仅在 headless 模式下生效
  - 开启后执行完成不自动关闭窗口，方便查看完整输出

### 修复 (Fixed)

- **`readdirSync` 未导入**：修复 `isValidSkillsDir()` 因缺少 `fs.readdirSync` 导入导致运行时崩溃
- **`config` 作用域错误**：修复 `executeCommand()` 的 `finally` 块中 `config` 未定义导致的编译错误
- **Detail metadata 类型错误**：移除不支持的 `metadata={{ items: [...] }}` 写法
- **Icon.X 不存在**：替换为 Raycast API 支持的 `Icon.Xmark`
- **Action.Style.Destructive 类型错误**：替换为 `Alert.ActionStyle.Destructive` 并添加 `Alert` 导入
- **StatusRefreshContext cleanup 返回值**：修复 `useEffect` cleanup 函数返回 boolean 的类型错误
- **RunInfo 缺少 workDir**：为 `RunInfo` 接口添加 `workDir` 字段
- **DevonThink type 类型不兼容**：添加 `"file" | "directory"` 类型断言

### 安全 (Security)

- **Terminal 模式 prompt 注入修复**：使用 base64 编码传递 prompt，避免 shell 特殊字符导致的命令注入风险

### 变更 (Changed)

- **流式 JSON 行缓冲**：改进 JSON 流解析，使用 `lineBuffer` 防止 TCP 分包导致 JSON 对象被截断，进程结束时自动处理缓冲区残余数据

## [0.3.0] - 2026-01-22

### 新增 (Added)

- **Skills 支持**：扩展现在支持读取和执行 Claude Code Skills
  - 新增 `src/utils/skills.ts` 模块，实现技能扫描和执行功能
  - 支持扫描 `.claude/skills/` 目录中的技能子目录
  - 每个技能目录需包含 `skill.md` 或 `SKILL.md` 定义文件
  - 自动识别符号链接技能目录，正确处理链接指向的技能文件
  - 技能调用语法：`/skill-name`，与命令语法保持一致
  - 技能与命令合并显示在同一列表中，通过类型标签区分（Command / Skill）
  - 支持技能元数据管理（置顶、新标记等），与命令使用相同的存储机制
  - 技能显示链接图标标识，方便识别符号链接来源

- **统一的执行列表**：Commands 和 Skills 在同一个界面展示
  - 列表项第一个 accessories 显示项目类型（Command 硬盘图标 / Skill 星星图标）
  - 符号链接技能额外显示"链接"标签
  - 统一的排序逻辑：置顶 > 新标记 > 字母顺序
  - 统一的执行函数 `executeItem()`，根据类型自动选择执行方式

- **扩展命令元数据接口**：`CommandMetadata` 接口添加 `type` 字段
  - 区分命令（command）和技能（skill）类型
  - 技能元数据使用 `skill:` 前缀存储，避免与命令名称冲突

- **新增元数据管理函数**：
  - `applyMetadataToSkills()` - 应用元数据到技能列表
  - `toggleSkillPinned()` - 切换技能置顶状态
  - `toggleSkillNew()` - 切换技能新标记状态

### 修复 (Fixed)

- **符号链接目录扫描问题**：修复无法识别符号链接技能目录的问题
  - `readdirSync` 返回的符号链接 `isDirectory()` 返回 `false`，导致符号链接被跳过
  - 修改扫描逻辑同时检查 `isDirectory()` 和 `isSymbolicLink()`
  - 现在能正确扫描和显示符号链接形式的技能

- **图标兼容性**：修复使用不存在图标导致的构建错误
  - 移除不存在的图标引用（如 `Icon.Gear`, `Icon.Download`, `Icon.Terminal` 等）
  - 更新为 Raycast API 实际支持的图标集合

### 变更 (Changed)

- **列表标题**：从"可用命令"更改为"可用项目"，反映包含 Commands 和 Skills
- **空状态提示**：更新为"未找到命令或技能"

## [0.2.0] - 2026-01-11

### 新增 (Added)

- **命令图标多样性优化**：提升命令列表的视觉识别度
  - 扩展图标库从 10 个到 70+ 个不同的图标选项
  - 实现双层匹配机制：
    - **关键词语义匹配**：根据命令名称智能匹配合适的图标（如 "search" → MagnifyingGlass、"code" → Code）
    - **哈希随机绑定**：对于无关键词匹配的命令，使用哈希算法确保同一命令始终获得相同图标，同时保证不同命令的图标多样性
  - 添加 50+ 个关键词映射规则，覆盖常见命令类型
  - 显著降低了命令列表中图标的重复率，提升视觉识别度

### 修复 (Fixed)

- **工作目录问题**：修复命令执行时的工作目录问题
  - 命令现在在其所属的项目目录中执行，确保能正确读取命令依赖（如 `@include` 文件）
  - 修复前所有命令都在第一个配置的项目目录中执行，导致某些命令无法找到其依赖文件
  - 扩展 `CommandMetadata` 接口，添加 `projectDir` 字段记录命令所属项目目录
  - 创建 `findCommandProjectDir()` 辅助函数，动态查找命令所属的项目目录
  - 修改 `commands.tsx` 使用 `command.projectDir` 而非硬编码的 `config.projectDirs[0]`

- **动态命令系统**：删除硬编码的单个命令文件
  - 删除 `preprocess.tsx`, `proposal.tsx`, `search.tsx`, `router.tsx` 四个硬编码命令文件
  - 所有命令现在完全通过 `commands.tsx` 动态读取和执行
  - 统一了命令执行方式，提升了系统的一致性和可维护性

- **命令界面优化**：去除命令描述中的冗余信息
  - 去除命令描述中的项目名称括号（例如："2word-完整的Markdown到Word转换功能(SuitAgent)" 中的 "(SuitAgent)"）
  - 因为右侧 accessories 已经显示项目来源，描述中的括号内容显得冗余
  - 界面更简洁，信息展示更清晰

- **多项目命令扫描**：扩展命令扫描功能
  - `getAvailableCommands()` 函数现在支持多项目扫描
  - 返回的命令元数据包含 `projectDir` 字段
  - 命令扫描时自动记录每个命令所属的项目目录

### 重命名 (Renamed)

- **扩展重命名为 "Agent Executor"**：
  - 扩展名称从 "AutoWeave" 更改为 "Agent Executor"
  - 内部包名从 `autoweave` 更改为 `agent-executor`
  - 描述更新为"执行 Claude Code 技能和命令的通用工具"
  - 所有接口和变量名从 `AutoWeave*` 重命名为 `Agent*` 或 `project*`
  - 偏好设置字段从 `autoweaveDir*` 重命名为 `projectDir*`
  - 移除硬编码的默认项目目录，要求用户在首次使用时配置
  - 现在可以作为通用工具分发，适用于任何包含 `.claude/commands/` 的项目

### 新增 (Added)

- **多项目目录支持**：
  - 支持配置最多 5 个项目目录，统一展示所有项目的命令
  - 每个命令显示其来源项目，方便区分和管理
  - 自动提取项目名称（从目录路径）
  - 验证所有配置的目录是否有效

- **配置系统**：添加 Raycast preferences 配置页面
  - 支持用户自定义项目目录（解决硬编码路径问题）
  - 支持自定义 Claude CLI 可执行文件路径
  - 添加目录验证功能，确保配置的目录包含 `.claude/commands/`
  - 为扩展分发做好准备

- **快捷配置入口**：在命令列表中按 `Cmd + ,` 直接打开扩展设置

- **工作目录验证**：命令执行前验证配置的项目目录是否有效

- **Worktree 支持**：通过配置页面支持 Git Worktree 开发工作流

- **友好的配置错误提示**：当配置无效时，显示清晰的错误信息和修复建议

- **命令管理功能**：
  - **置顶命令**：可在命令文件中使用 `pinned: true` 置顶常用命令
  - **标记新命令**：可在命令文件中使用 `new: true` 标记新功能
  - 智能排序：置顶命令 > 新命令 > 普通命令（按字母顺序）
  - 视觉标识：📌 表示置顶，✨ 表示新命令，右侧显示标签

- **DEVONthink 集成**：扩展现在支持直接从 DEVONthink 中选中文件进行处理
  - 自动检测并获取 DEVONthink 中选中的记录
  - **优先从 DEVONthink 获取文件**，如果没有则回退到 Finder
  - 显示文件来源（DEVONthink 或 Finder）
  - 新增 `getSelectedDevonThinkRecords()` 和 `checkDevonThinkAvailable()` 工具函数

- **文件详情显示**：
  - 在列表顶部显示当前选中文件的详细信息
  - 显示文件类型、修改时间
  - 支持在多个选中文件之间切换（`Cmd + T`）
  - 新增 `getDirectoryContents()` 和 `generateFileDetailMarkdown()` 工具函数
  - 新增 `formatFileSize()` 格式化文件大小显示

### 变更 (Changed)

- **UI 布局优化**：
  - 将文件详情区域提升到列表最顶部
  - 分离"当前选中文件"和"其他选中的文件"区域
  - 命令列表显示当前操作的文件名
  - 简化文件详情显示，移除文件夹内容统计（避免信息过载）

- **检测逻辑优化**：优先检查 DEVONthink 中的选中文件，然后再检查 Finder

- **热重载支持**：
  - 切换文件时自动刷新选中文件列表
  - 修复选中状态更新问题
  - 减少重复的 Toast 提示

- 更新错误提示，支持提示用户从 DEVONthink 或 Finder 选择文件

- 新增快捷键：
  - `Cmd + Shift + R`：重新加载选中的文件
  - `Cmd + T`：切换到其他选中的文件

- 为选中的文件添加视觉标识（✓ 图标）

### 文档 (Documentation)

- 新增 [COMMAND_MANAGEMENT.md](docs/COMMAND_MANAGEMENT.md) 命令管理使用说明
- 新增 [DEVONTHINK_INTEGRATION.md](docs/DEVONTHINK_INTEGRATION.md) 使用说明
- 新增测试脚本 `scripts/test-devonthink.scpt` 用于测试 DEVONthink 集成

## [0.1.0] - 2026-01-10

### 新增 (Added)
- 初始版本的 AutoWeave Raycast 扩展
- 支持从 Finder 中选中文件进行处理
- 实现动态命令列表显示
- 支持所有 AutoWeave legal workflow 命令：
  - legal-router (智能路由)
  - legal-preprocess (文件预处理)
  - legal-proposal (方案生成)
  - legal-search (法律检索)
  - legal-analyze (案件分析)
  - deepresearch (深度研究)
  - sync-external (同步外部文件)
- 运行日志系统
- 命令执行状态跟踪和错误处理

---

## 格式说明

变更类型：
- **新增 (Added)**：新功能
- **变更 (Changed)**：现有功能的变更
- **弃用 (Deprecated)**：即将移除的功能
- **移除 (Removed)**：已移除的功能
- **修复 (Fixed)**：bug 修复
- **安全 (Security)**：安全相关的修复或改进
