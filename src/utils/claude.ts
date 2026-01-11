import { spawn, execSync } from "child_process";
import { join, resolve } from "path";
import { homedir, tmpdir } from "os";
import { readFileSync, readdirSync, existsSync, unlinkSync, writeFileSync, chmodSync } from "fs";
import { getPreferenceValues } from "@raycast/api";

export interface AgentExecutorConfig {
  projectDirs: string[];  // 改为数组，支持多个项目目录
  claudeBin: string;
  headlessMode: boolean;
}

export interface Preferences {
  projectDir1: string;
  projectDir2?: string;
  projectDir3?: string;
  projectDir4?: string;
  projectDir5?: string;
  claudeBin?: string;
  headlessMode?: boolean;
}

/**
 * 验证目录是否是有效的项目目录（包含 .claude/commands/）
 */
export function isValidProjectDir(dir: string): boolean {
  const commandsDir = join(dir, ".claude/commands");
  return existsSync(commandsDir);
}

/**
 * 从目录路径提取项目名称
 */
export function getProjectName(dir: string): string {
  // 获取目录的最后一部分作为项目名
  const parts = dir.split("/").filter(p => p && p !== "");
  const lastName = parts[parts.length - 1] || dir;

  // 如果是隐藏目录（以 . 开头），去掉点
  if (lastName.startsWith(".")) {
    return lastName.slice(1);
  }

  return lastName;
}

/**
 * 从 Raycast preferences 加载配置
 * 如果配置无效，会抛出错误
 */
export function loadConfig(): AgentExecutorConfig {
  const prefs = getPreferenceValues<Preferences>();

  // 收集所有配置的目录（展开 ~ 并过滤空值）
  const rawDirs = [
    prefs.projectDir1,
    prefs.projectDir2,
    prefs.projectDir3,
    prefs.projectDir4,
    prefs.projectDir5,
  ].filter(Boolean);

  const projectDirs = rawDirs.map(dir => dir.replace(/^~/, homedir()));

  // 验证至少有一个有效目录
  const validDirs = projectDirs.filter(isValidProjectDir);

  if (validDirs.length === 0) {
    const error = new Error(
      `未找到有效的项目目录\n\n` +
      `请检查：\n` +
      `1. 至少配置一个有效的项目目录\n` +
      `2. 目录必须包含 .claude/commands/ 子目录\n\n` +
      `已配置的目录：\n` +
      projectDirs.map(d => `  - ${d}`).join("\n") +
      `\n\n提示：请在 Raycast 扩展设置中重新配置项目目录。`
    );
    (error as any).isConfigError = true;
    throw error;
  }

  const claudeBin = (prefs.claudeBin || "~/.local/bin/claude").replace(/^~/, homedir());

  // headlessMode 默认为 true（向后兼容）
  const headlessMode = prefs.headlessMode !== false;

  return {
    projectDirs: validDirs,
    claudeBin,
    headlessMode,
  };
}

/**
 * @deprecated 使用 loadConfig() 代替
 * 保留此函数以向后兼容，但建议使用 loadConfig()
 */
export function getConfig(): AgentExecutorConfig {
  // 直接使用 loadConfig()，不提供硬编码回退
  // 如果配置无效，让错误传播给调用者
  return loadConfig();
}

export interface ClaudeExecutionOptions {
  prompt: string;
  workDir: string;
  projectDir: string;
  claudeBin?: string;
  headlessMode?: boolean;
}

export interface ClaudeExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  duration: number;
  pid?: number;
  sessionId?: string;  // Claude Code session ID，用于恢复对话
}

