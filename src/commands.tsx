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
import { executeClaudeCommand, executeClaudeStreaming, getConfig } from "./utils/claude";
import { RunLogger } from "./utils/logger";
import { scanCommands, ClaudeCommand } from "./utils/commands";
import { scanSkills, ClaudeSkill } from "./utils/skills";
import {
  toggleCommandPinned,
  toggleCommandNew,
  toggleSkillPinned,
  toggleSkillNew,
} from "./utils/commandMetadata";
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
import { join } from "path";
import { countRunningCommands } from "./utils/status";
import { recordExecution } from "./utils/stats";
import StatusList from "./status";
import { triggerStatusRefresh } from "./contexts/StatusRefreshContext";

// 统一的执行项类型
type ExecutorItem = ClaudeCommand | ClaudeSkill;

export default function CommandList() {
  const [items, setItems] = useState<ExecutorItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [devonThinkRecords, setDevonThinkRecords] = useState<
    Map<string, DevonThinkRecord>
  >(new Map()); // 存储完整的记录信息
  const [activeFile, setActiveFile] = useState<string>("");
  const [processingCommand, setProcessingCommand] = useState<string | null>(
    null,
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [note, setNote] = useState<string>("");
  const [runningCount, setRunningCount] = useState<number>(0);
  
  // 流式输出相关状态
  const [streamingOutput, setStreamingOutput] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamingCommand, setStreamingCommand] = useState<string | null>(null);

  useEffect(() => {
    const timestamp = new Date().toISOString();
    console.log(`[CommandList] Component mounted at ${timestamp}`);
    loadCommands();
    loadSelectedFiles();
    loadRunningCount();

    // 每 5 秒刷新一次运行计数
    const interval = setInterval(() => {
      loadRunningCount();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  function loadRunningCount() {
    try {
      setRunningCount(countRunningCommands());
    } catch (error) {
      console.error("Failed to load running count:", error);
    }
  }

  async function loadCommands() {
    try {
      const config = getConfig();
      const availableCommands = scanCommands(config.projectDirs);
      const availableSkills = scanSkills(config.projectDirs);
      // 合并 commands 和 skills
      const allItems: ExecutorItem[] = [...availableCommands, ...availableSkills];
      // 排序：置顶的在前，然后是新的，最后按名称排序
      allItems.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        if (a.isNew && !b.isNew) return -1;
        if (!a.isNew && b.isNew) return 1;
        return a.name.localeCompare(b.name);
      });
      setItems(allItems);
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
    const timestamp = new Date().toISOString();
    console.log(
      `[loadSelectedFiles] Called at ${timestamp}, forceUpdate: ${forceUpdate}`,
    );

    let filePaths: string[] = [];
    let source = "";
    const recordsMap = new Map<string, DevonThinkRecord>();

    // 智能策略：根据当前前台应用决定从哪个来源获取文件
    try {
      const frontApp = await getFrontmostApplication();
      console.log(`[loadSelectedFiles] Frontmost application: ${frontApp}`);

      const isFinder = await isFinderFrontmost();

      // 如果前台是 Finder，从 Finder 获取文件
      if (isFinder) {
        console.log(`[loadSelectedFiles] Using Finder (frontmost)`);
        try {
          const items = await getSelectedFinderItems();
          filePaths = items.map((item) => item.path);
          console.log(
            `[loadSelectedFiles] Got ${filePaths.length} files from Finder:`,
            filePaths,
          );

          if (filePaths.length > 0) {
            source = "Finder";
          }
        } catch (error) {
          console.error(
            "[loadSelectedFiles] Failed to get Finder items:",
            error,
          );
        }
      }
      // 如果前台是 DEVONthink，从 DEVONthink 获取文件
      else if (
        frontApp.toLowerCase().includes("devon") ||
        frontApp.toLowerCase().includes("think")
      ) {
        console.log(`[loadSelectedFiles] Using DEVONthink (frontmost)`);
        try {
          const isDevonThinkAvailable = await checkDevonThinkAvailable();

          if (isDevonThinkAvailable) {
            const records = await getSelectedDevonThinkRecords();
            filePaths = records.map((record) => record.path);
            console.log(
              `[loadSelectedFiles] Got ${filePaths.length} files from DEVONthink:`,
              filePaths,
            );

            // 存储记录信息以便后续使用
            records.forEach((record) => {
              recordsMap.set(record.path, record);
            });

            if (filePaths.length > 0) {
              source = "DEVONthink";
            }
          }
        } catch (error) {
          console.error(
            "[loadSelectedFiles] Failed to get DEVONthink records:",
            error,
          );
        }
      }
      // 如果前台不是 Finder 或 DEVONthink，尝试从 Finder 获取（作为后备）
      else {
        console.log(
          `[loadSelectedFiles] Frontmost is ${frontApp}, trying Finder as fallback`,
        );
        try {
          const items = await getSelectedFinderItems();
          filePaths = items.map((item) => item.path);
          console.log(
            `[loadSelectedFiles] Got ${filePaths.length} files from Finder (fallback):`,
            filePaths,
          );

          if (filePaths.length > 0) {
            source = "Finder";
          }
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
      // 作为最后的后备，尝试从 Finder 获取
      try {
        const items = await getSelectedFinderItems();
        filePaths = items.map((item) => item.path);
        console.log(
          `[loadSelectedFiles] Got ${filePaths.length} files from Finder (emergency fallback):`,
          filePaths,
        );

        if (filePaths.length > 0) {
          source = "Finder";
        }
      } catch (err) {
        console.error(
          "[loadSelectedFiles] Failed to get Finder items (emergency fallback):",
          err,
        );
      }
    }

    console.log(`[loadSelectedFiles] Final filePaths:`, filePaths);
    console.log(
      `[loadSelectedFiles] Current activeFile before update:`,
      activeFile,
    );

    if (filePaths.length === 0) {
      console.log(
        `[loadSelectedFiles] No files found, keeping existing selection`,
      );

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

    // 总是更新文件列表和 activeFile（确保每次都获取最新选择）
    setSelectedFiles(filePaths);
    setDevonThinkRecords(recordsMap);

    // 如果有新文件，总是更新 activeFile 为第一个文件
    const newActiveFile = filePaths[0];
    console.log(`[loadSelectedFiles] Setting activeFile to:`, newActiveFile);

    // 只有在文件真正变化时才显示提示
    if (source && (forceUpdate || newActiveFile !== activeFile)) {
      console.log(`[loadSelectedFiles] Showing toast for source: ${source}`);
      await showToast({
        style: Toast.Style.Success,
        title: `从 ${source} 获取了 ${filePaths.length} 个文件`,
        message:
          filePaths.length === 1 ? filePaths[0].split("/").pop() : undefined,
      });
    } else {
      console.log(
        `[loadSelectedFiles] Not showing toast. forceUpdate: ${forceUpdate}, newActiveFile === activeFile: ${newActiveFile === activeFile}`,
      );
    }

    setActiveFile(newActiveFile);
    setRefreshKey((prev) => prev + 1);
  }

  async function executeCommand(command: ClaudeCommand) {
    if (processingCommand) {
      return;
    }

    // 对于需要文件参数的命令，检查是否选中了文件
    const validFiles = selectedFiles.filter(
      (file) => file && file.trim().length > 0,
    );
    const executionFile =
      activeFile && activeFile.trim().length > 0 ? activeFile : validFiles[0];

    if (command.name !== "deepresearch" && command.name !== "sync-external") {
      if (!executionFile) {
        await showToast({
          style: Toast.Style.Failure,
          title: "未选择文件",
          message: "请在 Finder 或 DEVONthink 中选择文件后重试",
        });
        return;
      }

      if (executionFile !== activeFile) {
        setActiveFile(executionFile);
        console.log(
          `[executeCommand] Active file updated to: ${executionFile}`,
        );
      }

      if (validFiles.length > 0 && validFiles[0] !== selectedFiles[0]) {
        setSelectedFiles(validFiles);
        console.log(
          `[executeCommand] Filtered out empty paths. Using first valid file: ${validFiles[0]}`,
        );
      }
    }

    // 对于 sync-external,需要确认
    if (command.name === "sync-external") {
      const confirmed = await confirmAlert({
        title: "同步外部文件",
        message: "确定要同步外部文件吗?",
        primaryAction: {
          title: "同步",
        },
      });

      if (!confirmed) {
        return;
      }
    }

    setProcessingCommand(command.name);

    // 检查是否需要从 DevonThink 导出文件
    let actualFilePath = executionFile || "";
    const record = executionFile
      ? devonThinkRecords.get(executionFile)
      : undefined;

    if (
      record &&
      executionFile &&
      (isDevonThinkURL(executionFile) || isFilesNoIndexPath(executionFile))
    ) {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: "正在导出文件",
        message: "从 DEVONthink 导出文件到临时目录...",
      });

      try {
        const prepared = await prepareFilePathForCommand(record);
        actualFilePath = prepared.path;

        if (prepared.isTemp) {
          await toast.hide();
          await showToast({
            style: Toast.Style.Success,
            title: "文件已导出",
            message: `临时路径: ${actualFilePath}`,
          });
        }
      } catch (error) {
        await toast.hide();
        await showToast({
          style: Toast.Style.Failure,
          title: "导出文件失败",
          message: error instanceof Error ? error.message : "未知错误",
        });
        setProcessingCommand(null);
        return;
      }
    }

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `正在执行：${command.title}`,
      message: actualFilePath.split("/").pop() || "",
    });

    // 记录命令执行开始时间
    const executionStartTime = Date.now();

    try {
      const config = getConfig();
      console.log(`[executeCommand] Config loaded:`, config);

      // 使用命令所属的项目目录作为工作目录
      const projectDir = command.projectDir || config.projectDirs[0];

      const logger = new RunLogger(
        actualFilePath || command.name,
        projectDir, // 使用项目目录而不是文件所在目录
      );

      logger.logValidated();
      console.log(
        `[executeCommand] Logger validated, Run ID: ${logger.getRunId()}`,
      );

      // 启动实时日志流
      logger.startRealtimeLogging();
      console.log(`[executeCommand] Realtime logging started`);

      // 构建命令参数
      let prompt = `/${command.name}`;
      if (
        actualFilePath &&
        command.name !== "deepresearch" &&
        command.name !== "sync-external"
      ) {
        prompt = `/${command.name} "${actualFilePath}"`;
      }

      // 如果有附加留言，添加到命令后面
      if (note && note.trim()) {
        prompt += ` ${note.trim()}`;
      }

      console.log(`[executeCommand] Executing command: ${prompt}`);

      let result;
      
      if (config.streamingMode) {
        // 流式输出模式 - 实时更新 UI
        let fullOutput = "";
        
        // 初始化流式输出状态
        setStreamingOutput(`› ${prompt}\n\n`);
        setIsStreaming(true);
        setStreamingCommand(command.title);
        
        result = await executeClaudeStreaming({
          prompt,
          workDir: projectDir,
          projectDir: projectDir,
          claudeBin: config.claudeBin,
          headlessMode: config.headlessMode,
          onChunk: (chunk, isFinal) => {
            fullOutput += chunk;
            // 更新 UI 显示实时输出
            setStreamingOutput((prev) => prev + chunk);
            if (isFinal) {
              setIsStreaming(false);
            }
          },
        });
        
        // 流式模式也记录日志
        logger.logCompleted(fullOutput, result.exitCode);
      } else {
        // 普通模式
        result = await executeClaudeCommand(
          {
            prompt,
            workDir: projectDir,  // 使用项目目录
            projectDir: projectDir, // 使用命令所属的项目目录
            claudeBin: config.claudeBin,
            headlessMode: config.headlessMode,
          },
          logger  // 传递 logger 以启用实时日志
        );
      }

      console.log(
        `[executeCommand] Command completed, PID: ${result.pid}, Exit code: ${result.exitCode}, Success: ${result.success}`,
      );

      // 注意：logExecuting 已经在 executeClaudeCommand 中调用过了，这里不需要再调用
      // logCompleted 在上面的 if-else 块中已经调用过了

      // 记录统计数据
      const executionDuration = Date.now() - executionStartTime;
      recordExecution(command.name, result.success, executionDuration);

      if (result.success) {
        // 流式模式下不自动关闭，让用户查看输出
        if (!config.streamingMode) {
          await toast.hide();
          // 可见模式显示不同的提示
          if (config.headlessMode) {
            await showHUD(`✅ ${command.title} 完成 (${Math.round(result.duration / 1000)}s)`);
          } else {
            await showHUD(`🖥️ ${command.title} 已在 Terminal 窗口中执行`);
          }
          await closeMainWindow();
        } else {
          // 流式模式：添加完成提示
          setStreamingOutput((prev) => prev + `\n\n✅ 命令执行完成 (${Math.round(result.duration / 1000)}s)\n`);
        }
      } else {
        if (!config.streamingMode) {
          toast.style = Toast.Style.Failure;
          toast.title = "执行失败";
          toast.message = `退出码: ${result.exitCode}`;
        } else {
          // 流式模式：添加错误提示
          setStreamingOutput((prev) => prev + `\n\n❌ 执行失败 (退出码: ${result.exitCode})\n`);
        }
      }
    } catch (error) {
      console.error(`[executeCommand] Error:`, error);
      
      // 流式模式下更新输出， 普通模式显示 toast
      const config = getConfig();
      if (config.streamingMode) {
        setStreamingOutput((prev) => prev + `\n\n❌ 错误: ${error instanceof Error ? error.message : "未知错误"}\n`);
        setIsStreaming(false);
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = "执行失败";
        toast.message = error instanceof Error ? error.message : "未知错误";
      }

      // 记录失败的统计数据
      const executionDuration = Date.now() - executionStartTime;
      recordExecution(command.name, false, executionDuration);

      // 尝试记录错误到日志
      try {
        const projectDir = command.projectDir || config.projectDirs[0];

        const logger = new RunLogger(
          actualFilePath || command.name,
          projectDir, // 使用项目目录而不是文件所在目录
        );
        logger.logCompleted(
          error instanceof Error ? error.message : "未知错误",
          1,
        );
      } catch (logError) {
        console.error(`[executeCommand] Failed to log error:`, logError);
      }
    } finally {
      setProcessingCommand(null);
      if (config.streamingMode) {
        setIsStreaming(false);
      }
      loadRunningCount(); // 刷新运行计数
      triggerStatusRefresh(); // 立即刷新状态列表
    }
  }

  /**
   * 执行技能
   */
  async function executeSkill(skill: ClaudeSkill) {
    if (processingCommand) {
      return;
    }

    // 对于需要文件参数的技能，检查是否选中了文件
    const validFiles = selectedFiles.filter(
      (file) => file && file.trim().length > 0,
    );
    const executionFile =
      activeFile && activeFile.trim().length > 0 ? activeFile : validFiles[0];

    setProcessingCommand(skill.name);

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `正在执行：${skill.title}`,
      message: executionFile ? executionFile.split("/").pop() || "" : "",
    });

    const executionStartTime = Date.now();

    try {
      const config = getConfig();
      const projectDir = skill.projectDir || config.projectDirs[0];

      const logger = new RunLogger(
        executionFile || skill.name,
        projectDir,
      );

      logger.logValidated();
      logger.startRealtimeLogging();

      // 构建技能调用参数
      let prompt = `/${skill.name}`;
      if (executionFile) {
        prompt += ` "${executionFile}"`;
      }
      if (note && note.trim()) {
        prompt += ` ${note.trim()}`;
      }

      const result = await executeClaudeCommand(
        {
          prompt,
          workDir: projectDir,
          projectDir,
          claudeBin: config.claudeBin,
          headlessMode: config.headlessMode,
        },
        logger,
      );

      logger.logCompleted(result.output, result.exitCode);

      const executionDuration = Date.now() - executionStartTime;
      recordExecution(skill.name, result.success, executionDuration);

      if (result.success) {
        await toast.hide();
        if (config.headlessMode) {
          await showHUD(
            `✅ ${skill.title} 完成 (${Math.round(result.duration / 1000)}s)`,
          );
        } else {
          await showHUD(`🖥️ ${skill.title} 已在 Terminal 窗口中执行`);
        }
        await closeMainWindow();
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = "执行失败";
        toast.message = `退出码: ${result.exitCode}`;
      }
    } catch (error) {
      console.error(`[executeSkill] Error:`, error);
      toast.style = Toast.Style.Failure;
      toast.title = "执行失败";
      toast.message = error instanceof Error ? error.message : "未知错误";

      const executionDuration = Date.now() - executionStartTime;
      recordExecution(skill.name, false, executionDuration);
    } finally {
      setProcessingCommand(null);
      loadRunningCount();
      triggerStatusRefresh();
    }
  }

  /**
   * 统一执行函数（根据类型选择执行命令或技能）
   */
  async function executeItem(item: ClaudeCommand | ClaudeSkill) {
    if ('filePath' in item) {
      await executeCommand(item);
    } else {
      await executeSkill(item);
    }
  }

  /**
   * 获取文件夹中的文件列表
   */
  function getDirectoryContents(
    dirPath: string,
  ): { name: string; path: string; isDir: boolean }[] {
    try {
      const files = readdirSync(dirPath);
      return files
        .map((name) => {
          const fullPath = join(dirPath, name);
          const stat = statSync(fullPath);
          return {
            name,
            path: fullPath,
            isDir: stat.isDirectory(),
          };
        })
        .sort((a, b) => {
          // 文件夹排在前面
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          return a.name.localeCompare(b.name);
        });
    } catch (error) {
      console.error("Failed to read directory:", error);
      return [];
    }
  }

  /**
   * 格式化文件大小
   */
  function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  }

  /**
   * 关闭流式输出视图
   */
  function closeStreamingOutput() {
    setStreamingOutput("");
    setIsStreaming(false);
    setStreamingCommand(null);
  }

  // 如果有流式输出，显示流式输出视图
  if (streamingOutput) {
    return (
      <Detail
        markdown={
          `\`\`\`\n${streamingOutput}\n\`\`\``
        }
        navigationTitle={streamingCommand ? `执行: ${streamingCommand}` : "流式输出"}
        metadata={{
          items: [
            {
              label: "状态",
              value: isStreaming ? "🔄 执行中..." : "✅ 完成",
            },
          ],
        }}
        actions={
          <ActionPanel>
            <Action
              title="关闭输出"
              onAction={closeStreamingOutput}
              icon={Icon.X}
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
            onAction={loadCommands}
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
      {/* 当前文件详情 - 如果有选中文件 */}
      {activeFile && (
        <List.Section title="当前选中文件">
          <ListItem
            key={`active-file-${refreshKey}`}
            id="active-file-detail"
            title={activeFile.split("/").pop() || activeFile}
            subtitle={activeFile}
            icon={Icon.Document}
            accessories={[
              { text: "当前选中", icon: Icon.CheckCircle },
              (() => {
                const record = devonThinkRecords.get(activeFile);
                if (record) {
                  if (isDevonThinkURL(activeFile)) {
                    return { text: "🔗 DevonThink URL", icon: Icon.Link };
                  } else if (isFilesNoIndexPath(activeFile)) {
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
                  target={activeFile}
                  icon={Icon.Finder}
                />
                <Action.CopyToClipboard
                  title="复制路径"
                  content={activeFile}
                  shortcut={{ modifiers: ["cmd"], key: "c" }}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      )}

      {/* 其他选中的文件 */}
      {selectedFiles.length > 1 && (
        <List.Section title={`其他选中的文件 (${selectedFiles.length - 1})`}>
          {selectedFiles
            .filter((f) => f !== activeFile)
            .slice(0, 3)
            .map((file, index) => (
              <ListItem
                key={`${file}-${index}-${refreshKey}`}
                id={`other-file-${index}`}
                title={file.split("/").pop() || file}
                subtitle={file}
                icon={Icon.Document}
                accessories={[{ text: "已选中" }]}
                actions={
                  <ActionPanel>
                    <Action
                      title="切换到此文件"
                      onAction={() => {
                        setActiveFile(file);
                        setRefreshKey((prev) => prev + 1);
                      }}
                      icon={Icon.Repeat}
                      shortcut={{ modifiers: ["cmd"], key: "t" }}
                    />
                  </ActionPanel>
                }
              />
            ))}
          {selectedFiles.filter((f) => f !== activeFile).length > 3 && (
            <ListItem
              id="more-files"
              title={`还有 ${selectedFiles.filter((f) => f !== activeFile).length - 3} 个文件...`}
              icon={Icon.Ellipsis}
              subtitle="所有选中的文件都将被处理"
            />
          )}
        </List.Section>
      )}

      {/* 命令/技能列表 */}
      {items.length === 0 ? (
        <List.EmptyView
          icon={Icon.Warning}
          title="未找到命令或技能"
          description="请在 .claude/commands/ 或 .claude/skills/ 目录中添加命令文件或技能目录"
        />
      ) : (
        <List.Section
          title={`可用项目 (${items.length})`}
          subtitle={
            selectedFiles.length > 0
              ? `将对 "${activeFile.split("/").pop() || activeFile}" 执行`
              : "请先在 DEVONthink 或 Finder 中选择文件"
          }
        >
          {runningCount > 0 && (
            <ListItem
              id="running-indicator"
              title={`🟢 ${runningCount} 个 Agent 正在运行`}
              subtitle="点击查看Agent 运行状态"
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

          {/* 渲染命令或技能列表 */}
          {items.map((item) => {
            const isSkill = 'skillDir' in item;
            const itemType = isSkill ? 'Skill' : 'Command';
            return (
              <ListItem
                key={isSkill ? item.skillDir : item.filePath}
                id={isSkill ? item.skillDir : item.filePath}
                title={`${item.pinned ? "📌 " : ""}${item.isNew ? "✨ " : ""}${item.title}`}
                subtitle={item.description}
                icon={item.icon}
                accessories={[
                  {
                    text:
                      processingCommand === item.name
                        ? "执行中..."
                        : undefined,
                    icon:
                      processingCommand === item.name
                        ? Icon.CircleProgress
                        : undefined,
                  },
                  { text: itemType, icon: isSkill ? Icon.Star : Icon.HardDrive },
                  item.pinned ? { text: "置顶", icon: Icon.Pin } : null,
                  item.isNew && !item.pinned
                    ? { text: "新", icon: Icon.Star }
                    : null,
                  isSkill && (item as ClaudeSkill).isSymlink
                    ? { text: "链接", icon: Icon.Link }
                    : null,
                  item.projectName
                    ? { text: item.projectName, icon: Icon.Folder }
                    : null,
                ].filter(Boolean)}
                actions={
                  <ActionPanel>
                    <Action
                      title={`执行${itemType}`}
                      onAction={() => executeItem(item)}
                      icon={Icon.Play}
                      shortcut={{ modifiers: ["cmd"], key: "enter" }}
                    />
                    {note && note.trim() && (
                      <Action
                        title={`执行${itemType}（带备注："${note.trim()}"）`}
                        onAction={() => executeItem(item)}
                        icon={Icon.Play}
                        shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
                      />
                    )}
                    <Action
                      title="切换置顶状态"
                      onAction={() => {
                        if (isSkill) {
                          toggleSkillPinned(item.name);
                        } else {
                          toggleCommandPinned(item.name);
                        }
                        loadCommands();
                      }}
                      icon={Icon.Pin}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
                    />
                    <Action
                      title="切换新标记"
                      onAction={() => {
                        if (isSkill) {
                          toggleSkillNew(item.name);
                        } else {
                          toggleCommandNew(item.name);
                        }
                        loadCommands();
                      }}
                      icon={Icon.Star}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
                    />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      )}
    </List>
  );
}
