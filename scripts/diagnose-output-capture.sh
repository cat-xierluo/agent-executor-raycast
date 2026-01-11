#!/bin/bash
# Cloud Code 输出捕获诊断脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CLAUDE_BIN="${CLAUDE_BIN:-$HOME/.local/bin/claude}"

echo "=========================================="
echo "Cloud Code 输出捕获诊断"
echo "=========================================="
echo ""

# 1. 检查 claude 二进制文件
echo "1. 检查 Cloud Code 二进制文件..."
if [ -f "$CLAUDE_BIN" ]; then
    echo "   ✓ 找到: $CLAUDE_BIN"
    CLAUDE_VERSION="$("$CLAUDE_BIN" --version 2>&1 || echo "未知版本")"
    echo "   版本: $CLAUDE_VERSION"
else
    echo "   ✗ 未找到: $CLAUDE_BIN"
    echo "   提示: 请安装 Cloud Code CLI 或设置 CLAUDE_BIN 环境变量"
    exit 1
fi
echo ""

# 2. 测试简单命令的输出（不使用 --print）
echo "2. 测试简单命令（不使用 --print）..."
TEST_OUTPUT_1="$("$CLAUDE_BIN" --help 2>&1 || true)"
if [ -n "$TEST_OUTPUT_1" ]; then
    echo "   ✓ 有输出（前100字符）:"
    echo "   ${TEST_OUTPUT_1:0:100}..."
else
    echo "   ✗ 无输出"
fi
echo ""

# 3. 测试 --print 参数
echo "3. 测试 --print 参数..."
TEST_CMD="echo 'hello from cloud code'"
TEST_OUTPUT_2="$("$CLAUDE_BIN" --print --dangerously-skip-permissions "$TEST_CMD" 2>&1 || true)"
if [ -n "$TEST_OUTPUT_2" ]; then
    echo "   ✓ 有输出:"
    echo "$TEST_OUTPUT_2"
else
    echo "   ✗ 无输出"
fi
echo ""

# 4. 测试使用 tee 捕获输出
echo "4. 测试 tee 命令捕获输出..."
TEMP_FILE=$(mktemp)
echo "   临时文件: $TEMP_FILE"

TEST_CMD_WITH_TEE="cd \"$PROJECT_DIR\" && \"$CLAUDE_BIN\" --print --dangerously-skip-permissions \"echo 'test output'\" 2>&1 | tee \"$TEMP_FILE\"; exit \${PIPESTATUS[0]}"
echo "   执行命令: $TEST_CMD_WITH_TEE"

eval "$TEST_CMD_WITH_TEE" || true

if [ -f "$TEMP_FILE" ]; then
    FILE_SIZE=$(stat -f%z "$TEMP_FILE" 2>/dev/null || stat -c%s "$TEMP_FILE" 2>/dev/null || echo "0")
    echo "   ✓ 临时文件已创建，大小: $FILE_SIZE 字节"

    if [ "$FILE_SIZE" -gt 0 ]; then
        echo "   ✓ 文件内容:"
        cat "$TEMP_FILE" | sed 's/^/   /'
    else
        echo "   ✗ 文件为空"
    fi

    rm -f "$TEMP_FILE"
else
    echo "   ✗ 临时文件未创建"
fi
echo ""

# 5. 测试实际命令（如果有的话）
echo "5. 测试实际命令执行..."
if [ -f "$PROJECT_DIR/.claude/commands" ]; then
    COMMAND_COUNT=$(ls -1 "$PROJECT_DIR/.claude/commands"/*.md 2>/dev/null | wc -l)
    echo "   找到 $COMMAND_COUNT 个命令文件"

    if [ "$COMMAND_COUNT" -gt 0 ]; then
        FIRST_CMD=$(ls -1 "$PROJECT_DIR/.claude/commands"/*.md 2>/dev/null | head -1)
        CMD_NAME=$(basename "$FIRST_CMD" .md)
        echo "   测试命令: /$CMD_NAME"

        TEMP_FILE_2=$(mktemp)
        TEST_REAL_CMD="cd \"$PROJECT_DIR\" && \"$CLAUDE_BIN\" --print --dangerously-skip-permissions \"/$CMD_NAME\" 2>&1 | tee \"$TEMP_FILE_2\"; exit \${PIPESTATUS[0]}"

        echo "   执行中..."
        eval "$TEST_REAL_CMD" || true

        if [ -f "$TEMP_FILE_2" ]; then
            FILE_SIZE_2=$(stat -f%z "$TEMP_FILE_2" 2>/dev/null || stat -c%s "$TEMP_FILE_2" 2>/dev/null || echo "0")
            echo "   输出大小: $FILE_SIZE_2 字节"

            if [ "$FILE_SIZE_2" -gt 0 ]; then
                echo "   输出内容（前500字符）:"
                head -c 500 "$TEMP_FILE_2" | sed 's/^/   /'
                echo "   ..."
            else
                echo "   ✗ 无输出"
            fi

            rm -f "$TEMP_FILE_2"
        fi
    fi
else
    echo "   未找到 .claude/commands 目录"
fi
echo ""

echo "=========================================="
echo "诊断完成"
echo "=========================================="
echo ""
echo "总结:"
echo "- Cloud Code CLI: $([ -f "$CLAUDE_BIN" ] && echo "已安装" || echo "未安装")"
echo "- --print 参数: $([ -n "$TEST_OUTPUT_2" ] && echo "有输出" || echo "无输出")"
echo "- tee 捕获: $([ -f "$TEMP_FILE" ] && [ "$FILE_SIZE" -gt 0 ] && echo "成功" || echo "失败")"
echo ""
echo "建议:"
echo "1. 如果 --print 参数无输出，可能是 Cloud Code 版本问题"
echo "2. 如果 tee 捕获失败，可能是 shell 环境问题"
echo "3. 查看完整输出日志以了解详细情况"
