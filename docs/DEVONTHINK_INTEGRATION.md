# DevonThink 集成改进说明

## 问题分析

### 原始实现的问题

原始代码使用 `the selection` 来获取选中的记录，这在某些情况下可能无法正常工作。

### DevonThink 文件类型

DevonThink 中有两种文件存储方式：

1. **索引文件（Indexed Files）**：
   - 文件保留在原始文件系统位置
   - DevonThink 只是"指向"这些文件
   - ✅ `path` 属性返回真实的文件系统路径
   - ✅ 可以直接被命令行工具读取

2. **导入文件（Imported Files）**：
   - 文件被复制到 DevonThink 的数据库中
   - 存储在 `~/Library/Application Support/DEVONthink 3/Files.noindex/` 下
   - ⚠️ 路径是动态的，可能变化
   - ⚠️ 不应该直接使用这些路径
   - 需要使用 `x-devonthink-item://` URL 或导出文件

## 改进方案

### 1. 修复 AppleScript 构造

**原始代码：**
```applescript
set theSelection to the selection
```

**改进代码：**
```applescript
set theSelection to (selection as list)
```

这个修改确保我们始终得到一个列表，即使只选中了一个文件。

### 2. 支持多种路径获取方式

新的实现按以下优先级尝试获取文件路径：

1. **文件系统路径**（`path` 属性）- 优先
2. **Content path**（`content path` 属性）- 备选
3. **Reference URL**（`reference URL` 属性）- 最后手段

```typescript
// 尝试获取文件系统路径
try {
  set thePath to path of theRecord
  if thePath is not missing value and thePath is not "" then
    set hasPath to "true"
  end if
on error
  set thePath to ""
end try

// 获取 reference URL (x-devonthink-item://)
try
  set theRefURL to reference URL of theRecord
on error
  set theRefURL to ""
end try

// 如果没有文件系统路径，尝试使用 content path
if hasPath is "false" then
  try
    set thePath to content path of theRecord
    if thePath is not missing value and thePath is not "" then
      set hasPath to "true"
    end if
  on error
    set thePath to ""
  end try
end if
```

### 3. 智能路径处理

对于索引文件（如你的使用场景）：
- ✅ 直接使用 `path` 属性
- ✅ 不需要任何额外处理
- ✅ 性能最优

对于导入文件或 URL：
- 🔄 自动导出到临时目录 `/tmp/agent-executor-devonthink/`
- 🔄 使用导出的临时文件路径
- 🔄 执行命令时显示导出状态

### 4. UI 改进

现在 Raycast 界面会显示文件类型：

- ✓ **索引文件** - 绿色勾选标记，可以直接使用
- 📦 **导入文件** - 盒子图标，需要导出
- 🔗 **DevonThink URL** - 链接图标，需要导出

## 使用方法

### 在 DEVONthink 中选中文件

1. 在 DEVONthink 中选中一个或多个文档/记录
2. 打开 Raycast，输入 "Agent Executor" 或 "autoweave"
3. 选择 "Agent Executor 命令列表" 或 "Agent Executor 命令（带备注）"
4. 扩展会自动从 DEVONthink 获取选中的文件，并显示提示："从 DEVONthink 获取了 N 个文件"
5. 查看文件类型标记（✓ 索引文件 / 📦 导入文件 / 🔗 DevonThink URL）
6. 选择要执行的命令即可

### 在 Finder 中选中文件（原有方式）

1. 在 Finder 中选中文件或文件夹
2. 打开 Raycast，输入 "Agent Executor"
3. 选择 "Agent Executor 命令"
4. 扩展会使用 Finder 中选中的文件

## 使用场景

### 场景 1：索引文件（推荐场景）

如果你使用索引文件：

```
✅ DevonThink 返回真实路径：/Users/username/Documents/file.pdf
✅ 直接使用这个路径
✅ 无需导出
✅ 性能最优
```

### 场景 2：导入文件

如果文件被导入到 DevonThink 数据库：

```
⚠️ DevonThink 返回：~/Library/Application Support/DEVONthink 3/Files.noindex/...
🔄 自动导出到：/tmp/agent-executor-devonthink/file.pdf
✅ 使用临时文件路径
```

### 场景 3：数据库记录

