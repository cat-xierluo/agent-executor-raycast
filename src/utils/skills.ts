import { readdirSync, readFileSync, existsSync, lstatSync, symlinkSync, mkdirSync } from "fs";
import { join, basename, resolve } from "path";
import { Icon } from "@raycast/api";
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
  const skillMd = join(skillPath, "skill.md");
  const skillMdUpper = join(skillPath, "SKILL.md");
  const claudeSkillMd = join(skillPath, ".claude", "skill.md");
  const claudeSkillMdUpper = join(skillPath, ".claude", "SKILL.md");

  return (
    existsSync(skillMd) ||
    existsSync(skillMdUpper) ||
    existsSync(claudeSkillMd) ||
    existsSync(claudeSkillMdUpper)
  );
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

/**
 * 扫描单个项目的 .claude/skills/ 目录
 */
function scanSingleProjectSkills(projectDir: string): ClaudeSkill[] {
  const skillsDir = join(projectDir, ".claude/skills");

  if (!existsSync(skillsDir)) {
    return [];
  }

  const entries = readdirSync(skillsDir, { withFileTypes: true });
  const skills: ClaudeSkill[] = [];
  const projectName = getProjectName(projectDir);

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

    // 查找 skill.md 或 SKILL.md
    let skillFile = join(skillDir, "skill.md");
    if (!existsSync(skillFile)) {
      skillFile = join(skillDir, "SKILL.md");
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
 * 扫描多个项目目录，获取所有可用的技能
 * 带缓存：10 秒内重复调用直接返回缓存结果
 */
let skillsCache: ClaudeSkill[] | null = null;
let skillsCacheTime = 0;
const SKILLS_CACHE_TTL = 10000;

export function scanSkills(projectDirs: string[]): ClaudeSkill[] {
  if (skillsCache && Date.now() - skillsCacheTime < SKILLS_CACHE_TTL) {
    return skillsCache;
  }

  const allSkills: ClaudeSkill[] = [];

  for (const dir of projectDirs) {
    const skills = scanSingleProjectSkills(dir);
    allSkills.push(...skills);
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
    if (a.executions !== b.executions) return (b.executions || 0) - (a.executions || 0);

    // 4. 名称字母序
    return a.name.localeCompare(b.name);
  });

  skillsCache = sorted;
  skillsCacheTime = Date.now();
  return sorted;
}

export function invalidateSkillsCache(): void {
  skillsCache = null;
  skillsCacheTime = 0;
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
  let frontmatterRawLines: string[] = [];

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
              j < frontmatterRawLines.length && frontmatterRawLines[j].startsWith("  ");
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
export function importSkill(sourceDir: string, targetProjectDir: string): { success: boolean; message: string } {
  const resolvedSource = resolve(sourceDir);
  const resolvedTarget = resolve(targetProjectDir);
  const skillName = basename(resolvedSource);
  const skillsDir = join(resolvedTarget, ".claude/skills");
  const targetPath = join(skillsDir, skillName);

  if (!isValidSkillDir(resolvedSource)) {
    return { success: false, message: "所选目录不是有效的 Skill（缺少 skill.md）" };
  }

  if (existsSync(targetPath)) {
    return { success: false, message: `Skill "${skillName}" 已存在于目标项目中` };
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
