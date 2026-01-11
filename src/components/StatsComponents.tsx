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
import { getGlobalSummary, getAllCommandStats, clearAllStats, clearCommandStats, CommandStats } from "../utils/stats";
import { clearAllHistory } from "../utils/status";

/**
 * 全局统计信息展示组件
 */
export function GlobalStatsItem() {
  const summary = getGlobalSummary();

  function formatSuccessRate(rate: number): string {
    if (rate >= 90) {
      return `🟢 ${rate.toFixed(1)}%`;
    } else if (rate >= 70) {
      return `🟡 ${rate.toFixed(1)}%`;
    } else {
      return `🔴 ${rate.toFixed(1)}%`;
    }
  }

  const globalMarkdown = `# 📊 全局统计摘要

**总执行次数:** ${summary.totalExecutions}

**成功次数:** ${summary.totalSuccesses} ✅

**失败次数:** ${summary.totalFailures} ❌

**全局成功率:** ${formatSuccessRate(summary.globalSuccessRate)}

**命令数量:** ${summary.commandCount}

**最常用命令:** ${summary.mostUsedCommand || "无"}

---

💡 **提示:** 点击查看各命令详细统计
`;

  async function handleClearAllHistory() {
    const confirmed = await confirmAlert({
      title: "清空所有历史记录",
      message: "确定要清空所有历史记录吗？\n\n这将删除所有已完成和失败的任务日志，但会保留正在运行的任务。此操作不可撤销。",
      primaryAction: {
        title: "清空",
        style: Action.Style.Destructive,
      },
    });

    if (confirmed) {
      try {
        const result = clearAllHistory();
        await showToast({
          style: Toast.Style.Success,
          title: "历史记录已清空",
          message: `已删除 ${result.deletedCount} 条记录${result.runningCount > 0 ? `，保留 ${result.runningCount} 个正在运行的任务` : ""}`,
        });
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "清空失败",
          message: error instanceof Error ? error.message : "未知错误",
        });
      }
    }
  }

  return (
    <ListItem
      key="global-stats"
      title="全局统计"
      icon={Icon.BarChart}
      accessories={[
        {
          text: `${summary.totalExecutions} 次`,
          tooltip: "总执行次数",
        },
        {
          text: formatSuccessRate(summary.globalSuccessRate),
          tooltip: "成功率",
        },
      ]}
      actions={
        <ActionPanel>
          <Action.Push
            title="查看详情"
            icon={Icon.Eye}
            target={<Detail markdown={globalMarkdown} />}
          />
          <Action.Push
            title="查看命令统计"
            icon={Icon.List}
            target={<CommandStatsList />}
          />
          <Action
            title="清空所有历史记录"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
            onAction={handleClearAllHistory}
          />
        </ActionPanel>
      }
    />
  );
}

/**
 * 命令统计列表组件
 */
