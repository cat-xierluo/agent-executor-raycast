import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { LOG_DIR } from "./logger";
import { countRunningCommands } from "./status";
import { GetPreferenceValues } from "@raycast/api";

const QUEUE_FILE = join(LOG_DIR, "task-queue.json");

export interface QueuedTask {
  id: string;
  skillName: string;
  prompt: string;
  projectDir: string;
  claudeBin: string;
  headlessMode: boolean;
  streamingMode: boolean;
  targetFilePath?: string;
  note?: string;
  queuedAt: string;
}

interface TaskQueueData {
  version: number;
  tasks: QueuedTask[];
}

// 正在 spawn 但 PID 尚未写入日志的任务计数
let spawningCount = 0;

// executor 回调：由 commands.tsx 注入
type TaskExecutor = (task: QueuedTask) => Promise<void>;
let currentExecutor: TaskExecutor | null = null;

// 简易写锁（Node.js 单线程，boolean 即可）
let writing = false;

function generateTaskId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export function getConcurrencyLimit(): number {
  try {
    const prefs = GetPreferenceValues<Record<string, string>>();
    return parseInt(prefs.concurrencyLimit || "5", 10);
  } catch {
    return 5;
  }
}

function readQueueFile(): TaskQueueData {
  try {
    if (!existsSync(QUEUE_FILE)) {
      return { version: 1, tasks: [] };
    }
    const raw = readFileSync(QUEUE_FILE, "utf-8");
    const data = JSON.parse(raw) as TaskQueueData;
    if (!data.tasks || !Array.isArray(data.tasks)) {
      return { version: 1, tasks: [] };
    }
    return data;
  } catch {
    return { version: 1, tasks: [] };
  }
}

function writeQueueFile(data: TaskQueueData): void {
  if (writing) return;
  writing = true;
  try {
    writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[taskQueue] Failed to write queue file:", err);
  } finally {
    writing = false;
  }
}

export function initQueue(): void {
  if (!existsSync(QUEUE_FILE)) {
    writeQueueFile({ version: 1, tasks: [] });
  }
}

export function setExecutor(executor: TaskExecutor): void {
  currentExecutor = executor;
}

export function enqueue(task: Omit<QueuedTask, "id" | "queuedAt">): string {
  const id = generateTaskId();
  const queuedTask: QueuedTask = {
    ...task,
    id,
    queuedAt: new Date().toISOString(),
  };

  const data = readQueueFile();
  data.tasks.push(queuedTask);
  writeQueueFile(data);

  // 尝试立即调度
  scheduleNext();

  return id;
}

export function dequeue(taskId: string): void {
  const data = readQueueFile();
  data.tasks = data.tasks.filter((t) => t.id !== taskId);
  writeQueueFile(data);
}

export function getQueuedTasks(): QueuedTask[] {
  return readQueueFile().tasks;
}

export function getQueuePosition(taskId: string): number {
  const data = readQueueFile();
  const idx = data.tasks.findIndex((t) => t.id === taskId);
  return idx >= 0 ? idx + 1 : 0;
}

export function getEffectiveRunningCount(): number {
  return countRunningCommands() + spawningCount;
}

export function incrementSpawningCount(): void {
  spawningCount++;
}

export function decrementSpawningCount(): void {
  spawningCount = Math.max(0, spawningCount - 1);
}

export function scheduleNext(): void {
  if (!currentExecutor) return;

  const limit = getConcurrencyLimit();
  const running = getEffectiveRunningCount();

  if (running >= limit) return;

  const data = readQueueFile();
  if (data.tasks.length === 0) return;

  // 出队第一个任务
  const task = data.tasks.shift()!;
  writeQueueFile(data);

  spawningCount++;

  // 异步执行，不阻塞调度
  currentExecutor(task)
    .catch((err) => {
      console.error(`[taskQueue] Executor failed for ${task.skillName}:`, err);
    })
    .finally(() => {
      spawningCount = Math.max(0, spawningCount - 1);
      // 递归调度下一个
      scheduleNext();
    });
}

export function restoreAndSchedule(): void {
  const data = readQueueFile();
  // 清理超过 24 小时仍未执行的过期任务
  const oneDayAgo = new Date();
  oneDayAgo.setHours(oneDayAgo.getHours() - 24);
  const before = data.tasks.length;
  data.tasks = data.tasks.filter(
    (t) => new Date(t.queuedAt) >= oneDayAgo,
  );
  if (data.tasks.length !== before) {
    writeQueueFile(data);
  }

  // 尝试调度
  scheduleNext();
}

export function clearQueue(): void {
  writeQueueFile({ version: 1, tasks: [] });
}
