import {
  List,
  ListItem,
  Action,
  ActionPanel,
  Toast,
  showToast,
  Icon,
  closeMainWindow,
  openCommandPreferences,
  Detail,
} from "@raycast/api";
import { useState, useEffect } from "react";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { LOG_DIR, RUNS_DIR, INDEX_FILE, ERROR_LOG, JSONL_LOG } from "./utils/logger";

interface LogEntry {
  timestamp: string;
  status: string;
  runId: string;
  filename: string;
  duration: string;
  logPath: string;
  pid?: string;
}

/**
 * 从 JSONL 日志中读取所有日志条目并转换为 LogEntry 格式
 */
function parseJsonlLog(): LogEntry[] {
  if (!existsSync(JSONL_LOG)) {
    return [];
  }

  try {
    const content = readFileSync(JSONL_LOG, "utf-8");
    const lines = content.trim().split("\n");

    // 按 run_id 分组
    const runGroups = new Map<string, any[]>();

    lines.forEach((line) => {
      try {
        const parsed = JSON.parse(line);
        const runId = parsed.run_id;
        if (runId) {
          if (!runGroups.has(runId)) {
            runGroups.set(runId, []);
          }
          runGroups.get(runId)!.push(parsed);
        }
      } catch (error) {
        // 跳过无法解析的行
      }
    });

    // 转换为 LogEntry 格式
    const entries: LogEntry[] = [];

    for (const [runId, events] of runGroups) {
      // 按时间戳排序
      events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

      // 查找关键事件
      const startedEvent = events.find((e) => e.event === "started");
      const executingEvent = events.find((e) => e.event === "executing");
      const completedEvent = events.find((e) => e.event === "completed" || e.event === "failed");

      if (!startedEvent) {
        continue;
      }

      const status = completedEvent?.event === "completed" ? "成功" : (completedEvent?.event === "failed" ? "失败" : "未知");
      const targetPath = completedEvent?.target || executingEvent?.target || startedEvent?.target || "";
      const filename = targetPath.split("/").pop() || runId;

      // 处理执行时长
      let duration = "未知";
      if (completedEvent?.duration !== undefined) {
        // duration 应该是秒（来自 logger.ts），如果大于 1000，可能是毫秒
        const durationNum = typeof completedEvent.duration === 'number' ? completedEvent.duration : parseFloat(completedEvent.duration);
        if (!isNaN(durationNum)) {
          if (durationNum > 1000) {
            // 如果大于 1000，可能是毫秒，转换为秒
            duration = `${(durationNum / 1000).toFixed(1)}秒`;
          } else {
            duration = `${durationNum.toFixed(1)}秒`;
          }
        }
      } else if ((status === "成功" || status === "失败") && completedEvent?.ts && startedEvent?.ts) {
        // 如果有完成事件但没有 duration，从时间戳计算
        const start = new Date(startedEvent.ts);
        const end = new Date(completedEvent.ts);
        const durationMs = end.getTime() - start.getTime();
        if (durationMs > 0) {
          duration = `${(durationMs / 1000).toFixed(1)}秒`;
        }
      }

      const pid = executingEvent?.pid?.toString();

      entries.push({
        timestamp: startedEvent.ts,
        status,
        runId,
        filename,
        duration,
        logPath: join(RUNS_DIR, `${runId}.log`),
        pid,
      });
    }

    // 按时间戳倒序排列（最新的在前）
    return entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  } catch (error) {
    console.error("Failed to parse JSONL log:", error);
    return [];
  }
}

interface LogDetail {
  runId: string;
  startTime: string;
  pid?: string;
  targetPath: string;
  workDir: string;
  command: string;
  output: string;
  endTime: string;
  duration: string;
  exitCode: number;
}

/**
 * 从 JSONL 日志中读取指定 runId 的 PID
 * 用于从旧日志文件中恢复 PID 信息
 */
function getPidFromJsonL(runId: string): string | undefined {
  try {
    const jsonlPath = join(LOG_DIR, "agent-executor.jsonl");
    if (!existsSync(jsonlPath)) {
      return undefined;
    }

    const content = readFileSync(jsonlPath, "utf-8");
    const lines = content.trim().split("\n");

    // 倒序查找，找到最新的 executing 事件
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed.run_id === runId && parsed.event === "executing" && parsed.pid) {
          return parsed.pid.toString();
        }
      } catch (error) {
        // 跳过无法解析的行
        continue;
      }
    }
    return undefined;
  } catch (error) {
    return undefined;
  }
}

