# Agent Executor Raycast Extension

使用 Raycast Extension API 执行 Claude Code 技能（Skills）的通用工具。

## ✨ 核心特性

### 📡 流式输出

- **实时输出显示**: 开启后可在 Raycast 内实时查看 Claude 的执行过程，无需等待完成
- **Session ID 捕获**: 自动提取 `session_id`，支持后续通过 `claude --resume` 恢复对话
- **安全行缓冲**: 使用行缓冲机制防止 TCP 分包导致的 JSON 截断

### 📊 执行状态追踪

- **实时状态监控**: 查看正在运行、已完成和失败的技能
- **历史记录**: 自动保存最近 7 天的执行历史
- **日志详情**: 每次运行的详细日志，包括输出、错误和执行时长
- **智能分类**: 按状态自动分组，快速找到需要的记录

### 🔄 完全动态的技能系统

- **自动扫描技能**: 从 `.claude/skills/` 目录动态加载所有技能
- **全局 Skills 支持**: 同时支持扫描 `~/.claude/skills/` 目录中的全局 Skills
- **无需硬编码**: 添加、修改或删除技能无需修改代码
- **智能提取**: 自动从 SKILL.md 文件中提取标题、描述和图标

### 📋 技能管理原则

**重要**: 本扩展不硬编码任何特定技能。所有技能都通过扫描以下目录动态生成：

- **项目技能**: 项目目录下的 `.claude/skills/` 目录
- **全局 Skills**: `~/.claude/skills/` 目录（可选）

添加新技能的步骤:
1. 在 `.claude/skills/` 目录下创建子目录
2. 在子目录中添加 `SKILL.md` 文件定义技能
3. 技能会自动出现在 Raycast 扩展中
4. 无需修改任何代码

## 📁 项目结构

```
agent-executor-raycast/
├── src/
│   ├── commands.tsx           # 技能列表与执行入口
│   ├── status.tsx             # 状态追踪页面
│   ├── components/
│   │   ├── StreamingOutput.tsx # 流式输出组件
│   │   └── StatsComponents.tsx # 统计组件
│   ├── contexts/
│   │   └── StatusRefreshContext.tsx # 状态刷新上下文
│   ├── utils/
│   │   ├── skills.ts          # Skills 扫描逻辑
│   │   ├── claude.ts          # Claude Code CLI 执行（含流式输出）
│   │   ├── commandMetadata.ts # 技能元数据管理
│   │   ├── devonthink.ts      # DEVONthink 集成
│   │   ├── logger.ts          # JSONL 日志记录
│   │   ├── status.ts          # 状态追踪工具函数
│   │   └── stats.ts           # 执行统计
│   ├── logs-viewer.tsx        # 日志查看器
│   └── ...
├── package.json
├── tsconfig.json
└── README.md
```

## ⚙️ 前提条件

在使用本扩展之前，你需要：

