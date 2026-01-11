# 更新日志 (Changelog)

所有重要的变更都会记录在此文件中。

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