function parseIndexFile(): LogEntry[] {
  // 首先尝试从 JSONL 日志读取（新的统一格式）
  const jsonlEntries = parseJsonlLog();
  if (jsonlEntries.length > 0) {
    return jsonlEntries;
  }

  // 如果 JSONL 日志为空，尝试从旧的索引文件读取（向后兼容）
  if (!existsSync(INDEX_FILE)) {
    return [];
  }

  const content = readFileSync(INDEX_FILE, "utf-8");
  const lines = content.trim().split("\n");
  const entries: LogEntry[] = [];

  for (const line of lines) {
    // 匹配格式: [2026/1/10 17:31:59] [SUCCESS] run_20260110_173126_4093 - 2025123100132.pdf (33s)
    const match = line.match(/\[(.*?)\] \[(.*?)\] (run_\d+_\d+_\d+) - (.*?) \((\d+)s\]/);
    if (match) {
      const [, timestamp, status, runId, filename, duration] = match;
      const logPath = join(RUNS_DIR, `${runId}.log`);

      // 尝试从日志文件中读取 PID
      let pid: string | undefined;
      if (existsSync(logPath)) {
        try {
          const logContent = readFileSync(logPath, "utf-8");
          const pidMatch = logContent.match(/进程 PID: (\d+)/);
          if (pidMatch) {
            pid = pidMatch[1];
          }
        } catch (error) {
          // 如果读取失败，PID 保持为 undefined
        }
      }

      entries.push({
        timestamp,
        status: status === "SUCCESS" ? "成功" : "失败",
        runId,
        filename,
        duration: `${duration}秒`,
        logPath,
        pid,
      });
    }
  }

  return entries;
}

/**
 * 解析时间字符串，返回Date对象
 */
function parseTimeString(timeStr: string): Date | null {
  try {
    // 尝试解析 "YYYY-MM-DD HH:mm:ss" 格式
    const match = timeStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/);
    if (match) {
      const [, year, month, day, hours, minutes, seconds] = match;
      return new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hours),
        parseInt(minutes),
        parseInt(seconds)
      );
    }
    // 如果解析失败，尝试直接创建Date对象
    return new Date(timeStr);
  } catch (error) {
    return null;
  }
}

/**
 * 格式化时间为精确的绝对时间显示
 * 始终显示日志中记录的精确时间点
 */
function formatTimeForDisplay(timeStr: string): string {
  const date = parseTimeString(timeStr);
  if (!date) {
    return timeStr; // 如果解析失败，返回原始字符串
  }

  // 始终显示绝对时间格式
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function parseRunLog(logPath: string): LogDetail | null {
  // 从 JSONL 日志中读取完整信息
  try {
    if (!existsSync(JSONL_LOG)) {
      return null;
    }

    const content = readFileSync(JSONL_LOG, "utf-8");
    const lines = content.trim().split("\n");

    // 从日志文件路径中提取 runId
    const runId = logPath.split("/").pop()?.replace(".log", "");
    if (!runId) {
      return null;
    }

    // 查找该 runId 的所有事件
    const runEntries = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry) => entry && entry.run_id === runId);

    if (runEntries.length === 0) {
      return null;
    }

    // 提取信息
    const startedEntry = runEntries.find((e) => e.event === "started");
    const executingEntry = runEntries.find((e) => e.event === "executing");
    const completedEntry = runEntries.find((e) => e.event === "completed" || e.event === "failed");

    const startTime = startedEntry?.ts || "未知";
    const endTime = completedEntry?.ts || "未知";
    const pid = executingEntry?.pid?.toString();
    const targetPath = completedEntry?.target || executingEntry?.target || startedEntry?.target || "未知";
    const workDir = completedEntry?.work_dir || executingEntry?.work_dir || startedEntry?.work_dir || "未知";
    const command = completedEntry?.cmd || executingEntry?.cmd || "未知";

    // 构建输出内容:
    // 1. 如果有完成事件,使用完成事件的output
    // 2. 否则,收集所有realtime_output事件的内容
    let output = "无输出";
    if (completedEntry?.output) {
      output = completedEntry.output;
    } else {
      // 收集所有实时输出事件
      const realtimeOutputs = runEntries
        .filter((e) => e.event === "realtime_output")
        .map((e) => e.output)
        .filter((o) => o);
      if (realtimeOutputs.length > 0) {
        output = realtimeOutputs.join("");
      }
    }

    // 处理执行时长
    let duration = "未知";
    if (completedEntry?.duration !== undefined) {
      // duration 应该是秒（来自 logger.ts），如果大于 1000，可能是毫秒
      const durationNum = typeof completedEntry.duration === 'number' ? completedEntry.duration : parseFloat(completedEntry.duration);
      if (!isNaN(durationNum)) {
        if (durationNum > 1000) {
          // 如果大于 1000，可能是毫秒，转换为秒
          duration = `${(durationNum / 1000).toFixed(1)}秒`;
        } else {
          duration = `${durationNum.toFixed(1)}秒`;
        }
      }
    } else if (completedEntry && completedEntry.ts && startedEntry?.ts) {
      // 如果有完成事件但没有 duration，从时间戳计算
      const start = new Date(startedEntry.ts);
      const end = new Date(completedEntry.ts);
      const durationMs = end.getTime() - start.getTime();
      if (durationMs > 0) {
        duration = `${(durationMs / 1000).toFixed(1)}秒`;
      }
    }

    const exitCode = completedEntry?.exit_code || 0;

    return {
      runId,
      startTime,
      endTime,
      pid,
      targetPath,
      workDir,
      command,
      output,
      duration,
      exitCode,
    };
  } catch (error) {
    console.error("Failed to parse run log:", error);
    return null;
  }
}

