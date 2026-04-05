# Agent Executor 详细使用指南

本文档提供 Agent Executor Raycast 扩展的详细说明和高级功能介绍。

## 目录

- [动态命令系统](#-动态命令系统)
- [流式输出系统](#-流式输出系统)
- [日志系统详解](#-日志系统详解)
- [状态追踪系统](#-状态追踪系统)
- [技术实现细节](#-技术实现细节)

---

## 📋 动态命令系统

### 命令来源

所有命令都从 `.claude/commands/` 目录动态加载：

```
.claude/commands/
├── deepresearch.md          # @include 引用外部文件
├── sync-external.md         # @include 引用外部文件
├── legal-router.md          # 本地命令文件
├── legal-preprocess.md
├── legal-proposal.md
├── legal-search.md
└── legal-analyze.md
```

### @include 指令支持

#### 相对路径
```markdown
@include ../../SuitAgent/.claude/commands/deepresearch.md
```

#### 绝对路径(支持 ~/)
```markdown
@include ~/Library/Application Support/maoscripts/SuitAgent/.claude/commands/sync-external.md
```

### 命令元数据提取

扩展会自动从命令文件中提取:

1. **标题**:
   - 优先使用 frontmatter 中的 `name` 字段
   - 其次使用文件中第一个一级标题 (`# 标题`)
   - 否则使用格式化的文件名

2. **描述**:
   - 优先使用 frontmatter 中的 `description` 字段
   - 其次查找包含"功能"、"描述"、"说明"等关键词的行
   - 或者以 `>`, `**`, `*` 开头的行

3. **图标**: 根据命令名称关键词智能匹配

### Frontmatter 格式

```markdown
---
name: 深度研究
description: 对特定主题进行深度研究和分析
---

# 深度研究命令

> 功能:对特定主题进行深度研究...
```

---

## 📡 流式输出系统

### 概述

流式输出模式允许在 Raycast 内实时查看 Claude Code 的执行过程，无需等待命令完成。通过 `--output-format stream-json` 参数获取 JSON 流，使用行缓冲机制逐步解析并更新 UI。

### 启用方式

在 Raycast 扩展设置中开启"流式输出模式"，或在 `package.json` 的 preferences 中设置 `streamingMode: true`。

> 流式输出仅在**后台运行模式（headless）**下生效。

### 工作原理

1. **JSON 流解析**：使用 `spawn` 启动 Claude CLI，通过 `--output-format stream-json` 获取 NDJSON 格式的实时输出
2. **行缓冲**：维护 `lineBuffer` 缓冲区，防止 TCP 分包导致 JSON 对象被截断
3. **事件回调**：通过 `onChunk(chunk, isFinal)` 回调逐步更新 UI 状态
4. **Session 捕获**：自动从 JSON 流中提取 `session_id`

### 支持的执行类型

| 类型 | 流式支持 | 说明 |
|------|----------|------|
| Command | ✅ | `.claude/commands/*.md` 定义的命令 |
| Skill | ✅ | `.claude/skills/*/SKILL.md` 定义的技能 |
| Terminal 模式 | ❌ | 弹出终端窗口执行，不支持流式输出 |

---

## 📊 日志系统详解

### 日志目录结构

```
~/Library/Application Support/maoscripts/AutoWeave/agent-executor-raycast/logs/
├── raycast-extension.jsonl  # JSONL 格式的结构化日志（主要日志文件）
└── stats.json               # 运行统计信息
```

**注意**：系统已完全迁移到 JSONL-only 日志记录方式。不再使用 `runs/` 目录、`index.txt` 或 `errors.log` 文件。

### 日志查看

在 Raycast 中运行 "查看运行状态" 命令,可以:
- 查看所有运行历史
- 按时间倒序排列
- 查看每次运行的详细信息
- 复制运行 ID
- 在 Finder 中打开日志文件

### 日志内容

每个运行日志包含:
- Run ID(唯一标识符)
- 进程 ID（PID）
- 开始/结束时间
- 执行时长
- 目标文件路径
- 工作目录
- 执行命令
- 完整输出（实时输出流 + 最终输出）
- 退出码

### JSONL 格式说明

**每行一个 JSON 对象**，表示一次运行的一个事件。所有日志按时间顺序追加到同一个文件中。

#### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `ts` | string | 时间戳，格式：`YYYY-MM-DD HH:mm:ss` |
| `event` | string | 事件类型（见下方事件类型） |
| `status` | string | 状态：`running` / `success` / `error` |
| `run_id` | string | 唯一运行标识符，格式：`run_YYYYMMDD_HHMMSS_PID` |
| `target` | string | 目标文件路径 |
| `work_dir` | string | 工作目录 |
| `cmd` | string | 执行的命令 |
| `pid` | number | 进程 ID |
| `output` | string | 命令输出（可能被截断） |
| `duration` | number | 执行时长（秒） |
| `exit_code` | number | 退出码（失败事件） |

#### JSONL 格式示例

```json
{"ts":"2026-01-10 17:31:26","event":"started","status":"running","run_id":"run_20260110_173126_4093","target":"/path/to/file.pdf","work_dir":"/path/to"}
{"ts":"2026-01-10 17:31:27","event":"started_realtime","status":"running","run_id":"run_20260110_173126_4093","target":"/path/to/file.pdf","work_dir":"/path/to"}
{"ts":"2026-01-10 17:31:27","event":"executing","status":"running","run_id":"run_20260110_173126_4093","cmd":"/legal-router \"/path/to/file.pdf\"","pid":12345}
{"ts":"2026-01-10 17:31:28","event":"realtime_output","status":"running","run_id":"run_20260110_173126_4093","output":"正在分析文件...","pid":12345}
{"ts":"2026-01-10 17:31:30","event":"realtime_output","status":"running","run_id":"run_20260110_173126_4093","output":"正在生成报告...","pid":12345}
{"ts":"2026-01-10 17:31:59","event":"completed","status":"success","run_id":"run_20260110_173126_4093","duration":33.4,"pid":12345,"target":"/path/to/file.pdf","work_dir":"/path/to","cmd":"/legal-router \"/path/to/file.pdf\"","output":"转换完成..."}
```

### 事件类型

| 事件 | 说明 |
|------|------|
| `started` | 命令开始执行 |
| `started_realtime` | 实时日志流启动 |
| `validated` | 命令参数验证通过 |
| `executing` | 命令正在执行（包含 PID） |
| `realtime_output` | 实时输出片段 |
| `completed` | 命令成功完成 |
| `failed` | 命令执行失败 |

### 日志读取方式

**直接读取 JSONL 文件**：
```bash
# 查看最近 10 条日志
tail -n 10 ~/Library/Application\ Support/maoscripts/AutoWeave/agent-executor-raycast/logs/raycast-extension.jsonl

# 查看特定运行的日志
grep "run_20260110_173126_4093" ~/Library/Application\ Support/maoscripts/AutoWeave/agent-executor-raycast/logs/raycast-extension.jsonl | jq
```

**在 Raycast 中查看**：
- 使用 "查看运行状态" 命令，界面会自动解析和展示 JSONL 日志

---

## 📊 状态追踪系统

### 概述

状态追踪系统提供了对命令执行历史的完整可视化，让你能够：

- 查看所有正在运行的命令
- 浏览最近 7 天的命令执行历史
- 查看每次运行的详细日志
- 快速诊断失败命令的原因

### 访问方式

状态追踪页面可以通过两种方式访问：

1. **独立命令**: 在 Raycast 中搜索并运行 "运行状态" 命令
2. **从命令列表跳转**: 在命令列表页面按下 `Cmd+S` 或点击 "查看运行状态"

### 状态分类

状态页面将命令执行记录分为三类：

#### 正在运行 (Running)

- 显示所有正在执行中的命令
- 显示命令开始时间
- 每 5 秒自动刷新状态
- 只显示最近 1 小时内开始运行的命令（避免僵尸进程）

#### 已完成 (Completed)

- 显示最近 7 天内成功完成的命令
- 显示完成时间和执行时长
- 可查看完整日志输出
- 支持复制命令重新执行

#### 失败 (Failed)

- 显示最近 7 天内执行失败的命令
- 显示退出码和错误信息
- 可查看详细错误日志
- 快速诊断失败原因

### 日志详情

点击任意命令记录可以查看详细日志，包括：

- Run ID（唯一标识符）
- 进程 ID（PID）
- 完整命令字符串
- 目标文件路径
- 开始/结束时间
- 执行时长
- 完整输出内容
- 退出码（失败命令）

**实时日志流**：
- 正在运行的命令会实时写入日志文件
- 查看运行中命令的日志时，页面每 2 秒自动刷新
- 可以看到命令的实时输出，无需等待命令完成
- 进程 ID 可以用于强制终止卡死的命令（使用 `kill <PID>`）

### 技术实现

状态追踪系统基于以下技术：

- **日志源**: 从 `agent-executor.jsonl` 读取结构化日志
- **状态识别**: 根据 `event` 字段（started/executing/completed/failed）确定命令状态
- **时间过滤**: 自动清理超过 7 天的记录
- **自动刷新**: 每 5 秒更新一次状态（仅在状态页面打开时）

### 设计原则

1. **简单高效**: 不维护额外的状态存储，直接读取日志文件
2. **跨进程支持**: 多个命令实例同时运行时都能被正确追踪
3. **自动清理**: 自动过滤旧记录，避免列表过长
4. **可扩展性**: 架构设计支持未来添加更多状态和过滤选项

---

## 🔧 技术实现细节

### 核心代码位置

- **命令扫描**: [src/utils/commands.ts:127](src/utils/commands.ts#L127) - 扫描并记录 `projectDir`
- **参数构建**: [src/commands.tsx:339](src/commands.tsx#L339) - 使用 `command.projectDir`
- **文件路径处理**: [src/commands.tsx:323](src/commands.tsx#L323) - 用引号包裹文件路径
- **实际执行**: [src/utils/claude.ts:140](src/utils/claude.ts#L140) - 设置 `cwd` 并传递 prompt

### 执行流程

1. **命令扫描（应用启动时）**
   ```typescript
   // 扫描所有配置的项目目录
   scanCommands([
     "~/maoscripts/AutoWeave",
     "~/maoscripts/SuitAgent"
   ])
   // → 发现 AutoWeave/.claude/commands/deepresearch.md
   // → 记录命令所属的项目目录
   ```

2. **构建执行参数**
   ```typescript
   {
     prompt: "/deepresearch \"~/Documents/cases/case001.pdf\"",  // 命令 + 文件路径
     projectDir: "~/maoscripts/AutoWeave"  // 命令所属项目
   }
   ```

3. **后端实际执行**
   ```typescript
   const child = spawn(claudeBin, [
     "--print",
     "--dangerously-skip-permissions",
     "/deepresearch \"~/Documents/cases/case001.pdf\"",  // 命令 + 文件路径
   ], {
     cwd: "~/maoscripts/AutoWeave"     // 设置进程工作目录
   });
   ```

### 多项目支持

当你配置了多个项目目录时：

```javascript
配置的项目目录 = [
  "~/maoscripts/AutoWeave",
  "~/maoscripts/SuitAgent"
]

// 当你执行 deepresearch 命令时（来自 AutoWeave）
{
  prompt: "/deepresearch \"~/Documents/cases/case001.pdf\"",
  projectDir: "~/maoscripts/AutoWeave"   // 自动使用命令所属的项目
}

// 当你执行 2word 命令时（来自 SuitAgent）
{
  prompt: "/2word \"~/Documents/cases/case001.pdf\"",
  projectDir: "~/maoscripts/SuitAgent"   // 自动使用命令所属的项目
}
```

**关键点**：
- ✅ 每个命令自动在其所属的项目目录中执行
- ✅ 文件路径在 prompt 中传递（用引号包裹）
- ✅ 无需手动指定，系统自动识别
- ✅ 支持跨项目命令协作

---

## 🎯 设计原则

1. **动态优于静态**: 所有命令通过扫描生成,不硬编码
2. **单一入口**: 只有一个命令列表入口,显示所有可用命令
3. **智能提取**: 自动从命令文件中提取元数据
4. **@include 支持**: 完整支持命令文件引用机制
5. **零配置添加**: 添加新命令只需创建 `.md` 文件
