#!/bin/bash
# 测试修复后的输出捕获

set -e

CLAUDE_BIN="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
TEMP_FILE=$(mktemp)

echo "=========================================="
echo "测试修复后的输出捕获"
echo "=========================================="
echo ""
echo "临时文件: $TEMP_FILE"
echo ""

# 测试新的命令格式（不使用 tee）
echo "执行命令（直接重定向）:"
echo 'cd "/Users/maoking/Library/Application Support/maoscripts/AutoWeave" && "/Users/maoking/.local/bin/claude" --print --dangerously-skip-permissions "echo test" > "'$TEMP_FILE'" 2>&1'
echo ""

cd "/Users/maoking/Library/Application Support/maoscripts/AutoWeave" && "/Users/maoking/.local/bin/claude" --print --dangerously-skip-permissions "echo test" > "$TEMP_FILE" 2>&1
EXIT_CODE=$?

echo "退出码: $EXIT_CODE"
echo ""

if [ -f "$TEMP_FILE" ]; then
    FILE_SIZE=$(stat -f%z "$TEMP_FILE" 2>/dev/null || stat -c%s "$TEMP_FILE" 2>/dev/null || echo "0")
    echo "✓ 文件已创建，大小: $FILE_SIZE 字节"
    echo ""

    if [ "$FILE_SIZE" -gt 0 ]; then
        echo "✓ 输出内容:"
        cat "$TEMP_FILE" | sed 's/^/  /'
        echo ""

        # 检查输出是否是期望的结果
        if grep -q "test" "$TEMP_FILE"; then
            echo "✓ 测试通过！输出包含预期内容"
        else
            echo "✗ 测试失败！输出不包含预期内容"
        fi
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
