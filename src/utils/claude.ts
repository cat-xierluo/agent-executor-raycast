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

/** 执行后端：Claude Code、CodeBuddy（CLI 兼容）或 Hermes（独立参数体系） */
export type AgentBackend = "claude" | "codebuddy" | "hermes";

export interface AgentExecutorConfig {
  projectDirs: string[]; // 扫描 .claude/commands/ 目录
  skillsDirs: string[]; // 扫描 ~/.claude/skills/ 目录
  claudeBin: string;
  codebuddyBin: string;
  hermesBin: string;
  hermesProfile: string; // Hermes profile 名称；空 = 主 Hermes
  hermesProfileHome?: string; // 解析后的 HERMES_HOME 绝对路径；执行时注入到子进程 env
  backend: AgentBackend;
  headlessMode: boolean;
  streamingMode: boolean;
}

export interface Preferences {
  projectDir1: string;
  projectDir2?: string;
  projectDir3?: string;
  projectDir4?: string;
  projectDir5?: string;
  backend?: AgentBackend;
  claudeBin?: string;
  codebuddyBin?: string;
  hermesBin?: string;
  hermesProfile?: string; // Hermes profile 名；空 = 主 profile（~/.hermes）；填了则切到 ~/.hermes/profiles/<name>/
  headlessMode?: boolean;
  enableDefaultSkills?: boolean; // 新增：是否启用默认 ~/.claude/skills/
  streamingMode?: boolean; // 新增：是否启用流式输出
  headlessPreamble?: string; // 无头模式注入的系统级前置指令（留空走内置默认）
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
 * 验证目录是否是有效的项目目录（包含 .claude/skills/ 或 Hermes 的 .hermes/skills/）
 */
export function isValidProjectDir(dir: string): boolean {
  return (
    existsSync(join(dir, ".claude/skills")) ||
    existsSync(join(dir, ".hermes/skills")) ||
    existsSync(join(dir, ".agents/skills"))
  );
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

  const projectDirs = [
    ...new Set(rawDirs.map((dir) => dir.replace(/^~/, homedir()))),
  ];

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

  const codebuddyBin = (prefs.codebuddyBin || "~/.local/bin/codebuddy").replace(
    /^~/,
    homedir(),
  );

  const hermesBin = (prefs.hermesBin || "~/.local/bin/hermes").replace(
    /^~/,
    homedir(),
  );

  // Hermes profile 解析：空 = 主 Hermes（HERMES_HOME 不注入，走默认 ~）；
  // 填了名则解析为 ~/.hermes/profiles/<name>，路径必须存在才生效，否则保留主 profile。
  const hermesProfile = (prefs.hermesProfile || "").trim();
  let hermesProfileHome: string | undefined;
  if (hermesProfile) {
    const candidate = join(homedir(), ".hermes/profiles", hermesProfile);
    if (existsSync(candidate)) {
      hermesProfileHome = candidate;
    }
  }

  // 执行后端默认 claude（向后兼容）
  const backend: AgentBackend =
    prefs.backend === "codebuddy" || prefs.backend === "hermes"
      ? prefs.backend
      : "claude";

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
    codebuddyBin,
    hermesBin,
    hermesProfile,
    hermesProfileHome,
    backend,
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

/**
 * 根据后端解析对应的 CLI 可执行文件路径。
 * codebuddy 后端用 codebuddyBin，hermes 后端用 hermesBin，否则用 claudeBin（缺省回退到默认路径）。
 */
export function resolveBackendBin(
  backend: AgentBackend | undefined,
  claudeBin?: string,
  codebuddyBin?: string,
  hermesBin?: string,
): string {
  if (backend === "codebuddy") {
    return codebuddyBin || join(homedir(), ".local/bin/codebuddy");
  }
  if (backend === "hermes") {
    return hermesBin || join(homedir(), ".local/bin/hermes");
  }
  return claudeBin || join(homedir(), ".local/bin/claude");
}

/**
 * 解析 Hermes `chat -q ... -Q --pass-session-id` 的 stdout。
 * 实测 session_id 行位置不稳定：无 --in 时在头部，带项目目录 --in 时在尾部，
 * 因此全文扫描该行并从输出中剥离，其余为最终回复正文。
 */
export function parseHermesOutput(stdout: string): {
  output: string;
  sessionId?: string;
} {
  const lines = stdout.split("\n");
  let sessionId: string | undefined;
  const kept: string[] = [];
  for (const line of lines) {
    const m = line.match(/^session_id:\s*(\S+)\s*$/);
    if (m && !sessionId) {
      sessionId = m[1];
      continue; // 剥离该行，不进入正文
    }
    kept.push(line);
  }
  const output = kept.join("\n").trim();
  return { output, sessionId };
}

/**
 * 为 Hermes 后端构建 `chat` 子命令参数。
 * - prompt 直接作为 -q 查询（参数数组传递，无 shell 转义问题）
 * - --oneshot + -Q：程序化单次执行，只输出最终回复
 * - --pass-session-id：输出 session_id 行，供恢复对话
 * - --in 指定工作目录：Hermes 按自身规则发现 .hermes/skills、.agents/skills
 *
 * 不用 `-s` 预加载：Hermes 的技能索引只覆盖自己的目录体系（~/.hermes/skills/<分类>/<技能>、
 * 项目 .hermes/skills、.agents/skills），不扫 Claude 布局的 .claude/skills——Raycast 扫出的
 * 技能名传 `-s` 会得到 "Unknown skill(s)" 退出码 1（实测）。因此由调用方把 SKILL.md 全文
 * 读出后作为 skillContent 传入，直接嵌入 query，语义与 Claude Code 的 Skill 工具注入对齐。
 */
export function buildHermesArgs(
  prompt: string,
  workDir: string,
  skillContent?: string,
  headlessPreamble?: string,
): string[] {
  let query = prompt;
  if (skillContent && skillContent.trim()) {
    query = `${skillContent.trim()}\n\n---\n\n# 任务\n${prompt}`;
  }
  // Hermes 无 --append-system-prompt；无头前置指令（不提问/产出 YYMMDD 命名等，
  // 见 resolveHeadlessPreamble）只能嵌入 query 头部，否则 Hermes 后端丢失整套
  // 执行规范（曾导致产出文件不带 YYMMDD 前缀）。
  if (headlessPreamble && headlessPreamble.trim()) {
    query = `${headlessPreamble.trim()}\n\n---\n\n${query}`;
  }
  return [
    "chat",
    "-q",
    query,
    "--oneshot",
    "-Q",
    "--pass-session-id",
    // 显式 source 标签：Hermes 自 2026-09-16（ae1b5d79）起把 oneshot 会话记为
    // source=oneshot 并从桌面端/CLI 会话列表隐藏（INTERNAL_LISTING_SOURCES 黑名单）。
    // 显式 --source 会设置 HERMES_SESSION_SOURCE_EXPLICIT=1，绕过 oneshot 改写
    // （run_agent._session_source_for_agent），会话保持可见可回看。cli 是"人类发起"
    // 语义最贴近的标签。
    "--source",
    "cli",
    "--in",
    workDir,
  ];
}

/**
 * 解析 `--output-format json` / `stream-json` 的 stdout，统一提取最终结果。
 * - Claude Code（json）：单个 result 对象
 * - CodeBuddy（json）：数组，最后一个为 result 对象
 * - CodeBuddy（stream-json）：逐行 JSON，最后一行是 result 对象
 * 任何格式解析失败都返回空对象，由调用方回退到原始输出。
 */
export function parsePrintOutput(stdout: string): {
  result?: unknown;
  sessionId?: string;
  isError?: boolean;
} {
  // 1) stream-json 逐行（Claude 与 CodeBuddy 可靠输出路径），取最后一个 result 行
  let lastStreamResult: { result?: unknown; sessionId?: string; isError?: boolean } | null = null;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.type === "result") {
        lastStreamResult = {
          result: parsed.result,
          sessionId: parsed.session_id,
          isError: parsed.is_error,
        };
      }
    } catch {
      // 忽略非 JSON 行（如日志文本）
    }
  }
  if (lastStreamResult) return lastStreamResult;

  // 2) 单个对象 / 数组（Claude 单对象、CodeBuddy json 数组）
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) {
      for (let i = parsed.length - 1; i >= 0; i--) {
        const item = parsed[i];
        if (item && typeof item === "object" && item.type === "result") {
          return {
            result: item.result,
            sessionId: item.session_id,
            isError: item.is_error,
          };
        }
      }
    } else if (parsed && typeof parsed === "object") {
      return {
        result: parsed.result,
        sessionId: parsed.session_id,
        isError: parsed.is_error,
      };
    }
  } catch {
    // 解析失败
  }

  return {};
}

