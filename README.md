# Agent Executor Raycast Extension

使用 Raycast Extension API 执行 Claude Code 技能和命令的通用工具。

## ✨ 核心特性

### 📊 命令状态追踪

- **实时状态监控**: 查看正在运行、已完成和失败的命令
- **历史记录**: 自动保存最近 7 天的命令执行历史
- **日志详情**: 每次运行的详细日志，包括输出、错误和执行时长
- **智能分类**: 按状态自动分组，快速找到需要的记录

### 🔄 完全动态的命令系统

- **自动扫描命令**: 从 `.claude/commands/` 目录动态加载所有命令
- **无需硬编码**: 添加、修改或删除命令无需修改代码
- **@include 支持**: 完整支持 `@include` 指令,包括相对路径和 `~/` 绝对路径
- **智能提取**: 自动从命令文件中提取标题、描述和图标

### 📋 命令管理原则
**重要**: 本扩展不应硬编码任何特定命令。所有命令都通过扫描 `.claude/commands/` 目录动态生成。

添加新命令的步骤:
1. 在 `.claude/commands/` 目录创建 `.md` 文件(或使用 `@include` 引用)
2. 命令会自动出现在 Raycast 扩展中
3. 无需修改任何代码

## 📁 项目结构

```
agent-executor-raycast/
├── src/
│   ├── commands.tsx        # 动态命令列表(唯一入口)
│   ├── status.tsx          # 状态追踪页面
│   ├── utils/
│   │   ├── commands.ts     # 命令扫描逻辑(支持@include)
│   │   ├── claude.ts       # Claude Code CLI 执行
│   │   ├── logger.ts       # 日志记录
│   │   ├── status.ts       # 状态追踪工具函数
│   │   └── ...
│   ├── logs-viewer.tsx     # 日志查看器
│   └── ...
├── package.json
├── tsconfig.json
└── README.md
```

## 🚀 快速开始

### 步骤 1:安装依赖

```bash
cd agent-executor-raycast
npm install
```

### 步骤 2:开发模式运行

```bash
npm run dev
```

这将启动扩展开发模式,你可以在 Raycast 中看到扩展并进行测试。

### 步骤 3:构建扩展

```bash
npm run build
```

## 📝 动态命令系统

### 命令来源
所有命令都从 `.claude/commands/` 目录动态加载:

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

## 🔧 配置

在 Raycast 的扩展设置中可以配置:

- **项目目录**: 包含 `.claude/commands/` 的项目目录（可配置多个）
- **Claude CLI 路径**: Claude Code CLI 可执行文件路径(默认: `~/.local/bin/claude`)

## 🎯 核心概念：项目目录与文件路径

### 为什么需要分离项目目录和文件路径？

本扩展在执行命令时使用两个概念，这是**命令依赖分离**的核心设计：

```
┌─────────────────────────────────────────────────────────┐
│  项目目录                          │
│  - 命令定义所在的位置                                      │
│  - 包含 .claude/commands/ 文件夹                         │
│  - 示例: ~/maoscripts/AutoWeave                          │
│                                                          │
│  用途:                                                   │
│  ✅ 读取命令定义文件 (如 .claude/commands/deepresearch.md)│
│  ✅ 读取 @include 引用的文件                             │
│  ✅ 读取项目配置 (如 .claude/ 下的其他文件)              │
│  ✅ 确保相对路径正确解析                                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  文件路径                               │
│  - 用户选中文件的完整路径                                  │
│  - 在 prompt 中传递给 Claude（用引号包裹）                 │
│  - 示例: "~/Documents/cases/case001.pdf"                │
│                                                          │
│  用途:                                                   │
│  ✅ 告诉 Claude 要处理哪个文件                            │
│  ✅ Claude 可以读取、分析该文件                           │
│  ✅ 引号确保路径中的空格被正确处理                          │
└─────────────────────────────────────────────────────────┘
```

### 完整执行流程示例

假设你选择 AutoWeave 项目中的 `deepresearch` 命令，并选中文件 `~/Documents/cases/case001.pdf`：

#### 步骤 1: 命令扫描（应用启动时）

```typescript
// 扫描所有配置的项目目录
scanCommands([
  "~/maoscripts/AutoWeave",
  "~/maoscripts/SuitAgent"
])
// → 发现 AutoWeave/.claude/commands/deepresearch.md
// → 记录命令所属的项目目录
```

**扫描结果**：
```javascript
{
  name: "deepresearch",
  projectDir: "~/maoscripts/AutoWeave",  // ✅ 记录命令所属项目
  filePath: "...AutoWeave/.claude/commands/deepresearch.md"
}
```

#### 步骤 2: 构建执行参数

```typescript
// src/commands.tsx:320-343
{
  prompt: "/deepresearch \"~/Documents/cases/case001.pdf\"",  // 命令 + 文件路径
  projectDir: "~/maoscripts/AutoWeave"  // 命令所属项目
}
```

#### 步骤 3: 后端实际执行

