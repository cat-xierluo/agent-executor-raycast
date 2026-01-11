# Raycast 扩展发布指南

本指南将帮助你将 Agent Executor Raycast 扩展发布到官方的 Raycast Store。

## 📋 发布前准备清单

### ✅ 代码检查

在发布前，请确保：

- [ ] **TypeScript 编译通过**: `npm run typescript`
- [ ] **代码规范检查**: `npm run lint`
- [ ] **构建测试**: `npm run build`
- [ ] **功能测试**: 在开发模式下测试所有功能
- [ ] **README 完整**: 包含使用说明和截图
- [ ] **图标存在**: 确保 `terminal.png` 图标文件存在

### ✅ package.json 配置检查

确保 `package.json` 包含必要的字段：

```json
{
  "name": "agent-executor",
  "title": "Agent Executor",
  "description": "执行 Claude Code 技能和命令的通用工具",
  "icon": "terminal.png",
  "author": "your-name",
  "categories": ["Productivity", "Developer Tools"],
  "license": "MIT",
  "commands": [...],
  "scripts": {
    "build": "ray build",
    "dev": "ray develop",
    "publish": "npx @raycast/api@latest publish",
    "pull-contributions": "npx @raycast/api@latest pull-contributions",
    "lint": "ray lint",
    "typescript": "tsc --noEmit"
  }
}
```

### ✅ GitHub 仓库准备

- [ ] 创建 GitHub 账户（如果还没有）
- [ ] 创建名为 `agent-executor-raycast` 的公共仓库
- [ ] 确保仓库包含完整的扩展代码
- [ ] 添加 LICENSE 文件（推荐 MIT 许可证）

## 🚀 发布流程

### 方法一：使用 Raycast CLI（推荐）

这是最简单快捷的发布方式：

#### 第一步：验证扩展

```bash
# 进入扩展目录
cd agent-executor-raycast

# 安装依赖（如果尚未安装）
npm install

# 构建扩展
npm run build
```

#### 第二步：合并贡献（如果适用）

如果你接受过外部贡献或有人在 GitHub 上编辑过代码：

```bash
npm run pull-contributions
```

如果有冲突，请手动解决后再继续。

#### 第三步：发布扩展

```bash
npm run publish
```

这将会：

