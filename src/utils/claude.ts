import { spawn, execSync } from "child_process";
import { join } from "path";
import { homedir, tmpdir } from "os";
import {
  readFileSync,
  existsSync,
  unlinkSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
} from "fs";
import { getPreferenceValues } from "@raycast/api";

export interface AgentExecutorConfig {
  projectDirs: string[]; // 扫描 .claude/commands/ 目录
  skillsDirs: string[]; // 扫描 ~/.claude/skills/ 目录
  claudeBin: string;
  headlessMode: boolean;
  streamingMode: boolean;
}

export interface Preferences {
  projectDir1: string;
  projectDir2?: string;
  projectDir3?: string;
  projectDir4?: string;
  projectDir5?: string;
  claudeBin?: string;
  headlessMode?: boolean;
  enableDefaultSkills?: boolean; // 新增：是否启用默认 ~/.claude/skills/
  streamingMode?: boolean; // 新增：是否启用流式输出
}

/**
 * 验证目录是否是有效的 skills 目录（包含 SKILL.md 文件）
 */
export function isValidSkillsDir(dir: string): boolean {
  if (!existsSync(dir)) return false;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    // 检查是否有子目录或符号链接目录包含 skill.md/SKILL.md
    return entries.some((entry) => {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        return (
          existsSync(join(dir, entry.name, "SKILL.md")) ||
          existsSync(join(dir, entry.name, "skill.md"))
        );
      }
      return false;
    });
  } catch {
    return false;
  }
}

/**
 * 验证目录是否是有效的项目目录（包含 .claude/skills/）
 */
export function isValidProjectDir(dir: string): boolean {
  const skillsDir = join(dir, ".claude/skills");
  return existsSync(skillsDir);
}

/**
 * 从目录路径提取项目名称
 */
export function getProjectName(dir: string): string {
  // 获取目录的最后一部分作为项目名
  const parts = dir.split("/").filter((p) => p && p !== "");
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

  const projectDirs = rawDirs.map((dir) => dir.replace(/^~/, homedir()));

  // 验证至少有一个有效目录
  const validDirs = projectDirs.filter(isValidProjectDir);

  if (validDirs.length === 0) {
    const error = new Error(
      `未找到有效的项目目录\n\n` +
        `请检查：\n` +
        `1. 至少配置一个有效的项目目录\n` +
        `2. 目录必须包含 .claude/skills/ 子目录\n\n` +
        `已配置的目录：\n` +
        projectDirs.map((d) => `  - ${d}`).join("\n") +
        `\n\n提示：请在 Raycast 扩展设置中重新配置项目目录。`,
    ) as Error & { isConfigError?: boolean };
    error.isConfigError = true;
    throw error;
  }

  const claudeBin = (prefs.claudeBin || "~/.local/bin/claude").replace(
    /^~/,
    homedir(),
  );

  // headlessMode 默认为 true（向后兼容）
  const headlessMode = prefs.headlessMode !== false;

  // streamingMode 默认为 false（向后兼容）
  const streamingMode = prefs.streamingMode === true;

  // 支持默认 ~/.claude/skills/ 目录
  const defaultSkillsDir = join(homedir(), ".claude/skills");
  const skillsDirs: string[] = [];

  if (
    prefs.enableDefaultSkills !== false &&
    isValidSkillsDir(defaultSkillsDir)
  ) {
    skillsDirs.push(defaultSkillsDir);
  }

  return {
    projectDirs: validDirs,
    skillsDirs,
    claudeBin,
    headlessMode,
    streamingMode,
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
  onPid?: (pid: number) => void;
}

export interface ClaudeExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  duration: number;
  pid?: number;
  sessionId?: string; // Claude Code session ID，用于恢复对话
  apiSuccess?: boolean; // Claude API 层面的成功状态（基于 is_error 字段），用于日志判断
}

/**
 * 流式输出的回调类型
 */
export type StreamingCallback = (chunk: string, isFinal: boolean) => void;

/**
 * 流式执行选项
 */