```typescript
// src/utils/claude.ts:140-147
const child = spawn(claudeBin, [
  "--print",
  "--dangerously-skip-permissions",
  "/deepresearch \"~/Documents/cases/case001.pdf\"",  // 命令 + 文件路径
], {
  cwd: "~/maoscripts/AutoWeave"     // 设置进程工作目录
});
```

**等效的终端命令**：
```bash
cd ~/maoscripts/AutoWeave              # 进入项目目录（命令定义所在位置）
~/.local/bin/claude \
  --print \
  --dangerously-skip-permissions \
  "/deepresearch \"~/Documents/cases/case001.pdf\""  # 命令 + 文件路径（引号包裹）
```

### 两个目录的协作

#### `cwd: projectDir` (进程工作目录)
```bash
cd ~/maoscripts/AutoWeave
```
- **作用**：进程的**当前工作目录**
- **关键用途**：
  - ✅ 读取命令定义文件
  - ✅ 读取 `@include` 引用的文件
  - ✅ 读取项目配置文件
  - ✅ 解析相对路径

#### 文件路径在 prompt 中传递
```bash
/deepresearch "~/Documents/cases/case001.pdf"
```
- **作用**：在 prompt 中直接传递文件路径（用引号包裹）
- **关键用途**：
  - ✅ Claude AI 能够访问指定的文件
  - ✅ 文件路径中的空格被正确处理
  - ✅ 支持多文件路径（如果命令需要）

### 为什么这样设计？

如果只用一个目录会导致问题：

❌ **问题 1**：在 `~/Documents/cases/` 目录执行

```bash
cd ~/Documents/cases
claude "/deepresearch"  # ❌ 找不到 deepresearch.md 命令定义
```

❌ **问题 2**：在 `~/AutoWeave/` 目录执行（不传递文件路径）

```bash
cd ~/AutoWeave
claude "/deepresearch"  # ❌ Claude 不知道要处理哪个文件
```

✅ **正确方案**：项目目录 + 文件路径

```bash
cd ~/AutoWeave  # 确保命令能读取定义和依赖
claude "/deepresearch \"~/Documents/cases/case001.pdf\""  # 告诉 Claude 要处理哪个文件
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

### 技术实现细节

核心代码位于：
- **命令扫描**：[src/utils/commands.ts:127](src/utils/commands.ts#L127) - 扫描并记录 `projectDir`
- **参数构建**：[src/commands.tsx:339](src/commands.tsx#L339) - 使用 `command.projectDir`
- **文件路径处理**：[src/commands.tsx:323](src/commands.tsx#L323) - 用引号包裹文件路径
- **实际执行**：[src/utils/claude.ts:140](src/utils/claude.ts#L140) - 设置 `cwd` 并传递 prompt

## 📊 日志系统

### 日志目录结构

```
~/Library/Application Support/maoscripts/AutoWeave/agent-executor-raycast/logs/
├── agent-executor.jsonl  # JSONL 格式的结构化日志
├── errors.log               # 错误日志
├── index.txt                # 运行索引(时间倒序)
└── runs/                    # 每次运行的详细日志
    ├── run_20260110_152000_1234.log
    └── ...
```

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
- 开始/结束时间
- 执行时长
- 目标文件路径
- 工作目录
- 执行命令
- 完整输出
- 退出码

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

## 🛠️ 开发

### 类型检查
```bash
npm run typescript
```

### 代码检查
```bash
npm run lint
```

### 自动修复
```bash
npm run fix-lint
```

## 🔄 与 Script Commands 版本的区别

| 功能 | Script Commands | Extension |
|------|-----------------|-----------|
| 获取 Finder 选择 | 需要 AppleScript | 直接使用 `getSelectedFinderItems()` API |
| 用户界面 | 终端输出 | 丰富的 Raycast UI |
| 配置 | 修改脚本文件 | Raycast 偏好设置 |
| 命令管理 | 硬编码在脚本中 | 完全动态加载 |
| @include 支持 | 不支持 | 完整支持(相对/绝对路径) |
| 可扩展性 | 较低 | 高(添加命令无需修改代码) |
| 开发难度 | 简单 | 需要 TypeScript/React |

## 🎯 设计原则

1. **动态优于静态**: 所有命令通过扫描生成,不硬编码
2. **单一入口**: 只有一个命令列表入口,显示所有可用命令
3. **智能提取**: 自动从命令文件中提取元数据
4. **@include 支持**: 完整支持命令文件引用机制
5. **零配置添加**: 添加新命令只需创建 `.md` 文件

## 📚 相关文档

- [故障排除指南](TROUBLESHOOTING.md) - 详细的问题诊断和解决方案，包含：
  - 命令未显示
  - @include 解析失败
  - Claude CLI 执行问题
  - DevonThink 集成问题
  - 日志相关问题
  - 配置验证失败
  - 性能优化建议
  - 调试技巧
- [CHANGELOG.md](CHANGELOG.md) - 变更历史和关键修复记录
- [ROADMAP.md](ROADMAP.md) - 开发路线图
- [Raycast API 文档](https://developers.raycast.com/)
- [Claude Code CLI 文档](https://code.claude.com/docs/en/headless)
