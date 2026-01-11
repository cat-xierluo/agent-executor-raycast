#!/bin/bash

echo "=== DevonThink 文件获取测试 ==="
echo ""
echo "请确保："
echo "1. DevonThink 正在运行"
echo "2. 在 DevonThink 中选中了一个文件"
echo ""
echo "按 Enter 继续..."
read

echo ""
echo "运行 AppleScript 测试..."

APPLESCRIPT=$(cat <<'EOF'
tell application id "com.devon-technologies.thinkpro2"
  try
    set theSelection to (selection as list)
    if theSelection is {} then
      return "❌ 没有选中任何文件"
    end if

    set resultList to {}
    repeat with theRecord in theSelection
      set theName to name of theRecord
      set thePath to path of theRecord
      set theUUID to id of theRecord

      set resultString to "名称: " & theName & "\n路径: " & thePath & "\nUUID: " & theUUID
      set end of resultList to resultString
    end repeat

    return resultList as string
  on error errMsg
    return "❌ 错误: " & errMsg
  end try
end tell
EOF
)

RESULT=$(osascript -e "$APPLESCRIPT" 2>&1)

echo ""
echo "=== 结果 ==="
echo "$RESULT"
echo ""

if [[ "$RESULT" == *"❌"* ]]; then
  echo "⚠️  检测到错误或没有选中文件"
  echo ""
  echo "故障排除建议："
  echo "1. 确认 DevonThink 正在运行"
  echo "2. 在 DevonThink 中选中一个文件（不是文件夹）"
  echo "3. 确认文件是索引文件（不是导入到数据库的文件）"
  echo "4. 检查 DevonThink 版本（需要 DevonThink 3 或 Pro）"
else
  echo "✅ 成功获取文件信息！"
fi
