import { execSync } from "child_process";
import { showToast, Toast } from "@raycast/api";

// 支持的 DevonThink 版本
const DEVONTHINK_BUNDLE_IDS = [
  "com.devon-technologies.think3",     // DevonThink 3
  "com.devon-technologies.thinkpro2",  // DevonThink Pro 2
  "com.devon-technologies.think2",     // DevonThink 2
];

// 获取当前运行的 DevonThink 的 bundle ID
function getDevonThinkBundleId(): string {
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

export interface DevonThinkRecord {
  path: string;
  name: string;
  uuid?: string;
  type: "file" | "directory";
  referenceUrl?: string; // x-devonthink-item:// URL
  hasFileSystemPath: boolean; // 是否有有效的文件系统路径
}

/**
 * 获取 DevonThink 中当前选中的记录（改进版）
 * 支持多种路径获取方式，包括 x-devonthink-item:// URL
 */
export async function getSelectedDevonThinkRecords(): Promise<DevonThinkRecord[]> {
  // 获取当前运行的 DevonThink 的 bundle ID
  let bundleId: string;
  try {
    bundleId = getDevonThinkBundleId();
  } catch (error) {
    throw new Error("DEVONthink 未运行，请先启动 DEVONthink");
  }

  const appleScript = `
    tell application id "${bundleId}"
      try
        -- 使用正确的 selection as list 构造
        set theSelection to (selection as list)
        if theSelection is {} then
          return "No selection"
        end if

        set resultList to {}
        repeat with theRecord in theSelection
          -- 获取基本属性
          set theName to name of theRecord
          set theUUID to id of theRecord
          set recordType to type of theRecord

          -- 尝试获取文件系统路径
          set thePath to ""
          set hasPath to "false"

          try
            set thePath to path of theRecord
            if thePath is not missing value and thePath is not "" then
              set hasPath to "true"
            end if
          on error
            set thePath to ""
          end try

          -- 获取 reference URL (x-devonthink-item://)
          set theRefURL to ""
          try
            set theRefURL to reference URL of theRecord
          on error
            set theRefURL to ""
          end try

          -- 如果没有文件系统路径，尝试使用 content path
          if hasPath is "false" then
            try
              set thePath to content path of theRecord
              if thePath is not missing value and thePath is not "" then
                set hasPath to "true"
              end if
            on error
              set thePath to ""
            end try
          end if

          -- 构造结果字符串
          set resultString to thePath & "||" & theName & "||" & theUUID & "||" & recordType & "||" & theRefURL & "||" & hasPath
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

    // 检查是否有错误
    if (result.startsWith("Error:")) {
      throw new Error(result.replace("Error: ", ""));
    }

    if (result === "No selection" || result === "") {
      return [];
    }

    // 解析结果
    const records: DevonThinkRecord[] = result.split(", ")
      .map((item) => {
        const [path, name, uuid, type, referenceUrl, hasPath] = item.split("||");

        // 如果没有文件系统路径，使用 reference URL
        const finalPath = (path && hasPath === "true") ? path : (referenceUrl || "");

        return {
          path: finalPath,
          name: name || path.split("/").pop() || "",
          uuid,
          type: type === "group" ? "directory" : "file",
          referenceUrl: referenceUrl || undefined,
          hasFileSystemPath: hasPath === "true"
        };
      })
      // 过滤掉没有有效路径的记录
      .filter((record) => record.path && record.path.trim().length > 0);

    return records;
  } catch (error) {
    // DEVONthink 未运行或未安装
    if (error instanceof Error && error.message.includes("com.devon-technologies.thinkpro2")) {
      throw new Error("DEVONthink 未运行，请先启动 DEVONthink");
    }
    throw error;
  }
}

/**
 * 检查 DEVONthink 是否可用
 */
export async function checkDevonThinkAvailable(): Promise<boolean> {
  try {
    getDevonThinkBundleId();
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取当前前台应用的 bundle ID
 * 用于智能判断应该使用哪个来源的文件选择
 */
export async function getFrontmostApplication(): Promise<string> {
  try {
    const appleScript = `
      tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
        return frontApp
      end tell
    `;

    const result = execSync(`osascript -e '${appleScript.replace(/'/g, "\\'")}'`, {
      encoding: "utf-8",
    }).trim();

    return result;
  } catch (error) {
    console.error("Failed to get frontmost application:", error);
    return "";
  }
}

/**
 * 检查 Finder 是否是当前前台应用
 */
export async function isFinderFrontmost(): Promise<boolean> {
  try {
    const frontApp = await getFrontmostApplication();
    return frontApp === "Finder";
  } catch {
    return false;
  }
}

/**
 * 检查路径是否为 x-devonthink-item:// URL
 */
export function isDevonThinkURL(path: string): boolean {
  return path.startsWith("x-devonthink-item://");
}

/**
 * 检查路径是否在 Files.noindex 中（DevonThink 的内部存储）
 */
export function isFilesNoIndexPath(path: string): boolean {
  return path.includes("/Files.noindex/");
}

/**
 * 将 x-devonthink-item:// URL 导出为临时文件
 * 用于处理没有文件系统路径的数据库记录
 */
export async function exportDevonThinkRecordToTemp(record: DevonThinkRecord): Promise<string> {
  if (!record.referenceUrl) {
    throw new Error("该记录没有 reference URL");
  }

  const bundleId = getDevonThinkBundleId();
  const tempDir = `/tmp/autoweave-devonthink`;
  const appleScript = `
    tell application id "${bundleId}"
      try
        set theRecord to get record at id "${record.uuid}"
        if theRecord is missing value then
          error "Record not found"
        end if

        set theName to name of theRecord
        set thePath to "${tempDir}/" & theName

        -- 导出文件到临时目录
        export theRecord to file thePath

        return thePath
      on error errMsg
        return "Error: " & errMsg
      end try
    end tell
  `;

  try {
    // 确保临时目录存在
    execSync(`mkdir -p "${tempDir}"`, { encoding: "utf-8" });

    const result = execSync(`osascript -e '${appleScript.replace(/'/g, "\\'")}'`, {
      encoding: "utf-8",
    }).trim();

    if (result.startsWith("Error:")) {
      throw new Error(result.replace("Error: ", ""));
    }

    return result;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`导出文件失败: ${error.message}`);
    }
    throw error;
  }
}

/**
 * 准备用于命令执行的文件路径
 * 如果是 x-devonthink-item:// URL 或 Files.noindex 路径，先导出到临时文件
 */
export async function prepareFilePathForCommand(
  record: DevonThinkRecord
): Promise<{ path: string; isTemp: boolean; originalPath: string }> {
  // 如果是 x-devonthink-item:// URL，需要导出
  if (isDevonThinkURL(record.path)) {
    const tempPath = await exportDevonThinkRecordToTemp(record);
    return {
      path: tempPath,
      isTemp: true,
      originalPath: record.path,
    };
  }

  // 如果是 Files.noindex 路径，也需要导出（路径是动态的，不可靠）
  if (isFilesNoIndexPath(record.path)) {
    const tempPath = await exportDevonThinkRecordToTemp(record);
    return {
      path: tempPath,
      isTemp: true,
      originalPath: record.path,
    };
  }

  // 否则直接使用原路径
  return {
    path: record.path,
    isTemp: false,
    originalPath: record.path,
  };
}
