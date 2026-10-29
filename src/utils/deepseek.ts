import { spawn } from "child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from "fs";
import { homedir, tmpdir } from "os";
import { dirname, join } from "path";
import { StringDecoder } from "string_decoder";
import { Document, isAlias, isMap, isSeq, parseDocument, visit } from "yaml";
import type {
  ClaudeExecutionOptions,
  ClaudeExecutionResult,
  ClaudeStreamingOptions,
} from "./claude";

export function resolveDshHome(): string {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

/**
 * Copy model settings as YAML nodes: !!js belongs to DSH's loader and must
 * retain its tag, without being evaluated by the Raycast process.
 */
export function buildDshPatch(
  profile: string,
  home = resolveDshHome(),
): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
    throw new Error("DSH 配置来源必须是 profile 名称，例如 desktop 或 web");
  }
  const source = join(home, "profiles", profile, "cordis.patch.yml");
  if (!existsSync(source)) {
    throw new Error(`未找到 DSH 配置：${source}`);
  }
  const input = parseDocument(readFileSync(source, "utf8"), {
    customTags: [{ tag: "tag:yaml.org,2002:js", resolve: (value) => value }],
  });
  if (input.errors.length || !isSeq(input.contents)) {
    throw new Error(`DSH profile 配置不是有效的 YAML patch 数组：${source}`);
  }
  const output = new Document([]);
  const ids = new Set([
    "llm-pi-ai",
    "agent-default-model",
    "web-search-deepseek",
  ]);
  let hasModelRow = false;
  for (const row of input.contents.items) {
    if (!isMap(row) || !ids.has(String(row.get("id")))) continue;
    if (["llm-pi-ai", "agent-default-model"].includes(String(row.get("id")))) {
      hasModelRow = true;
    }
    // Cross-row aliases would reference nodes outside this minimal tree.
    visit(row, (_key, node) => {
      if (
        isAlias(node) ||
        (node && typeof node === "object" && "anchor" in node && node.anchor)
      ) {
        throw new Error(
          `DSH 模型配置包含 YAML 锚点/别名，请使用独立配置：${source}`,
        );
      }
    });
    output.add(row.clone());
  }
  if (!hasModelRow) {
    throw new Error(
      `DSH 配置来源 ${profile} 未包含 llm-pi-ai / agent-default-model，无法安全继承模型设置：${source}`,
    );
  }
  for (const id of ["credentials", "authorization", "deepseek-account"]) {
    output.add({ id, disabled: false });
  }
  output.add({
    id: "permission",
    config: {
      presets: {
        "danger-full-access": {
          sandbox: "danger-full-access",
          approval: "never",
        },
      },
      defaultPreset: "danger-full-access",
    },
  });
  return output.toString();
}