export async function executeClaudeCommand(
  options: ClaudeExecutionOptions,
  logger?: { startRealtimeLogging: () => void; logRealtime: (chunk: string) => void; logExecuting?: (prompt: string, pid?: number) => void }
): Promise<ClaudeExecutionResult> {
  const { projectDir, claudeBin: customClaudeBin, prompt, workDir, headlessMode = true } = options;
  const claudeBin = customClaudeBin || join(homedir(), ".local/bin/claude");

  const startTime = Date.now();

  // 如果不是无头模式，在新的 Terminal 窗口中运行 Claude Code
  if (!headlessMode) {
    return new Promise((resolve) => {
      try {
        // 创建临时脚本文件，避免复杂的转义问题
        const scriptPath = join(tmpdir(), `claude-visible-${Date.now()}.sh`);
        const sessionFile = join(tmpdir(), `claude-session-${Date.now()}.json`);

        const scriptContent = `#!/bin/bash
cd "${projectDir}"
echo "=== 执行 Claude Code 命令 ==="
echo "命令: ${prompt}"
echo ""

# 使用 JSON 输出格式以捕获 session ID
"${claudeBin}" --print --dangerously-skip-permissions --output-format json "${prompt}" > "${sessionFile}"

# 提取并显示结果和 session ID
if [ -f "${sessionFile}" ]; then
  # 提取 session_id
  SESSION_ID=$(cat "${sessionFile}" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)

  # 提取并显示结果
  cat "${sessionFile}" | grep -o '"result":"[^"]*"' | sed 's/"result":"//' | sed 's/"$//' | sed 's/\\\\n/\\n/g'

  echo ""
  echo "=== 执行完成 ==="
  echo "Session ID: $SESSION_ID"
  echo ""
  echo "💡 恢复此对话: claude --resume $SESSION_ID"
  echo "你可以查看上方输出，手动关闭此窗口。"

  # 清理临时文件
  rm -f "${sessionFile}"
else
  echo "执行失败：未生成输出文件"
fi
`;

        // 写入脚本文件并设置可执行权限
        writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

        // 使用简单的 AppleScript 打开 Terminal 并执行脚本
        const appleScript = `tell application "Terminal"
  activate
  do script "${scriptPath}"
end tell`;

        execSync(`osascript -e '${appleScript}'`);

        // 延迟删除脚本文件，给 Terminal 足够时间读取
        setTimeout(() => {
          try {
            if (existsSync(scriptPath)) {
              unlinkSync(scriptPath);
            }
          } catch (e) {
            // 忽略删除失败
          }
        }, 5000);

        if (logger && logger.logExecuting) {
          logger.logExecuting(prompt, undefined);
        }

        const duration = Date.now() - startTime;
        resolve({
          success: true,
          output: "(已在新的 Terminal 窗口中启动 Claude Code，请查看终端窗口)",
          exitCode: 0,
          duration,
          pid: undefined,
          sessionId: undefined, // 可视化模式下session ID在终端显示，不返回
        });
      } catch (error: any) {
        const duration = Date.now() - startTime;
        resolve({
          success: false,
          output: error.message || "启动终端窗口失败",
          error: error.message,
          exitCode: 1,
          duration,
          pid: undefined,
          sessionId: undefined,
        });
      }
    });
  }

  // 创建临时文件用于捕获输出(使用 JSON 格式以提取 session ID)
  const tempOutputFile = join(tmpdir(), `claude-output-${Date.now()}-${process.pid}.json`);

  // 启动实时日志流
  if (logger) {
    logger.startRealtimeLogging();
  }

  return new Promise((resolve) => {
    let pid: number | undefined;

    try {
      // 使用 bash 包装，直接重定向到文件（不使用 tee，避免 Cloud Code 进入交互模式）
      // 2>&1 将 stderr 重定向到 stdout，然后 > 重定向到文件
      const bashCommand = `cd "${projectDir}" && "${claudeBin}" --print --dangerously-skip-permissions --output-format json "${prompt.replace(/"/g, '\\"')}" > "${tempOutputFile}" 2>&1`;

      const child = spawn('/bin/bash', ['-c', bashCommand], {
        cwd: projectDir,
        env: { ...process.env },
        detached: false,
        stdio: 'ignore',  // 不使用父进程的 stdio
      });

      pid = child.pid;

      // 立即记录执行开始事件（在进程启动后）
      if (logger && logger.logExecuting) {
        logger.logExecuting(prompt, pid);
      }

      // 监听进程结束
      child.on("close", (code) => {

        const duration = Date.now() - startTime;
        let output = "";
        let sessionId: string | undefined;
        let exitCode = code || 0;

        try {
          // 读取完整输出
          if (existsSync(tempOutputFile)) {
            const rawOutput = readFileSync(tempOutputFile, 'utf-8');

            // 尝试解析 JSON 输出
            try {
              const jsonOutput = JSON.parse(rawOutput);

              // 提取 session_id
              if (jsonOutput.session_id) {
                sessionId = jsonOutput.session_id;
              }

              // 提取实际结果文本
              if (jsonOutput.result) {
                output = jsonOutput.result;
              } else {
                // 如果没有 result 字段,使用原始输出
                output = rawOutput;
              }
            } catch (parseError) {
              // JSON 解析失败,使用原始输出(可能是错误信息)
              output = rawOutput;
            }
          }

          // 清理临时文件
          if (existsSync(tempOutputFile)) unlinkSync(tempOutputFile);
        } catch (error) {
          // 清理失败不影响结果
        }

        resolve({
          success: exitCode === 0,
          output: output || "(无输出)",
          error: exitCode !== 0 ? output : undefined,
          exitCode,
          duration,
          pid,
          sessionId,
        });
      });

      child.on("error", (error) => {
        const duration = Date.now() - startTime;

        // 清理临时文件
        try {
          if (existsSync(tempOutputFile)) unlinkSync(tempOutputFile);
        } catch {}

        resolve({
          success: false,
          output: error.message,
          error: error.message,
          exitCode: 1,
          duration,
          pid,
        });
      });

      // 5 分钟后超时
      setTimeout(() => {
        // 检查子进程是否仍在运行
        try {
          process.kill(pid!, 0); // 发送信号 0 检查进程是否存在
        } catch {
          // 进程已结束，不需要超时处理
          return;
        }

        // 进程仍在运行，强制终止
        child.kill();

        const duration = Date.now() - startTime;

        // 尝试读取已有输出
        let output = "命令执行超时（5分钟）";
        try {
          if (existsSync(tempOutputFile)) {
            const partialOutput = readFileSync(tempOutputFile, 'utf-8');
            if (partialOutput) {
              output = `${partialOutput}\n\n[命令执行超时]`;
            }
            unlinkSync(tempOutputFile);
          }
        } catch {}

        resolve({
          success: false,
          output,
          error: "Timeout after 5 minutes",
          exitCode: -1,
          duration,
          pid,
        });
      }, 300000);
    } catch (error: any) {
      // 启动失败
      const duration = Date.now() - startTime;

      // 清理临时文件
      try {
        if (existsSync(tempOutputFile)) unlinkSync(tempOutputFile);
      } catch {}

      resolve({
        success: false,
        output: error.message || "执行失败",
        error: error.message,
        exitCode: 1,
        duration,
        pid,
      });
    }
  });
}