export interface ClaudeExecutionOptions {
  prompt: string;
  workDir: string;
  projectDir: string;
  claudeBin?: string;
  codebuddyBin?: string;
  hermesBin?: string;
  hermesProfileHome?: string; // Hermes 子进程 HERMES_HOME；空 = 主 Hermes
  backend?: AgentBackend;
  skillContent?: string; // Hermes 后端：SKILL.md 全文，直接嵌入 query（不依赖 Hermes 技能索引）
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
  codebuddyBin?: string;
  hermesBin?: string;
  hermesProfileHome?: string; // Hermes 子进程 HERMES_HOME；空 = 主 Hermes
  backend?: AgentBackend;
  skillContent?: string; // Hermes 后端：SKILL.md 全文，直接嵌入 query（不依赖 Hermes 技能索引）
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
 *
 * 若传入 hermesHome，则作为 HERMES_HOME 注入到子进程 env，
 * 使 Hermes 走 ~/.hermes/profiles/<name>/ 的 skills/ 与 state/（profile 隔离）。
 */
function getProjectEnv(
  projectDir: string,
  hermesHome?: string,
): Record<string, string> {
  const env: Record<string, string> = {};

  if (hermesHome) {
    env.HERMES_HOME = hermesHome;
  }

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

/**
 * 无头模式默认前置系统指令。
 * 在后台（无头）启动时注入，压制不必要的提问/确认，并预设外传授权与输出规范。
 * 用户可在 Raycast 偏好"无头模式前置指令"中整体覆盖；留空时使用本默认值。
 */
const DEFAULT_HEADLESS_PREAMBLE = `# 执行模式（最高优先级，覆盖各 skill 正文的冲突说明）
本会话由 Raycast 无头模式自动启动，用户不在线，无法回复任何提问。
1. 不向用户提问、不征求选择、不要求确认；遇到需要决策的情况，选择最合理默认值并继续执行。
2. 任何需要上传或外传的已配置后端/服务（包括但不限于 PaddleOCR、MinerU 等云端 OCR 及其他联网 API）默认视为已获用户授权，直接使用；仅当用户本次留言明确要求保密/本地/离线时才改用纯本地方案。
3. 本指令优先级高于任何 skill 正文中"先询问用户/等待确认/取得授权后再继续"的说明。
4. CLI 命令产生的命名产出写入输入文件所在目录，文件名格式：YYMMDD 原名.扩展名。
5. 仅当遇到真正无法自行决定、且不处理就无法继续的阻塞时才停下，并说明阻塞点和建议的默认值。
完成后直接给出结果：做了什么、输出文件、验证情况、遗留风险。不要罗列选项让用户选。`;

/**
 * 解析无头模式前置指令：优先用 Raycast 偏好的自定义内容，否则用内置默认。
 * 在 claude.ts 内部读取，使直接执行与排队执行两条路径都自动覆盖。
 */
function resolveHeadlessPreamble(): string {
  try {
    const prefs = getPreferenceValues<Preferences>();
    const custom = (prefs.headlessPreamble || "").trim();
    return custom || DEFAULT_HEADLESS_PREAMBLE;
  } catch {
    return DEFAULT_HEADLESS_PREAMBLE;
  }
}

export async function executeClaudeStreaming(
  options: ClaudeStreamingOptions,
): Promise<ClaudeExecutionResult> {
  const {
    projectDir,
    claudeBin: customClaudeBin,
    codebuddyBin: customCodebuddyBin,
    hermesBin: customHermesBin,
    hermesProfileHome,
    backend,
    skillContent,
    prompt,
    headlessMode = true,
    onPid,
    onChunk,
    logger,
  } = options;
  const claudeBin = resolveBackendBin(
    backend,
    customClaudeBin,
    customCodebuddyBin,
    customHermesBin,
  );
  const startTime = Date.now();

  // 读取项目的 settings.json 环境变量
  const projectEnv = getProjectEnv(
    projectDir,
    backend === "hermes" ? hermesProfileHome : undefined,
  );

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
    let streamApiSuccess: boolean | undefined;
    let lineBuffer = ""; // 行缓冲，防止 JSON 在 TCP 分包时被截断

    // 使用参数数组传递 prompt，避免 shell 转义和注入问题
    // 无头模式注入系统级前置指令（压制提问/预设外传授权），见 resolveHeadlessPreamble()
    // Hermes 后端：独立的 chat 参数体系（无 --output-format stream-json），
    // 逐行直传 stdout 作为流式块，结束时用 parseHermesOutput 提取正文与 session_id
    const isHermes = backend === "hermes";
    const streamPreamble = resolveHeadlessPreamble();
    const streamArgs = isHermes
      ? buildHermesArgs(prompt, projectDir, skillContent, streamPreamble)
      : [
          "-p",
          prompt,
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
        ];
    if (streamPreamble && !isHermes) {
      streamArgs.push("--append-system-prompt", streamPreamble);
    }
    const child = spawn(claudeBin, streamArgs, {
      cwd: projectDir,
      env: { ...process.env, ...projectEnv },
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const pid = child.pid;
    if (pid) {
      onPid?.(pid);
    }

    // 记录执行信息（含 PID）
    logger?.logExecuting?.(prompt, pid);

    // 超时兜底：进程长时间不退出（如残留僵尸/close 不触发）时强制结束并返回错误，
    // 避免任务永远停在"执行中"。正常完成会 clearTimeout。
    const EXEC_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟
    const execTimeoutTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // 进程可能已退出，忽略
      }
      const duration = Date.now() - startTime;
      resolve({
        success: false,
        output: `执行超时（超过 ${EXEC_TIMEOUT_MS / 60000} 分钟，已强制终止）`,
        error: `执行超时（超过 ${EXEC_TIMEOUT_MS / 60000} 分钟，已强制终止）`,
        exitCode: 124,
        duration,
        pid,
        sessionId,
      });
    }, EXEC_TIMEOUT_MS);
    execTimeoutTimer.unref?.();

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
          // 直接从 result 行读取 is_error（Claude Code 与 CodeBuddy 均输出该字段）
          if (parsed.type === "result" && parsed.is_error !== undefined) {
            streamApiSuccess = parsed.is_error === false;
          }
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
      clearTimeout(execTimeoutTimer);

      // Hermes 后端：无 is_error 字段，exitCode 即成败；用 parseHermesOutput
      // 提取正文（剥掉 session_id 头行）与会话 ID
      if (isHermes) {
        const parsed = parseHermesOutput(fullOutput);
        const hSessionId = parsed.sessionId || sessionId;
        const hSuccess = exitCode === 0 && parsed.output.length > 0;
        resolve({
          success: hSuccess,
          output: parsed.output || "(无输出)",
          error: !hSuccess ? fullOutput : undefined,
          exitCode,
          duration,
          pid,
          sessionId: hSessionId,
          apiSuccess: exitCode === 0 ? true : undefined,
        });
        return;
      }

      // 优先使用流式解析出的 is_error，回退到从 fullOutput 正则解析
      let apiSuccess = streamApiSuccess;
      if (apiSuccess === undefined) {
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
      clearTimeout(execTimeoutTimer);

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
    codebuddyBin: customCodebuddyBin,
    hermesBin: customHermesBin,
    hermesProfileHome,
    backend,
    skillContent,
    prompt,
    headlessMode = true,
    onPid,
  } = options;
  const claudeBin = resolveBackendBin(
    backend,
    customClaudeBin,
    customCodebuddyBin,
    customHermesBin,
  );

  const startTime = Date.now();

  // 读取项目的 settings.json 环境变量
  const projectEnv = getProjectEnv(
    projectDir,
    backend === "hermes" ? hermesProfileHome : undefined,
  );

  // 如果不是无头模式，在新的 Terminal 窗口中运行 Claude Code
  if (!headlessMode) {
    return new Promise((resolve) => {
      try {
        // 创建临时脚本文件，避免复杂的转义问题
        const scriptPath = join(tmpdir(), `claude-visible-${Date.now()}.sh`);
        const sessionFile = join(tmpdir(), `claude-session-${Date.now()}.json`);

        // 使用 base64 编码传递 prompt，避免 shell 注入
        const promptB64 = Buffer.from(prompt).toString("base64");

        // Hermes 后端：无 --print/--output-format，走 chat -q 参数体系；
        // 可视化模式用户在场，不嵌 skill 正文与无头前置指令，靠 TTY 交互。
        // --source cli 让会话在桌面端可见（Hermes 默认把 oneshot 会话隐藏）。
        const isHermes = backend === "hermes";
        const runCmd = isHermes
          ? `"${claudeBin}" chat -q "$PROMPT" --source cli`
          : `"${claudeBin}" --print --dangerously-skip-permissions --output-format json "$PROMPT"`;

        const scriptContent = `#!/bin/bash
cd "${projectDir}"
PROMPT=$(echo '${promptB64}' | base64 -d)
echo "=== 执行命令 ==="
echo "命令: $PROMPT"
echo ""

${runCmd} > "${sessionFile}" 2>&1
EXIT_CODE=$?

# 提取并显示结果和 session ID
if [ -f "${sessionFile}" ]; then
  # 提取 session_id（Claude JSON 格式或 Hermes 纯文本 session_id: 行）
  SESSION_ID=$(cat "${sessionFile}" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)
  if [ -z "$SESSION_ID" ]; then
    SESSION_ID=$(cat "${sessionFile}" | grep -o 'session_id: [^[:space:]]*' | cut -d' ' -f2)
  fi

  # 提取并显示结果
  cat "${sessionFile}" | grep -o '"result":"[^"]*"' | sed 's/"result":"//' | sed 's/"$//' | sed 's/\\\\n/\\n/g'

  echo ""
  echo "=== 执行完成 (exit $EXIT_CODE) ==="
  echo "Session ID: $SESSION_ID"
  echo ""
  echo "恢复此对话: ${isHermes ? "hermes chat -r" : "claude --resume"} $SESSION_ID"
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
      // 无头模式注入系统级前置指令（压制提问/预设外传授权），见 resolveHeadlessPreamble()
      // 统一使用 stream-json 逐行输出：--output-format json 会把结果缓冲到最后一次性写 stdout，
      // 进程异常退出时 stdout 为空导致结果/ session 全部丢失（Claude 与 CodeBuddy 都出现过）。
      // Hermes 后端：chat 子命令参数体系，无 stream-json，close 时用 parseHermesOutput 解析。
      const isHermes = backend === "hermes";
      const printPreamble = resolveHeadlessPreamble();
      const printArgs = isHermes
        ? buildHermesArgs(prompt, projectDir, skillContent, printPreamble)
        : [
            "--print",
            "--dangerously-skip-permissions",
            "--output-format",
            "stream-json",
            "--verbose",
            prompt,
          ];
      if (printPreamble && !isHermes) {
        printArgs.push("--append-system-prompt", printPreamble);
      }
      const child = spawn(claudeBin, printArgs, {
        cwd: projectDir,
        env: { ...process.env, ...projectEnv },
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      // 超时兜底：进程长时间不退出（如残留僵尸/close 不触发）时强制结束并返回错误，
      // 避免任务永远停在"执行中"。正常完成会 clearTimeout。
      const EXEC_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟
      const execTimeoutTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // 进程可能已退出，忽略
        }
        const duration = Date.now() - startTime;
        resolve({
          success: false,
          output: `执行超时（超过 ${EXEC_TIMEOUT_MS / 60000} 分钟，已强制终止）`,
          error: `执行超时（超过 ${EXEC_TIMEOUT_MS / 60000} 分钟，已强制终止）`,
          exitCode: 124,
          duration,
          pid,
        });
      }, EXEC_TIMEOUT_MS);
      execTimeoutTimer.unref?.();

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
          // Hermes 后端：纯文本输出（session_id 头行 + 正文），走专用解析
          if (backend === "hermes") {
            const rawOutput = stdout + stderr;
            const parsedH = parseHermesOutput(rawOutput);
            output = parsedH.output;
            if (parsedH.sessionId) sessionId = parsedH.sessionId;
            apiSuccess = exitCode === 0 ? true : undefined;
          } else if (existsSync(tempOutputFile)) {
            const rawOutput =
              stdout + stderr || readFileSync(tempOutputFile, "utf-8");

            // 统一解析 stdout（Claude 单对象 / CodeBuddy 数组或 stream-json 行）
            const parsedOut = parsePrintOutput(stdout);
            if (
              typeof parsedOut.result === "string" &&
              parsedOut.result
            ) {
              output = parsedOut.result;
            } else {
              // 没有可用 result 字段，使用原始输出（可能是错误信息）
              output = rawOutput;
            }
            if (parsedOut.sessionId) sessionId = parsedOut.sessionId;
            if (parsedOut.isError !== undefined) {
              apiSuccess = parsedOut.isError === false;
            }
          }

          // 清理临时文件
          if (existsSync(tempOutputFile)) unlinkSync(tempOutputFile);
        } catch {
          // 清理失败不影响结果
        }

        clearTimeout(execTimeoutTimer);

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
        clearTimeout(execTimeoutTimer);

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
