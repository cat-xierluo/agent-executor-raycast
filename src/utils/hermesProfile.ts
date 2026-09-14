import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { LocalStorage } from "@raycast/api";

/** LocalStorage key：用户选中的 Hermes profile 名；空/未设置 = 主 Hermes */
const SELECTED_PROFILE_KEY = "hermes-selected-profile";

/**
 * 同步快路径文件：~/.hermes/active-profile（纯文本一行 profile 名）。
 * LocalStorage 是 Raycast 进程外 IPC 桥，extension 冷启动时首查可能秒级——
 * profile 选择决定首扫路径，必须同步可读才能秒开。写路径双写（文件+LocalStorage），
 * 文件为准；文件缺失时（旧版本选择过）异步迁移回写。
 */
const ACTIVE_PROFILE_FILE = join(homedir(), ".hermes", "active-profile");

/** 同步读取当前选中 profile；空字符串 = 主 Hermes。文件不存在时返回空（未选过）。 */
export function getSelectedHermesProfileSync(): string {
  try {
    if (!existsSync(ACTIVE_PROFILE_FILE)) return "";
    return readFileSync(ACTIVE_PROFILE_FILE, "utf-8").trim();
  } catch {
    return "";
  }
}

/** 双写：快路径文件 + LocalStorage（兼容旧读取路径）。 */
async function writeSelectedHermesProfile(name: string): Promise<void> {
  try {
    writeFileSync(ACTIVE_PROFILE_FILE, name, "utf-8");
  } catch {
    // 文件写失败不致命，LocalStorage 仍生效
  }
  if (name) {
    await LocalStorage.setItem(SELECTED_PROFILE_KEY, name);
  } else {
    await LocalStorage.removeItem(SELECTED_PROFILE_KEY);
  }
}

export interface HermesProfileInfo {
  name: string; // profile 目录名（即 profile 名）
  home: string; // ~/.hermes/profiles/<name>/ 绝对路径
  description?: string; // profile.yaml 的 description 字段
  skillCount: number; // skills/ 下 SKILL.md 总数（递归）
}

/**
 * 读取当前选中的 Hermes profile 名；空字符串 = 主 Hermes。
 * 快路径文件优先；文件缺失时回落 LocalStorage 并迁移回写文件。
 */
export async function getSelectedHermesProfile(): Promise<string> {
  const fromFile = getSelectedHermesProfileSync();
  if (fromFile) return fromFile;
  try {
    const legacy = ((await LocalStorage.getItem(SELECTED_PROFILE_KEY)) as string) || "";
    if (legacy) {
      // 旧数据迁移：写入快路径文件，下次同步可读
      try {
        writeFileSync(ACTIVE_PROFILE_FILE, legacy, "utf-8");
      } catch {
        // 迁移失败不影响本次返回
      }
    }
    return legacy;
  } catch {
    return "";
  }
}

/**
 * 保存选中的 Hermes profile 名；传空字符串 = 回到主 Hermes。
 */
export async function setSelectedHermesProfile(name: string): Promise<void> {
  await writeSelectedHermesProfile(name);
}

/**
 * 动态扫描 ~/.hermes/profiles/ 下所有有效 profile。
 * 有效 = 目录存在且含 config.yaml 或 profile.yaml（Hermes profile 建立时都会生成）。
 * 按 .DS_Store 等隐藏文件跳过。返回按名称排序的列表。
 */
export function scanHermesProfiles(): HermesProfileInfo[] {
  const profilesRoot = join(homedir(), ".hermes/profiles");
  if (!existsSync(profilesRoot)) return [];

  const result: HermesProfileInfo[] = [];
  for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const home = join(profilesRoot, entry.name);
    const hasConfig =
      existsSync(join(home, "config.yaml")) ||
      existsSync(join(home, "profile.yaml"));
    if (!hasConfig) continue;

    result.push({
      name: entry.name,
      home,
      description: readProfileDescription(home),
      skillCount: countProfileSkills(home),
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** 解析 profile.yaml 的 description 字段（简单行解析，避免引入 YAML 依赖） */
function readProfileDescription(home: string): string | undefined {
  try {
    const content = readFileSync(join(home, "profile.yaml"), "utf-8");
    const m = content.match(/^description:\s*(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    // profile.yaml 不存在或读失败，忽略
  }
  return undefined;
}

/** 递归统计 profile skills/ 下的 SKILL.md 数量（上限保护，防异常大目录卡 UI） */
function countProfileSkills(home: string, depth = 0): number {
  const skillsRoot = join(home, "skills");
  if (depth > 4 || !existsSync(skillsRoot)) return 0;

  let count = 0;
  try {
    for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(skillsRoot, entry.name);
      if (entry.isDirectory()) {
        if (existsSync(join(full, "SKILL.md"))) count++;
        else count += countProfileSkillsFromDir(full, depth + 1);
      }
    }
  } catch {
    // 忽略读取失败
  }
  return count;
}

function countProfileSkillsFromDir(dir: string, depth: number): number {
  if (depth > 4) return 0;
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (existsSync(join(full, "SKILL.md"))) count++;
        else count += countProfileSkillsFromDir(full, depth + 1);
      }
    }
  } catch {
    // 忽略
  }
  return count;
}

/**
 * 把 profile 名解析为 HERMES_HOME 绝对路径。
 * 空名 → undefined（主 Hermes，不注入）；名字不存在 → undefined（回退主 Hermes）。
 */
export function resolveProfileHome(name: string): string | undefined {
  if (!name) return undefined;
  const home = join(homedir(), ".hermes/profiles", name);
  return existsSync(home) ? home : undefined;
}

/** 给 UI 展示用：主 Hermes 选项的标签 */
export const MAIN_PROFILE_LABEL = "主 Hermes（默认）";

export { basename };
