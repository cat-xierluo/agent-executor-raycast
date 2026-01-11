import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Icon } from "@raycast/api";
import { applyMetadataToCommands } from "./commandMetadata";
import { getProjectName } from "./claude";

export interface ClaudeCommand {
  name: string;
  title: string;
  description: string;
  filePath: string;
  fileName: string;
  icon: Icon;
  pinned?: boolean;
  isNew?: boolean;
  projectName?: string;  // 新增：命令来自哪个项目
  projectDir?: string;   // 新增：项目的根目录
}

/**
 * 解析 @include 指令,支持相对路径和绝对路径(~/)
 */
function resolveIncludePath(includePath: string, currentFilePath: string): string {
  // 处理 ~/ 开头的路径
  if (includePath.startsWith("~/")) {
    return join(homedir(), includePath.slice(2));
  }

  // 处理绝对路径
  if (includePath.startsWith("/")) {
    return includePath;
  }

  // 处理相对路径
  const currentDir = currentFilePath.split("/").slice(0, -1).join("/");

  // 手动处理相对路径，避免 resolve() 的规范化行为
  const parts = currentDir.split("/");
  const includeParts = includePath.split("/");

  for (const part of includeParts) {
    if (part === "..") {
      parts.pop(); // 回退一级目录
    } else if (part !== ".") {
      parts.push(part);
    }
  }

  return parts.join("/");
}

/**
 * 读取文件内容,如果包含 @include 指令则递归解析
 * 防止循环引用并正确处理相对/绝对路径
 *
 * 新行为: @include 指令会替换为被引用文件的内容,并保留原文件中 @include 之后的内容
 */
function readFileWithIncludes(filePath: string, visited = new Set<string>()): string {
  // 防止循环引用
  if (visited.has(filePath)) {
    console.warn(`Circular include detected: ${filePath}`);
    return "";
  }
  visited.add(filePath);

  if (!existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return "";
  }

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // 查找 @include 指令(必须在文件开头)
  let includedContent: string | null = null;
  let includeIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();

    // 跳过空行
    if (trimmedLine === "") {
      continue;
    }

    // 如果遇到 @include,解析它
    if (trimmedLine.startsWith("@include ")) {
      const includePath = trimmedLine.replace("@include ", "").trim();
      const resolvedPath = resolveIncludePath(includePath, filePath);

      // 递归读取被引用的文件
      includedContent = readFileWithIncludes(resolvedPath, new Set(visited));
      includeIndex = i;

      // 找到 @include 后停止搜索(只处理第一个 @include)
      break;
    }

    // 如果遇到非 @include 的内容,停止查找
    break;
  }

  // 如果没有找到 @include,返回原始内容
  if (includeIndex === -1) {
    return content;
  }

  // 如果找到了 @include,合并被引用的内容和原文件剩余内容
  // 保留 @include 之前的空行和 frontmatter
  const beforeInclude = lines.slice(0, includeIndex).join("\n");
  // 保留 @include 之后的内容(跳过 @include 所在行)
  const afterInclude = lines.slice(includeIndex + 1).join("\n");

  // 如果被引用的文件读取失败,返回原内容(跳过 @include 行)
  if (includedContent === null) {
    return beforeInclude + (afterInclude ? "\n" + afterInclude : "");
  }

  // 合并内容: @include 之前 + 被引用内容 + @include 之后
  return beforeInclude + "\n" + includedContent + (afterInclude ? "\n" + afterInclude : "");
}

/**
 * 扫描单个项目的 .claude/commands/ 目录
 */
function scanSingleProject(autoweaveDir: string): ClaudeCommand[] {
  const commandsDir = join(autoweaveDir, ".claude/commands");

  if (!existsSync(commandsDir)) {
    return [];
  }

  const files = readdirSync(commandsDir);
  const commands: ClaudeCommand[] = [];
  const projectName = getProjectName(autoweaveDir);

  for (const file of files) {
    if (!file.endsWith(".md")) {
      continue;
    }

    const filePath = join(commandsDir, file);

    // 读取文件内容,如果有 @include 则递归解析
    const content = readFileWithIncludes(filePath);

    if (!content) {
      // 如果无法读取内容(例如循环引用或文件不存在),跳过
      continue;
    }

    // 提取命令名称(文件名去掉 .md 后缀)
    const name = file.replace(/\.md$/, "");

    // 从实际内容中动态提取标题和描述
    const { title, description } = extractCommandInfo(name, content);

    // 根据命令名称匹配图标
    const icon = getCommandIcon(name);

    commands.push({
      name,
      title,
      description,
      filePath,
      fileName: file,
      icon,
      pinned: false,
      isNew: false,
      projectName,  // 添加项目名称
      projectDir: autoweaveDir,  // 添加项目目录
    });
  }

  return commands;
}