export function buildDshPrompt(
  prompt: string,
  preamble?: string,
  skillContent?: string,
): string {
  return [
    `Raycast: ${prompt.split("\n")[0].slice(0, 160)}`,
    preamble,
    skillContent?.trim()
      ? `${skillContent.trim()}\n\n---\n\n# 本次任务`
      : undefined,
    prompt,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface DshRunState {
  sessionId?: string;
  answer?: string;
  final: boolean;
  reason?: string;
  error?: string;
  preview?: string;
}

export function consumeDshEvent(line: string, state: DshRunState): string {
  if (!line.trim()) return "";
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    state.error = "DSH 返回了无法解析的 JSON 事件";
    return "";
  }
  if (!event || typeof event !== "object") {
    state.error = "DSH 返回了无效事件";
    return "";
  }
  switch (event.type) {
    case "session":
      if (typeof event.sessionId === "string")
        state.sessionId = event.sessionId;
      return state.sessionId ? `Session ID: ${state.sessionId}\n` : "";
    case "status":
      if (event.phase === "turn_end") {
        state.reason =
          typeof event.reason === "string" ? event.reason : event.reason?.kind;
        if (
          state.reason === "error" &&
          typeof event.reason?.message === "string"
        ) {
          state.error = event.reason.message;
        }
      }
      return "";
    case "text":
      if (typeof event.text === "string") state.preview = event.text;
      return typeof event.text === "string" ? `${event.text}\n` : "";
    case "thinking":
      return typeof event.text === "string" ? `[思考] ${event.text}\n` : "";
    case "tool_call":
      return `[工具] ${String(event.tool || "unknown")}\n`;
    case "tool_result":
      return event.status === "error" ? "[工具返回错误]\n" : "";
    case "error":
      state.error =
        typeof event.message === "string" ? event.message : "DSH 执行错误";
      return `${state.error}\n`;
    case "final":
      if (typeof event.text === "string") {
        state.answer = event.text;
        state.final = true;
      } else {
        state.error = "DSH final 事件缺少回复正文";
      }
      return "";
    default:
      return "";
  }
}

export function dshRunSucceeded(state: DshRunState, code: number): boolean {
  return (
    code === 0 &&
    state.final &&
    !!state.sessionId &&
    state.reason === "completed" &&
    !state.error
  );
}

type DshLogger = {
  startRealtimeLogging: () => void;
  logRealtime: (chunk: string) => void;
  logExecuting?: (prompt: string, pid?: number, outputFile?: string) => void;
  logSession?: (sessionId: string, backend: string) => void;
};

function withLauncherPath(
  binary: string,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  try {
    const binDir = dirname(binary);
    const realDir = dirname(realpathSync(binary));
    const nodeDirs = [binDir, realDir].filter(
      (dir, index, dirs) =>
        dirs.indexOf(dir) === index && existsSync(join(dir, "node")),
    );
    return {
      ...env,
      PATH: [...nodeDirs, env.PATH].filter(Boolean).join(":"),
    };
  } catch {
    return env;
  }
}

export async function executeDsh(
  options: ClaudeExecutionOptions | ClaudeStreamingOptions,
  env: NodeJS.ProcessEnv,
  preamble: string,
  logger?: DshLogger,
): Promise<ClaudeExecutionResult> {
  const start = Date.now();
  let runDir: string | undefined;
  try {
    if (options.headlessMode === false) {
      throw new Error(
        "DeepSeek Harness 目前支持后台与流式执行，请在扩展设置中启用后台运行模式；完成后可在 Desktop 回看会话。",
      );
    }
    const binary = options.dshBin || join(homedir(), ".local/bin/dsh");
    const patch = buildDshPatch(
      options.dshConfigProfile || "desktop",
      env.DSH_HOME || resolveDshHome(),
    );
    runDir = mkdtempSync(join(tmpdir(), "raycast-dsh-"));
    const patchFile = join(runDir, "provider.patch.yml");
    const outputFile = join(runDir, "output.jsonl");
    const skillContent =
      options.skillContent ||
      (options.skillFile
        ? `[技能目录：${dirname(options.skillFile)}。相对路径均相对该目录解析。]\n\n${readFileSync(options.skillFile, "utf8")}`
        : undefined);
    const prompt = buildDshPrompt(options.prompt, preamble, skillContent);
    writeFileSync(patchFile, patch, { mode: 0o600 });
    writeFileSync(outputFile, "", { mode: 0o600 });
    // Stdin avoids argv size limits for full SKILL.md content.
    const args = ["--profile", "headless", "--patch", patchFile, "--json"];

    const ownedDir = runDir;
    return await new Promise<ClaudeExecutionResult>((resolve) => {
      const state: DshRunState = { final: false };
      const decoder = new StringDecoder("utf8");
      let buffer = "";
      let stderr = "";
      let settled = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      const onChunk = "onChunk" in options ? options.onChunk : undefined;
      logger?.startRealtimeLogging();
      const child = spawn(binary, args, {
        cwd: options.projectDir,
        env: withLauncherPath(binary, env),
        stdio: ["pipe", "pipe", "pipe"],
      });
      const finish = (code: number, error?: string) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const success = !error && dshRunSucceeded(state, code);
        const failure =
          error ||
          state.error ||
          stderr.trim() ||
          (state.reason && state.reason !== "completed"
            ? `DSH 任务未完成：${state.reason}`
            : "DSH 未返回完整的会话、完成状态及 final 事件");
        const output = success
          ? state.answer || "(任务完成，无文字回复)"
          : [state.answer, failure].filter(Boolean).join("\n");
        // final is lossless; text events can be capped at 8 KiB by DSH.
        if (!success || state.preview !== state.answer) {
          logger?.logRealtime(`\n${output}\n`);
          onChunk?.(success ? state.answer || "" : failure, false);
        }
        onChunk?.("", true);
        resolve({
          success,
          output,
          error: success ? undefined : failure,
          exitCode: success ? 0 : code || 1,
          duration: Date.now() - start,
          pid: child.pid,
          sessionId: state.sessionId,
          apiSuccess: success,
        });
        rmSync(ownedDir, { recursive: true, force: true });
      };
      const line = (value: string) => {
        const previous = state.sessionId;
        const display = consumeDshEvent(value, state);
        if (state.sessionId && state.sessionId !== previous) {
          logger?.logSession?.(state.sessionId, "dsh");
        }
        if (display) {
          logger?.logRealtime(display);
          onChunk?.(display, false);
        }
      };
      if (child.pid) options.onPid?.(child.pid);
      timeoutTimer = setTimeout(
        () => {
          try {
            child.kill("SIGKILL");
          } catch {
            // The child may already have exited; close still settles the run.
          }
          finish(124, "DSH 执行超时（超过 30 分钟，已强制终止）");
        },
        30 * 60 * 1000,
      );
      timeoutTimer.unref?.();
      logger?.logExecuting?.(options.prompt, child.pid, outputFile);
      child.stdout.on("data", (chunk: Buffer) => {
        appendFileSync(outputFile, chunk);
        buffer += decoder.write(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        lines.forEach(line);
      });
      child.stdout.on("end", () => {
        buffer += decoder.end();
        if (buffer.trim()) line(buffer);
        buffer = "";
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        logger?.logRealtime(text);
        onChunk?.(text, false);
      });
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") state.error = error.message;
      });
      child.on("error", (error) => finish(1, error.message));
      child.on("close", (code, signal) =>
        finish(code ?? 1, signal ? `DSH 进程被 ${signal} 终止` : undefined),
      );
      child.stdin.end(prompt);
    });
  } catch (error) {
    if (runDir) rmSync(runDir, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    if ("onChunk" in options && options.onChunk) {
      options.onChunk(message, false);
      options.onChunk("", true);
    }
    return {
      success: false,
      output: message,
      error: message,
      exitCode: 1,
      duration: Date.now() - start,
    };
  }
}
