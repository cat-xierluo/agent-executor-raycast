import {
  List,
  ListItem,
  ActionPanel,
  Action,
  showToast,
  Toast,
  getSelectedFinderItems,
  Icon,
  closeMainWindow,
  showHUD,
  confirmAlert,
  openCommandPreferences,
  Detail,
} from "@raycast/api";
import React, { useState, useEffect, useRef } from "react";
import {
  executeClaudeCommand,
  executeClaudeStreaming,
  getConfig,
} from "./utils/claude";
import { RunLogger } from "./utils/logger";
import { scanSkills, ClaudeSkill } from "./utils/skills";
import { toggleSkillPinned, toggleSkillNew } from "./utils/commandMetadata";
import {
  getSelectedDevonThinkRecords,
  checkDevonThinkAvailable,
  prepareFilePathForCommand,
  isDevonThinkURL,
  isFilesNoIndexPath,
  DevonThinkRecord,
  getFrontmostApplication,
  isFinderFrontmost,
} from "./utils/devonthink";
import { readdirSync, statSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { countRunningCommands } from "./utils/status";
import { recordExecution, getGlobalSummary } from "./utils/stats";
import StatusList from "./status";
import { triggerStatusRefresh } from "./contexts/StatusRefreshContext";

// 不需要文件的 Skill 名称列表（兼容层）
const SKILLS_NO_FILE_REQUIRED = ["deepresearch", "sync-external"];
// 需要确认弹窗的 Skill 名称列表（兼容层）
const SKILLS_REQUIRE_CONFIRM: Record<
  string,
  { title: string; message: string }
> = {
  "sync-external": { title: "同步外部文件", message: "确定要同步外部文件吗?" },
};


export default function CommandList() {
  const [items, setItems] = useState<ClaudeSkill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [devonThinkRecords, setDevonThinkRecords] = useState<
    Map<string, DevonThinkRecord>
  >(new Map());
  const [processingCommand, setProcessingCommand] = useState<{ name: string; pid?: number }[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [note, setNote] = useState<string>("");
  const [runningCount, setRunningCount] = useState<number>(0);
  const [totalExecutions, setTotalExecutions] = useState<number>(0);
  const [showAllFiles, setShowAllFiles] = useState<boolean>(false);
  // 记录正在执行技能的 PID，用于取消功能
  const activePids = useRef<Record<string, number>>({});

  // 流式输出相关状态
  const [streamingOutput, setStreamingOutput] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamingCommand, setStreamingCommand] = useState<string | null>(null);

  useEffect(() => {
    const timestamp = new Date().toISOString();
    console.log(`[CommandList] Component mounted at ${timestamp}`);
    loadSkills();
    loadSelectedFiles();
    loadRunningCount();

    const interval = setInterval(() => {
      loadRunningCount();
      loadSkills();
    }, 5000);

    const fileRefreshInterval = setInterval(() => {
      loadSelectedFiles();
    }, 2000);

    return () => {
      clearInterval(interval);
      clearInterval(fileRefreshInterval);
    };
  }, []);

  function loadRunningCount() {
    try {
      setRunningCount(countRunningCommands());
      const summary = getGlobalSummary();
      setTotalExecutions(summary.totalExecutions);
    } catch (error) {
      console.error("Failed to load running count:", error);
    }
  }

  async function loadSkills() {
    try {
      const config = getConfig();
      const availableSkills = scanSkills(config.projectDirs);
      setItems(availableSkills);
    } catch (error) {
      const isConfigError =
        error instanceof Error && (error as any).isConfigError;

      await showToast({
        style: Toast.Style.Failure,
        title: isConfigError ? "配置错误" : "加载失败",
        message: error instanceof Error ? error.message : "未知错误",
      });

      if (isConfigError) {
        setItems([]);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSelectedFiles(forceUpdate: boolean = false) {
    let filePaths: string[] = [];
    let source = "";
    const recordsMap = new Map<string, DevonThinkRecord>();

    try {
      const frontApp = await getFrontmostApplication();
      const isFinder = await isFinderFrontmost();

      if (isFinder) {
        try {
          const finderItems = await getSelectedFinderItems();
          filePaths = finderItems.map((item) => item.path);
          if (filePaths.length > 0) source = "Finder";
        } catch (error) {
          console.error(
            "[loadSelectedFiles] Failed to get Finder items:",
            error,
          );
        }
      } else if (
        frontApp.toLowerCase().includes("devon") ||
        frontApp.toLowerCase().includes("think")
      ) {
        try {
          const isDevonThinkAvailable = await checkDevonThinkAvailable();
          if (isDevonThinkAvailable) {
            const records = await getSelectedDevonThinkRecords();
            filePaths = records.map((record) => record.path);
            records.forEach((record) => {
              recordsMap.set(record.path, record);
            });
            if (filePaths.length > 0) source = "DEVONthink";
          }
        } catch (error) {
          console.error(
            "[loadSelectedFiles] Failed to get DEVONthink records:",
            error,
          );
        }
      } else {
        try {
          const finderItems = await getSelectedFinderItems();
          filePaths = finderItems.map((item) => item.path);
          if (filePaths.length > 0) source = "Finder";
        } catch (error) {
          console.error(
            "[loadSelectedFiles] Failed to get Finder items (fallback):",
            error,
          );
        }
      }
    } catch (error) {
      console.error(
        "[loadSelectedFiles] Failed to detect frontmost app:",
        error,
      );
      try {
        const finderItems = await getSelectedFinderItems();
        filePaths = finderItems.map((item) => item.path);
        if (filePaths.length > 0) source = "Finder";
      } catch (err) {
        console.error(
          "[loadSelectedFiles] Failed to get Finder items (emergency fallback):",
          err,
        );
      }
    }

    if (filePaths.length === 0) {
      if (forceUpdate) {
        await showToast({
          style: Toast.Style.Failure,
          title: "未获取到选中文件",
          message:
            selectedFiles.length > 0
              ? "已保留上次选择"
              : "请在 Finder 或 DEVONthink 中选择文件",
        });
      }
      return;
    }

    setSelectedFiles(filePaths);
    setDevonThinkRecords(recordsMap);
    setShowAllFiles(false); // 重置展开状态

    if (source && forceUpdate) {
      await showToast({
        style: Toast.Style.Success,
        title: `从 ${source} 获取了 ${filePaths.length} 个文件`,
        message:
          filePaths.length === 1 ? filePaths[0].split("/").pop() : undefined,
      });
    }

    setRefreshKey((prev) => prev + 1);
  }

  /**
   * 执行自由指令（直接输入prompt，不走skill）
   */
  async function executeFreeCommand() {
    if (processingCommand.some((c) => c.name === "free-command")) return;

    const validFiles = selectedFiles.filter(
      (file) => file && file.trim().length > 0,
    );
    const executionFile = validFiles[0];

    if (!executionFile) {
      await showToast({
        style: Toast.Style.Failure,
        title: "未选择文件",
        message: "请在 Finder 或 DEVONthink 中选择文件后重试",
      });
      return;
    }

    const userPrompt = note.trim();
    if (!userPrompt) {
      await showToast({
        style: Toast.Style.Failure,
        title: "未输入指令",
        message: "请在搜索框中输入你的要求",
      });
      return;
    }

    setProcessingCommand((prev) => [...prev, { name: "free-command" }]);

    // DEVONthink 文件导出
    let actualFilePath = executionFile;
    const record = executionFile
      ? devonThinkRecords.get(executionFile)
      : undefined;

    if (
      record &&
      executionFile &&
      (isDevonThinkURL(executionFile) || isFilesNoIndexPath(executionFile))
    ) {
      const exportToast = await showToast({
        style: Toast.Style.Animated,
        title: "正在导出文件",
        message: "从 DEVONthink 导出文件到临时目录...",
      });

      try {
        const prepared = await prepareFilePathForCommand(record);
        actualFilePath = prepared.path;
        if (prepared.isTemp) {
          await exportToast.hide();
          await showToast({
            style: Toast.Style.Success,
            title: "文件已导出",
            message: `临时路径: ${actualFilePath}`,
          });
        }
      } catch (error) {
        await exportToast.hide();
        await showToast({
          style: Toast.Style.Failure,
          title: "导出文件失败",
          message: error instanceof Error ? error.message : "未知错误",
        });
        setProcessingCommand((prev) => prev.filter((c) => c.name !== "free-command"));
        return;
      }
    }

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "正在执行自由指令",
      message: actualFilePath.split("/").pop() || "",
    });

    const executionStartTime = Date.now();
    const config = getConfig();

    try {
      const projectDir = config.projectDirs[0];
      const logger = new RunLogger(actualFilePath, projectDir);

      logger.logValidated();

      // 构建 prompt: 直接使用用户输入，不加 /skillname 前缀
      const prompt = `${userPrompt} "${actualFilePath}"`;

      let result;

      if (config.streamingMode && config.headlessMode) {
        let fullOutput = "";
        setStreamingOutput(`› ${prompt}\n\n`);
        setIsStreaming(true);
        setStreamingCommand("自由指令");

        result = await executeClaudeStreaming({
          prompt,
          workDir: projectDir,
          projectDir,
          claudeBin: config.claudeBin,
          headlessMode: config.headlessMode,
          logger,
          onChunk: (chunk, isFinal) => {
            fullOutput += chunk;
            setStreamingOutput((prev) => prev + chunk);
            if (isFinal) setIsStreaming(false);
          },
        });

        logger.logCompleted(fullOutput, result.exitCode, result.pid, result.sessionId, result.apiSuccess);
        if (result.pid) activePids.current["free-command"] = result.pid;
      } else {
        result = await executeClaudeCommand(
          {
            prompt,
            workDir: projectDir,
            projectDir,
            claudeBin: config.claudeBin,
            headlessMode: config.headlessMode,
          },
          logger,
        );

        logger.logCompleted(result.output, result.exitCode, undefined, undefined, result.apiSuccess);
        if (result.pid) activePids.current["free-command"] = result.pid;
      }

      const executionDuration = Date.now() - executionStartTime;
      recordExecution("free-command", result.success, executionDuration);

      if (result.success) {
        if (config.streamingMode && config.headlessMode) {
          setStreamingOutput(
            (prev) =>
              prev +
              `\n\n✅ 命令执行完成 (${Math.round(result.duration / 1000)}s)\n`,
          );
        } else {
          await toast.hide();
          if (config.headlessMode) {
            await showHUD(
              `✅ 自由指令完成 (${Math.round(result.duration / 1000)}s)`,
            );
          } else {
            await showHUD(`🖥️ 自由指令已在 Terminal 窗口中执行`);
          }
          await closeMainWindow();
        }
      } else {
        if (config.streamingMode && config.headlessMode) {
          setStreamingOutput(
            (prev) => prev + `\n\n❌ 执行失败 (退出码: ${result.exitCode})\n`,
          );
        } else {
          toast.style = Toast.Style.Failure;
          toast.title = "执行失败";
          toast.message = `退出码: ${result.exitCode}`;
        }
      }
    } catch (error) {
      console.error(`[executeFreeCommand] Error:`, error);

      if (config.streamingMode && config.headlessMode) {
        setStreamingOutput(
          (prev) =>
            prev +
            `\n\n❌ 错误: ${error instanceof Error ? error.message : "未知错误"}\n`,
        );
        setIsStreaming(false);
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = "执行失败";
        toast.message = error instanceof Error ? error.message : "未知错误";
      }

      const executionDuration = Date.now() - executionStartTime;
      recordExecution("free-command", false, executionDuration);
    } finally {
      delete activePids.current["free-command"];
      setProcessingCommand((prev) => prev.filter((c) => c.name !== "free-command"));
      if (config.streamingMode && config.headlessMode) {
        setIsStreaming(false);
      }
      loadRunningCount();
      loadSkills();
      triggerStatusRefresh();
    }
  }

  /**
   * 执行技能（包含兼容层的特殊处理）
   */
  async function executeSkill(skill: ClaudeSkill) {
    if (processingCommand.some((c) => c.name === skill.name)) return;

    const needsFile = !SKILLS_NO_FILE_REQUIRED.includes(skill.name);

    // 文件检查
    const validFiles = selectedFiles.filter(
      (file) => file && file.trim().length > 0,
    );
    const executionFile = validFiles[0];

    if (needsFile && !executionFile) {
      await showToast({
        style: Toast.Style.Failure,
        title: "未选择文件",
        message: "请在 Finder 或 DEVONthink 中选择文件后重试",
      });
      return;
    }

    // 确认弹窗（兼容层）
    const confirmConfig = SKILLS_REQUIRE_CONFIRM[skill.name];
    if (confirmConfig) {
      const confirmed = await confirmAlert({
        title: confirmConfig.title,
        message: confirmConfig.message,
        primaryAction: { title: "确认" },
      });
      if (!confirmed) return;
    }

    setProcessingCommand((prev) => [...prev, { name: skill.name }]);

    // DEVONthink 文件导出
    let actualFilePath = executionFile || "";
    const record = executionFile
      ? devonThinkRecords.get(executionFile)
      : undefined;

    if (
      record &&
      executionFile &&
      (isDevonThinkURL(executionFile) || isFilesNoIndexPath(executionFile))
    ) {
      const exportToast = await showToast({
        style: Toast.Style.Animated,
        title: "正在导出文件",
        message: "从 DEVONthink 导出文件到临时目录...",
      });

      try {
        const prepared = await prepareFilePathForCommand(record);
        actualFilePath = prepared.path;
        if (prepared.isTemp) {
          await exportToast.hide();
          await showToast({
            style: Toast.Style.Success,
            title: "文件已导出",
            message: `临时路径: ${actualFilePath}`,
          });
        }
      } catch (error) {
        await exportToast.hide();
        await showToast({
          style: Toast.Style.Failure,
          title: "导出文件失败",
          message: error instanceof Error ? error.message : "未知错误",
        });
        setProcessingCommand((prev) => prev.filter((c) => c.name !== skill.name));
        return;
      }
    }

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `正在执行：${skill.title}`,
      message: actualFilePath.split("/").pop() || "",
    });

    const executionStartTime = Date.now();
    const config = getConfig();

    try {
      const projectDir = skill.projectDir || config.projectDirs[0];
      const logger = new RunLogger(actualFilePath || skill.name, projectDir);

      logger.logValidated();
      // 注意: startRealtimeLogging() 在 executeClaudeStreaming/executeClaudeCommand 内部调用

      // 构建 prompt
      let prompt = `/${skill.name}`;

      if (needsFile) {
        if (validFiles.length > 1) {
          // 多文件：传递所有选中文件
          prompt += " " + validFiles.map((f) => `"${f}"`).join(" ");
        } else if (actualFilePath) {
          // 单文件：只传一个
          prompt += ` "${actualFilePath}"`;
        }
      }

      if (note && note.trim()) {
        prompt += ` ${note.trim()}`;
      }

      let result;

      if (config.streamingMode && config.headlessMode) {
        let fullOutput = "";
        setStreamingOutput(`› ${prompt}\n\n`);
        setIsStreaming(true);
        setStreamingCommand(skill.title);

        result = await executeClaudeStreaming({
          prompt,
          workDir: projectDir,
          projectDir,
          claudeBin: config.claudeBin,
          headlessMode: config.headlessMode,
          logger,
          onChunk: (chunk, isFinal) => {
            fullOutput += chunk;
            setStreamingOutput((prev) => prev + chunk);
            if (isFinal) setIsStreaming(false);
          },
        });

        logger.logCompleted(fullOutput, result.exitCode, result.pid, result.sessionId, result.apiSuccess);
        if (result.pid) activePids.current[skill.name] = result.pid;
      } else {
        result = await executeClaudeCommand(
          {
            prompt,
            workDir: projectDir,
            projectDir,
            claudeBin: config.claudeBin,
            headlessMode: config.headlessMode,
          },
          logger,
        );

        logger.logCompleted(result.output, result.exitCode, undefined, undefined, result.apiSuccess);
        if (result.pid) activePids.current[skill.name] = result.pid;
      }

      const executionDuration = Date.now() - executionStartTime;
      recordExecution(skill.name, result.success, executionDuration);

      if (result.success) {
        if (config.streamingMode && config.headlessMode) {
          setStreamingOutput(
            (prev) =>
              prev +
              `\n\n✅ 命令执行完成 (${Math.round(result.duration / 1000)}s)\n`,
          );
        } else {
          await toast.hide();
          if (config.headlessMode) {
            await showHUD(
              `✅ ${skill.title} 完成 (${Math.round(result.duration / 1000)}s)`,
            );
          } else {
            await showHUD(`🖥️ ${skill.title} 已在 Terminal 窗口中执行`);
          }
          await closeMainWindow();
        }
      } else {
        if (config.streamingMode && config.headlessMode) {
          setStreamingOutput(
            (prev) => prev + `\n\n❌ 执行失败 (退出码: ${result.exitCode})\n`,
          );
        } else {
          toast.style = Toast.Style.Failure;
          toast.title = "执行失败";
          toast.message = `退出码: ${result.exitCode}`;
        }
      }
    } catch (error) {
      console.error(`[executeSkill] Error:`, error);

      if (config.streamingMode && config.headlessMode) {
        setStreamingOutput(
          (prev) =>
            prev +
            `\n\n❌ 错误: ${error instanceof Error ? error.message : "未知错误"}\n`,
        );
        setIsStreaming(false);
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = "执行失败";
        toast.message = error instanceof Error ? error.message : "未知错误";
      }

      const executionDuration = Date.now() - executionStartTime;
      recordExecution(skill.name, false, executionDuration);
    } finally {
      delete activePids.current[skill.name];
      setProcessingCommand((prev) => prev.filter((c) => c.name !== skill.name));
      if (config.streamingMode && config.headlessMode) {
        setIsStreaming(false);
      }
      loadRunningCount();
      loadSkills();
      triggerStatusRefresh();
    }
  }

  function getDirectoryContents(
    dirPath: string,
  ): { name: string; path: string; isDir: boolean }[] {
    try {
      const files = readdirSync(dirPath);
      return files
        .map((name) => {
          const fullPath = join(dirPath, name);
          const stat = statSync(fullPath);
          return { name, path: fullPath, isDir: stat.isDirectory() };
        })
        .sort((a, b) => {
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          return a.name.localeCompare(b.name);
        });
    } catch (error) {
      console.error("Failed to read directory:", error);
      return [];
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  }

  function closeStreamingOutput() {
    setStreamingOutput("");
    setIsStreaming(false);
    setStreamingCommand(null);
  }

  // 流式输出视图
  if (streamingOutput) {
    return (
      <Detail
        markdown={`\`\`\`\n${streamingOutput}\n\`\`\``}
        navigationTitle={
          streamingCommand ? `执行: ${streamingCommand}` : "流式输出"
        }
        actions={
          <ActionPanel>
            <Action
              title="关闭输出"
              onAction={closeStreamingOutput}
              icon={Icon.Xmark}
              shortcut={{ modifiers: ["cmd"], key: "w" }}
            />
            <Action
              title="清空输出"
              onAction={() => setStreamingOutput("")}
              icon={Icon.Trash}
            />
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="附加留言（输入偏好、方向等备注）..."
      searchText={note}
      onSearchTextChange={setNote}
      actions={
        <ActionPanel>
          <Action
            title="刷新列表"
            onAction={loadSkills}
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
          />
          <Action
            title="重新加载选中的文件"
            onAction={() => loadSelectedFiles(true)}
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
          />
          <Action.Push
            title="查看Agent 运行状态"
            target={<StatusList />}
            icon={Icon.List}
            shortcut={{ modifiers: ["cmd"], key: "s" }}
          />
          <Action
            title="打开扩展设置"
            onAction={openCommandPreferences}
            icon={Icon.Gear}
            shortcut={{ modifiers: ["cmd"], key: "," }}
          />
          {note && note.trim() && (
            <Action
              title="清空附加留言"
              onAction={() => setNote("")}
              icon={Icon.Trash}
              shortcut={{ modifiers: ["cmd"], key: "backspace" }}
            />
          )}
        </ActionPanel>
      }
    >
      {/* 选中的文件 */}
      {selectedFiles.length > 0 && (
        <List.Section
          title={`选中的文件 (${selectedFiles.length})${!showAllFiles && selectedFiles.length > 3 ? ` (显示 3/${selectedFiles.length})` : ""}`}
          actions={
            <ActionPanel>
              <Action
                title={showAllFiles ? "收起文件列表" : `显示全部 ${selectedFiles.length} 个文件`}
                onAction={() => setShowAllFiles(!showAllFiles)}
                icon={showAllFiles ? Icon.ChevronUp : Icon.ChevronDown}
                shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
              />
            </ActionPanel>
          }
        >
          {(showAllFiles ? selectedFiles : selectedFiles.slice(0, 3)).map((file, index) => (
            <ListItem
              key={`${file}-${index}-${refreshKey}`}
              id={`file-${index}`}
              title={file.split("/").pop() || file}
              subtitle={file}
              icon={Icon.Document}
              accessories={[
                (() => {
                  const record = devonThinkRecords.get(file);
                  if (record) {
                    if (isDevonThinkURL(file)) {
                      return { text: "🔗 DevonThink URL", icon: Icon.Link };
                    } else if (isFilesNoIndexPath(file)) {
                      return { text: "📦 导入文件", icon: Icon.Box };
                    } else if (record.hasFileSystemPath) {
                      return { text: "✓ 索引文件", icon: Icon.Check };
                    }
                  }
                  return null;
                })(),
              ].filter(Boolean)}
              actions={
                <ActionPanel>
                  <Action.Open
                    title="在 Finder 中显示"
                    target={file}
                    icon={Icon.Finder}
                  />
                  <Action.CopyToClipboard
                    title="复制路径"
                    content={file}
                    shortcut={{ modifiers: ["cmd"], key: "c" }}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}

      {/* 技能列表 */}
      {items.length === 0 ? (
        <List.EmptyView
          icon={Icon.Warning}
          title="未找到技能"
          description="请在 .claude/skills/ 目录中添加技能（含 SKILL.md 的子目录）"
        />
      ) : (
        <List.Section
          title={`可用技能 (${items.length})`}
          subtitle={
            selectedFiles.length > 0
              ? selectedFiles.length === 1
                ? `将对 "${selectedFiles[0].split("/").pop() || selectedFiles[0]}" 执行`
                : `将对 ${selectedFiles.length} 个文件执行`
              : "请先在 DEVONthink 或 Finder 中选择文件"
          }
        >
          {runningCount > 0 && (
            <ListItem
              id="running-indicator"
              title={`🟢 ${runningCount} 个 Agent 正在运行`}
              subtitle={`累计已执行 ${totalExecutions} 次`}
              icon={Icon.CircleProgress}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="查看Agent 运行状态"
                    target={<StatusList />}
                    icon={Icon.List}
                    shortcut={{ modifiers: ["cmd"], key: "s" }}
                  />
                </ActionPanel>
              }
            />
          )}
          {runningCount === 0 && totalExecutions > 0 && (
            <ListItem
              id="stats-indicator"
              title={`📊 累计执行 ${totalExecutions} 次`}
              subtitle="查看运行状态与历史"
              icon={Icon.BarChart}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="查看Agent 运行状态"
                    target={<StatusList />}
                    icon={Icon.List}
                    shortcut={{ modifiers: ["cmd"], key: "s" }}
                  />
                </ActionPanel>
              }
            />
          )}

          {/* 自由指令入口 - 始终显示（当有文件选中时） */}
          {selectedFiles.length > 0 && (
            <ListItem
              id="free-command"
              title={`💬 ${note.trim() ? `自由指令：${note.trim().substring(0, 30)}${note.trim().length > 30 ? "..." : ""}` : "自由指令"}`}
              subtitle={
                note.trim()
                  ? selectedFiles.length === 1
                    ? `将对 "${selectedFiles[0].split("/").pop()}" 执行`
                    : `将对 ${selectedFiles.length} 个文件执行`
                  : "在搜索框输入你的指令，然后执行（Cmd+Shift+Enter）"
              }
              icon={Icon.SpeechBubble}
              accessories={[
                {
                  text:
                    processingCommand.some((c) => c.name === "free-command")
                      ? "执行中..."
                      : undefined,
                  icon:
                    processingCommand.some((c) => c.name === "free-command")
                      ? Icon.CircleProgress
                      : undefined,
                },
              ].filter(Boolean)}
              actions={
                <ActionPanel>
                  <Action
                    title="执行自由指令"
                    onAction={executeFreeCommand}
                    icon={Icon.Play}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
                  />
                  {note.trim() && (
                    <Action
                      title={`执行：${note.trim().substring(0, 30)}${note.trim().length > 30 ? "..." : ""}`}
                      onAction={executeFreeCommand}
                      icon={Icon.Play}
                    />
                  )}
                </ActionPanel>
              }
            />
          )}

          {items.map((skill) => (
            <ListItem
              key={skill.skillDir}
              id={skill.skillDir}
              title={`${skill.pinned ? "📌 " : ""}${skill.isNew ? "✨ " : ""}${skill.title}`}
              subtitle={skill.description}
              icon={skill.icon}
              accessories={[
                {
                  text:
                    processingCommand.some((c) => c.name === skill.name) ? "执行中..." : undefined,
                  icon:
                    processingCommand.some((c) => c.name === skill.name)
                      ? Icon.CircleProgress
                      : undefined,
                },
                skill.pinned ? { text: "置顶", icon: Icon.Pin } : null,
                skill.isNew && !skill.pinned
                  ? { text: "新", icon: Icon.Star }
                  : null,
                skill.executions && skill.executions > 0
                  ? { text: String(skill.executions) }
                  : null,
              ].filter(Boolean)}
              actions={
                <ActionPanel>
                  <Action
                    title="执行技能"
                    onAction={() => executeSkill(skill)}
                    icon={Icon.Play}
                    shortcut={{ modifiers: ["cmd"], key: "enter" }}
                  />
                  {processingCommand.some((c) => c.name === skill.name) && (
                    <Action
                      title="取消执行"
                      onAction={() => {
                        const pid = activePids.current[skill.name];
                        if (pid) {
                          try {
                            execSync(`kill ${pid}`, { stdio: "ignore" });
                          } catch {}
                        }
                        setProcessingCommand((prev) =>
                          prev.filter((c) => c.name !== skill.name),
                        );
                      }}
                      icon={Icon.XMarkCircle}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "k" }}
                    />
                  )}
                  {note && note.trim() && (
                    <Action
                      title={`执行技能（带备注："${note.trim()}"）`}
                      onAction={() => executeSkill(skill)}
                      icon={Icon.Play}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
                    />
                  )}
                  <Action
                    title="切换置顶状态"
                    onAction={() => {
                      toggleSkillPinned(skill.name);
                      loadSkills();
                    }}
                    icon={Icon.Pin}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
                  />
                  <Action
                    title="切换新标记"
                    onAction={() => {
                      toggleSkillNew(skill.name);
                      loadSkills();
                    }}
                    icon={Icon.Star}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