1. **安装 Claude Code CLI**

   本扩展依赖 Claude Code CLI 来执行技能。请确保已安装并配置好 Claude Code CLI。

   ```bash
   # 检查 Claude CLI 是否已安装
   which claude
   # 或
   ~/.local/bin/claude --version
   ```

   如果尚未安装，请访问 [Claude Code CLI 文档](https://code.claude.com/docs/en/headless) 获取安装指南。

2. **创建项目目录结构**

   确保你的项目包含：
   - `.claude/skills/` 目录（项目技能）

3. **配置 Raycast 扩展设置**

   安装本扩展后，需要在 Raycast 扩展设置中配置：
   - **项目目录**：包含 `.claude/skills/` 的项目路径
   - **启用默认 Skills 目录**：自动扫描 `~/.claude/skills/`（默认开启）
   - **Claude CLI 路径**（可选）：如果 CLI 不在默认路径 `~/.local/bin/claude`

## 🚀 快速开始

### 步骤 1: 安装依赖

```bash
cd agent-executor-raycast
npm install
```

### 步骤 2: 开发模式运行

```bash
npm run dev
```

这将启动扩展开发模式,你可以在 Raycast 中看到扩展并进行测试。

### 步骤 3: 构建扩展

```bash
npm run build
```

## 📝 动态技能系统

### 技能目录结构

所有技能从 `.claude/skills/` 目录动态加载，每个技能是一个包含 `SKILL.md` 的子目录：

```
.claude/skills/
├── mineru-ocr/
│   └── SKILL.md
├── skill-manager/
│   └── SKILL.md
└── deepresearch/
    └── SKILL.md
```

### 技能元数据提取

扩展会自动从 SKILL.md 文件中提取：

1. **标题**: 使用格式化的目录名
2. **描述**: 从 frontmatter 或内容中提取
3. **图标**: 根据技能名称关键词智能匹配

### Frontmatter 格式

```markdown
---
description: 将文档转换为 Markdown 格式
---

# Mineru OCR

> 功能: 将本地或远程文档转换为 Markdown...
```

## 🔧 配置

在 Raycast 的扩展设置中可以配置:

- **项目目录**: 包含 `.claude/skills/` 的项目目录（可配置最多 5 个）
- **启用默认 Skills 目录**: 自动扫描 `~/.claude/skills/`（默认开启）
- **Claude CLI 路径**: Claude Code CLI 可执行文件路径(默认: `~/.local/bin/claude`)
- **后台运行模式**: 控制技能执行的可视化方式
  - ✅ **启用（默认）**: 技能在后台静默运行，输出记录到日志文件
  - ❌ **禁用**: 在新的 Terminal 窗口中显示执行过程，适合调试和观察实时输出
- **流式输出模式**: 实时显示 Claude 的输出（默认关闭）
  - ✅ **启用**: 在 Raycast 内实时查看执行过程，完成后不自动关闭窗口
  - ❌ **禁用（默认）**: 技能完成后自动关闭窗口并显示 HUD 提示
  - 仅在后台运行模式下生效

## 📊 日志系统

扩展使用 **JSONL 格式**记录所有技能执行历史，保存在 Raycast 扩展支持目录下的 `logs/` 中。

### 日志查看

在 Raycast 中运行 "Agent 运行状态" 命令，可以：

- 查看所有运行历史
- 按时间倒序排列
- 查看每次运行的详细信息
- 复制运行 ID
- 在 Finder 中打开日志文件
- 实时查看正在运行的命令输出

### 日志内容

每个运行日志包含：Run ID、进程 ID（PID）、开始/结束时间、执行时长、目标文件路径、工作目录、执行命令、完整输出和退出码。

详细的日志系统说明请参阅 [详细使用指南 - 日志系统详解](docs/DETAILED_GUIDE.md#-日志系统详解)。

## 📊 状态追踪系统

状态追踪系统提供了对技能执行历史的完整可视化:

- **查看所有正在运行的技能**
- **浏览最近 7 天的执行历史**
- **查看每次运行的详细日志**
- **快速诊断失败的原因**

### 访问方式

1. **独立命令**: 在 Raycast 中搜索并运行 "Agent 运行状态" 命令
2. **从技能列表跳转**: 在列表页面按下 `Cmd+S` 或点击 "查看 Agent 运行状态"

### 状态分类

- **正在运行 (Running)**: 显示所有正在执行中的技能，每 5 秒自动刷新
- **已完成 (Completed)**: 显示最近 7 天内成功完成的技能
- **失败 (Failed)**: 显示最近 7 天内执行失败的技能

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

## 🎯 设计原则

1. **动态优于静态**: 所有技能通过扫描生成，不硬编码
2. **单一入口**: 只有一个技能列表入口，显示所有可用技能
3. **智能提取**: 自动从 SKILL.md 文件中提取元数据
4. **零配置添加**: 添加新技能只需创建含 `SKILL.md` 的子目录
5. **安全执行**: 使用 base64 编码传递 prompt，防止 shell 注入

## 📚 相关文档

- [详细使用指南](docs/DETAILED_GUIDE.md) - 完整的扩展功能说明
- [故障排除指南](docs/TROUBLESHOOTING.md) - 详细的问题诊断和解决方案
- [DevonThink 集成](docs/DEVONTHINK_INTEGRATION.md) - DevonThink 集成说明
- [Raycast API 文档](https://developers.raycast.com/)
- [Claude Code CLI 文档](https://code.claude.com/docs/en/headless)
