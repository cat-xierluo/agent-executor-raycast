import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/**
 * 命令元数据接口
 */
export interface CommandMetadata {
  name: string;
  pinned?: boolean;
  isNew?: boolean;
  note?: string;
}

/**
 * 元数据存储接口
 */
interface MetadataStore {
  [commandName: string]: CommandMetadata;
}

/**
 * 元数据文件路径
 */
const METADATA_DIR = join(homedir(), ".autoweave");
const METADATA_FILE = join(METADATA_DIR, "command-metadata.json");

/**
 * 确保元数据目录存在
 */
function ensureMetadataDir() {
  if (!existsSync(METADATA_DIR)) {
    mkdirSync(METADATA_DIR, { recursive: true });
  }
}

/**
 * 读取命令元数据
 */
export function readCommandMetadata(): MetadataStore {
  ensureMetadataDir();

  if (!existsSync(METADATA_FILE)) {
    return {};
  }

  try {
    const content = readFileSync(METADATA_FILE, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error("Failed to read command metadata:", error);
    return {};
  }
}

/**
 * 写入命令元数据
 */
export function writeCommandMetadata(metadata: MetadataStore): void {
  ensureMetadataDir();

  try {
    writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write command metadata:", error);
  }
}

/**
 * 获取单个命令的元数据
 */
export function getCommandMetadata(commandName: string): CommandMetadata | undefined {
  const metadata = readCommandMetadata();
  return metadata[commandName];
}

/**
 * 更新命令的元数据
 */
export function updateCommandMetadata(commandName: string, updates: Partial<CommandMetadata>): void {
  const metadata = readCommandMetadata();
  metadata[commandName] = {
    ...metadata[commandName],
    name: commandName,
    ...updates,
  };
  writeCommandMetadata(metadata);
}

/**
 * 删除命令的元数据
 */
export function deleteCommandMetadata(commandName: string): void {
  const metadata = readCommandMetadata();
  delete metadata[commandName];
  writeCommandMetadata(metadata);
}

/**
 * 切换命令的置顶状态
 */
export function toggleCommandPinned(commandName: string): boolean {
  const current = getCommandMetadata(commandName);
  const newPinnedState = !current?.pinned;
  updateCommandMetadata(commandName, { pinned: newPinnedState });
  return newPinnedState;
}

/**
 * 切换命令的新标记状态
 */
export function toggleCommandNew(commandName: string): boolean {
  const current = getCommandMetadata(commandName);
  const newNewState = !current?.isNew;
  updateCommandMetadata(commandName, { isNew: newNewState });
  return newNewState;
}

/**
 * 批量更新命令元数据（用于扫描命令时应用）
 */
export function applyMetadataToCommands(commands: any[]): any[] {
  const metadata = readCommandMetadata();

  return commands.map((command) => {
    const cmdMetadata = metadata[command.name];
    return {
      ...command,
      pinned: cmdMetadata?.pinned || false,
      isNew: cmdMetadata?.isNew || false,
      note: cmdMetadata?.note,
    };
  });
}
