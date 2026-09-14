import { readFileSync, existsSync, readdirSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { LocalStorage } from "@raycast/api";

/** LocalStorage key：用户选中的 Hermes profile 名；空/未设置 = 主 Hermes */
const SELECTED_PROFILE_KEY = "hermes-selected-profile";

export interface HermesProfileInfo {
  name: string; // profile 目录名（即 profile 名）
  home: string; // ~/.hermes/profiles/<name>/ 绝对路径
  description?: string; // profile.yaml 的 description 字段
  skillCount: number; // skills/ 下 SKILL.md 总数（递归）
}

/**
 * 读取当前选中的 Hermes profile 名；空字符串 = 主 Hermes。
 */
export async function getSelectedHermesProfile(): Promise<string> {
  try {
    return ((await LocalStorage.getItem(SELECTED_PROFILE_KEY)) as string) || "";
  } catch {
    return "";
  }
}

/**
 * 保存选中的 Hermes profile 名；传空字符串 = 回到主 Hermes。
 */
export async function setSelectedHermesProfile(name: string): Promise<void> {
  if (name) {
    await LocalStorage.setItem(SELECTED_PROFILE_KEY, name);
  } else {
    await LocalStorage.removeItem(SELECTED_PROFILE_KEY);
  }
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
