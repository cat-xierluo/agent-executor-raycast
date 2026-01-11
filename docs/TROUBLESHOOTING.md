# 故障排除指南

本文档提供了 Agent Executor Raycast 扩展的常见问题诊断和解决方案。

## 🔍 常见问题

### 命令未显示

**现象**: 在 Raycast 中看不到某些或全部命令

**检查步骤**:
1. 确认 `.claude/commands/` 目录是否存在
2. 确认命令文件是否为 `.md` 格式
3. 如果使用 `@include`，检查引用路径是否正确
4. 查看 Raycast 开发者控制台中的警告信息

**解决方案**:
```bash
# 检查命令目录结构
ls -la .claude/commands/

# 如果使用 @include，验证路径是否可访问
cat .claude/commands/your-command.md
```

---

### @include 无法解析

**现象**: 使用 `@include` 的命令无法加载

**支持的路径格式**:
- 相对路径: `../../SuitAgent/.claude/commands/command.md`
- 绝对路径: `/Users/username/path/to/command.md`
- Home 路径: `~/Library/Application Support/maoscripts/command.md`

**常见错误**:
1. **相对路径错误**: 确保相对路径是从 `.claude/commands/` 目录开始计算
2. **文件不存在**: 使用 `ls` 验证引用文件是否存在
3. **权限问题**: 确保文件可读

**调试方法**:
```bash
# 测试相对路径
cd .claude/commands/
cat ../../other-project/.claude/commands/test.md

# 测试绝对路径
cat ~/Library/Application\ Support/maoscripts/other-project/.claude/commands/test.md
```

---

### Claude CLI 执行失败

**现象**: 命令执行时出现 Claude CLI 相关错误

**常见原因**:

1. **Claude CLI 路径错误**
   - 检查 Raycast 扩展设置中的 Claude CLI 路径
   - 默认路径: `~/.local/bin/claude`
   - 验证方法: `which claude` 或 `ls -la ~/.local/bin/claude`

2. **工作目录问题**
   - 确保项目目录配置正确（必须包含 `.claude/commands/`）
   - 验证方法: 在项目目录执行 `ls .claude/commands/`

3. **权限问题**
   - 确保 Claude CLI 有执行权限
   - 修复方法: `chmod +x ~/.local/bin/claude`

---

### DevonThink 集成问题

**现象**: 无法从 DevonThink 获取选中的文件

**支持的版本**:
- DevonThink 3 (com.devon-technologies.think3)
- DevonThink Pro 2 (com.devon-technologies.thinkpro2)
- DevonThink 2 (com.devon-technologies.think2)

**诊断步骤**:
```bash
cd agent-executor-raycast/scripts
node test-devon-integration.js
```

**常见问题**:
1. **DevonThink 未运行**: 确保应用正在运行
2. **未选择文件**: 在 DevonThink 中先选择文件
3. **版本不匹配**: 扩展会自动检测版本，确保使用支持的版本

---

### 日志相关问题

#### 日志目录位置

日志存储在:
```
~/Library/Application Support/maoscripts/AutoWeave/agent-executor-raycast/logs/
```

#### 日志目录为空

**现象**: logs 目录存在但为空

**可能原因**:
1. 命令还未执行过
2. 日志写入权限问题
3. 查看的是错误的 logs 目录

**解决方案**:
```bash
# 检查日志目录
ls -la ~/Library/Application\ Support/maoscripts/Agent Executor/agent-executor-raycast/logs/

# 检查最新日志
ls -lt ~/Library/Application\ Support/maoscripts/Agent Executor/agent-executor-raycast/logs/runs/ | head -5
```

---

### 配置验证失败

**现象**: 提示配置目录无效

**检查项**:
1. 项目目录必须包含 `.claude/commands/` 子目录
2. 目录权限正确（可读可执行）
3. 使用绝对路径而非相对路径

**验证命令**:
```bash
# 验证项目目录结构
ls -la /your/project/directory/.claude/commands/

# 验证权限
namei -l /your/project/directory/.claude/commands/
```