1. **自动创建 Pull Request**: 在 [raycast/extensions](https://github.com/raycast/extensions) 仓库中创建 PR
2. **要求 GitHub 认证**: 首次发布需要登录 GitHub
3. **自动压缩代码**: 清理和压缩扩展代码
4. **提交到官方仓库**: 扩展被提交到 Raycast 团队审核

#### 第四步：等待审核

- 提交 PR 后，Raycast 团队会审核你的扩展
- 审核时间通常为几天到一周
- 如有需要修改的地方，团队会在 PR 中留言

#### 第五步：发布完成

- PR 合并后，扩展会自动发布到 [Raycast Store](https://raycast.com/store)
- 你会收到发布确认邮件

### 方法二：手动创建 Pull Request

如果你需要更多控制权或 CLI 方式出现问题：

#### 第一步：Fork 官方仓库

1. 访问 [raycast/extensions](https://github.com/raycast/extensions)
2. 点击右上角的 "Fork" 按钮
3. 选择你的 GitHub 账户作为 fork 目标

#### 第二步：复制扩展到 Fork

```bash
# 克隆你的 fork
git clone https://github.com/YOUR_USERNAME/extensions.git
cd extensions

# 创建新分支
git checkout -b add-agent-executor

# 复制扩展文件到相应目录
# extensions 的结构通常是: extensions/category/extension-name/
mkdir -p extensions/productivity/agent-executor
cp -r /path/to/agent-executor-raycast/* extensions/productivity/agent-executor/
```

#### 第三步：提交更改

```bash
git add .
git commit -m "Add Agent Executor extension"
git push origin add-agent-executor
```

#### 第四步：创建 Pull Request

1. 在 GitHub 上打开你的 fork
2. 点击 "Pull requests" → "New pull request"
3. 选择 `main` 作为目标分支
4. 填写 PR 模板（如果有）
5. 点击 "Create pull request"

## 📦 扩展结构要求

Raycast 期望的扩展目录结构：

```
extensions/
└── productivity/
    └── agent-executor/
        ├── package.json
        ├── tsconfig.json
        ├── src/
        │   ├── commands.tsx
        │   ├── status.tsx
        │   └── utils/
        ├── icon.png (或 .svg)
        ├── README.md
        └── CHANGELOG.md (可选)
```

## 📝 PR 标题格式

使用清晰的标题：

```
Add: Agent Executor - Claude Code command runner
```

## 🔍 审核标准

你的扩展将根据以下标准审核：

### 功能性
- [ ] 扩展功能正常，无明显 Bug
- [ ] 错误处理得当
- [ ] 性能表现良好

### 代码质量
- [ ] TypeScript 类型检查通过
- [ ] 代码规范检查通过
- [ ] 代码结构清晰，有必要注释

### 用户体验
- [ ] UI 直观易用
- [ ] 错误信息清晰
- [ ] 有完整的 README 文档

### 安全性
- [ ] 不执行恶意代码
- [ ] 权限请求合理
- [ ] 输入验证充分

## 🎯 最佳实践建议

### 1. README 编写

确保 README 包含：
- 扩展用途和功能
- 安装和使用说明
- 配置选项说明
- 截图（可选但推荐）
- 常见问题解答

示例结构：
```markdown
# Extension Name

Brief description of what the extension does.

## Features

- Feature 1
- Feature 2

## Installation

Steps to install and configure.

## Usage

How to use the extension.

## Configuration

Configuration options explained.
```

### 2. 图标要求

- **尺寸**: 最佳 512x512 像素
- **格式**: PNG 或 SVG
- **风格**: 简洁、清晰、易识别
- **避免**: 文字过多、过于复杂的设计

### 3. 分类选择

选择最符合扩展功能的分类：

- **Developer Tools**: 开发工具（如你的扩展）
- **Productivity**: 提高效率的工具
- **Design**: 设计相关
- **Utilities**: 实用工具
- **Entertainment**: 娱乐
- **Other**: 其他

### 4. 版本管理

发布后如需更新：

```bash
# 更新版本号
# 编辑 package.json 中的 version 字段

# 重新发布
npm run publish
```

## 🆘 常见问题

### Q: 发布命令提示 "Authentication failed"

**A**: 确保已登录 GitHub：

```bash
# 安装 GitHub CLI
brew install gh

# 登录
gh auth login
```

### Q: PR 被拒绝，要求修改

**A**: 仔细阅读审核意见，在本地修改后：

```bash
# 重新构建和测试
npm run build

# 再次发布（会更新现有 PR）
npm run publish
```

### Q: 扩展在商店中找不到

**A**:
- 确认 PR 已合并
- 等待商店索引更新（可能需要几小时）
- 使用准确的扩展名称搜索

### Q: 如何处理多个扩展？

**A**: 每个扩展都需要独立的 PR。重复执行发布流程。

## 📚 相关资源

- [Raycast Store](https://raycast.com/store)
- [raycast/extensions 仓库](https://github.com/raycast/extensions)
- [Raycast 社区](https://raycast.com/community)
- [官方 API 文档](https://developers.raycast.com/)

## 🎉 发布后分享

扩展发布后，可以：

1. **分享链接**:
   - 在 Raycast 中搜索扩展
   - 按 `⌘` `⌥` `.` 复制分享链接

2. **社交媒体**:
   - 发推特 @raycast
   - 分享到 GitHub
   - 发布到开发者社区

3. **收集反馈**:
   - 监控 PR 评论
   - 关注 GitHub Issues
   - 回复用户问题

---

**祝你的扩展发布成功！🚀**
