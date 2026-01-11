import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { LOG_DIR } from "./logger";

/**
 * 命令统计数据接口
 */
export interface CommandStats {
  /** 命令名称 */
  commandName: string;
  /** 总执行次数 */
  totalExecutions: number;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failureCount: number;
  /** 成功率（百分比） */
  successRate: number;
  /** 总执行时间（毫秒） */
  totalDuration: number;
  /** 平均执行时间（毫秒） */
  averageDuration: number;
  /** 最短执行时间（毫秒） */
  minDuration: number;
  /** 最长执行时间（毫秒） */
  maxDuration: number;
  /** 最后执行时间 */
  lastExecutedAt: string;
  /** 首次执行时间 */
  firstExecutedAt: string;
}

/**
 * 所有命令的统计数据
 */
export interface StatsData {
  /** 各命令统计 */
  commands: Record<string, CommandStats>;
  /** 全局统计更新时间 */
  lastUpdated: string;
}

// 统计数据文件路径
const STATS_FILE = join(LOG_DIR, "stats.json");

/**
 * 确保日志目录存在
 */
function ensureStatsDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * 读取统计数据
 */
export function readStats(): StatsData {
  ensureStatsDir();

  if (!existsSync(STATS_FILE)) {
    return {
      commands: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  try {
    const content = readFileSync(STATS_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error("[stats] Failed to read stats file:", error);
    return {
      commands: {},
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * 写入统计数据
 */
export function writeStats(data: StatsData): void {
  ensureStatsDir();

  try {
    data.lastUpdated = new Date().toISOString();
    writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("[stats] Failed to write stats file:", error);
  }
}

/**
 * 初始化命令统计
 */
function initCommandStats(commandName: string): CommandStats {
  const now = new Date().toISOString();
  return {
    commandName,
    totalExecutions: 0,
    successCount: 0,
    failureCount: 0,
    successRate: 0,
    totalDuration: 0,
    averageDuration: 0,
    minDuration: Number.MAX_SAFE_INTEGER,
    maxDuration: 0,
    lastExecutedAt: now,
    firstExecutedAt: now,
  };
}

/**
 * 记录命令执行结果
 * @param commandName 命令名称
 * @param success 是否成功
 * @param duration 执行时长（毫秒）
 */
export function recordExecution(commandName: string, success: boolean, duration: number): void {
  const stats = readStats();

  // 获取或初始化该命令的统计数据
  if (!stats.commands[commandName]) {
    stats.commands[commandName] = initCommandStats(commandName);
  }

  const cmdStats = stats.commands[commandName];
  const now = new Date().toISOString();

  // 更新统计数据
  cmdStats.totalExecutions += 1;
  if (success) {
    cmdStats.successCount += 1;
  } else {
    cmdStats.failureCount += 1;
  }
  cmdStats.successRate = (cmdStats.successCount / cmdStats.totalExecutions) * 100;

  // 更新时长统计
  cmdStats.totalDuration += duration;
  cmdStats.averageDuration = cmdStats.totalDuration / cmdStats.totalExecutions;
  cmdStats.minDuration = Math.min(cmdStats.minDuration, duration);
  cmdStats.maxDuration = Math.max(cmdStats.maxDuration, duration);

  // 更新时间戳
  cmdStats.lastExecutedAt = now;

  // 写入更新后的统计数据
  writeStats(stats);
}

/**
 * 获取指定命令的统计数据
 */
export function getCommandStats(commandName: string): CommandStats | null {
  const stats = readStats();
  return stats.commands[commandName] || null;
}

/**
 * 获取所有命令的统计数据（按执行次数降序）
 */
export function getAllCommandStats(): CommandStats[] {
  const stats = readStats();
  return Object.values(stats.commands).sort((a, b) => b.totalExecutions - a.totalExecutions);
}

/**
 * 清空所有统计数据
 */
export function clearAllStats(): void {
  const emptyStats: StatsData = {
    commands: {},
    lastUpdated: new Date().toISOString(),
  };
  writeStats(emptyStats);
}

/**
 * 清空指定命令的统计数据
 */
export function clearCommandStats(commandName: string): void {
  const stats = readStats();
  if (stats.commands[commandName]) {
    delete stats.commands[commandName];
    writeStats(stats);
  }
}

/**
 * 获取全局统计摘要
 */
export interface GlobalStatsSummary {
  /** 总执行次数 */
  totalExecutions: number;
  /** 总成功次数 */
  totalSuccesses: number;
  /** 总失败次数 */
  totalFailures: number;
  /** 全局成功率 */
  globalSuccessRate: number;
  /** 命令数量 */
  commandCount: number;
  /** 最常用命令 */
  mostUsedCommand: string | null;
  /** 最后更新时间 */
  lastUpdated: string;
}

export function getGlobalSummary(): GlobalStatsSummary {
  const stats = readStats();
  const allCommands = Object.values(stats.commands);

  const totalExecutions = allCommands.reduce((sum, cmd) => sum + cmd.totalExecutions, 0);
  const totalSuccesses = allCommands.reduce((sum, cmd) => sum + cmd.successCount, 0);
  const totalFailures = allCommands.reduce((sum, cmd) => sum + cmd.failureCount, 0);

  const mostUsed = allCommands.sort((a, b) => b.totalExecutions - a.totalExecutions)[0];

  return {
    totalExecutions,
    totalSuccesses,
    totalFailures,
    globalSuccessRate: totalExecutions > 0 ? (totalSuccesses / totalExecutions) * 100 : 0,
    commandCount: allCommands.length,
    mostUsedCommand: mostUsed?.commandName || null,
    lastUpdated: stats.lastUpdated,
  };
}