---

## 🛠️ 开发环境问题

### 依赖安装失败

**现象**: `npm install` 报错

**解决方案**:
```bash
# 清理缓存
rm -rf node_modules package-lock.json

# 重新安装
npm install

# 如果仍有问题，尝试
npm cache clean --force
npm install
```

### TypeScript 编译错误

**现象**: `npm run typescript` 报错

**解决方案**:
```bash
# 检查类型错误
npm run typescript

# 自动修复 lint 问题
npm run fix-lint

# 如果类型定义缺失
npm install --save-dev @types/node @types/react
```

### 开发模式启动失败

**现象**: `npm run dev` 报错

**常见原因**:
1. Raycast 应用未运行
2. 端口被占用
3. 扩展已在 Raycast 中加载

**解决方案**:
1. 确保 Raycast 应用正在运行
2. 在 Raycast 中启用扩展开发模式
3. 重启 Raycast 应用

---

## 📊 性能问题

### 命令执行缓慢

**可能原因**:
1. Claude CLI 首次启动需要加载环境
2. 网络连接问题（Claude API 调用）
3. 大文件处理

**优化建议**:
1. 首次执行后会更快（CLI 已缓存）
2. 检查网络连接
3. 对于大文件，考虑分批处理

### 内存占用过高

**解决方案**:
1. 清理旧日志（超过 7 天的记录会自动过滤）
2. 手动清理 logs 目录:
```bash
# 清理 7 天前的日志
find ~/Library/Application\ Support/maoscripts/Agent Executor/agent-executor-raycast/logs/runs/ \
  -name "*.log" -mtime +7 -delete
```

---

## 🐛 调试技巧

### 启用详细日志

在 Raycast 开发者控制台中查看详细日志：
1. 打开 Raycast
2. 按 `Cmd + ,` 打开设置
3. 进入 "Advanced" 标签
4. 启用 "Developer Mode"
5. 打开开发者控制台查看日志

### 测试 Claude CLI

```bash
# 测试基本功能
claude --help

# 测试无头模式
claude --print --dangerously-skip-permissions "Hello, Claude!"

# 测试命令执行
cd /path/to/project
claude --print --dangerously-skip-permissions "/legal-preprocess" --add-dir /path/to/file
```

### 测试 DevonThink 集成

```bash
cd agent-executor-raycast/scripts
node test-devon-integration.js
```

### 检查命令扫描结果

创建测试脚本验证命令是否被正确扫描：
```typescript
// test-command-scanner.ts
import { scanCommands } from "./src/utils/commands";

const commands = await scanCommands();
console.log("Found commands:", commands.length);
commands.forEach(cmd => {
  console.log(`- ${cmd.name}: ${cmd.description}`);
});
```

---

## 📞 获取帮助

如果以上方法都无法解决问题：

1. **检查日志文件**: 查看 `logs/errors.log` 获取详细错误信息
2. **查看 CHANGELOG.md**: 了解最近的变更和已知问题
3. **查看 ROADMAP.md**: 了解当前的开发进度和计划
4. **提交 Issue**: 在项目仓库提交详细的错误报告

### 提交 Issue 时请包含：

1. **环境信息**:
   - macOS 版本
   - Raycast 版本
   - Node.js 版本 (`node --version`)
   - 扩展版本（见 package.json）

2. **错误信息**:
   - 完整的错误堆栈
   - 相关日志文件内容
   - 复现步骤

3. **配置信息**:
   - 项目目录路径
   - Claude CLI 路径
   - 命令文件内容（如果相关）

---

## 📚 相关文档

- [README.md](README.md) - 项目概述和快速开始
- [CHANGELOG.md](CHANGELOG.md) - 变更历史
- [ROADMAP.md](ROADMAP.md) - 开发路线图
- [docs/DEVONTHINK_INTEGRATION.md](docs/DEVONTHINK_INTEGRATION.md) - DevonThink 集成文档
