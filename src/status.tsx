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
import { getAllRunStatus, RunInfo, countRunningCommands, clearAllHistory } from "./utils/status";
import { readFileSync, existsSync, appendFileSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { JSONL_LOG, formatLocalTime } from "./utils/logger";
import { GlobalStatsItem } from "./components/StatsComponents";
import { useStatusRefresh } from "./contexts/StatusRefreshContext";

/**
 * 检查指定 PID 的进程是否真实存活
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const errno = (error as any).errno;
    if (errno === 'ESRCH' || errno === 'EPERM') {
      return false;
    }
    return false;
  }
}

export default function StatusList() {
  const [runs, setRuns] = useState<{
    running: RunInfo[];
    completed: RunInfo[];
    failed: RunInfo[];
  }>({ running: [], completed: [], failed: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [runningCount, setRunningCount] = useState(0);
  const [selectedRun, setSelectedRun] = useState<RunInfo | null>(null);
  const { version } = useStatusRefresh();

  useEffect(() => {
    loadStatus();

    // 每 5 秒刷新一次状态（特别是为了更新运行中的命令）
    const interval = setInterval(() => {
      loadStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [version]);

  async function loadStatus() {
    try {
      const status = getAllRunStatus(7);
      setRuns(status);
      setRunningCount(countRunningCommands());
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
      return "昨天 " + date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    } else {
      return date.toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }

  function formatDuration(seconds?: number): string {
    if (!seconds) return "";
    if (seconds < 60) {
      return `${Math.round(seconds)}秒`;
    } else {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}分${secs}秒`;
    }
  }

  // 统一的渲染函数，根据状态显示不同的图标和样式
  function renderRunItem(run: RunInfo) {
    // 根据状态确定图标和标题
    let icon: Icon;
    let title: string;
    let statusText: string;
    let statusIcon: Icon;

    switch (run.status) {
      case "running":
        icon = Icon.CircleProgress;
        title = run.commandName;
        statusText = "运行中";
        statusIcon = Icon.Globe;
        break;
      case "completed":
        icon = Icon.CheckCircle;
        title = run.commandName;
        statusText = "成功";
        statusIcon = Icon.Check;
        break;
      case "failed":
        icon = Icon.XMarkCircle;
        title = run.commandName;
        statusText = "失败";
        statusIcon = Icon.ExclamationMark;
        break;
    }

    // 构建辅助信息
    const accessories = [
      { text: formatDateTime(run.endTime || run.startTime), icon: Icon.Clock },
      run.duration ? { text: formatDuration(run.duration), icon: Icon.Hourglass } : null,
      { text: statusText, icon: statusIcon },
      run.status === "failed" && run.exitCode !== undefined ? { text: `退出码: ${run.exitCode}`, icon: Icon.Text } : null,
    ].filter(Boolean);

    return (
      <ListItem
        key={run.runId}
        id={run.runId}
        title={title}
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
                          message: error instanceof Error ? error.message : "未知错误",
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
                      // 写入失败事件到 JSONL 日志
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
                      setTimeout(() => loadStatus(), 500);
                    } catch (error) {
                      await showToast({
                        style: Toast.Style.Failure,
                        title: "标记失败",
                        message: error instanceof Error ? error.message : "未知错误",
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

  // 合并所有运行记录并按时间倒序排序（最新的在前）
  const allRuns = [...runs.running, ...runs.completed, ...runs.failed]
    .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

  const totalItems = allRuns.length;

  // 如果选中了某个 run，显示详情
  if (selectedRun) {
    return <LogDetail run={selectedRun} />;
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
          {totalItems > 0 && (
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

      {/* 运行历史区域 */}
      <List.Section title={`📝 运行历史 (${totalItems})`}>
        {totalItems === 0 ? (
          <List.Item
            icon={Icon.List}
            title="暂无运行记录"
            subtitle="执行命令后，这里会显示运行历史和状态"
          />
        ) : (
          allRuns.map(renderRunItem)
        )}
      </List.Section>
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
    run.status === "running" && (run.pid ? isProcessAlive(run.pid) : true)
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
      if (!existsSync(run.logPath)) {
        setLogContent("日志文件不存在");
        setIsLoading(false);
        return;
      }

      const content = readFileSync(run.logPath, "utf-8");
      setLogContent(content);

      // 如果已经有内容了，就不再显示 loading
      if (content.length > 0) {
        setIsLoading(false);
      }
    } catch (error) {
      setLogContent(error instanceof Error ? error.message : "读取日志失败");
    } finally {
      // 只在第一次加载时设置 isLoading 为 false
      if (logContent === "") {
        setIsLoading(false);
      }
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
      // 刷新日志内容以查看最终状态
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
      // 写入失败事件到 JSONL 日志
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
      // 刷新日志内容以查看最终状态
      setTimeout(() => loadLogContent(), 500);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "标记失败",
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  }

  // 格式化时间 - 包含日期
  const formatTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // 今天：显示相对时间
    if (diffDays === 0) {
      if (diffMins < 1) return "刚刚";
      if (diffMins < 60) return `${diffMins}分钟前`;
      if (diffHours < 24) return `${diffHours}小时前`;
    }

    // 昨天或更早：显示完整日期时间
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    if (diffDays === 1) {
      return `昨天 ${hours}:${minutes}`;
    }

    return `${month}-${day} ${hours}:${minutes}`;
  };

  // 计算日志统计信息
  const logStats = {
    totalLines: logContent.split("\n").length,
    totalChars: logContent.length,
  };

  // 状态文本和图标
  const statusText = run.status === "running"
    ? (isActuallyRunning ? "🟢 运行中" : "⚠️ 进程已结束")
    : run.status === "completed" ? "✅ 成功" : "❌ 失败";
  const durationText = run.duration ? formatDuration(run.duration) : "进行中";

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
            <Detail.Metadata.TagList.Item text={`开始: ${formatTime(run.startTime)}`} color="#a0a0a0" />
            {run.endTime && <Detail.Metadata.TagList.Item text={`结束: ${formatTime(run.endTime)}`} color="#a0a0a0" />}
          </Detail.Metadata.TagList>

          <Detail.Metadata.Separator />

          <Detail.Metadata.TagList title="进程信息">
            {run.pid ? (
              <>
                <Detail.Metadata.TagList.Item text={`PID: ${run.pid}`} color="#50C878" />
                {isActuallyRunning && (
                  <Detail.Metadata.TagList.Item text="✓ 进程运行中" color="#50C878" />
                )}
                {run.status === "running" && !isActuallyRunning && (
                  <Detail.Metadata.TagList.Item text="✗ 进程已结束" color="#ff6b6b" />
                )}
              </>
            ) : (
              <Detail.Metadata.TagList.Item text="PID: 无" color="#666666" />
            )}
            <Detail.Metadata.TagList.Item
              text={`退出码: ${run.status === "failed" ? run.exitCode : run.status === "completed" ? "0" : "-"}`}
              color={run.status === "failed" ? "#ff6b6b" : run.status === "completed" ? "#50C878" : "#a0a0a0"}
            />
          </Detail.Metadata.TagList>

          <Detail.Metadata.Separator />

          <Detail.Metadata.Label title="文件" text={run.targetFile} />
          <Detail.Metadata.Label title="目录" text={run.targetPath} />

          <Detail.Metadata.Separator />

          <Detail.Metadata.Label title="命令" text={run.fullCommand} />

          <Detail.Metadata.Separator />

          <Detail.Metadata.Label title="Run ID" text={run.runId} />
          <Detail.Metadata.Label title="日志大小" text={`${logStats.totalLines} 行 / ${(logStats.totalChars / 1024).toFixed(2)} KB`} />

          {run.status === "running" && isActuallyRunning && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.Label title="🔄 自动刷新" text="每 2 秒" icon={Icon.ArrowClockwise} />
            </>
          )}
          {run.status === "running" && !isActuallyRunning && (
            <>
              <Detail.Metadata.Separator />
              <Detail.Metadata.Label title="⚠️ 进程状态" text="进程已异常退出" icon={Icon.ExclamationMark} />
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

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}秒`;
  } else {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}分${secs}秒`;
  }
}
