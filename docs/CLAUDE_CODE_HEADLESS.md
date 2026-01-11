# Claude Code 无头模式 (Headless Mode) 详细文档

> 最后更新: 2026-01-10
>
> 本文档详细介绍 Claude Code CLI 工具的无头模式、自动化功能和程序化集成方法。

---

## 目录

1. [概述](#概述)
2. [安装与配置](#安装与配置)
3. [无头模式基础](#无头模式基础)
4. [自动化使用场景](#自动化使用场景)
5. [命令行参数详解](#命令行参数详解)
6. [集成与扩展](#集成与扩展)
7. [最佳实践](#最佳实践)
8. [故障排除](#故障排除)

---

## 概述

### 什么是 Claude Code?

Claude Code 是 Anthropic 官方推出的 **智能代理命令行工具 (Agentic CLI Tool)**，旨在通过自然语言命令自动化开发工作流。它可以:

- 执行常规编码任务
- 解释复杂代码
- 处理 Git 工作流
- 自动修复代码问题
- 生成和执行测试

### 核心特性

| 特性 | 描述 |
|------|------|
| **智能代理架构** | 自主理解代码库并执行多步骤操作 |
| **Unix 哲学设计** | 可组合、可脚本化的命令行工具 |
| **MCP 协议支持** | 通过 Model Context Protocol 连接外部数据源和工具 |
| **无头模式** | 支持非交互式运行，适合 CI/CD 和自动化场景 |
| **企业级安全** | 支持企业安全标准和网络配置 |

---

## 安装与配置

### 系统要求

- **Node.js**: 18+ 版本
- **操作系统**: macOS, Linux, Windows (WSL), Windows (PowerShell)

### 安装方法

#### macOS / Linux / WSL
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

#### Windows (PowerShell)
```powershell
irm https://claude.ai/install.ps1 | iex
```

#### Homebrew (macOS)
```bash
brew install --cask claude-code
```

#### NPM (跨平台)
```bash
npm install -g @anthropic-ai/claude-code
```

### 初始化设置

安装完成后，运行以下命令初始化:

```bash
claude
```

这将触发登录流程并创建交互式会话。

### 配置选项

#### API 密钥配置

Claude Code 支持多种托管选项:

1. **直接使用 Claude API**
   ```bash
   export ANTHROPIC_API_KEY="your-api-key"
   ```

2. **Amazon Bedrock**
   ```bash
   export AWS_REGION="us-east-1"
   export AWS_ACCESS_KEY_ID="your-access-key"
   export AWS_SECRET_ACCESS_KEY="your-secret-key"
   ```

3. **Google Vertex AI**
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json"
   export GOOGLE_CLOUD_PROJECT="your-project-id"
   ```

#### 代理配置

对于企业网络环境:

```bash
export HTTP_PROXY="http://proxy.company.com:8080"
export HTTPS_PROXY="https://proxy.company.com:8080"
```

---

## 无头模式基础

### 什么是无头模式?

无头模式 (Headless Mode) 允许 Claude Code 在**非交互式环境**中运行，这对以下场景特别有用:

- CI/CD 管道集成
- 批处理任务
- 自动化脚本
- 定时任务
- 远程执行

### `-p` 标志: 核心命令

`-p` (prompt) 标志是无头模式的核心，它允许你运行特定提示并在完成后退出。

#### 基本语法

```bash
claude -p "你的任务描述"
```

#### 简单示例

```bash
# 代码分析
claude -p "分析 src/main.py 中的性能瓶颈"

# 自动修复
claude -p "修复所有 ESLint 错误"

# 代码生成
claude -p "创建一个计算斐波那契数列的 Python 函数"
```

---

## 自动化使用场景

### 1. CI/CD 管道集成

#### 自动翻译和 PR 创建

```bash
claude -p "如果有新的文本字符串,将它们翻译成法语并为 @lang-fr-team 创建 PR 以供审核"
```

#### 自动化测试和报告

```bash
claude -p "运行所有测试并生成覆盖率报告"
```

#### 代码质量检查

```bash
# .github/workflows/claude-lint.yml
name: Claude Code Quality Check
on: [push, pull_request]

jobs:
  code-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install Claude Code
        run: |
          curl -fsSL https://claude.ai/install.sh | bash

      - name: Run Code Analysis
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          claude -p "分析代码中的潜在 bug 和性能问题,生成报告"
```

### 2. 日志监控和异常告警

#### 实时日志分析

```bash
tail -f app.log | claude -p "如果发现日志中出现任何异常,请通过 Slack 通知我"
```

#### 错误诊断

```bash
claude -p "分析最近 100 行错误日志,找出根本原因并提供修复建议"
```

### 3. 自动化代码维护

#### 依赖更新

```bash
claude -p "检查过期的依赖项,更新 package.json 并确保向后兼容"
```

#### 合并冲突解决

```bash
claude -p "解决当前分支的合并冲突"
```

#### Release Notes 生成

```bash
claude -p "基于 git log 生成本次发布的 Release Notes"
```

### 4. 批处理文件操作

#### 批量代码重构

```bash
# 处理多个文件
for file in src/**/*.js; do
  claude -p "将 $file 重构为使用 async/await 而不是 Promise 链"
done
```

#### 批量文档生成

```bash
claude -p "为 src/ 目录下所有公共 API 生成 JSDoc 文档"
```

---

## 命令行参数详解

### 核心标志

| 标志 | 描述 | 示例 |
|------|------|------|
| `-p, --prompt` | 运行特定提示后退出 (无头模式) | `claude -p "task"` |
| `--headless` | 显式启用无头模式 | `claude --headless "task"` |
| `--input` | 从文件读取输入 | `claude --input task.txt` |
| `--output` | 将输出写入文件 | `claude --output result.txt` |
| `--model` | 指定使用的模型 | `claude --model claude-3-opus` |
| `--no-confirm` | 跳过确认提示 (自动化用) | `claude --no-confirm -p "task"` |

### 完整命令示例

```bash
# 从文件读取任务,输出到文件
claude --headless --input tasks.txt --output results.json

# 指定模型并跳过确认
claude -p "生成单元测试" --model claude-3-sonnet --no-confirm

# 组合使用
claude --headless \
  --input requirements.md \
  --output implementation.py \
  --model claude-3-opus \
  --no-confirm
```

---

## 集成与扩展

### Model Context Protocol (MCP)

MCP 允许 Claude Code 连接外部数据源和自定义工具。

#### 支持的集成

| 类型 | 工具 | 用途 |
|------|------|------|
| **文档/数据** | Google Drive, Figma, Slack | 读取和分析文档 |
| **项目管理** | Jira | 更新工作项和票据 |
| **开发工具** | 自定义工具 | 连接内部开发平台 |

#### MCP 配置示例

```json
// .claude/mcp-config.json
{
  "tools": [
    {
      "type": "google-drive",
      "credentials": "/path/to/credentials.json"
    },
    {
      "type": "jira",
      "server": "https://company.atlassian.net",
      "token": "${JIRA_TOKEN}"
    }
  ]
}
```

### 插件系统

Claude Code 支持通过插件扩展功能。

#### 插件结构

```
.claude-plugin/
├── config.json          # 插件配置
├── commands/            # 自定义命令
│   └── my-command.sh
└── agents/              # 自定义智能代理
    └── my-agent.js
```

#### 自定义命令示例

```json
// .claude-plugin/config.json
{
  "name": "my-custom-plugin",
  "version": "1.0.0",
  "commands": [
    {
      "name": "deploy",
      "description": "部署应用到生产环境",
      "script": "commands/deploy.sh"
    }
  ]
}
```

```bash
# commands/deploy.sh
#!/bin/bash
echo "开始部署..."
npm run build
kubectl apply -f k8s/
echo "部署完成!"
```

使用自定义命令:

```bash
claude -p "运行 deploy 命令"
```

### Hooks (钩子)

Claude Code 支持生命周期钩子,可在特定事件触发时执行操作。

#### 常见钩子类型

| 钩子 | 触发时机 | 用途 |
|------|----------|------|
| `pre-commit` | Git 提交前 | 代码检查、格式化 |
| `post-commit` | Git 提交后 | 通知、日志记录 |
| `pre-push` | Git 推送前 | 运行测试 |
| `task-start` | 任务开始时 | 初始化环境 |
| `task-complete` | 任务完成时 | 清理、报告 |

#### Hook 配置示例

```bash
# .claude/hooks/pre-commit
#!/bin/bash
claude -p "检查代码是否符合团队规范,如有问题请自动修复"
```

---

## 最佳实践

### 1. 任务描述的编写

#### ✅ 好的实践

```bash
# 具体、明确的任务
claude -p "在 src/api/users.ts 中添加用户认证中间件,使用 JWT token 验证"

# 包含验收标准
claude -p "重构 calculatePrice 函数,要求: 1) 使用 TypeScript 严格模式 2) 添加单元测试 3) 性能提升至少 20%"
```

#### ❌ 避免的做法

```bash
# 过于模糊
claude -p "改进代码"

# 缺乏上下文
claude -p "修复 bug"
```

### 2. 错误处理

#### 捕获和记录错误

```bash
#!/bin/bash

# 执行任务并捕获错误
if ! claude -p "运行测试套件" 2> error.log; then
  echo "任务失败,错误日志:"
  cat error.log
  # 发送告警
  curl -X POST https://hooks.slack.com/... -d "$(cat error.log)"
  exit 1
fi
```

### 3. 输出管理

#### 结构化输出

```bash
# 请求 JSON 格式输出
claude -p "分析代码复杂度,以 JSON 格式输出结果" --output complexity.json

# 解析输出
cat complexity.json | jq '.modules[] | select(.complexity > 10)'
```

### 4. 安全性考虑

#### 敏感信息保护

```bash
# ❌ 不要在命令行中硬编码敏感信息
claude -p "部署到 production,密码是 MyPassword123"

# ✅ 使用环境变量
export DB_PASSWORD=$(vault read secret/db/password)
claude -p "部署到 production,使用 \$DB_PASSWORD 环境变量"
```

#### API 密钥管理

```bash
# 使用密钥管理工具
export ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value --secret-id claude-api-key --query SecretString --output text)
```

### 5. 性能优化

#### 并行处理

```bash
#!/bin/bash

# 并行处理多个任务
tasks=(
  "检查代码风格"
  "运行单元测试"
  "生成文档"
)

for task in "${tasks[@]}"; do
  claude -p "$task" &
done

# 等待所有任务完成
wait
echo "所有任务已完成"
```

---

## 故障排除

### 常见问题

#### 1. 认证失败

**症状**: `Authentication failed` 错误

**解决方案**:
```bash
# 检查 API 密钥
echo $ANTHROPIC_API_KEY

# 重新设置
export ANTHROPIC_API_KEY="your-valid-key"

# 或重新登录
claude logout
claude
```

#### 2. 网络超时

**症状**: `Request timeout` 错误

**解决方案**:
```bash
# 设置代理
export HTTP_PROXY="http://proxy:8080"

# 增加超时时间
claude -p "task" --timeout 300
```

#### 3. 无头模式无输出

**症状**: 命令执行但没有输出

**解决方案**:
```bash
# 显式指定输出文件
claude -p "task" --output result.txt

# 或重定向标准输出
claude -p "task" > output.log 2>&1
```

#### 4. 权限问题

**症状**: `Permission denied` 错误

**解决方案**:
```bash
# 检查文件权限
ls -la ~/.claude/

# 修复权限
chmod 755 ~/.claude/
chmod 600 ~/.claude/config
```

### 调试技巧

#### 启用详细日志

```bash
# 设置日志级别
export CLAUDE_LOG_LEVEL=debug

# 运行任务
claude -p "task" 2>&1 | tee debug.log
```

#### 查看执行历史

```bash
# 查看命令历史
claude history

# 查看详细的会话日志
cat ~/.claude/logs/session-$(date +%Y%m%d).log
```

---

## 高级用例

### 1. 构建自定义 CI/CD 流水线

```yaml
# .github/workflows/claude-pipeline.yml
name: Claude Automated Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  code-analysis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Claude Code
        run: |
          npm install -g @anthropic-ai/claude-code

      - name: Code Review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          claude -p "审查本次提交的代码变更,检查:
          1. 代码质量和最佳实践
          2. 潜在的安全漏洞
          3. 性能问题
          输出 JSON 格式的报告" --output report.json

      - name: Auto Fix Issues
        if: success()
        run: |
          claude -p "根据 report.json 中的问题自动修复可以修复的项目"

      - name: Create PR Comment
        uses: actions/github-script@v6
        with:
          script: |
            const report = require('./report.json');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## Claude Code 审查报告\n\n${JSON.stringify(report, null, 2)}`
            });
```

### 2. 智能日志分析系统

```bash
#!/bin/bash
# log-monitor.sh

LOG_FILE="/var/log/application.log"
ANALYSIS_INTERVAL=300  # 5分钟

while true; do
  # 获取最新日志
  tail -n 1000 "$LOG_FILE" > /tmp/recent.log

  # 使用 Claude 分析
  claude -p "分析日志文件 /tmp/recent.log,识别:
  1. 错误模式和频率
  2. 性能异常
  3. 安全威胁
  4. 需要立即关注的问题

  输出 JSON 格式,包含严重级别和建议的操作" \
  --output /tmp/analysis.json

  # 处理高优先级告警
  jq -r '.alerts[] | select(.severity == "critical")' /tmp/analysis.json | while read alert; do
    # 发送 Slack 通知
    curl -X POST "$SLACK_WEBHOOK" -d "{\"text\": \"🚨 Critical Alert: $alert\"}"

    # 自动采取修复措施
    claude -p "针对告警: $alert, 执行自动修复措施"
  done

  sleep $ANALYSIS_INTERVAL
done
```

### 3. 多项目批处理管理

```bash
#!/bin/bash
# multi-project-update.sh

PROJECTS=(
  "/path/to/project-a"
  "/path/to/project-b"
  "/path/to/project-c"
)

for project in "${PROJECTS[@]}"; do
  echo "处理项目: $project"
  cd "$project"

  # 对每个项目执行相同的任务
  claude -p "执行以下任务:
  1. 更新所有依赖到最新的兼容版本
  2. 运行完整测试套件
  3. 如果测试通过,创建 git commit
  4. 生成变更摘要报告
  " --output "$project/update-report.txt"

  # 检查结果
  if [ $? -eq 0 ]; then
    echo "✅ $project 更新成功"
  else
    echo "❌ $project 更新失败"
  fi
done
```

---

## 资源链接

### 官方文档

- [Claude Code 官方文档](https://code.claude.com/docs)
- [Claude API 文档](https://docs.anthropic.com/claude/reference)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)

### GitHub 资源

- [Claude Code GitHub 仓库](https://github.com/anthropics/claude-code)
- [示例和模板](https://github.com/anthropics/claude-code/tree/main/examples)
- [插件开发指南](https://github.com/anthropics/claude-code/blob/main/docs/plugins.md)

### 社区资源

- [Claude Code Discord 社区](https://discord.gg/anthropic)
- [问题反馈](https://github.com/anthropics/claude-code/issues)

---

## 总结

Claude Code 的无头模式为开发者提供了强大的自动化能力。通过 `-p` 标志和其他命令行选项,您可以:

✅ 将 AI 辅助编程集成到 CI/CD 流水线
✅ 自动化重复性的开发任务
✅ 构建智能监控和告警系统
✅ 批量处理代码维护工作
✅ 通过 MCP 和插件扩展功能

掌握这些技术,可以显著提升开发效率并减少手动操作的错误。

---

**文档维护者**: Agent Executor Team
**版本**: 1.0.0
**许可**: MIT
