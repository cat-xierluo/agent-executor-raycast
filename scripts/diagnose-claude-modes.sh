#!/bin/bash
# Cloud Code 不同模式的输出测试

set -e

CLAUDE_BIN="${CLAUDE_BIN:-$HOME/.local/bin/claude}"

echo "=========================================="
echo "Cloud Code 模式测试"
echo "=========================================="
echo ""

# 测试 1: --help (应该有输出)
echo "测试 1: --help 参数"
echo "命令: $CLAUDE_BIN --help"
echo "---"
OUTPUT_1="$("$CLAUDE_BIN" --help 2>&1 || true)"
if [ -n "$OUTPUT_1" ]; then
    echo "✓ 有输出 (${#OUTPUT_1} 字符)"
    echo "前 200 字符:"
    echo "$OUTPUT_1" | head -c 200
    echo ""
else
    echo "✗ 无输出"
fi
echo ""

# 测试 2: --print "echo test" (直接输出)
echo "测试 2: --print 参数执行简单命令"
echo "命令: $CLAUDE_BIN --print --dangerously-skip-permissions \"echo test\""
echo "---"
OUTPUT_2="$("$CLAUDE_BIN" --print --dangerously-skip-permissions "echo test" 2>&1 || true)"
if [ -n "$OUTPUT_2" ]; then
    echo "✓ 有输出 (${#OUTPUT_2} 字符)"
    echo "内容:"
    echo "$OUTPUT_2"
else
    echo "✗ 无输出"
fi
echo ""

# 测试 3: 检查是否有 --headless 模式
echo "测试 3: 检查是否有 --headless 模式"
echo "命令: $CLAUDE_BIN --help | grep -i headless"
echo "---"
if "$CLAUDE_BIN" --help 2>&1 | grep -qi "headless"; then
    echo "✓ 支持 --headless 模式"
    echo "用法:"
    "$CLAUDE_BIN" --help 2>&1 | grep -i "headless" -A 2 -B 2 || true
else
    echo "✗ 未找到 --headless 选项"
fi
echo ""

# 测试 4: 测试 --headless 模式（如果存在）
echo "测试 4: 测试 --headless 模式"
echo "命令: $CLAUDE_BIN --headless --dangerously-skip-permissions \"echo test\""
echo "---"
OUTPUT_4="$("$CLAUDE_BIN" --headless --dangerously-skip-permissions "echo test" 2>&1 || true)"
if [ -n "$OUTPUT_4" ]; then
    echo "✓ 有输出 (${#OUTPUT_4} 字符)"
    echo "内容:"
    echo "$OUTPUT_4"
else
    echo "✗ 无输出"
fi
echo ""

# 测试 5: 测试执行一个实际的 skill 命令
echo "测试 5: 测试执行 skill 命令"
echo "命令: $CLAUDE_BIN --print --dangerously-skip-permissions \"/using-superpowers\""
echo "---"
OUTPUT_5="$("$CLAUDE_BIN" --print --dangerously-skip-permissions "/using-superpowers" 2>&1 || true)"
if [ -n "$OUTPUT_5" ]; then
    echo "✓ 有输出 (${#OUTPUT_5} 字符)"
    echo "内容:"
    echo "$OUTPUT_5"
else
    echo "✗ 无输出"
fi
echo ""

# 测试 6: 测试重定向到文件
echo "测试 6: 测试输出重定向"
TEMP_FILE=$(mktemp)
echo "命令: $CLAUDE_BIN --print --dangerously-skip-permissions \"echo test\" > $TEMP_FILE"
echo "---"
"$CLAUDE_BIN" --print --dangerously-skip-permissions "echo test" > "$TEMP_FILE" 2>&1 || true

if [ -f "$TEMP_FILE" ]; then
    FILE_SIZE=$(stat -f%z "$TEMP_FILE" 2>/dev/null || stat -c%s "$TEMP_FILE" 2>/dev/null || echo "0")
    echo "✓ 文件已创建，大小: $FILE_SIZE 字节"

    if [ "$FILE_SIZE" -gt 0 ]; then
        echo "内容:"
        cat "$TEMP_FILE"
    else
        echo "✗ 文件为空"
    fi

    rm -f "$TEMP_FILE"
else
    echo "✗ 文件未创建"
fi
echo ""

echo "=========================================="
echo "测试完成"
echo "=========================================="
