import { execFile } from "child_process";
import { basename, dirname } from "path";

/**
 * Hermes 技能可寻址性探测。
 *
 * Hermes 的 `/skill` 斜杠命令在无头路径（`-q --oneshot`）下不会被展开，
 * 扩展因此历史上把 SKILL.md 全文嵌进 query。Hermes 其实提供了无头可用的原生方式：
 * `-s <name>` 预加载——它按自己的技能索引解析该名字，写进 system prompt，并附带
 * 技能目录、references/ scripts/ 支撑文件清单与 config.yaml 解析值，比裸嵌全文更完整。
 *
 * 但 `-s` 有一个致命前提：名字必须能被 Hermes **唯一**解析。两种情况不行——
 *  1. 名字不在 Hermes 的技能索引里（技能装在 Claude 布局 .claude/skills 下等）
 *  2. 同名多份（历史上技能目录内嵌 archive/ 存历史快照，每份都带 SKILL.md，
 *     Hermes 的 os.walk 全部收为独立技能 → Ambiguous；code-video 曾因此假命中归档旧快照）
 *
 * 两种都退回归嵌入。探测结果缓存，避免每 5 秒的列表轮询都拉起一次子进程。
 */

interface HermesSkillIndex {
  /** 表格中未截断的技能名 */
  exactNames: Set<string>;
  /** 被表格截断的行（名字含 …），其可见前缀 */
  truncatedPrefixes: string[];
}

const indexCache = new Map<string, { index: HermesSkillIndex; at: number }>();
const INDEX_TTL_MS = 10 * 60 * 1000;
const LIST_TIMEOUT_MS = 20 * 1000;

/**
 * 解析 `hermes skills list` 的 rich table 输出。
 * 形如：│ code-livephoto │ (空分类) │ local │ local │ enabled │
 * 名字列可能被表格宽度截断成 `universal-media-downlo…`——这种行不算精确匹配。
 */
export function parseSkillsList(stdout: string): HermesSkillIndex {
  const exactNames = new Set<string>();
  const truncatedPrefixes: string[] = [];
  // 墓碑集合：剔除过的重名不再按「首次出现」加回（第三次出现时 exactNames
  // 已不含该名，没有墓碑会误判回可寻址——历史事故正是 3 份同名 code-video）
  const dupNames = new Set<string>();

  for (const line of stdout.split("\n")) {
    if (!line.includes("│")) continue;
    // rich table 的边框行以 ┏ ┡ └ 等开头，字段里不会有这些字符
    const fields = line.split("│").map((f) => f.trim());
    if (fields.length < 2) continue;

    const name = fields[1];
    if (!name) continue;
    // 表头与分隔行
    if (name === "Name" || /^-+$/.test(name)) continue;

    if (name.endsWith("…")) {
      truncatedPrefixes.push(name.slice(0, -1));
      continue;
    }
    // 同名多份（如误留的 archive 快照）会让 -s 报 Ambiguous 直接失败，
    // 比回退嵌入更糟——从可寻址集合里剔除，走全文嵌入兜底
    if (exactNames.has(name) || dupNames.has(name)) {
      exactNames.delete(name);
      dupNames.add(name);
      continue;
    }
    exactNames.add(name);
  }

  return { exactNames, truncatedPrefixes };
}

async function fetchSkillsIndex(
  hermesBin: string,
  projectDir: string,
  hermesProfileHome?: string,
): Promise<HermesSkillIndex | null> {
  return new Promise((resolve) => {
    // HERMES_HOME 决定 profile 隔离岛，与扩展执行子进程时的注入保持一致
    const env = { ...process.env };
    if (hermesProfileHome) env.HERMES_HOME = hermesProfileHome;
    else delete env.HERMES_HOME;

    execFile(
      hermesBin,
      ["skills", "list"],
      {
        cwd: projectDir,
        env,
        timeout: LIST_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
          return;
        }
        try {
          resolve(parseSkillsList(stdout));
        } catch {
          resolve(null);
        }
      },
    );
  });
}

/**
 * 判断某个技能能否走 `-s` 预加载。
 * @param skillFile 技能定义文件路径；其所在目录名即 Raycast 使用的技能名
 */
export async function canPreloadHermesSkill(options: {
  skillFile: string;
  hermesBin: string;
  projectDir: string;
  hermesProfileHome?: string;
}): Promise<boolean> {
  const { skillFile, hermesBin, projectDir, hermesProfileHome } = options;
  const name = basename(dirname(skillFile));
  if (!name) return false;

  const cacheKey = JSON.stringify({ hermesBin, projectDir, hermesProfileHome });
  const cached = indexCache.get(cacheKey);
  let index =
    cached && Date.now() - cached.at < INDEX_TTL_MS ? cached.index : undefined;

  if (!index) {
    index =
      (await fetchSkillsIndex(hermesBin, projectDir, hermesProfileHome)) ??
      undefined;
    // 探测失败不缓存：宁可每次重试，也不要把一次失败固化成 10 分钟的"不可预加载"
    if (!index) return false;
    indexCache.set(cacheKey, { index, at: Date.now() });
  }

  // 表格里存在同前缀的截断行 → 无法确定没有第二份同名技能，保守放弃预加载
  if (index.truncatedPrefixes.some((p) => p === name)) return false;

  return index.exactNames.has(name);
}

/** 供测试与调试：清空探测缓存 */
export function invalidateHermesSkillIndexCache(): void {
  indexCache.clear();
}
