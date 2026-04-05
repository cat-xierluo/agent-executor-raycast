import {
  List,
  ListItem,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  Detail,
  confirmAlert,
} from "@raycast/api";
import { useState, useEffect } from "react";
import {
  getAllRunStatus,
  RunInfo,
  clearAllHistory,
  isProcessAlive,
} from "./utils/status";
import { readFileSync, existsSync, appendFileSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { JSONL_LOG, LOG_DIR, formatLocalTime } from "./utils/logger";
import { GlobalStatsItem } from "./components/StatsComponents";
import { useStatusRefresh } from "./contexts/StatusRefreshContext";

export default function StatusList() {
  const [runs, setRuns] = useState<{
    running: RunInfo[];
    completed: RunInfo[];
    failed: RunInfo[];
  }>({ running: [], completed: [], failed: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [tick, setTick] = useState(0); // 用于触发运行中任务的时长更新
  const { version } = useStatusRefresh();

  useEffect(() => {
    loadStatus();

    // 每 5 秒刷新一次状态
    const interval = setInterval(() => {
      loadStatus();
    }, 5000);

    // 每 1 秒更新一次运行中任务的已用时长显示
    const tickInterval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(tickInterval);
    };
  }, [version]);

  async function loadStatus() {
    try {
      const status = getAllRunStatus(7);
      setRuns(status);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "加载状态失败",
        message: error instanceof Error ? error.message : "未知错误",
      });
    } finally {
      setIsLoading(false);
    }
  }

  function formatDateTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return "刚刚";
    } else if (diffMins < 60) {
      return `${diffMins} 分钟前`;
    } else if (diffHours < 24) {
      return `${diffHours} 小时前`;
    } else if (diffDays === 1) {
      return (
        "昨天 " +
        date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      );
    } else {
      return date.toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }

  // 计算运行中任务的已用时长（每秒刷新）
  function getElapsedDuration(startTime: Date): string {
    const elapsed = (Date.now() - startTime.getTime()) / 1000;
    return formatDuration(elapsed);
  }

  function formatDuration(seconds?: number): string {
    if (!seconds && seconds !== 0) return "";
    if (seconds < 60) {
      return `${Math.round(seconds)}秒`;
    } else {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}分${secs}秒`;
    }
  }

  // 渲染运行项
  function renderRunItem(run: RunInfo) {
    let icon: Icon;
    let statusText: string;
    let statusIcon: Icon;

    switch (run.status) {
      case "running":
        icon = Icon.CircleProgress;
        statusText = "运行中";
        statusIcon = Icon.Globe;
        break;
      case "completed":
        icon = Icon.CheckCircle;
        statusText = "成功";
        statusIcon = Icon.Check;
        break;
      case "failed":
        icon = Icon.XMarkCircle;
        statusText = "失败";
        statusIcon = Icon.ExclamationMark;
        break;
    }

    // 运行中任务显示实时已用时长
    const durationText =
      run.status === "running"
        ? getElapsedDuration(run.startTime)
        : run.duration
          ? formatDuration(run.duration)
          : undefined;

    const accessories = [
      { text: formatDateTime(run.endTime || run.startTime), icon: Icon.Clock },
      durationText ? { text: durationText, icon: Icon.Hourglass } : null,
      { text: statusText, icon: statusIcon },
      run.status === "failed" && run.exitCode !== undefined
        ? { text: `退出码: ${run.exitCode}`, icon: Icon.Text }
        : null,
    ].filter(Boolean) as { text: string; icon: Icon }[];

    return (
      <ListItem
        key={run.runId}
        id={run.runId}
        title={run.commandName}
        subtitle={run.targetFile}
        icon={icon}
        accessories={accessories}
        actions={
          <ActionPanel>
            <Action.Push
              title="查看日志详情"
              target={<LogDetail run={run} />}
              icon={Icon.Document}
              shortcut={{ modifiers: ["cmd"], key: "enter" }}
            />
            {run.status === "running" && (
              <>
                {run.pid && (
                  <Action
                    title="终止进程"
                    onAction={async () => {
                      const confirmed = await confirmAlert({
                        title: "终止进程",
                        message: `确定要终止进程 ${run.pid} 吗？这可能会丢失未保存的数据。`,
                        primaryAction: {
                          title: "终止",
                        },
                      });

                      if (!confirmed) {
                        return;
                      }

                      try {
                        execSync(`kill ${run.pid}`, { stdio: "ignore" });
                        await showToast({
                          style: Toast.Style.Success,
                          title: "进程已终止",
                          message: `进程 ${run.pid} 已被终止`,
                        });
                        setTimeout(() => loadStatus(), 500);
                      } catch (error) {
                        await showToast({
                          style: Toast.Style.Failure,
                          title: "终止失败",
                          message:
                            error instanceof Error ? error.message : "未知错误",
                        });
                      }
                    }}
                    icon={Icon.XMarkCircle}
                    shortcut={{ modifiers: ["cmd"], key: "k" }}
                  />
                )}
                <Action
                  title="强制标记为失败"
                  onAction={async () => {
                    const confirmed = await confirmAlert({
                      title: "强制标记为失败",
                      message: `这将把任务 ${run.runId} 标记为失败状态，但不会终止实际运行的进程。确定要继续吗？`,
                      primaryAction: {
                        title: "标记",
                      },
                    });

                    if (!confirmed) {
                      return;
                    }

                    try {
                      const failedEvent = {
                        ts: formatLocalTime(new Date()),
                        event: "failed",
                        run_id: run.runId,
                        status: "failed",
                        exit_code: -1,
                        duration: Math.floor(
                          (Date.now() - run.startTime.getTime()) / 1000,
                        ),
                        reason: "user_force_closed",
                      };
                      appendFileSync(
                        JSONL_LOG,
                        JSON.stringify(failedEvent) + "\n",
                      );

                      await showToast({
                        style: Toast.Style.Success,
                        title: "已标记为失败",
                        message: "任务已被强制标记为失败状态",
                      });
                      setTimeout(() => loadStatus(), 500);
                    } catch (error) {
                      await showToast({
                        style: Toast.Style.Failure,
                        title: "标记失败",
                        message:
                          error instanceof Error ? error.message : "未知错误",
                      });
                    }
                  }}
                  icon={Icon.Xmark}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "k" }}
                />
              </>
            )}
            {run.status !== "running" && (
              <Action.CopyToClipboard
                title="复制命令"
                content={run.fullCommand}
                shortcut={{ modifiers: ["cmd"], key: "c" }}
              />
            )}
            <Action
              title="刷新状态"
              onAction={loadStatus}
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
            />
          </ActionPanel>
        }
      />
    );
  }

  async function handleClearAllHistory() {
    const confirmed = await confirmAlert({
      title: "清空所有历史记录",
      message: `确定要清空所有历史记录吗？\n\n这将删除所有已完成和失败的任务日志，但会保留正在运行的任务。此操作不可撤销。`,
      primaryAction: {
        title: "清空",
      },
    });

    if (!confirmed) {
      return;
    }

    try {
      const result = clearAllHistory();
      await showToast({
        style: Toast.Style.Success,
        title: "历史记录已清空",
        message: `已删除 ${result.deletedCount} 条记录${result.runningCount > 0 ? `，保留 ${result.runningCount} 个正在运行的任务` : ""}`,
      });
      setTimeout(() => loadStatus(), 500);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "清空失败",
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  }

  const totalCount = runs.running.length + runs.completed.length + runs.failed.length;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="搜索命令历史..."
      actions={
        <ActionPanel>
          <Action
            title="刷新状态"
            onAction={loadStatus}
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
          />
          {totalCount > 0 && (
            <Action
              title="清空所有历史"
              onAction={handleClearAllHistory}
              icon={Icon.Trash}
              shortcut={{ modifiers: ["cmd", "shift"], key: "delete" }}
            />
          )}
        </ActionPanel>
      }
    >
      {/* 统计信息区域 */}
      <List.Section title="📊 执行统计">
        <GlobalStatsItem />
      </List.Section>

      {/* 运行中 */}
      {runs.running.length > 0 && (
        <List.Section title={`🔄 运行中 (${runs.running.length})`}>
          {runs.running.map(renderRunItem)}
        </List.Section>
      )}

      {/* 已完成 */}
      {runs.completed.length > 0 && (
        <List.Section title={`✅ 已完成 (${runs.completed.length})`}>
          {runs.completed.map(renderRunItem)}
        </List.Section>
      )}

      {/* 失败 */}
      {runs.failed.length > 0 && (
        <List.Section title={`❌ 失败 (${runs.failed.length})`}>
          {runs.failed.map(renderRunItem)}
        </List.Section>
      )}

      {/* 无记录 */}
      {totalCount === 0 && (
        <List.Section title="📝 运行历史">
          <List.Item
            icon={Icon.List}
            title="暂无运行记录"
            subtitle="执行命令后，这里会显示运行历史和状态"
          />
        </List.Section>
      )}
    </List>
  );
}

// 日志详情视图组件
interface LogDetailProps {
  run: RunInfo;
}

export function LogDetail({ run }: LogDetailProps) {
  const [logContent, setLogContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isActuallyRunning, setIsActuallyRunning] = useState<boolean>(
    run.status === "running" && (run.pid ? isProcessAlive(run.pid) : true),
  );

  useEffect(() => {
    loadLogContent();

    // 如果命令正在运行，每 2 秒刷新一次日志内容
    let interval: NodeJS.Timeout;
    if (run.status === "running") {
      interval = setInterval(() => {
        loadLogContent();

        // 检查进程是否真的还在运行
        if (run.pid && !isProcessAlive(run.pid)) {
          setIsActuallyRunning(false);
          clearInterval(interval);
        }
      }, 2000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [run.runId, run.status, run.pid]);

  async function loadLogContent() {
    try {
      const jsonlPath = join(LOG_DIR, "raycast-extension.jsonl");

      if (!existsSync(jsonlPath)) {
        setLogContent("JSONL 日志文件不存在");
        setIsLoading(false);
        return;
      }

      const jsonlContent = readFileSync(jsonlPath, "utf-8");
      const lines = jsonlContent.trim().split("\n");

      // 只解析属于该 runId 的条目（跳过不相关的行）
      const runEntries: any[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.run_id === run.runId) {
            runEntries.push(parsed);
          }
        } catch {
          // 跳过无法解析的行
        }
      }

      if (runEntries.length === 0) {
        setLogContent("未找到该任务的日志记录");
        setIsLoading(false);
        return;
      }

      // 提取信息
      const startedEntry = runEntries.find((e) => e.event === "started");
      const executingEntry = runEntries.find((e) => e.event === "executing");
      const completedEntry = runEntries.find(
        (e) => e.event === "completed" || e.event === "failed",
      );

      // 构建日志内容
      let logLines: string[] = [];
      logLines.push("========================================");
      logLines.push("Agent Executor - 运行日志");
      logLines.push("========================================");
      logLines.push(`Run ID: ${run.runId}`);
      if (startedEntry?.ts) {
        logLines.push(`开始时间: ${startedEntry.ts}`);
      }
      if (run.pid) {
        logLines.push(`进程 PID: ${run.pid}`);
      }
      if (run.targetPath) {
        logLines.push(`目标路径: ${run.targetPath}`);
      }
      if (run.workDir) {
        logLines.push(`工作目录: ${run.workDir}`);
      }
      if (executingEntry?.cmd) {
        logLines.push(`命令: ${executingEntry.cmd}`);
      }
      logLines.push("----------------------------------------");
      logLines.push("");
      logLines.push("执行输出:");
      logLines.push("========================================");

      // 收集输出
      let output = "";
      if (completedEntry?.output) {
        output = completedEntry.output;
      } else {
        // 收集所有实时输出事件
        const realtimeOutputs = runEntries
          .filter((e) => e.event === "realtime_output")
          .map((e) => e.output)
          .filter((o: string) => o);
        if (realtimeOutputs.length > 0) {
          output = realtimeOutputs.join("");
        }
      }

      if (output) {
        logLines.push(output);
      } else {
        logLines.push("(无输出)");
      }

      logLines.push("========================================");
      logLines.push("");
      if (completedEntry?.ts) {
        logLines.push(`结束时间: ${completedEntry.ts}`);
      }
      if (completedEntry?.duration !== undefined) {
        const duration =
          typeof completedEntry.duration === "number"
            ? completedEntry.duration
            : parseFloat(completedEntry.duration);
        if (!isNaN(duration)) {
          logLines.push(`执行时长: ${duration.toFixed(1)}秒`);
        }
      }
      if (completedEntry?.exit_code !== undefined) {
        logLines.push(`退出码: ${completedEntry.exit_code}`);
      }

      const content = logLines.join("\n");
      setLogContent(content);
      setIsLoading(false);
    } catch (error) {
      setLogContent(error instanceof Error ? error.message : "读取日志失败");
      setIsLoading(false);
    }
  }

  async function killProcess() {
    if (!run.pid) {
      await showToast({
        style: Toast.Style.Failure,
        title: "无法终止",
        message: "该命令没有进程 ID",
      });
      return;
    }

    const confirmed = await confirmAlert({
      title: "终止命令",
      message: `确定要终止进程 ${run.pid} 吗？这可能会丢失未保存的数据。`,
      primaryAction: {
        title: "终止",
      },
    });

    if (!confirmed) {
      return;
    }

    try {
      execSync(`kill ${run.pid}`, { stdio: "ignore" });
      await showToast({
        style: Toast.Style.Success,
        title: "命令已终止",
        message: `进程 ${run.pid} 已被终止`,
      });
      setTimeout(() => loadLogContent(), 500);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "终止失败",
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  }

  async function forceMarkAsFailed() {
    const confirmed = await confirmAlert({
      title: "强制标记为失败",
      message: `这将把任务 ${run.runId} 标记为失败状态，但不会终止实际运行的进程。确定要继续吗？`,
      primaryAction: {
        title: "标记",
      },
    });

    if (!confirmed) {
      return;
    }

    try {
      const failedEvent = {
        ts: formatLocalTime(new Date()),
        event: "failed",
        run_id: run.runId,
        status: "failed",
        exit_code: -1,
        duration: Math.floor((Date.now() - run.startTime.getTime()) / 1000),
        reason: "user_force_closed",
      };
      appendFileSync(JSONL_LOG, JSON.stringify(failedEvent) + "\n");

      await showToast({
        style: Toast.Style.Success,
        title: "已标记为失败",
        message: "任务已被强制标记为失败状态",
      });
      setTimeout(() => loadLogContent(), 500);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "标记失败",
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  }

  // 状态文本和图标
  const statusText =
    run.status === "running"
      ? isActuallyRunning
        ? "🟢 运行中"
        : "⚠️ 进程已结束"
      : run.status === "completed"
        ? "✅ 成功"
        : "❌ 失败";
  const durationText = run.duration ? formatDuration(run.duration) : "进行中";

  const logStats = {
    totalLines: logContent.split("\n").length,
    totalChars: logContent.length,
  };

  return (
    <Detail
      isLoading={isLoading}
      markdown={`# 日志内容\n\n\`\`\`\n${logContent}\n\`\`\``}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="状态">
            <Detail.Metadata.TagList.Item text={statusText} />
            <Detail.Metadata.TagList.Item text={durationText} color="#eed535" />
          </Detail.Metadata.TagList>

          <Detail.Metadata.Separator />

          <Detail.Metadata.TagList title="时间">
            <Detail.Metadata.TagList.Item
              text={`开始: ${formatTime(run.startTime)}`}
              color="#a0a0a0"
            />
            {run.endTime && (
              <Detail.Metadata.TagList.Item
                text={`结束: ${formatTime(run.endTime)}`}
                color="#a0a0a0"
              />
            )}
          </Detail.Metadata.TagList>

          <Detail.Metadata.Separator />

          <Detail.Metadata.TagList title="进程信息">
            {run.pid ? (
              <>
                <Detail.Metadata.TagList.Item
                  text={`PID: ${run.pid}`}
                  color="#50C878"
                />
                {isActuallyRunning && (
                  <Detail.Metadata.TagList.Item
                    text="✓ 进程运行中"
                    color="#50C878"
                  />
                )}
                {run.status === "running" && !isActuallyRunning && (
                  <Detail.Metadata.TagList.Item
                    text="✗ 进程已结束"
                    color="#ff6b6b"
                  />
                )}
              </>
            ) : (
              <Detail.Metadata.TagList.Item text="PID: 无" color="#666666" />
            )}
            <Detail.Metadata.TagList.Item
              text={`退出码: ${run.status === "failed" ? run.exitCode : run.status === "completed" ? "0" : "-"}`}
              color={
                run.status === "failed"
                  ? "#ff6b6b"
                  : run.status === "completed"
                    ? "#50C878"
                    : "#a0a0a0"
              }
            />
          </Detail.Metadata.TagList>

          <Detail.Metadata.Separator />

          <Detail.Metadata.Label title="文件" text={run.targetFile} />
          <Detail.Metadata.Label title="目录" text={run.targetPath} />

          <Detail.Metadata.Separator />

          <Detail.Metadata.Label title="命令" text={run.fullCommand} />

          <Detail.Metadata.Separator />

          <Detail.Metadata.Label title="Run ID" text={run.runId} />
          <Detail.Metadata.Label
            title="日志大小"
            text={`${logStats.totalLines} 行 / ${(logStats.totalChars / 1024).toFixed(2)} KB`}
          />

          {run.status === "running" && isActuallyRunning && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.Label
                title="🔄 自动刷新"
                text="每 2 秒"
                icon={Icon.ArrowClockwise}
              />
            </>
          )}
          {run.status === "running" && !isActuallyRunning && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.Label
                title="⚠️ 进程状态"
                text="进程已异常退出"
                icon={Icon.ExclamationMark}
              />
            </>
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.CopyToClipboard
            title="复制日志内容"
            content={logContent}
            shortcut={{ modifiers: ["cmd"], key: "c" }}
          />
          {run.status === "running" && (
            <>
              {run.pid && (
                <Action
                  title="终止进程"
                  onAction={killProcess}
                  icon={Icon.XMarkCircle}
                  shortcut={{ modifiers: ["cmd"], key: "k" }}
                />
              )}
              <Action
                title="强制标记为失败"
                onAction={forceMarkAsFailed}
                icon={Icon.Xmark}
                shortcut={{ modifiers: ["cmd", "shift"], key: "k" }}
              />
            </>
          )}
          {existsSync(run.logPath) && (
            <Action.Open
              title="在 Finder 中显示日志文件"
              target={run.logPath}
              icon={Icon.Finder}
            />
          )}
        </ActionPanel>
      }
    />
  );
}

function formatTime(date: Date) {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    if (diffMins < 1) return "刚刚";
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
  }

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  if (diffDays === 1) {
    return `昨天 ${hours}:${minutes}`;
  }

  return `${month}-${day} ${hours}:${minutes}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}秒`;
  } else {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}分${secs}秒`;
  }
}
