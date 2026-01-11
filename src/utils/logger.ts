import { join } from "path";
import { existsSync, appendFileSync, mkdirSync, readFileSync, writeFileSync, createWriteStream, WriteStream } from "fs";
import { environment } from "@raycast/api";
import { getRunId } from "./claude";

// 使用 Raycast 扩展支持目录存放日志（每个用户独立）
const LOG_DIR = join(environment.supportPath, "logs");
const RUNS_DIR = join(LOG_DIR, "runs");
const JSONL_LOG = join(LOG_DIR, "agent-executor.jsonl");
const ERROR_LOG = join(LOG_DIR, "errors.log");
const INDEX_FILE = join(LOG_DIR, "index.txt");

// 导出日志目录和时间格式化工具供其他模块使用
export { LOG_DIR, RUNS_DIR, INDEX_FILE, ERROR_LOG, JSONL_LOG };

/**
 * 格式化日期为本地时间字符串
 * @param date Date 对象
 * @returns 格式化后的本地时间字符串，格式: YYYY-MM-DD HH:mm:ss
 */
export function formatLocalTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export interface LogEntry {
  timestamp: string;
  runId: string;
  event: string;
  status: string;
  target?: string;
  workDir?: string;
  cmd?: string;
  error?: string;
  duration?: number;
  exitCode?: number;
  pid?: number;
  output?: string;
}

function ensureLogDirs() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  if (!existsSync(RUNS_DIR)) {
    mkdirSync(RUNS_DIR, { recursive: true });
  }
}

function escapeJsonString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

export function writeJsonLog(
  event: string,
  status: string,
  runId: string,
  extraData: Record<string, any> = {}
): void {
  ensureLogDirs();

  const timestamp = formatLocalTime(new Date());

  // 改进的字段处理逻辑 - 明确区分字段存在性和值类型
  const extraFields = Object.entries(extraData)
    .filter(([_, value]) => value !== undefined) // 只处理已定义的字段
    .map(([key, value]) => {
      if (typeof value === "string") {
        return `, "${key}":"${escapeJsonString(value)}"`;
      } else if (typeof value === "number") {
        return `, "${key}":${value}`;
      } else if (typeof value === "boolean") {
        return `, "${key}":${value}`;
      }
      // 对于其他类型，转换为JSON字符串
      return `, "${key}":${JSON.stringify(value)}`;
    })
    .join("");

  const logEntry = `{"ts":"${timestamp}","event":"${event}","status":"${status}","run_id":"${runId}"${extraFields}}\n`;

  appendFileSync(JSONL_LOG, logEntry);
}

export function writeRunLog(
  runId: string,
  targetPath: string,
  workDir: string,
  prompt: string,
  output: string,
  exitCode: number,
  duration: number,
  startTimeMs?: number // 新增参数：开始时间戳（毫秒）
): void {
  ensureLogDirs();

  const runLogPath = join(RUNS_DIR, `${runId}.log`);

  // 使用传入的开始时间，如果没有则用当前时间减去时长
  const startTime = startTimeMs ? new Date(startTimeMs) : new Date(Date.now() - duration);
  const endTime = new Date(); // 当前时间作为结束时间

  const logContent = `
========================================
Agent Executor Raycast Extension - 运行日志
========================================
Run ID: ${runId}
开始时间: ${formatLocalTime(startTime)}
目标路径: ${targetPath}
工作目录: ${workDir}
命令: ${prompt}
----------------------------------------

执行输出:
========================================
${output}
========================================

结束时间: ${formatLocalTime(endTime)}
执行时长: ${duration / 1000}秒
退出码: ${exitCode}
`;

  appendFileSync(runLogPath, logContent);
}

export function writeErrorLog(
  runId: string,
  targetPath: string,
  workDir: string,
  errorMessage: string,
  exitCode: number
): void {
  ensureLogDirs();

  const timestamp = new Date().toLocaleString("zh-CN");

  const errorContent = `
========================================
[${timestamp}] 错误记录
========================================
Run ID: ${runId}
目标: ${targetPath}
工作目录: ${workDir}
退出码: ${exitCode}
----------------------------------------
错误信息:
${errorMessage}
========================================

`;

  appendFileSync(ERROR_LOG, errorContent);
}

export function updateIndex(runId: string, targetPath: string, status: string, duration: number): void {
  ensureLogDirs();

  const timestamp = new Date().toLocaleString("zh-CN");
  const basename = targetPath.split("/").pop() || targetPath;
  const entry = `[${timestamp}] [${status}] ${runId} - ${basename} (${Math.round(duration / 1000)}s)\n  → ${join(RUNS_DIR, runId)}.log\n`;

  // 将新条目添加到索引文件的开头
  const currentContent = existsSync(INDEX_FILE) ? readFileSync(INDEX_FILE, "utf-8") : "";
  writeFileSync(INDEX_FILE, entry + currentContent);
}