如果文件没有文件系统路径：

```
⚠️ DevonThink 返回：x-devonthink-item://4B19AD66-4962-4261-A7D8-DCC9335C7E36
🔄 使用 reference URL 导出
✅ 使用导出的临时文件
```

## 诊断工具

如果遇到问题，可以运行诊断脚本：

```bash
cd agent-executor-raycast/scripts
chmod +x run-diagnosis.sh
./run-diagnosis.sh
```

诊断脚本会显示：
- 文件名称和 UUID
- 所有可用的路径属性
- 推荐的最佳路径获取方式

## 技术细节

### AppleScript 改进

1. **使用 `selection as list`**：
   ```applescript
   repeat with theRecord in (selection as list)
     -- 处理每个记录
   end repeat
   ```

2. **错误处理**：
   - 每个路径获取操作都有 try-catch
   - 优雅降级到备选方案

3. **兼容性**：
   - 适用于 DevonThink 3 和 DevonThink Pro
   - 使用 bundle ID：`com.devon-technologies.thinkpro2`

### TypeScript 接口

```typescript
export interface DevonThinkRecord {
  path: string;                  // 文件路径或 URL
  name: string;                  // 文件名称
  uuid?: string;                 // 记录 UUID
  type: "file" | "directory";    // 文件类型
  referenceUrl?: string;         // x-devonthink-item:// URL
  hasFileSystemPath: boolean;    // 是否有真实文件系统路径
}
```

### 辅助函数

```typescript
// 检查是否为 DevonThink URL
isDevonThinkURL(path: string): boolean

// 检查是否为 Files.noindex 路径
isFilesNoIndexPath(path: string): boolean

// 导出记录到临时文件
exportDevonThinkRecordToTemp(record: DevonThinkRecord): Promise<string>

// 准备用于命令执行的文件路径
prepareFilePathForCommand(record: DevonThinkRecord): Promise<{
  path: string;
  isTemp: boolean;
  originalPath: string;
}>
```

## 快捷键

- `Cmd + R`：刷新命令列表
- `Cmd + Shift + R`：重新加载选中的文件（在切换来源时很有用）
- `Cmd + Enter`：执行选中的命令
- `Cmd + Shift + P`：切换命令置顶状态
- `Cmd + Shift + S`：切换命令新标记

## 注意事项

1. **DEVONthink 必须运行**：要使用 DEVONthink 集成，DEVONthink 应用程序必须处于运行状态
2. **文件路径格式**：DEVONthink 返回的文件路径是 POSIX 格式，可以直接用于 Agent Executor 命令
3. **多选支持**：支持同时选中多个文件，所有文件都会被传递给命令
4. **自动降级**：如果 DEVONthink 未运行或未选中文件，扩展会优雅地降级到 Finder，不会显示错误

## 故障排除

### 问题：扩展无法从 DEVONthink 获取文件

**解决方案：**
- 确认 DEVONthink 正在运行
- 确认在 DEVONthink 中选中了至少一个记录
- 尝试使用 `Cmd + Shift + R` 重新加载文件

### 问题：显示 "DEVONthink 未运行" 错误

**解决方案：**
- 启动 DEVONthink 应用程序
- 等待 DEVONthink 完全启动后再重试

### 问题：文件需要导出但导出失败

**解决方案：**
- 检查 `/tmp/agent-executor-devonthink/` 目录权限
- 查看诊断脚本的输出
- 确认文件的 UUID 有效

## 参考资源

- [DEVONtechnologies Community - Open selected records with external applications](https://discourse.devontechnologies.com/t/open-selected-records-with-external-applications/65696)
- [DEVONtechnologies Community - File path](https://discourse.devontechnologies.com/t/file-path/12090)
- [DEVONtechnologies Blog - Understanding Item Links](https://www.devontechnologies.com/blog/20240502-understanding-devonthink-item-links)

## 总结

对于你的使用场景（全部使用索引文件）：

✅ 改进的实现修复了原始 bug
✅ 文件路径直接可用
✅ UI 会显示 "✓ 索引文件" 标记
✅ 无需导出，性能最优
✅ 兼容未来的导入文件场景

这是一个健壮的解决方案，既解决了当前问题，又为未来的使用场景提供了支持。
