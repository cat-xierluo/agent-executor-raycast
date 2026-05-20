import {
  readdirSync,
  readFileSync,
  existsSync,
  lstatSync,
  symlinkSync,
  mkdirSync,
  rmSync,
  cpSync,
} from "fs";
import { join, basename, resolve } from "path";
import { Icon } from "@raycast/api";
import { execSync } from "child_process";
import { homedir } from "os";
import { getProjectName } from "./claude";
import { applyMetadataToSkills } from "./commandMetadata";
import { readStats } from "./stats";
import { countExecutionsFromLog } from "./status";

/**
 * Claude Skill 接口
 */
export interface ClaudeSkill {
  name: string;
  title: string;
  description: string;
  skillDir: string;
  skillFile: string;
  icon: Icon;
  pinned?: boolean;
  isNew?: boolean;
  projectName?: string;
  projectDir?: string;
  isSymlink?: boolean;
  executions?: number;
}

/**
 * 检查目录是否是有效的 skill 目录
 * 有效条件（满足任一）：
 * 1. 根目录包含 skill.md 或 SKILL.md
 * 2. .claude 子目录下包含 skill.md 或 SKILL.md
 */
export function isValidSkillDir(skillPath: string): boolean {
  return findSkillFile(skillPath) !== null;
}

function findSkillFile(skillPath: string): string | null {
  const candidates = [
    join(skillPath, "skill.md"),
    join(skillPath, "SKILL.md"),
    join(skillPath, ".claude", "skill.md"),
    join(skillPath, ".claude", "SKILL.md"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) || null;
}

/**
 * 检查路径是否是符号链接
 */
function isSymlink(path: string): boolean {
  try {
    const stats = lstatSync(path);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function scanSkillsDirectory(
  skillsDir: string,
  projectDir: string,
  projectName: string,
): ClaudeSkill[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const entries = readdirSync(skillsDir, { withFileTypes: true });
  const skills: ClaudeSkill[] = [];

  for (const entry of entries) {
    // 跳过非目录项（包括符号链接，它们既不是目录也不是文件）
    // 符号链接会被 isDirectory() 和 isFile() 都返回 false
    // 所以我们需要单独检查 isSymbolicLink()
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const skillDir = join(skillsDir, entry.name);

    // 验证是否是有效的 skill 目录
    if (!isValidSkillDir(skillDir)) {
      console.log(`[scanSkills] Skipping invalid skill directory: ${skillDir}`);
      continue;
    }

    const skillFile = findSkillFile(skillDir);
    if (!skillFile) {
      continue;
    }

    // 读取技能定义文件
    let content = "";
    try {
      content = readFileSync(skillFile, "utf-8");
    } catch (error) {
      console.error(
        `[scanSkills] Failed to read skill file: ${skillFile}`,
        error,
      );
      continue;
    }

    // 提取技能名称（目录名）
    const name = entry.name;

    // 从内容中提取标题和描述
    const { title, description } = extractSkillInfo(name, content);

    // 匹配图标
    const icon = getSkillIcon(name);

    skills.push({
      name,
      title,
      description,
      skillDir,
      skillFile,
      icon,
      pinned: false,
      isNew: false,
      projectName,
      projectDir: projectDir,
      isSymlink: isSymlink(skillDir),
    });
  }

  return skills;
}

/**
 * 扫描单个项目的 .claude/skills/ 目录
 */
function scanSingleProjectSkills(projectDir: string): ClaudeSkill[] {
  return scanSkillsDirectory(
    join(projectDir, ".claude/skills"),
    projectDir,
    getProjectName(projectDir),
  );
}

/**
 * 扫描多个项目目录，获取所有可用的技能
 * 带缓存：10 秒内重复调用直接返回缓存结果
 */
let skillsCache: ClaudeSkill[] | null = null;
let skillsCacheTime = 0;
let skillsCacheKey = "";
const SKILLS_CACHE_TTL = 10000;

export function scanSkills(
  projectDirs: string[],
  standaloneSkillsDirs: string[] = [],
): ClaudeSkill[] {
  const cacheKey = JSON.stringify({ projectDirs, standaloneSkillsDirs });
  if (
    skillsCache &&
    skillsCacheKey === cacheKey &&
    Date.now() - skillsCacheTime < SKILLS_CACHE_TTL
  ) {
    return skillsCache;
  }

  const allSkills: ClaudeSkill[] = [];

  for (const dir of projectDirs) {
    const skills = scanSingleProjectSkills(dir);
    allSkills.push(...skills);
  }

  const defaultExecutionProjectDir = projectDirs[0];
  if (defaultExecutionProjectDir) {
    for (const dir of standaloneSkillsDirs) {
      const skills = scanSkillsDirectory(
        dir,
        defaultExecutionProjectDir,
        "默认 Skills",
      );
      allSkills.push(...skills);
    }
  }

  // 应用元数据（复用现有逻辑）
  const skillsWithMetadata = applyMetadataToSkills(allSkills);

  // 读取统计数据（带缓存）
  const stats = readStats();
  const logCounts = countExecutionsFromLog();

  // 添加使用次数（取 stats.json 和 JSONL 日志中的较大值）
  const skillsWithExecutions = skillsWithMetadata.map((skill) => ({
    ...skill,
    executions: Math.max(
      stats.commands[skill.name]?.totalExecutions || 0,
      logCounts[skill.name] || 0,
    ),
  }));

  // 排序：pinned > isNew > 使用频次 > 名称
  const sorted = skillsWithExecutions.sort((a, b) => {
    // 1. pinned 优先
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;

    // 2. isNew 其次
    if (a.isNew && !b.isNew) return -1;
    if (!a.isNew && b.isNew) return 1;

    // 3. 使用频次（高频在前）
    if (a.executions !== b.executions)
      return (b.executions || 0) - (a.executions || 0);

    // 4. 名称字母序
    return a.name.localeCompare(b.name);
  });

  skillsCache = sorted;
  skillsCacheTime = Date.now();
  skillsCacheKey = cacheKey;
  return sorted;
}

export function invalidateSkillsCache(): void {
  skillsCache = null;
  skillsCacheTime = 0;
  skillsCacheKey = "";
}

/**
 * 从技能文件内容中提取标题和描述
 * 与 commands.ts 中的 extractCommandInfo 逻辑相同
 */
function extractSkillInfo(
  name: string,
  content: string,
): {
  title: string;
  description: string;
} {
  const lines = content.split("\n");

  // 标题固定使用文件名
  const title = name;
  let description = "";

  // 尝试解析 frontmatter (YAML 格式: ---\nkey: value\n---)
  let inFrontmatter = false;
  const frontmatterRawLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 检测 frontmatter 开始
    if (line === "---" && i === 0) {
      inFrontmatter = true;
      continue;
    }

    // 检测 frontmatter 结束
    if (line === "---" && inFrontmatter) {
      inFrontmatter = false;

      // 解析 frontmatter - 只提取 description
      const frontmatterText = frontmatterRawLines.join("\n");
      const descMatch = frontmatterText.match(/description:\s*(.+)/);

      if (descMatch) {
        const descValue = descMatch[1].trim().replace(/^["']|["']$/g, "");

        // 检查是否是 YAML 多行字符串（| 或 > 开头）
        if (descValue === "|" || descValue === ">") {
          // 收集多行描述：找到 description: | 所在行之后的缩进行（使用原始行检查缩进）
          const descLineIndex = frontmatterRawLines.findIndex((l) =>
            l.trim().startsWith("description:"),
          );
          if (descLineIndex !== -1) {
            const descLines: string[] = [];
            for (
              let j = descLineIndex + 1;
              j < frontmatterRawLines.length &&
              frontmatterRawLines[j].startsWith("  ");
              j++
            ) {
              descLines.push(frontmatterRawLines[j].trim());
            }
            description = descLines.join(" ").replace(/^["']|["']$/g, "");
          }
        } else {
          description = descValue;
        }
      }

      // 找到 description 后直接返回
      break;
    }

    // 收集 frontmatter 内容（存储原始行以保留缩进信息）
    if (inFrontmatter) {
      frontmatterRawLines.push(lines[i]);
      continue;
    }

    // 如果没有 frontmatter,跳过空行
    if (line === "") {
      continue;
    }

    // 如果没有 frontmatter 的 description,尝试从内容中提取
    if (
      description === "" &&
      (line.includes("功能") ||
        line.includes("描述") ||
        line.includes("说明") ||
        line.startsWith(">") ||
        line.startsWith("**") ||
        line.startsWith("* "))
    ) {
      description = line
        .replace(/^>\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/^\*\s*/, "")
        .replace(/^#+\s*/, "")
        .trim();

      if (description.length > 3 && description.length < 200) {
        break;
      } else {
        description = "";
      }
    }
  }

  return { title, description };
}

/**
 * 根据技能名称匹配图标
 * 技能特定的图标映射
 */
function getSkillIcon(name: string): Icon {
  // Raycast API 可用的图标列表
  const icons: Icon[] = [
    Icon.ArrowClockwise,
    Icon.BlankDocument,
    Icon.Bookmark,
    Icon.Bubble,
    Icon.Calendar,
    Icon.Circle,
    Icon.Clipboard,
    Icon.Eye,
    Icon.Finder,
    Icon.Globe,
    Icon.Hammer,
    Icon.HardDrive,
    Icon.Person,
    Icon.Star,
    Icon.Trash,
    Icon.Upload,
  ];

  // 技能特定的图标映射（仅使用存在的图标）
  const skillKeywordMap: Record<string, Icon> = {
    ocr: Icon.Eye,
    pdf: Icon.BlankDocument,
    convert: Icon.ArrowClockwise,
    generator: Icon.Star,
    creator: Icon.Person,
    manager: Icon.Hammer,
    analyzer: Icon.Bubble,
    search: Icon.Bubble,
    router: Icon.Globe,
    upload: Icon.Upload,
    download: Icon.ArrowClockwise,
    article: Icon.Bookmark,
    format: Icon.BlankDocument,
  };

  const lowerName = name.toLowerCase();

  // 检查是否有精确关键词匹配
  for (const [keyword, icon] of Object.entries(skillKeywordMap)) {
    if (lowerName.includes(keyword)) {
      return icon;
    }
  }

  // 如果没有精确匹配，使用哈希值选择图标
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  const index = Math.abs(hash) % icons.length;
  return icons[index];
}

/**
 * 读取技能内容
 */
export function readSkillContent(skillFile: string): string {
  return readFileSync(skillFile, "utf-8");
}

/**
 * 导入外部 Skill 目录（创建符号链接）
 */
export function importSkill(
  sourceDir: string,
  targetProjectDir: string,
): { success: boolean; message: string } {
  const resolvedSource = resolve(sourceDir);
  const resolvedTarget = resolve(targetProjectDir);
  const skillName = basename(resolvedSource);
  const skillsDir = join(resolvedTarget, ".claude/skills");
  const targetPath = join(skillsDir, skillName);

  if (!isValidSkillDir(resolvedSource)) {
    return {
      success: false,
      message: "所选目录不是有效的 Skill（缺少 skill.md）",
    };
  }

  if (existsSync(targetPath)) {
    return {
      success: false,
      message: `Skill "${skillName}" 已存在于目标项目中`,
    };
  }

  // 确保 .claude/skills/ 目录存在
  mkdirSync(skillsDir, { recursive: true });

  try {
    symlinkSync(resolvedSource, targetPath);
  } catch (error) {
    return {
      success: false,
      message: `创建符号链接失败: ${error instanceof Error ? error.message : "未知错误"}`,
    };
  }

  invalidateSkillsCache();
  return { success: true, message: `Skill "${skillName}" 导入成功` };
}

/**
 * 解析 GitHub URL，提取 repo 地址和子路径
 */
function parseGitHubUrl(
  url: string,
): { repoUrl: string; subPath: string; branch: string } | null {
  // https://github.com/user/repo/tree/branch/path/to/skill
  const treeMatch = url.match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/tree\/([^/]+)\/?(.*)$/,
  );
  if (treeMatch) {
    return {
      repoUrl: `https://github.com/${treeMatch[1]}.git`,
      branch: treeMatch[2],
      subPath: treeMatch[3] || "",
    };
  }
  // https://github.com/user/repo
  const repoMatch = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/?$/);
  if (repoMatch) {
    return {
      repoUrl: `https://github.com/${repoMatch[1]}.git`,
      branch: "main",
      subPath: "",
    };
  }
  return null;
}

/**
 * 扫描目录寻找所有包含 skill.md 的子目录
 */
function findSkillDirs(rootDir: string): string[] {
  const results: string[] = [];
  const maxDepth = 4;

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name.startsWith(".") &&
          depth === 0 &&
          entry.name !== ".claude"
        )
          continue;
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

        const fullPath = join(dir, entry.name);
        if (isValidSkillDir(fullPath)) {
          results.push(fullPath);
        }
        if (depth < maxDepth) {
          walk(fullPath, depth + 1);
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }

  walk(rootDir, 0);
  return results;
}

const EXTERNAL_SKILLS_DIR = join(homedir(), ".claude", "external-skills");

/**
 * 从 URL 导入 Skill（git clone 后创建符号链接）
 */
export async function importSkillFromUrl(
  url: string,
  targetProjectDir: string,
): Promise<{ success: boolean; message: string }> {
  const trimmedUrl = url.trim();
  const parsed = parseGitHubUrl(trimmedUrl);
  const resolvedTarget = resolve(targetProjectDir);

  if (!parsed) {
    return {
      success: false,
      message: "不支持的 URL 格式。请输入 GitHub 仓库链接。",
    };
  }

  // 从 repo URL 提取仓库名
  const repoName = basename(parsed.repoUrl, ".git");
  const cloneDest = join(EXTERNAL_SKILLS_DIR, repoName);

  // 确保外部 skills 管理目录存在
  mkdirSync(EXTERNAL_SKILLS_DIR, { recursive: true });

  try {
    // 如果之前 clone 过，先删除
    if (existsSync(cloneDest)) {
      rmSync(cloneDest, { recursive: true, force: true });
    }

    // Clone 仓库
    execSync(
      `git clone --depth 1 --branch ${parsed.branch} ${parsed.repoUrl} "${cloneDest}"`,
      {
        timeout: 60000,
        stdio: "pipe",
      },
    );
  } catch {
    // 如果指定分支失败，尝试默认 clone
    try {
      if (existsSync(cloneDest)) {
        rmSync(cloneDest, { recursive: true, force: true });
      }
      execSync(`git clone --depth 1 ${parsed.repoUrl} "${cloneDest}"`, {
        timeout: 60000,
        stdio: "pipe",
      });
    } catch {
      return { success: false, message: "克隆仓库失败，请检查 URL 是否正确" };
    }
  }

  // 确定要导入的 skill 目录
  let skillSourceDirs: string[];

  if (parsed.subPath) {
    const specificPath = join(cloneDest, parsed.subPath);
    if (isValidSkillDir(specificPath)) {
      skillSourceDirs = [specificPath];
    } else {
      // 子路径不是有效 skill，扫描该路径下的 skill
      skillSourceDirs = findSkillDirs(specificPath);
    }
  } else {
    // 未指定子路径，扫描整个仓库
    skillSourceDirs = findSkillDirs(cloneDest);
  }

  if (skillSourceDirs.length === 0) {
    rmSync(cloneDest, { recursive: true, force: true });
    return {
      success: false,
      message: "仓库中未找到有效的 Skill（缺少 skill.md）",
    };
  }

  // 导入找到的所有 skill
  const skillsDir = join(resolvedTarget, ".claude/skills");
  mkdirSync(skillsDir, { recursive: true });

  const results: string[] = [];
  for (const skillDir of skillSourceDirs) {
    const skillName = basename(skillDir);
    const targetPath = join(skillsDir, skillName);

    if (existsSync(targetPath)) {
      results.push(`"${skillName}" 已存在，跳过`);
      continue;
    }

    // 将 skill 复制到外部管理目录（避免引用整个仓库）
    const managedPath = join(EXTERNAL_SKILLS_DIR, skillName);
    if (existsSync(managedPath) && managedPath !== skillDir) {
      rmSync(managedPath, { recursive: true, force: true });
    }
    if (managedPath !== skillDir) {
      cpSync(skillDir, managedPath, { recursive: true });
    }

    try {
      symlinkSync(managedPath, targetPath);
      results.push(`"${skillName}" 导入成功`);
    } catch {
      results.push(`"${skillName}" 创建链接失败`);
    }
  }

  // 清理克隆的仓库（如果已复制 skill 到管理目录）
  if (existsSync(cloneDest)) {
    rmSync(cloneDest, { recursive: true, force: true });
  }

  invalidateSkillsCache();

  const successCount = results.filter((r) => r.includes("导入成功")).length;
  if (successCount === 0) {
    return {
      success: false,
      message: results.join("\n") || "未导入任何 Skill",
    };
  }

  return {
    success: true,
    message: `成功导入 ${successCount} 个 Skill\n${results.join("\n")}`,
  };
}