export class RunLogger {
  private runId: string;
  private targetPath: string;
  private workDir: string;
  private startTime: number;
  private prompt: string;
  private logStream: WriteStream | null = null;
  private runLogPath: string;
  private pid: number | undefined;
  private headerWritten: boolean = false;  // 跟踪头部是否已写入

  constructor(targetPath: string, workDir: string) {
    this.runId = getRunId();
    this.targetPath = targetPath;
    this.workDir = workDir;
    this.startTime = Date.now();
    this.prompt = "";
    this.runLogPath = join(RUNS_DIR, `${this.runId}.log`);
    this.pid = undefined;
    this.headerWritten = false;

    writeJsonLog("started", "running", this.runId, {
      target: targetPath,
      work_dir: workDir,
    });
  }

  getRunId(): string {
    return this.runId;
  }

  /**
   * 启动实时日志流
   * 创建一个可写流，用于实时写入日志内容
   * 注意：此时PID可能还未获取，头部会在setLogHeader中更新
   */
  startRealtimeLogging(): void {
    ensureLogDirs();

    // 先创建可写流（不写入头部）
    this.logStream = createWriteStream(this.runLogPath, { flags: 'w' });
  }

  /**
   * 设置日志头部（在获取PID后调用）
   * 这个方法会在 logExecuting 中自动调用
   */
  private setLogHeader(): void {
    if (!this.logStream) {
      return;
    }

    // 写入日志头部
    const header = `
========================================
Agent Executor Raycast Extension - 运行日志
========================================
Run ID: ${this.runId}
开始时间: ${formatLocalTime(new Date(this.startTime))}
${this.pid ? `进程 PID: ${this.pid}` : '进程 PID: 启动中...'}
目标路径: ${this.targetPath}
工作目录: ${this.workDir}
----------------------------------------
执行输出:
========================================
`;

    // 写入头部到已创建的流
    this.logStream.write(header);
  }

  /**
   * 实时写入日志内容
   * @param chunk 日志片段
   */
  logRealtime(chunk: string): void {
    if (this.logStream) {
      // 如果头部还未写入，先写入头部
      if (!this.headerWritten) {
        this.setLogHeader();
        this.headerWritten = true;
      }
      this.logStream.write(chunk);
    }
  }

  /**
   * 停止实时日志流并完成日志文件
   */
  stopRealtimeLogging(output: string, exitCode: number): void {
    if (this.logStream) {
      // 如果头部还未写入，先写入头部
      const wasHeaderWritten = this.headerWritten;
      if (!wasHeaderWritten) {
        this.setLogHeader();
        this.headerWritten = true;
      }

      const endTime = formatLocalTime(new Date());
      const duration = Date.now() - this.startTime;

      // 如果有输出但之前没有写入（因为头部还未写入），现在写入输出
      if (output && !wasHeaderWritten) {
        this.logStream.write(output);
      }

      const footer = `
========================================

结束时间: ${endTime}
执行时长: ${duration / 1000}秒
退出码: ${exitCode}
`;

      this.logStream.end(footer);
      this.logStream = null;
    }
  }

  /**
   * 获取日志文件路径
   */
  getLogPath(): string {
    return this.runLogPath;
  }

  logValidated(): void {
    writeJsonLog("validated", "success", this.runId, {
      target: this.targetPath,
      work_dir: this.workDir,
    });
  }

  logExecuting(prompt: string, pid?: number): void {
    this.prompt = prompt; // 保存 prompt 供后续使用
    this.pid = pid; // 保存 PID

    // 写入JSONL日志
    writeJsonLog("executing", "running", this.runId, {
      cmd: prompt.replace(/"/g, "'"),
      pid: pid,
    });

    // 如果日志流已启动但头部还未写入，现在写入头部（此时已有PID）
    if (this.logStream && !this.headerWritten && pid) {
      this.setLogHeader();
      this.headerWritten = true;
    }
  }

  logCompleted(output: string, exitCode: number): void {
    const duration = Date.now() - this.startTime;

    // 停止实时日志流（如果存在）
    if (this.logStream) {
      this.stopRealtimeLogging(output, exitCode);
    }

    if (exitCode === 0) {
      writeJsonLog("completed", "success", this.runId, {
        duration: duration / 1000,
        pid: this.pid,
        target: this.targetPath,
        work_dir: this.workDir,
        cmd: this.prompt || "未知命令",
        output: output.substring(0, 10000), // 限制输出长度，避免JSONL文件过大
      });
      updateIndex(this.runId, this.targetPath, "SUCCESS", duration);
    } else {
      writeJsonLog("failed", "error", this.runId, {
        duration: duration / 1000,
        exit_code: exitCode,
        pid: this.pid,
        target: this.targetPath,
        work_dir: this.workDir,
        cmd: this.prompt || "未知命令",
        output: output.substring(0, 10000), // 限制输出长度，避免JSONL文件过大
        reason: "execution_error",
      });
      writeErrorLog(this.runId, this.targetPath, this.workDir, output, exitCode);
      updateIndex(this.runId, this.targetPath, "FAILED", duration);
    }
  }

  getDuration(): number {
    return Date.now() - this.startTime;
  }
}
