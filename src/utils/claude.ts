import { spawn } from "child_process";
import { join, resolve } from "path";
import { homedir } from "os";
import { readFileSync, readdirSync, existsSync } from "fs";
import { getPreferenceValues } from "@raycast/api";

export interface AgentExecutorConfig {
  projectDirs: string[];  // 改为数组，支持多个项目目录
  claudeBin: string;
}

export interface Preferences {
  projectDir1: string;
  projectDir2?: string;
  projectDir3?: string;
  projectDir4?: string;
  projectDir5?: string;
  claudeBin?: string;
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

  return {
    projectDirs: validDirs,
    claudeBin,
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
}

export interface ClaudeExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  duration: number;
  pid?: number;
}

export async function executeClaudeCommand(
  options: ClaudeExecutionOptions,
  logger?: { startRealtimeLogging: () => void; logRealtime: (chunk: string) => void; logExecuting?: (prompt: string, pid?: number) => void }
): Promise<ClaudeExecutionResult> {
  const { projectDir, claudeBin: customClaudeBin, prompt, workDir } = options;
  const claudeBin = customClaudeBin || join(homedir(), ".local/bin/claude");

  const startTime = Date.now();

  // 启动实时日志流 - 已禁用，改为仅使用JSONL日志
  // if (logger) {
  //   logger.startRealtimeLogging();
  // }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    // 使用 spawn 启动子进程，这样可以获取 PID
    const child = spawn(claudeBin, [
      "--print",
      "--dangerously-skip-permissions",
      prompt,
    ], {
      cwd: projectDir,
      env: { ...process.env },
    });

    const pid = child.pid;

    // 立即记录执行开始事件（在进程启动后）
    if (logger && logger.logExecuting) {
      logger.logExecuting(prompt, pid);
    }

    child.stdout?.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;

      // 实时写入日志 - 已禁用，改为仅使用JSONL日志
      // if (logger) {
      //   logger.logRealtime(chunk);
      // }
    });

    child.stderr?.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;

      // 实时写入日志（包括 stderr）- 已禁用，改为仅使用JSONL日志
      // if (logger) {
      //   logger.logRealtime(chunk);
      // }
    });

    child.on("close", (code) => {
      const duration = Date.now() - startTime;
      const combinedOutput = stderr ? `${stdout}\n\n=== 错误信息 ===\n${stderr}` : stdout;

      resolve({
        success: code === 0,
        output: combinedOutput,
        error: stderr || undefined,
        exitCode: code || 0,
        duration,
        pid,
      });
    });

    child.on("error", (error) => {
      const duration = Date.now() - startTime;
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
      child.kill();
      const duration = Date.now() - startTime;
      resolve({
        success: false,
        output: "命令执行超时（5分钟）",
        error: "Timeout after 5 minutes",
        exitCode: -1,
        duration,
        pid,
      });
    }, 300000);
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