export interface ClaudeStreamingOptions {
  prompt: string;
  workDir: string;
  projectDir: string;
  claudeBin?: string;
  headlessMode?: boolean;
  onPid?: (pid: number) => void;
  onChunk?: StreamingCallback; // 流式输出回调
  logger?: {
    startRealtimeLogging: () => void;
    logRealtime: (chunk: string) => void;
    logExecuting?: (prompt: string, pid?: number) => void;
    logCompleted: (
      output: string,
      exitCode: number,
      pid?: number,
      sessionId?: string,
      apiSuccess?: boolean,
    ) => void;
  };
}

/**
 * 使用流式输出执行 Claude 命令
 * 借鉴自 SkillLauncher 的实现
 */
/**
 * 从项目的 .claude/settings.json 读取 env 字段作为环境变量
 * 同时扫描 .claude/skills/ 下各 skill 的 assets/skill-env.json 合并环境配置
 */
function getProjectEnv(projectDir: string): Record<string, string> {
  const env: Record<string, string> = {};

  // 1. 读取项目级 settings.json
  try {
    const settingsPath = join(projectDir, ".claude/settings.json");
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      Object.assign(env, settings.env || {});
    }
  } catch {
    // 忽略读取失败
  }

  // 2. 读取各 skill 的 skill-env.json
  try {
    const skillsDir = join(projectDir, ".claude/skills");
    if (existsSync(skillsDir)) {
      for (const entry of readdirSync(skillsDir)) {
        const envFile = join(skillsDir, entry, "assets", "skill-env.json");
        if (existsSync(envFile)) {
          const skillEnv = JSON.parse(readFileSync(envFile, "utf-8"));
          if (skillEnv.env) {
            // PATH 做合并（skill 的 PATH 追加到已有 PATH 前面）
            if (skillEnv.env.PATH && env.PATH) {
              const merged = skillEnv.env.PATH + ":" + env.PATH;
              Object.assign(env, skillEnv.env, { PATH: merged });
            } else {
              Object.assign(env, skillEnv.env);
            }
          }
        }
      }
    }
  } catch {
    // 忽略 skill env 读取失败
  }

  return env;
}

export async function executeClaudeStreaming(
  options: ClaudeStreamingOptions,
): Promise<ClaudeExecutionResult> {
  const {
    projectDir,
    claudeBin: customClaudeBin,
    prompt,
    headlessMode = true,
    onPid,
    onChunk,
    logger,
  } = options;
  const claudeBin = customClaudeBin || join(homedir(), ".local/bin/claude");
  const startTime = Date.now();

  // 读取项目的 settings.json 环境变量
  const projectEnv = getProjectEnv(projectDir);

  // 流式模式只能在 headless 模式下使用
  if (!headlessMode) {
    return {
      success: false,
      output: "流式输出仅支持 headless 模式",
      error: "流式输出仅支持 headless 模式",
      exitCode: 1,
      duration: 0,
    };
  }

  // 启动实时日志流
  logger?.startRealtimeLogging();

  return new Promise((resolve) => {
    let fullOutput = "";
    let sessionId: string | undefined;
    let lineBuffer = ""; // 行缓冲，防止 JSON 在 TCP 分包时被截断

    // 使用参数数组传递 prompt，避免 shell 转义和注入问题
    const child = spawn(
      claudeBin,
      [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
      ],
      {
        cwd: projectDir,
        env: { ...process.env, ...projectEnv },
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const pid = child.pid;
    if (pid) {
      onPid?.(pid);
    }

    // 记录执行信息（含 PID）
    logger?.logExecuting?.(prompt, pid);

    // 处理完整的 JSON 行
    function processLine(line: string) {
      if (!line.trim()) return;

      try {
        const parsed = JSON.parse(line);

        // 处理不同类型的消息
        if (parsed.type === "content" || parsed.type === "message") {
          const text =
            parsed.delta?.text || parsed.content?.text || parsed.text || "";
          if (text) {
            fullOutput += text;
            logger?.logRealtime(text);
            onChunk?.(text, false);
          }
        }

        // 提取 session_id
        if (parsed.session_id && !sessionId) {
          sessionId = parsed.session_id;
        }

        // 处理最终结果 JSON（包含 is_error 字段）
        if (
          parsed.type === "result" ||
          parsed.subtype === "success" ||
          parsed.subtype === "error"
        ) {
          // 将完整结果 JSON 追加到 fullOutput（用于后续解析 is_error）
          fullOutput += line + "\n";
          // 如果有 result 字段的内容，也追加到实时输出
          if (parsed.result) {
            logger?.logRealtime(parsed.result);
            onChunk?.(parsed.result, false);
          }
        }

        // 检查是否是最终消息
        if (parsed.type === "done" || parsed.stop_reason) {
          onChunk?.(fullOutput, true);
        }
      } catch {
        // 非 JSON 行，直接追加（可能是纯文本）
        const text = line.trim();
        if (text && !text.startsWith("{")) {
          fullOutput += text + "\n";
          logger?.logRealtime(text + "\n");
          onChunk?.(text + "\n", false);
        }
      }
    }

    // 处理 stdout（JSON 流），使用行缓冲防止截断
    child.stdout?.on("data", (data: Buffer) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split("\n");
      // 最后一个元素可能是不完整的行，保留在缓冲区
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        processLine(line);
      }
    });

    // 进程结束时处理缓冲区中剩余内容
    child.stdout?.on("end", () => {
      if (lineBuffer.trim()) {
        processLine(lineBuffer);
        lineBuffer = "";
      }
    });

    // 处理 stderr
    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      if (text) {
        fullOutput += text;
        logger?.logRealtime(text);
        onChunk?.(text, false);
      }
    });

    // 处理进程结束
    child.on("close", (code, signal) => {
      const duration = Date.now() - startTime;
      const exitCode = code ?? (signal ? 1 : 0);

      // 尝试从 fullOutput 中解析 is_error 字段
      let apiSuccess: boolean | undefined;
      try {
        const jsonMatch = fullOutput.match(
          /\{[\s\S]*"is_error"\s*:\s*(true|false)[\s\S]*\}/,
        );
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.is_error !== undefined) {
            apiSuccess = parsed.is_error === false;
          }
        }
      } catch {
        // 解析失败，忽略
      }

      // 优先使用 apiSuccess 判断成功与否
      const isSuccess = apiSuccess !== undefined ? apiSuccess : exitCode === 0;

      resolve({
        success: isSuccess,
        output: fullOutput || "(无输出)",
        error: !isSuccess ? fullOutput : undefined,
        exitCode,
        duration,
        pid,
        sessionId,
        apiSuccess,
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
        sessionId,
      });
    });
  });
}