export default function LogsViewer() {
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [selectedLog, setSelectedLog] = useState<LogDetail | null>(null);
  const [selectedLogPath, setSelectedLogPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);

  // 主列表加载日志
  useEffect(() => {
    loadLogs();
  }, []);

  // 实时更新正在运行的日志
  useEffect(() => {
    if (!selectedLogPath || !isRunning) {
      return;
    }

    // 每秒刷新一次日志内容
    const intervalId = setInterval(() => {
      const detail = parseRunLog(selectedLogPath);
      if (detail) {
        // 如果有完成事件，说明任务已经结束，停止实时监控
        if (detail.endTime !== "未知") {
          setIsRunning(false);
        }
        // 始终更新日志内容以显示实时输出
        setSelectedLog(detail);
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [selectedLogPath, isRunning]);

  async function loadLogs() {
    try {
      const entries = parseIndexFile();
      setLogEntries(entries);

      // 加载最新的日志详情
      if (entries.length > 0) {
        const latestLog = parseRunLog(entries[0].logPath);
        setSelectedLog(latestLog);
        setSelectedLogPath(entries[0].logPath);

        // 检查是否正在运行
        const isCurrentlyRunning = latestLog && latestLog.endTime === "未知";
        setIsRunning(isCurrentlyRunning);
      }
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "加载日志失败",
        message: error instanceof Error ? error.message : "未知错误",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function viewLogDetail(entry: LogEntry) {
    const detail = parseRunLog(entry.logPath);
    if (detail) {
      setSelectedLog(detail);
      setSelectedLogPath(entry.logPath);

      // 检查是否正在运行（没有结束时间）
      const isCurrentlyRunning = detail.endTime === "未知";
      setIsRunning(isCurrentlyRunning);

      // 如果正在运行，显示提示
      if (isCurrentlyRunning) {
        await showToast({
          style: Toast.Style.Animated,
          title: "实时监控中",
          message: "日志将自动刷新，任务完成后将停止",
        });
      }
    } else {
      await showToast({
        style: Toast.Style.Failure,
        title: "无法读取日志",
        message: "日志文件不存在或格式错误",
      });
    }
  }

  function getStatusIcon(status: string): Icon {
    return status === "成功" ? Icon.CheckCircle : Icon.XMarkCircle;
  }

  function getStatusColor(status: string): string {
    return status === "成功" ? "green" : "red";
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="搜索日志..."
      isShowingDetail={selectedLog !== null}
      actions={
        <ActionPanel>
          <Action title="刷新日志" onAction={loadLogs} icon={Icon.RotateClockwise} shortcut={{ modifiers: ["cmd"], key: "r" }} />
          <Action.Open title="在 Finder 中显示日志目录" target={LOG_DIR} />
        </ActionPanel>
      }
    >
      {logEntries.length === 0 ? (
        <List.EmptyView
          icon={Icon.Document}
          title="暂无日志"
          description="执行 AutoWeave 命令后，日志将显示在这里"
          actions={
            <ActionPanel>
              <Action.Open title="在 Finder 中显示日志目录" target={LOG_DIR} />
            </ActionPanel>
          }
        />
      ) : (
        <>
          <List.Section title="运行历史" subtitle={`${logEntries.length} 条记录`}>
            {logEntries.map((entry) => (
              <ListItem
                key={entry.runId}
                id={entry.runId}
                title={entry.filename}
                subtitle={`${entry.timestamp} · ${entry.duration}`}
                accessories={[
                  { text: entry.status, icon: getStatusIcon(entry.status) },
                  { text: entry.runId },
                  ...(entry.pid ? [{ text: `PID: ${entry.pid}` }] : []),
                ]}
                actions={
                  <ActionPanel>
                    <Action
                      title="查看详情"
                      onAction={() => viewLogDetail(entry)}
                      icon={Icon.Eye}
                      shortcut={{ modifiers: ["cmd"], key: "enter" }}
                    />
                  <Action.CopyToClipboard title="复制运行 ID" content={entry.runId} />
                    <Action.Open title="在 Finder 中显示" target={entry.logPath} />
                  </ActionPanel>
                }
              />
            ))}
          </List.Section>

          {selectedLog && (
            <List.Item.Detail
              markdown={`# ${selectedLog.runId} ${isRunning ? "🔄 **实时监控中**" : ""}

## 基本信息
- **开始时间**: ${formatTimeForDisplay(selectedLog.startTime)}
${selectedLog.pid ? `- **进程 PID**: ${selectedLog.pid}` : ''}
- **结束时间**: ${
                isRunning
                  ? "运行中"
                  : (selectedLog.endTime === "未知"
                    ? "未知"
                    : formatTimeForDisplay(selectedLog.endTime))
              }
- **执行时长**: ${selectedLog.duration}${isRunning ? " *(计算中)*" : ""}
- **退出码**: ${isRunning ? "*(等待完成)*" : (selectedLog.exitCode === 0 ? "✅ 成功" : "❌ 失败 (" + selectedLog.exitCode + ")")}

## 文件信息
- **目标路径**: \`${selectedLog.targetPath}\`
- **工作目录**: \`${selectedLog.workDir}\`

## 执行命令
\`\`\`
${selectedLog.command}
\`\`\`

## 执行输出
${isRunning ? "> **⚡ 实时输出 - 每秒自动刷新**\n" : ""}
\`\`\`
${selectedLog.output}
\`\`\`
`}
              metadata={
                <List.Item.Detail.Metadata>
                  <List.Item.Detail.Metadata.Label title="Run ID" text={selectedLog.runId} />
                  {selectedLog.pid && (
                    <List.Item.Detail.Metadata.Label title="PID" text={selectedLog.pid} />
                  )}
                  <List.Item.Detail.Metadata.Separator />
                  <List.Item.Detail.Metadata.Label
                    title="开始时间"
                    text={formatTimeForDisplay(selectedLog.startTime)}
                  />
                  <List.Item.Detail.Metadata.Label
                    title="结束时间"
                    text={
                      isRunning
                        ? "运行中..."
                        : (selectedLog.endTime === "未知"
                          ? "未知"
                          : formatTimeForDisplay(selectedLog.endTime))
                    }
                  />
                  <List.Item.Detail.Metadata.Label
                    title="执行时长"
                    text={isRunning ? "计算中..." : selectedLog.duration}
                  />
                  <List.Item.Detail.Metadata.Separator />
                  <List.Item.Detail.Metadata.Label
                    title="状态"
                    text={isRunning ? "运行中" : (selectedLog.exitCode === 0 ? "成功" : "失败")}
                    icon={isRunning ? Icon.Clock : (selectedLog.exitCode === 0 ? Icon.CheckCircle : Icon.XMarkCircle)}
                  />
                  {!isRunning && (
                    <List.Item.Detail.Metadata.Label title="退出码" text={String(selectedLog.exitCode)} />
                  )}
                </List.Item.Detail.Metadata>
              }
            />
          )}
        </>
      )}
    </List>
  );
}