/**
 * 扫描多个项目目录,获取所有可用的命令
 * 完全动态读取,不硬编码任何命令信息
 * 正确处理 @include 指令(支持相对路径和 ~/ 绝对路径)
 */
export function scanCommands(autoweaveDirs: string[]): ClaudeCommand[] {
  // 从所有目录扫描命令
  const allCommands: ClaudeCommand[] = [];

  for (const dir of autoweaveDirs) {
    const commands = scanSingleProject(dir);
    allCommands.push(...commands);
  }

  // 应用元数据（置顶、新标记等）
  const commandsWithMetadata = applyMetadataToCommands(allCommands);

  // 排序：置顶的在前，然后是新的，最后按名称排序
  return commandsWithMetadata.sort((a, b) => {
    // 置顶优先
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;

    // 新命令次之
    if (a.isNew && !b.isNew) return -1;
    if (!a.isNew && b.isNew) return 1;

    // 都置顶或都未置顶，按名称排序
    return a.name.localeCompare(b.name);
  });
}

/**
 * 从命令文件内容中提取标题和描述
 * 标题: 使用文件名(不使用 frontmatter 的 name 字段)
 * 描述: 优先使用 frontmatter 的 description 字段
 */
function extractCommandInfo(name: string, content: string): {
  title: string;
  description: string;
} {
  const lines = content.split("\n");

  // 标题固定使用文件名
  const title = name;
  let description = "";

  // 尝试解析 frontmatter (YAML 格式: ---\nkey: value\n---)
  let inFrontmatter = false;
  let frontmatterLines: string[] = [];

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
      const frontmatterText = frontmatterLines.join("\n");
      const descMatch = frontmatterText.match(/description:\s*(.+)/);

      if (descMatch) {
        description = descMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      // 找到 description 后直接返回,不再继续查找
      break;
    }

    // 收集 frontmatter 内容
    if (inFrontmatter) {
      frontmatterLines.push(line);
      continue;
    }

    // 如果没有 frontmatter,跳过空行
    if (line === "") {
      continue;
    }

    // 如果没有 frontmatter 的 description,尝试从内容中提取
    if (description === "" && (
      line.includes("功能") ||
      line.includes("描述") ||
      line.includes("说明") ||
      line.startsWith(">") ||
      line.startsWith("**") ||
      line.startsWith("* ")
    )) {
      // 清理格式
      description = line
        .replace(/^>\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/^\*\s*/, "")
        .replace(/^#+\s*/, "")
        .trim();

      // 如果找到了有意义的描述,停止搜索
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
 * 根据命令名称匹配图标
 * 使用智能匹配 + 哈希随机化，确保图标多样性
 */
function getCommandIcon(name: string): Icon {
  // 扩展的图标列表，提供更多选择
  const icons: Icon[] = [
    Icon.MagnifyingGlass,    // 搜索
    Icon.ArrowClockwise,     // 同步/刷新
    Icon.Globe,              // 路由/网络
    Icon.Document,           // 文档/预处理
    Icon.Text,               // 文本/方案
    Icon.List,               // 列表/分析
    Icon.QuestionMark,       // 帮助
    Icon.Book,               // 书籍/法律
    Icon.Folder,             // 文件/文件夹
    Icon.Terminal,           // 终端/代码
    Icon.Gear,               // 设置/工具
    Icon.Wand,               // 魔杖/自动化
    Icon.AppWindow,          // 窗口
    Icon.Bolt,               // 闪电/快速
    Icon.Calculator,         // 计算
    Icon.ChartBar,           // 图表
    Icon.Cog,                // 齿轮
    Icon.Code,               // 代码
    Icon.ComputerChip,       // 芯片
    Icon.CreditCard,         // 卡片
    Icon.Cursor,             // 光标
    Icon.Dashboard,          // 仪表板
    Icon.Database,           // 数据库
    Icon.Doc,                // 文档
    Icon.Download,           // 下载
    Icon.Envelope,           // 邮件
    Icon.Eye,                // 眼睛/查看
    Icon.Finder,             // Finder
    Icon.Flashlight,         // 手电筒
    Icon.Funnel,             // 过滤
    Icon.Gift,               // 礼物
    Icon.Globe,              // 地球
    Icon.Hammer,             // 锤子
    Icon.Hashtag,            // 标签
    Icon.Heart,              // 心形
    Icon.Image,              // 图片
    Icon.Info,               // 信息
    Icon.Key,                // 钥匙
    Icon.Link,               // 链接
    Icon.LifeBuoy,           // 救生圈
    Icon.LightBulb,          // 灯泡
    Icon.List,               // 列表
    Icon.Location,           // 位置
    Icon.Lock,               // 锁
    Icon.Map,                // 地图
    Icon.Megaphone,          // 扩音器
    Icon.MemoryChip,         // 内存
    Icon.Microphone,         // 麦克风
    Icon.Mobile,             // 手机
    Icon.Mouse,              // 鼠标
    Icon.Music,              // 音乐
    Icon.Newspaper,          // 报纸
    Icon.Note,               // 笔记
    Icon.Paper,              // 纸张
    Icon.Pencil,             // 铅笔
    Icon.Phone,              // 电话
    Icon.Play,               // 播放
    Icon.Plus,               // 加号
    Icon.Print,              // 打印
    Icon.Puzzle,             // 拼图
    Icon.QuestionMark,       // 问号
    Icon.Rocket,             // 火箭
    Icon.Scalpel,            // 手术刀
    Icon.Scissors,           // 剪刀
    Icon.Search,             // 搜索
    Icon.Share,              // 分享
    Icon.Shield,             // 盾牌
    Icon.Star,               // 星星
    Icon.Syringe,            // 注射器
    Icon.Tag,                // 标签
    Icon.Tangent,            // 切线
    Icon.Text,               // 文本
    Icon.TrafficLight,       // 红绿灯
    Icon.TwoColumns,         // 双列
    Icon.Video,              // 视频
    Icon.Wallet,             // 钱包
    Icon.WandAndStars,       // 魔杖和星星
    Icon.Wrench,             // 扳手
  ];

  // 关键词精确匹配（优先级最高）
  const keywordMap: Record<string, Icon> = {
    'search': Icon.MagnifyingGlass,
    'find': Icon.MagnifyingGlass,
    'research': Icon.MagnifyingGlass,
    'sync': Icon.ArrowClockwise,
    'update': Icon.ArrowClockwise,
    'refresh': Icon.ArrowClockwise,
    'router': Icon.Globe,
    'route': Icon.Globe,
    'navigate': Icon.Globe,
    'preprocess': Icon.Document,
    'convert': Icon.Document,
    'transform': Icon.Document,
    'document': Icon.Document,
    'proposal': Icon.Text,
    'plan': Icon.Text,
    'suggest': Icon.Text,
    'analyze': Icon.List,
    'check': Icon.CheckCircle,
    'review': Icon.List,
    'help': Icon.QuestionMark,
    'info': Icon.Info,
    'guide': Icon.Map,
    'legal': Icon.Book,
    'book': Icon.Book,
    'library': Icon.Book,
    'file': Icon.Doc,
    'folder': Icon.Folder,
    'code': Icon.Code,
    'terminal': Icon.Terminal,
    'command': Icon.Terminal,
    'auto': Icon.Wand,
    'ai': Icon.MemoryChip,
    'bot': Icon.Robot,
    'test': Icon.Flask,
    'fix': Icon.Wrench,
    'build': Icon.Hammer,
    'deploy': Icon.Rocket,
    'download': Icon.Download,
    'upload': Icon.Upload,
    'email': Icon.Envelope,
    'mail': Icon.Envelope,
    'web': Icon.Globe,
    'api': Icon.Cloud,
    'data': Icon.Database,
    'config': Icon.Gear,
    'setting': Icon.Gear,
    'tool': Icon.Wrench,
    'script': Icon.Code,
    'batch': Icon.Grid,
    'multi': Icon.TwoColumns,
  };

  // 转为小写进行匹配
  const lowerName = name.toLowerCase();

  // 检查是否有精确关键词匹配
  for (const [keyword, icon] of Object.entries(keywordMap)) {
    if (lowerName.includes(keyword)) {
      return icon;
    }
  }

  // 如果没有精确匹配，使用哈希值选择图标
  // 这样同一个命令总是显示相同的图标，但不同命令会有不同图标
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  // 确保哈希值为正数并在图标列表范围内
  const index = Math.abs(hash) % icons.length;
  return icons[index];
}

/**
 * 读取命令内容,正确处理 @include 指令
 */
export function readCommandContent(filePath: string): string {
  return readFileWithIncludes(filePath);
}