export async function executeClaudeCommand(
  options: ClaudeExecutionOptions,
  logger?: {
    startRealtimeLogging: () => void;
    logRealtime: (chunk: string) => void;
    logExecuting?: (prompt: string, pid?: number, outputFile?: string) => void;
  },
): Promise<ClaudeExecutionResult> {
  const {
    projectDir,
    claudeBin: customClaudeBin,
    prompt,
    headlessMode = true,
    onPid,
  } = options;
  const claudeBin = customClaudeBin || join(homedir(), ".local/bin/claude");

  const startTime = Date.now();

  // 读取项目的 settings.json 环境变量
  const projectEnv = getProjectEnv(projectDir);

  // 如果不是无头模式，在新的 Terminal 窗口中运行 Claude Code
  if (!headlessMode) {
    return new Promise((resolve) => {
      try {
        // 创建临时脚本文件，避免复杂的转义问题
        const scriptPath = join(tmpdir(), `claude-visible-${Date.now()}.sh`);
        const sessionFile = join(tmpdir(), `claude-session-${Date.now()}.json`);

        // 使用 base64 编码传递 prompt，避免 shell 注入
        const promptB64 = Buffer.from(prompt).toString("base64");

        const scriptContent = `#!/bin/bash
cd "${projectDir}"
PROMPT=$(echo '${promptB64}' | base64 -d)
echo "=== 执行 Claude Code 命令 ==="
echo "命令: $PROMPT"
echo ""

# 使用 JSON 输出格式以捕获 session ID
"${claudeBin}" --print --dangerously-skip-permissions --output-format json "$PROMPT" > "${sessionFile}"

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
  echo "恢复此对话: claude --resume $SESSION_ID"
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
          } catch {
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
      } catch (error: unknown) {
        const duration = Date.now() - startTime;
        const message =
          error instanceof Error ? error.message : "启动终端窗口失败";
        resolve({
          success: false,
          output: message,
          error: message,
          exitCode: 1,
          duration,
          pid: undefined,
          sessionId: undefined,
        });
      }
    });
  }

  // 创建临时文件用于捕获输出(使用 JSON 格式以提取 session ID)
  const tempOutputFile = join(
    tmpdir(),
    `claude-output-${Date.now()}-${process.pid}.json`,
  );
  writeFileSync(tempOutputFile, "", "utf-8");

  // 启动实时日志流
  if (logger) {
    logger.startRealtimeLogging();
  }

  return new Promise((resolve) => {
    let pid: number | undefined;

    try {
      // 使用参数数组传递 prompt，避免 shell 转义和注入问题
      const child = spawn(
        claudeBin,
        [
          "--print",
          "--dangerously-skip-permissions",
          "--output-format",
          "json",
          prompt,
        ],
        {
          cwd: projectDir,
          env: { ...process.env, ...projectEnv },
          detached: false,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      pid = child.pid;
      if (pid) {
        onPid?.(pid);
      }

      // 立即记录执行开始事件（含临时输出文件路径，用于 PID 检测恢复）
      if (logger && logger.logExecuting) {
        logger.logExecuting(prompt, pid, tempOutputFile);
      }

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        appendFileSync(tempOutputFile, text, "utf-8");
      });

      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        appendFileSync(tempOutputFile, text, "utf-8");
      });

      // 监听进程结束
      child.on("close", (code, signal) => {
        const duration = Date.now() - startTime;
        let output = "";
        let sessionId: string | undefined;
        const exitCode = code ?? (signal ? 1 : 0);
        let apiSuccess: boolean | undefined;

        try {
          // 读取完整输出
          if (existsSync(tempOutputFile)) {
            const rawOutput =
              stdout + stderr || readFileSync(tempOutputFile, "utf-8");

            // 尝试解析 stdout 中的 JSON 输出，避免 stderr 警告破坏解析
            try {
              const jsonOutput = JSON.parse(stdout);

              // 提取 session_id
              if (jsonOutput.session_id) {
                sessionId = jsonOutput.session_id;
              }

              // 提取 is_error 字段用于判断 API 执行成功与否
              // 即使进程退出码非 0，只要 is_error === false 仍认为执行成功
              if (jsonOutput.is_error !== undefined) {
                apiSuccess = jsonOutput.is_error === false;
              }

              // 提取实际结果文本
              if (jsonOutput.result) {
                output = jsonOutput.result;
              } else {
                // 如果没有 result 字段,使用原始输出
                output = rawOutput;
              }
            } catch {
              // JSON 解析失败,使用原始输出(可能是错误信息)
              output = rawOutput;
            }
          }

          // 清理临时文件
          if (existsSync(tempOutputFile)) unlinkSync(tempOutputFile);
        } catch {
          // 清理失败不影响结果
        }

        // 优先使用 apiSuccess 判断成功与否（如果可用），否则使用 exitCode
        const isSuccess =
          apiSuccess !== undefined ? apiSuccess : exitCode === 0;

        resolve({
          success: isSuccess,
          output: output || "(无输出)",
          error: !isSuccess ? output : undefined,
          exitCode,
          duration,
          pid,
          sessionId,
          apiSuccess,
        });
      });

      child.on("error", (error) => {
        const duration = Date.now() - startTime;

        // 清理临时文件
        try {
          if (existsSync(tempOutputFile)) unlinkSync(tempOutputFile);
        } catch {
          // 忽略清理失败
        }

        resolve({
          success: false,
          output: error.message,
          error: error.message,
          exitCode: 1,
          duration,
          pid,
        });
      });
    } catch (error: unknown) {
      // 启动失败
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : "执行失败";

      // 清理临时文件
      try {
        if (existsSync(tempOutputFile)) unlinkSync(tempOutputFile);
      } catch {
        // 忽略清理失败
      }

      resolve({
        success: false,
        output: message,
        error: message,
        exitCode: 1,
        duration,
        pid,
      });
    }
  });
}

export function getRunId(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const time = now.toTimeString().split(" ")[0].replace(/:/g, "");
  const millis = String(now.getMilliseconds()).padStart(3, "0");
  const pid = process.pid.toString().slice(-4);
  const random = Math.random().toString(36).slice(2, 6);
  return `run_${date}_${time}${millis}_${pid}_${random}`;
}
