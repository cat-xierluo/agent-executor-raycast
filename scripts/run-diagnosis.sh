#!/bin/bash

# DevonThink 诊断脚本运行器

echo "=== DevonThink 诊断工具 ==="
echo ""
echo "使用说明:"
echo "1. 请先在 DevonThink 中选中一个文件"
echo "2. 确保已授予 Raycast 和终端必要的权限"
echo "3. 运行此脚本查看该文件的路径信息"
echo ""
echo "按 Enter 继续..."
read

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APPLESCRIPT_PATH="$SCRIPT_DIR/diagnose-devonthink.applescript"

echo "运行诊断脚本..."
osascript "$APPLESCRIPT_PATH"