export function CommandStatsList() {
  const [stats, setStats] = useState<CommandStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  function loadStats() {
    setIsLoading(true);
    try {
      const commandStats = getAllCommandStats();
      setStats(commandStats);
    } catch (error) {
      console.error("Failed to load stats:", error);
    } finally {
      setIsLoading(false);
    }
  }

  function formatDurationMs(ms: number): string {
    if (ms < 1000) {
      return `${ms.toFixed(0)}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = ((ms % 60000) / 1000).toFixed(0);
      return `${minutes}m ${seconds}s`;
    }
  }

  function formatSuccessRate(rate: number): string {
    if (rate >= 90) {
      return `🟢 ${rate.toFixed(1)}%`;
    } else if (rate >= 70) {
      return `🟡 ${rate.toFixed(1)}%`;
    } else {
      return `🔴 ${rate.toFixed(1)}%`;
    }
  }

  async function handleClearCommand(commandName: string) {
    const confirmed = await confirmAlert({
      title: `清空 ${commandName} 统计数据`,
      message: "确定要清空该命令的统计数据吗？此操作不可恢复。",
      primaryAction: {
        title: "清空",
        style: Action.Style.Destructive,
      },
    });

    if (confirmed) {
      try {
        clearCommandStats(commandName);
        await showToast({
          style: Toast.Style.Success,
          title: `${commandName} 统计数据已清空`,
        });
        loadStats();
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "清空失败",
          message: error instanceof Error ? error.message : "未知错误",
        });
      }
    }
  }

  return (
    <List isLoading={isLoading} navigationTitle="命令统计" searchBarPlaceholder="搜索命令...">
      <List.Section title={`命令统计 (${stats.length})`}>
        {stats.map((stat) => (
          <ListItem
            key={stat.commandName}
            title={stat.commandName}
            icon={Icon.Terminal}
            accessories={[
              {
                text: `${stat.totalExecutions}次`,
                tooltip: "总执行次数",
              },
              {
                text: formatSuccessRate(stat.successRate),
                tooltip: "成功率",
              },
              {
                text: formatDurationMs(stat.averageDuration),
                tooltip: "平均执行时间",
              },
            ]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="查看详情"
                  icon={Icon.Eye}
                  target={<CommandStatsDetail stats={stat} />}
                />
                <Action
                  title="清空该命令统计"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ["cmd"], key: "delete" }}
                  onAction={() => handleClearCommand(stat.commandName)}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}

/**
 * 命令统计详情组件
 */
export function CommandStatsDetail({ stats }: { stats: CommandStats }) {
  function formatDurationMs(ms: number): string {
    if (ms < 1000) {
      return `${ms.toFixed(0)}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = ((ms % 60000) / 1000).toFixed(0);
      return `${minutes}m ${seconds}s`;
    }
  }

  function formatSuccessRate(rate: number): string {
    if (rate >= 90) {
      return `🟢 ${rate.toFixed(1)}%`;
    } else if (rate >= 70) {
      return `🟡 ${rate.toFixed(1)}%`;
    } else {
      return `🔴 ${rate.toFixed(1)}%`;
    }
  }

  function formatTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  const markdown = `# ${stats.commandName} 统计详情

## 📈 执行统计

- **总执行次数:** ${stats.totalExecutions}
- **成功次数:** ${stats.successCount} ✅
- **失败次数:** ${stats.failureCount} ❌
- **成功率:** ${formatSuccessRate(stats.successRate)}

## ⏱️ 执行时间

- **平均时长:** ${formatDurationMs(stats.averageDuration)}
- **最短时长:** ${formatDurationMs(stats.minDuration)}
- **最长时长:** ${formatDurationMs(stats.maxDuration)}
- **总时长:** ${formatDurationMs(stats.totalDuration)}

## 📅 时间记录

- **首次执行:** ${formatTime(stats.firstExecutedAt)}
- **最后执行:** ${formatTime(stats.lastExecutedAt)}

---

💡 **提示:** 使用 \`⌘R\` 刷新统计数据
`;

  return (
    <Detail
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="命令名称" text={stats.commandName} />
          <Detail.Metadata.Separator />

          <Detail.Metadata.Label
            title="执行次数"
            text={stats.totalExecutions.toString()}
            icon={Icon.Repeat}
          />
          <Detail.Metadata.Label
            title="成功 / 失败"
            text={`${stats.successCount} / ${stats.failureCount}`}
            icon={stats.successRate >= 90 ? Icon.CheckCircle : Icon.XMarkCircle}
          />
          <Detail.Metadata.Label
            title="成功率"
            text={formatSuccessRate(stats.successRate)}
          />

          <Detail.Metadata.Separator />

          <Detail.Metadata.Label
            title="平均时长"
            text={formatDurationMs(stats.averageDuration)}
            icon={Icon.Clock}
          />
          <Detail.Metadata.Label
            title="最短 / 最长"
            text={`${formatDurationMs(stats.minDuration)} / ${formatDurationMs(stats.maxDuration)}`}
          />

          <Detail.Metadata.Separator />

          <Detail.Metadata.Label
            title="首次执行"
            text={formatTime(stats.firstExecutedAt)}
            icon={Icon.Calendar}
          />
          <Detail.Metadata.Label
            title="最后执行"
            text={formatTime(stats.lastExecutedAt)}
          />
        </Detail.Metadata>
      }
    />
  );
}
