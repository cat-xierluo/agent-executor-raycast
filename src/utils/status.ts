import { readFileSync, existsSync, writeFileSync, readdirSync, unlinkSync, statSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { LogEntry, JSONL_LOG, RUNS_DIR, INDEX_FILE, ERROR_LOG } from "./logger";

/**
 * 检查指定 PID 的进程是否真实存活
 * 使用 process.kill(pid, 0) 发送空信号，不会杀死进程但可以检测进程是否存在
 * @param pid 进程 ID
 * @returns 进程是否存活
 */
function isProcessAlive(pid: number): boolean {
  try {
    // 发送信号 0 不会终止进程，但可以检查进程是否存在
    process.kill(pid, 0);

    // 进程存在，但需要检查是否是僵尸进程
    // 通过 execSync 调用 ps 命令来检查进程状态
    const { execSync } = require('child_process');
    try {
      const psOutput = execSync(`ps -p ${pid} -o state=`, { encoding: 'utf-8' });
      const state = psOutput.trim();

      // 如果进程状态是 Z (Zombie)，说明进程已经结束但等待父进程回收
      if (state === 'Z') {
        return false;
      }

      return true;
    } catch (psError) {
      // ps 命令失败，保守地认为进程不可访问
      return false;
    }
  } catch (error) {
    // 如果抛出错误（通常是 ESRCH - No such process），说明进程不存在
    const errno = (error as any).errno;
    if (errno === 'ESRCH' || errno === 'EPERM') {
      return false;
    }
    // 其他错误也认为进程不可访问
    return false;
  }
}

/**
 * 检测进程是否有输出内容
 * @param pid 进程ID
 * @param runId 运行ID
 * @param targetPath 目标路径
 * @returns 是否有输出内容
 */
function checkProcessOutput(pid: number, runId: string, targetPath: string): boolean {
  try {
    // 1. 检查JSONL日志中是否有输出内容
    const entries = readLogEntries();
    const runEntries = entries.filter(entry => entry.runId === runId);
    const completedEntry = runEntries.find(entry => entry.event === "completed" || entry.event === "failed");
    if (completedEntry && completedEntry.output && completedEntry.output.length > 0) {
      return true;
    }

    // 2. 检查目标文件是否被修改
    if (targetPath && targetPath !== "N/A" && targetPath !== "未知路径") {
      try {
        const targetStat = statSync(targetPath);
        const hoursSinceModified = (Date.now() - targetStat.mtime.getTime()) / (1000 * 60 * 60);
        // 24小时内被修改过，认为有输出
        if (hoursSinceModified < 24) {
          return true;
        }
      } catch {
        // 文件不存在，继续检查
      }
    }

    // 3. 检查进程的实际运行状态
    try {
      const output = execSync(`ps -o pid,stat,etime -p ${pid}`, { encoding: 'utf8' });
      const lines = output.trim().split('\n');
      if (lines.length >= 2) {
        const stats = lines[1].trim().split(/\s+/);
        const stat = stats[1];
        // 如果进程处于运行(R)或睡眠(S)状态，认为是活跃的
        if (stat.includes('R') || stat.includes('S')) {
          return true;
        }
      }
    } catch {
      // 进程不存在
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * 检测进程是否卡住（长时间无输出）
 * @param pid 进程ID
 * @returns 是否卡住
 */
function checkProcessStuck(pid: number): boolean {
  try {
    // 检查进程运行时间
    const output = execSync(`ps -o pid,etime -p ${pid}`, { encoding: 'utf8' });
    const lines = output.trim().split('\n');
    if (lines.length >= 2) {
      const etime = lines[1].trim().split(/\s+/)[1];
      // 如果运行时间超过30分钟且没有新输出，认为是卡住
      return parseEtimeToHours(etime) > 0.5;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 解析ps的etime格式为小时数
 * @param etime ps命令的etime格式时间
 * @returns 小时数
 */
function parseEtimeToHours(etime: string): number {
  // etime格式：[[dd-]hh:]mm:ss 或 hh:mm:ss
  const parts = etime.split(':');
  if (parts.length === 3) {
    // 格式：hh:mm:ss
    return parseInt(parts[0]) + parseInt(parts[1]) / 60;
  } else if (parts.length === 2 && etime.includes('-')) {
    // 格式：dd-hh:mm:ss
    const [d, h, m] = etime.replace('-', ':').split(':');
    return parseInt(d) * 24 + parseInt(h) + parseInt(m) / 60;
  }
  return 0;
}

/**
 * 深度检测PID的返回内容和真实状态
 * @param pid 进程ID
 * @param runId 运行ID
 * @param targetPath 目标路径
 * @returns 检测结果
 */
function detectProcessStatus(pid: number, runId: string, targetPath: string): {
  isAlive: boolean;
  hasOutput: boolean;
  exitCode?: number;
  status: 'running' | 'completed' | 'failed';
} {
  try {
    // 1. 检测进程是否真实存活
    const isAlive = isProcessAlive(pid);

    // 2. 检测是否有输出内容
    const hasOutput = checkProcessOutput(pid, runId, targetPath);

    // 3. 如果进程已结束但有输出，说明已完成
    if (!isAlive && hasOutput) {
      return { isAlive: false, hasOutput: true, status: 'completed' };
    }

    // 4. 如果进程存活，检查是否有异常（长时间无输出）
    if (isAlive) {
      const isStuck = checkProcessStuck(pid);
      if (isStuck) {
        return { isAlive: true, hasOutput: false, status: 'failed' };
      }
    }

    return { isAlive, hasOutput, status: isAlive ? 'running' : 'failed' };
  } catch (error) {
    console.error('[detectProcessStatus] Error:', error);
    return { isAlive: false, hasOutput: false, status: 'failed' };
  }
}

export interface RunInfo {
  runId: string;
  commandName: string;
  fullCommand: string;
  targetFile: string;
  targetPath: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: "running" | "completed" | "failed";
  exitCode?: number;
  pid?: number;
  logPath: string;
}

/**
 * 解析本地时间字符串为 Date 对象
 * 支持格式：YYYY-MM-DD HH:mm:ss
 */
function parseLocalTime(timeStr: string): Date {
  // 替换空格为 T，使其符合 ISO 8601 格式
  const isoStr = timeStr.replace(" ", "T");
  return new Date(isoStr);
}

/**
 * 从 JSONL 日志文件读取所有日志条目
 */
export function readLogEntries(): LogEntry[] {
  if (!existsSync(JSONL_LOG)) {
    return [];
  }

  try {
    const content = readFileSync(JSONL_LOG, "utf-8");
    const lines = content.trim().split("\n");

    return lines
      .map((line) => {
        try {
          const parsed = JSON.parse(line);
          return {
            timestamp: parsed.ts,
            event: parsed.event,
            status: parsed.status,
            runId: parsed.run_id,
            target: parsed.target,
            workDir: parsed.work_dir,
            cmd: parsed.cmd,
            duration: parsed.duration,
            exitCode: parsed.exit_code,
            pid: parsed.pid,
            output: parsed.output,
          };
        } catch (error) {
          // 跳过无法解析的行
          return null;
        }
      })
      .filter((entry) => entry !== null) as LogEntry[];
  } catch (error) {
    console.error("Failed to read log entries:", error);
    return [];
  }
}

/**
 * 解析日志条目，按 run_id 分组
 */
export function groupLogsByRunId(entries: LogEntry[]): Map<string, LogEntry[]> {
  const grouped = new Map<string, LogEntry[]>();

  for (const entry of entries) {
    if (!grouped.has(entry.runId)) {
      grouped.set(entry.runId, []);
    }
    grouped.get(entry.runId)!.push(entry);
  }

  return grouped;
}

/**
 * 从命令字符串中提取命令名称
 * 例如："/legal-router \"/path/to/file.pdf\"" -> "legal-router"
 */
function extractCommandName(cmd: string): string {
  const match = cmd.match(/^\/([a-zA-Z0-9-]+)/);
  return match ? match[1] : cmd;
}

/**
 * 从路径中提取文件名
 */
function extractFileName(path: string): string {
  return path.split("/").pop() || path;
}

/**
 * 确定单个运行的状态和信息
 */
function extractRunInfo(runId: string, logs: LogEntry[]): RunInfo | null {
  if (logs.length === 0) {
    return null;
  }

  // 按时间戳排序
  const sortedLogs = logs.sort((a, b) =>
    parseLocalTime(a.timestamp).getTime() - parseLocalTime(b.timestamp).getTime()
  );

  // 查找各个事件
  const startedEvent = sortedLogs.find((log) => log.event === "started");
  const executingEvent = sortedLogs.find((log) => log.event === "executing");
  const completedEvent = sortedLogs.find((log) => log.event === "completed");
  const failedEvent = sortedLogs.find((log) => log.event === "failed");

  if (!startedEvent) {
    return null;
  }

  const startTime = parseLocalTime(startedEvent.timestamp);
  const targetFullPath = startedEvent.target || "未知路径";
  const targetDirectory = startedEvent.workDir || "未知路径";
  const command = executingEvent?.cmd || startedEvent.cmd || "未知命令";
  const pid = executingEvent?.pid;

  // 检查 target 是否是真正的文件路径（包含 / 并且以 . 开头有扩展名，或者是绝对路径）
  // 如果不是，说明这是命令名而不是文件路径
  const isFilePath = targetFullPath.includes("/") &&
                     (targetFullPath.startsWith("/") || targetFullPath.startsWith("~"));

  // 提取文件名和目录
  let fileName: string;
  let directory: string;

  if (isFilePath) {
    // 是真正的文件路径
    fileName = extractFileName(targetFullPath);
    directory = targetDirectory;
  } else {
    // 不是文件路径（是命令名或 N/A）
    fileName = "无（命令执行）";
    directory = targetDirectory;
  }

  // 确定状态
  let status: "running" | "completed" | "failed";
  let endTime: Date | undefined;
  let exitCode: number | undefined;
  let duration: number | undefined;

  // 检查是否有完成或失败事件
  if (completedEvent) {
    status = "completed";
    endTime = parseLocalTime(completedEvent.timestamp);
    duration = completedEvent.duration;
  } else if (failedEvent) {
    status = "failed";
    endTime = parseLocalTime(failedEvent.timestamp);
    exitCode = failedEvent.exitCode;
    duration = failedEvent.duration;
  } else {
    // 没有日志事件时，使用深度PID检测
    if (pid) {
      const processInfo = detectProcessStatus(pid, runId, directory);

      if (processInfo.status === 'completed') {
        status = "completed";
        endTime = new Date(); // 使用当前时间作为结束时间
        duration = endTime.getTime() - startTime.getTime();
        console.log(`[extractRunInfo] 检测到PID ${pid} 已完成，基于输出内容判定状态`);
      } else if (processInfo.status === 'failed') {
        status = "failed";
        endTime = new Date();
        duration = endTime.getTime() - startTime.getTime();
        exitCode = -2; // 表示基于检测判定为失败
        console.log(`[extractRunInfo] 检测到PID ${pid} 已失败，基于进程状态判定`);
      } else {
        status = "running";
        console.log(`[extractRunInfo] 检测到PID ${pid} 仍在运行`);
      }
    } else {
      // 没有 PID，无法验证进程状态，保守地认为是 running
      status = "running";
    }
  }

  return {
    runId,
    commandName: extractCommandName(command),
    fullCommand: command,
    targetFile: fileName,
    targetPath: directory,
    startTime,
    endTime,
    duration,
    status,
    exitCode,
    pid,
    logPath: join(RUNS_DIR, `${runId}.log`),
  };
}

/**
 * 确定所有运行的状态并进行分类
 */
export function categorizeRuns(groupedLogs: Map<string, LogEntry[]>): {
  running: RunInfo[];
  completed: RunInfo[];
  failed: RunInfo[];
} {
  const running: RunInfo[] = [];
  const completed: RunInfo[] = [];
  const failed: RunInfo[] = [];

  for (const [runId, logs] of groupedLogs.entries()) {
    const runInfo = extractRunInfo(runId, logs);
    if (runInfo) {
      switch (runInfo.status) {
        case "running":
          running.push(runInfo);
          break;
        case "completed":
          completed.push(runInfo);
          break;
        case "failed":
          failed.push(runInfo);
          break;
      }
    }
  }

  // 按开始时间倒序排序（最新的在前）
  running.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  completed.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  failed.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

  return { running, completed, failed };
}

/**
 * 过滤掉超过指定天数的记录
 */
export function filterRecentEntries(runs: RunInfo[], days: number): RunInfo[] {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return runs.filter((run) => run.startTime >= cutoffDate);
}

/**
 * 统计正在运行的命令数量
 */
export function countRunningCommands(): number {
  const entries = readLogEntries();
  const grouped = groupLogsByRunId(entries);
  const { running } = categorizeRuns(grouped);

  // 只保留最近 1 小时内的运行中记录（避免僵尸进程）
  const oneHourAgo = new Date();
  oneHourAgo.setHours(oneHourAgo.getHours() - 1);

  return running.filter((run) => run.startTime >= oneHourAgo).length;
}

/**
 * 获取所有 Agent 运行状态（应用 7 天过滤）
 */
export function getAllRunStatus(daysToKeep: number = 7): {
  running: RunInfo[];
  completed: RunInfo[];
  failed: RunInfo[];
} {
  const entries = readLogEntries();
  const grouped = groupLogsByRunId(entries);
  const { running, completed, failed } = categorizeRuns(grouped);

  return {
    running: filterRecentEntries(running, daysToKeep),
    completed: filterRecentEntries(completed, daysToKeep),
    failed: filterRecentEntries(failed, daysToKeep),
  };
}

/**
 * 清空所有历史记录
 * 删除所有日志文件和索引，但保留正在运行的任务
 */
export function clearAllHistory(): { deletedCount: number; runningCount: number } {
  const entries = readLogEntries();
  const grouped = groupLogsByRunId(entries);
  const { running, completed, failed } = categorizeRuns(grouped);

  let deletedCount = 0;

  // 删除已完成和失败的任务日志文件
  for (const run of [...completed, ...failed]) {
    if (existsSync(run.logPath)) {
      try {
        unlinkSync(run.logPath);
        deletedCount++;
      } catch (error) {
        console.error(`Failed to delete log file ${run.logPath}:`, error);
      }
    }
  }

  // 清空 JSONL 日志，但保留正在运行的任务记录
  const runningRunIds = new Set(running.map((r) => r.runId));
  const filteredEntries = entries.filter((entry) => runningRunIds.has(entry.runId));

  try {
    if (filteredEntries.length > 0) {
      // 重写 JSONL 日志，只保留运行中的任务
      const jsonlContent = filteredEntries
        .map((entry) => {
          return JSON.stringify({
            ts: entry.timestamp,
            event: entry.event,
            status: entry.status,
            run_id: entry.runId,
            ...(entry.target && { target: entry.target }),
            ...(entry.workDir && { work_dir: entry.workDir }),
            ...(entry.cmd && { cmd: entry.cmd }),
            ...(entry.duration !== undefined && { duration: entry.duration }),
            ...(entry.exitCode !== undefined && { exit_code: entry.exitCode }),
            ...(entry.pid !== undefined && { pid: entry.pid }),
          });
        })
        .join("\n") + "\n";
      writeFileSync(JSONL_LOG, jsonlContent);
    } else {
      // 如果没有运行中的任务，清空 JSONL 文件
      writeFileSync(JSONL_LOG, "");
    }
  } catch (error) {
    console.error("Failed to update JSONL log:", error);
  }

  // 清空索引文件
  if (existsSync(INDEX_FILE)) {
    try {
      writeFileSync(INDEX_FILE, "");
    } catch (error) {
      console.error("Failed to clear index file:", error);
    }
  }

  // 清空错误日志文件
  if (existsSync(ERROR_LOG)) {
    try {
      writeFileSync(ERROR_LOG, "");
    } catch (error) {
      console.error("Failed to clear error log:", error);
    }
  }

  return { deletedCount, runningCount: running.length };
}