export function getRunId(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0].replace(/-/g, "");
  const time = now.toTimeString().split(" ")[0].replace(/:/g, "");
  const pid = process.pid.toString().slice(-4);
  return `run_${date}_${time}_${pid}`;
}

export interface CommandMetadata {
  name: string;
  description: string;
  filename: string;
  prompt: string;
  projectDir?: string; // 命令所属的项目目录
}

/**
 * 根据命令名称查找其所属的项目目录
 * @param commandName 命令名称（不含斜杠）
 * @param projectDirs 配置的项目目录列表
 * @returns 命令所属的项目目录，如果找不到则返回第一个项目目录
 */
export function findCommandProjectDir(commandName: string, projectDirs: string[]): string {
  const commands = getAvailableCommands(projectDirs);
  const command = commands.find(cmd => cmd.name === commandName);
  return command?.projectDir || projectDirs[0];
}

/**
 * 从多个项目目录的 .claude/commands 读取所有可用的命令
 */
export function getAvailableCommands(projectDirs: string[]): CommandMetadata[] {
  const allCommands: CommandMetadata[] = [];

  for (const projectDir of projectDirs) {
    const commandsDir = join(projectDir, ".claude/commands");

    if (!existsSync(commandsDir)) {
      continue;
    }

    const files = readdirSync(commandsDir);

    for (const file of files) {
      if (!file.endsWith(".md") || file === "CLAUDE.md" || file.startsWith("README")) {
        continue;
      }

      const filePath = join(commandsDir, file);
      try {
        let content = readFileSync(filePath, "utf-8");
        const commandName = file.replace(".md", "");

        // 检查是否使用了 @include 指令
        const includeMatch = content.match(/^@include\s+(.+)/);
        if (includeMatch) {
          // 处理 @include 指令，读取被引用的实际文件
          const includePath = includeMatch[1].trim();
          const referencedFilePath = resolve(commandsDir, includePath);

          if (existsSync(referencedFilePath)) {
            content = readFileSync(referencedFilePath, "utf-8");
          } else {
            // 如果被引用的文件不存在，跳过这个命令
            continue;
          }
        }

        // 解析 frontmatter (--- 包裹的 YAML 元数据)
        let description = commandName; // 默认使用文件名作为描述
        const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---/);
        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const descMatch = frontmatter.match(/description:\s*(.+)/);
          if (descMatch) {
            description = descMatch[1].trim().replace(/^["']|["']$/g, "");
          }
        }

        allCommands.push({
          name: commandName,
          description: description,
          filename: file,
          prompt: `/${commandName}`,
          projectDir, // 添加项目目录信息
        });
      } catch (error) {
        // 跳过无法读取的文件
        continue;
      }
    }
  }

  return allCommands.sort((a, b) => a.name.localeCompare(b.name));
}
