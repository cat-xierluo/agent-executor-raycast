#!/usr/bin/env node

/**
 * DevonThink 集成测试脚本
 * 用于诊断文件获取问题
 */

const { execSync } = require("child_process");

console.log("=== DevonThink 集成测试 ===\n");
console.log("前置条件：");
console.log("1. DevonThink 正在运行");
console.log("2. 在 DevonThink 中选中了一个文件\n");

// 支持的 DevonThink 版本
const DEVONTHINK_BUNDLE_IDS = [
  "com.devon-technologies.think3",     // DevonThink 3
  "com.devon-technologies.thinkpro2",  // DevonThink Pro 2
  "com.devon-technologies.think2",     // DevonThink 2
];

// 获取当前运行的 DevonThink 的 bundle ID
function getDevonThinkBundleId() {
  for (const bundleId of DEVONTHINK_BUNDLE_IDS) {
    try {
      execSync(`osascript -e 'tell application id "${bundleId}" to get name'`, {
        stdio: ["ignore", "pipe", "ignore"],
      });
      return bundleId;
    } catch {
      // 继续尝试下一个
    }
  }
  throw new Error("No DevonThink application found");
}

// 测试 1: 检查 DevonThink 是否运行
console.log("📋 测试 1: 检查 DevonThink 是否运行");
let bundleId;
try {
  bundleId = getDevonThinkBundleId();
  console.log(`✅ DevonThink 正在运行 (Bundle ID: ${bundleId})\n`);
} catch {
  console.log("❌ DevonThink 未运行！请先启动 DevonThink\n");
  process.exit(1);
}

// 测试 2: 获取选中的文件
console.log("📋 测试 2: 获取选中的文件");
const appleScript = `
tell application id "${bundleId}"
  try
    set theSelection to (selection as list)
    if theSelection is {} then
      return "No selection"
    end if

    set resultList to {}
    repeat with theRecord in theSelection
      set theName to name of theRecord
      set thePath to path of theRecord

      set resultString to theName & "||" & thePath
      set end of resultList to resultString
    end repeat

    return resultList as string
  on error errMsg
    return "Error: " & errMsg
  end try
end tell
`;

try {
  const result = execSync(`osascript -e '${appleScript.replace(/'/g, "\\'")}'`, {
    encoding: "utf-8",
  }).trim();

  if (result.startsWith("Error:")) {
    console.log("❌ AppleScript 错误:", result.replace("Error: ", ""), "\n");
    process.exit(1);
  }

  if (result === "No selection") {
    console.log("❌ 没有选中任何文件！");
    console.log("请在 DevonThink 中选中一个文件后重试\n");
    process.exit(1);
  }

  console.log("✅ 成功获取文件信息：\n");

  // 解析并显示结果
  const records = result.split(", ");
  records.forEach((record, index) => {
    const [name, path] = record.split("||");
    console.log(`文件 ${index + 1}:`);
    console.log(`  名称: ${name}`);
    console.log(`  路径: ${path}`);

    if (path.includes("/Files.noindex/")) {
      console.log(`  ⚠️  这是一个导入文件（在 Files.noindex 中）`);
    } else if (path.startsWith("x-devonthink-item://")) {
      console.log(`  ⚠️  这是一个 DevonThink URL（需要导出）`);
    } else {
      console.log(`  ✅ 这是一个索引文件（可以直接使用）`);
    }
    console.log("");
  });

  console.log("=== 测试完成 ===");
  console.log("✅ DevonThink 集成工作正常！");
  console.log("");
  console.log("现在请在 Raycast 中：");
  console.log("1. 按 Cmd + Space 打开 Raycast");
  console.log("2. 输入 'AutoWeave'");
  console.log("3. 选择 'AutoWeave 命令列表'");
  console.log("4. 应该能看到选中的文件并显示 '✓ 索引文件' 标记");

} catch (error) {
  console.log("❌ 执行失败:", error.message, "\n");
  process.exit(1);
}
