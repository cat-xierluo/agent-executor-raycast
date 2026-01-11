# Claude Code CLI 模式官方文档

> **来源**: https://code.claude.com/docs/en/headless
> **抓取日期**: 2026-01-11
> **说明**: 此文档原名为"Headless Mode"（无头模式），现已更名为"CLI Mode"（CLI 模式）

---

## 目录

1. [概述](#概述)
2. [核心指令](#核心指令)
3. [命令行选项详解](#命令行选项详解)
4. [实用示例](#实用示例)
5. [最佳实践](#最佳实践)
6. [进阶使用](#进阶使用)

---

## 概述

Claude Code CLI 模式（原"无头模式"）允许在非交互式环境中运行 Claude Code，适用于：

- **CI/CD 管道集成**
- **批处理任务自动化**
- **脚本化工作流**
- **与其他命令行工具的集成**

---

## 核心指令

使用 `-p`（或 `--print`）标志即可进入非交互式编程运行模式。

### 基本语法

```bash
claude -p "你的指令" [选项]
```

### 示例

```bash
# 简单任务
claude -p "分析 auth.py 中的函数"

# 带选项的任务
claude -p "运行测试并修复错误" --allowedTools "Bash,Read,Edit"
```

---

## 命令行选项详解

### 核心选项

| 选项 | 说明 | 示例 |
|------|------|------|
| `-p, --print` | 进入 CLI 模式（非交互式），输出结果后退出 | `claude -p "task"` |
| `--allowedTools` | 自动批准特定工具的使用，无需手动确认 | `--allowedTools "Bash,Read,Edit"` |
| `--output-format` | 设置输出格式：`text` (默认), `json`, 或 `stream-json` | `--output-format json` |
| `--json-schema` | 配合 `--output-format json` 使用，定义输出的 JSON Schema | 见下方示例 |
| `--continue` | 继续上一次最近的对话 | `--continue` |
| `--resume <ID>` | 使用特定的 `session_id` 恢复对话 | `--resume abc-123-def` |
| `--append-system-prompt` | 在保留默认行为的基础上追加系统提示词 | `--append-system-prompt "额外指令"` |
| `--system-prompt` | 完全替换默认的系统提示词 | `--system-prompt "自定义系统提示"` |

### 工具权限控制

`--allowedTools` 支持精细化的权限控制：

```bash
# 允许所有 Bash 命令
--allowedTools "Bash"

# 只允许特定的 git 命令
--allowedTools "Bash(git diff:*,git status:*)"

# 允许多个工具
--allowedTools "Bash,Read,Edit"
```

---

## 实用示例

### 1. 获取结构化数据 (JSON)

通过 JSON Schema 提取代码信息并使用 `jq` 解析：

```bash
claude -p "Extract function names from auth.py" \
  --output-format json \
  --json-schema '{
    "type": "object",
    "properties": {
      "functions": {
        "type": "array",
        "items": {"type": "string"}
      }
    },
    "required": ["functions"]
  }' \
  | jq '.structured_output'
```

**输出示例**:
```json
{
  "functions": ["login", "logout", "verify_token", "refresh_session"]
}
```

### 2. 自动化任务与工具授权

运行测试套件并自动修复错误，无需人工干预批准工具使用：

```bash
claude -p "Run the test suite and fix any failures" \
  --allowedTools "Bash,Read,Edit"
```

### 3. 持续对话管理

执行多步任务，保持上下文连续性：

```bash
# 步骤 1: 发起初始审核
claude -p "Review this codebase for performance issues"

# 步骤 2: 针对特定部分继续追问
claude -p "Now focus on the database queries" --continue
```

### 4. CI/CD 集成示例

将 GitHub PR 的差异内容通过管道传递给 Claude 进行安全审查：

```bash
gh pr diff "$1" | claude -p \
  --append-system-prompt "You are a security engineer. Review for vulnerabilities." \
  --output-format json
```

### 5. 批处理多个文件

```bash
# 批量处理所有 Python 文件
for file in src/**/*.py; do
  claude -p "Add type hints to $file" --allowedTools "Read,Edit"
done
```

### 6. 实时流式输出

使用 `stream-json` 格式获取实时响应：

```bash
claude -p "Explain this codebase" \
  --output-format stream-json \
  | jq -c '.content // .delta'
```

---

## 最佳实践

### 1. 指令描述规范

**✅ 好的做法**:
```bash
# 具体明确的任务
claude -p "Look at my staged changes and create an appropriate commit message"

# 包含上下文的任务
claude -p "Review auth.py for security issues, focusing on SQL injection and XSS"
```

**❌ 避免的做法**:
```bash
# 不要使用斜杠命令（在 CLI 模式下不可用）
claude -p "/commit"  # ❌ 错误

# 过于模糊的指令
claude -p "fix code"  # ❌ 缺乏上下文
```

**重要提示**: 在 `-p` 模式下，无法使用 `/commit`、`/test` 等斜杠命令。应直接描述任务，例如：
- ❌ `claude -p "/commit"`
- ✅ `claude -p "Look at my staged changes and create an appropriate commit"`

### 2. 权限与安全

**限定工具参数**增强安全性：

```bash
# ✅ 只允许安全的 git 命令
claude -p "Review recent changes" \
  --allowedTools "Bash(git diff:*,git log:*)"

# ❌ 允许所有 Bash 命令（不安全）
claude -p "Review recent changes" --allowedTools "Bash"
```

### 3. 会话跟踪

管理多个并发会话时，记录 `session_id`：

```bash
# 提取并保存 session ID
session_id=$(claude -p "Initial task" --output-format json | jq -r '.session_id')

# 稍后恢复该会话
claude -p "Continue task" --resume "$session_id"
```

### 4. 错误处理

```bash
#!/bin/bash

# 捕获错误并记录
if ! claude -p "Run tests" --allowedTools "Bash" 2> error.log; then
  echo "Task failed. Error log:"
  cat error.log
  exit 1
fi
```

### 5. 输出格式选择

| 格式 | 适用场景 |
|------|----------|
| `text` | 人类可读的默认输出 |
| `json` | 结构化数据提取，配合 `jq` 使用 |
| `stream-json` | 实时流式响应，长时间运行的任务 |

---

## 进阶使用

### 1. 自定义系统提示词

完全控制 Claude 的行为模式：

```bash
claude -p "Review code" \
  --system-prompt "You are a senior code reviewer specializing in Rust.
  Focus on memory safety, error handling, and idiomatic patterns."
```

### 2. 追加系统提示词

在保留默认能力的基础上添加额外指令：

```bash
claude -p "Analyze performance" \
  --append-system-prompt "Provide metrics in milliseconds and suggest optimizations."
```

### 3. 与其他工具集成

#### 配合 `jq` 处理 JSON

```bash
# 提取特定字段
claude -p "List all TODO comments" \
  --output-format json \
  | jq '.todos[] | select(.priority == "high")'
```

#### 配合 `grep` 过滤输出

```bash
claude -p "Explain all functions" \
  | grep -A 5 "async function"
```

#### 在脚本中使用

```bash
#!/bin/bash
# automated-review.sh

REVIEW_RESULT=$(claude -p "Review recent commits for issues" \
  --output-format json \
  --allowedTools "Bash(git log:*)")

ISSUES=$(echo "$REVIEW_RESULT" | jq -r '.issues | length')

if [ "$ISSUES" -gt 0 ]; then
  echo "Found $ISSUES issues. Creating report..."
  echo "$REVIEW_RESULT" | jq '.issues' > review-report.json
fi
```

### 4. 高级 CI/CD 集成

```yaml
# .github/workflows/claude-review.yml
name: Claude Code Review

on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install Claude Code
        run: curl -fsSL https://claude.ai/install.sh | bash

      - name: Review PR
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          gh pr diff ${{ github.event.pull_request.number }} | \
          claude -p \
            --append-system-prompt "Review for security, performance, and best practices" \
            --output-format json \
            --allowedTools "Read" \
          > review-result.json

      - name: Post Comment
        uses: actions/github-script@v6
        with:
          script: |
            const review = require('./review-result.json');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## Claude Review\n\n${review.summary}`
            });
```

---

## Agent SDK（更高级控制）

如需更高程度的控制，例如：
- **工具批准回调**
- **原生消息对象处理**
- **自定义工具集成**

建议使用 **Agent SDK**（Python 或 TypeScript 版本）：

📖 **文档**: [Agent SDK 完整文档](https://platform.claude.com/docs/en/agent-sdk/overview)

### Agent SDK 示例

```python
from anthropic import Anthropic

client = Anthropic()

response = client.agent(
    prompt="Review this codebase",
    allowed_tools=["Bash", "Read"],
    output_format="json"
)

print(response.content)
```

---

## 常见问题

### Q: CLI 模式和交互模式有什么区别？

**A**:
- **CLI 模式** (`-p` 标志): 非交互式，执行任务后立即退出，适合脚本和自动化
- **交互模式** (无 `-p` 标志): 启动 TUI 界面，可以持续对话

### Q: 为什么我的斜杠命令不工作？

**A**: CLI 模式下不支持斜杠命令（如 `/commit`）。请直接描述任务：
```bash
# ❌ 错误
claude -p "/commit"

# ✅ 正确
claude -p "Look at my staged changes and create a commit"
```

### Q: 如何在 CI 环境中使用？

**A**: 设置环境变量并使用 `--allowedTools` 避免交互提示：
```bash
export ANTHROPIC_API_KEY="your-key"
claude -p "task" --allowedTools "Bash,Read,Edit"
```

### Q: 输出格式应该选择哪个？

**A**:
- **`text`**: 默认，适合人类阅读
- **`json`**: 适合程序处理和数据提取
- **`stream-json`**: 适合长时间运行的任务，实时查看进度

---

## 资源链接

- **官方文档**: https://code.claude.com/docs/en/headless
- **Agent SDK**: https://platform.claude.com/docs/en/agent-sdk/overview
- **Claude API**: https://docs.anthropic.com/claude/reference
- **社区支持**: https://discord.gg/anthropic

---

**文档维护**: Agent Executor Team
**版本**: 2.0 (CLI Mode)
**许可**: MIT
