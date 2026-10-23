import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { LocalStorage } from "@raycast/api";
import { parse as parseYaml } from "yaml";

/** LocalStorage key：用户选中的 Hermes 模型（provider/model）；空/未设置 = 跟随 config.yaml 默认 */
const SELECTED_MODEL_KEY = "hermes-selected-model";

/**
 * 同步快路径文件：~/.hermes/active-model（纯文本一行 provider/model）。
 * 下拉初始值必须首个渲染帧同步可读（LocalStorage 是 IPC 桥，冷启动可能秒级）。
 * 文件存在 = 权威状态（含空文件 = 显式回到默认）；文件缺失才回落 LocalStorage。
 */
const ACTIVE_MODEL_FILE = join(homedir(), ".hermes", "active-model");

/**
 * 模型值白名单：裸模型名，或 `provider/模型路径`（可含多段 `/`，
 * 如 `magpie/minimax-code/MiniMax-M3.1-Flash`）。
 * 每段字符集覆盖真实模型名（glm-5.3-flash、zai_glm-5.3-flash[1M]），
 * 段首必须字母数字，段内可含 `. _ [ ] -`。
 * 该值会进可视化终端的 bash 脚本字符串——引号/$/反引号等可注入字符一律丢弃。
 */
const MODEL_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._[\]-]*$/;

/** 模型值长度上限——防御异常超长输入（该值会进命令行）。 */
const MAX_MODEL_VALUE_LENGTH = 200;

/**
 * 校验并归一模型选择值；非法（含可注入字符/为空）返回空字符串 = 默认。
 * 逐段校验：`a/b/c` 合法，`a//b`、`a/./b`、含引号/$/反引号/空格的值非法。
 */
export function normalizeHermesModel(value: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return "";
  if (v.length > MAX_MODEL_VALUE_LENGTH) return "";
  const segments = v.split("/");
  for (const segment of segments) {
    if (!MODEL_SEGMENT_RE.test(segment)) return "";
  }
  return v;
}

/** 快路径文件的读取结果：区分「文件不存在」与「文件存在但为空」。 */
interface ActiveModelFileState {
  exists: boolean;
  value: string;
}

/** 读快路径文件；文件缺失 = { exists:false }，文件存在但内容非法/为空 = { exists:true, value:"" }。 */
function readActiveModelFile(): ActiveModelFileState {
  try {
    if (!existsSync(ACTIVE_MODEL_FILE)) return { exists: false, value: "" };
    const raw = readFileSync(ACTIVE_MODEL_FILE, "utf-8");
    return { exists: true, value: normalizeHermesModel(raw) };
  } catch {
    // 读失败（权限/竞态删除）视为文件不存在，允许走 LocalStorage 回落
    return { exists: false, value: "" };
  }
}

/** 同步读取当前选中模型（provider/model 形态，如 zai/glm-5.3）；空 = 默认。 */
export function getSelectedHermesModelSync(): string {
  return readActiveModelFile().value;
}

/**
 * 读取当前选中的 Hermes 模型。快路径文件优先；文件缺失时回落
 * LocalStorage 并迁移回写文件（语义与 getSelectedHermesProfile 一致）。
 * 两条来源都过 normalizeHermesModel 白名单。
 *
 * 不变量：
 * - 文件存在（含空文件）= 权威；空文件表示显式选了「默认」，不再回落
 *   LocalStorage，否则清空后重开旧值会被复活。
 * - 文件缺失 = 从未落盘，才读 LocalStorage 并迁移回写。
 * - 迁移回写前复查文件：读 LocalStorage 期间可能已有新选择落盘，不得覆盖。
 */
export async function getSelectedHermesModel(): Promise<string> {
  const fileState = readActiveModelFile();
  if (fileState.exists) return fileState.value;
  try {
    const legacyRaw =
      ((await LocalStorage.getItem(SELECTED_MODEL_KEY)) as string) || "";
    const legacy = normalizeHermesModel(legacyRaw);
    // 读 LocalStorage 期间可能已有新选择落盘（文件已存在），此时让位给文件
    const current = readActiveModelFile();
    if (current.exists) return current.value;
    if (!legacy) return "";
    try {
      writeFileSync(ACTIVE_MODEL_FILE, legacy, "utf-8");
    } catch {
      // 迁移失败不影响本次返回
    }
    return legacy;
  } catch {
    return "";
  }
}

/**
 * LocalStorage 写入串行队列：Raycast 的 LocalStorage 是异步 IPC，快速连续
 * 保存时并发写会乱序落地。串行化后按调用顺序完成；同步文件写入即时生效。
 */
let localStorageQueue: Promise<unknown> = Promise.resolve();

function enqueueLocalStorage<T>(task: () => Promise<T>): Promise<T> {
  const run = localStorageQueue.then(task, task);
  // 队列尾部吞掉错误，避免一次失败卡死后续写入
  localStorageQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * 保存选中的 Hermes 模型；传空字符串 = 回到默认（不传 -m）。
 *
 * 非空但非法的值（引号/$/反引号/空格/空段等）抛错且不落盘，保持既有选择。
 * 落盘顺序：同步文件立即写，LocalStorage 走串行队列按序完成。
 */
export async function setSelectedHermesModel(model: string): Promise<void> {
  const raw = typeof model === "string" ? model.trim() : "";
  const normalized = normalizeHermesModel(raw);
  if (raw && !normalized) {
    // 错误信息不含原始值——该值可能是任意用户输入，不进日志
    throw new Error("非法 Hermes 模型值：含不允许的字符");
  }
  try {
    writeFileSync(ACTIVE_MODEL_FILE, normalized, "utf-8");
  } catch {
    // 文件写失败不致命，LocalStorage 仍生效
  }
  await enqueueLocalStorage(async () => {
    if (normalized) {
      await LocalStorage.setItem(SELECTED_MODEL_KEY, normalized);
    } else {
      await LocalStorage.removeItem(SELECTED_MODEL_KEY);
    }
  });
}

export interface HermesModelGroup {
  provider: string; // provider 名（config.yaml providers 下的键）
  models: string[]; // 该 provider 的可用模型名（裸名，不含 provider/ 前缀）
}

export interface HermesModelCatalog {
  defaultProvider?: string; // config.yaml model.provider
  defaultModel?: string; // config.yaml model.default（裸名）
  providers: HermesModelGroup[];
}

/**
 * 解析单个 config.yaml；文件缺失/解析失败返回 null（不抛出）。
 */
function readConfigFile(configPath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(configPath)) return null;
    const raw = parseYaml(readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    > | null;
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

/** 从一份（可能已合并的）配置对象提取模型清单。 */
function toCatalog(config: Record<string, unknown>): HermesModelCatalog {
  const model = (config.model ?? {}) as {
    provider?: unknown;
    default?: unknown;
  };
  const providersRaw = (config.providers ?? {}) as Record<
    string,
    { models?: unknown }
  >;

  const providers: HermesModelGroup[] = [];
  for (const [name, conf] of Object.entries(providersRaw)) {
    const models = Array.isArray(conf?.models)
      ? conf.models.filter(
          (m): m is string => typeof m === "string" && m.trim().length > 0,
        )
      : [];
    if (models.length > 0) providers.push({ provider: name, models });
  }

  return {
    defaultProvider:
      typeof model.provider === "string" ? model.provider : undefined,
    defaultModel: typeof model.default === "string" ? model.default : undefined,
    providers,
  };
}

/**
 * 读取模型清单：model.default + 各 provider 的 models 列表。
 * 同步 readFileSync——文件小且下拉初始渲染必须无异步空窗。
 *
 * 合并语义（按 Hermes 真实解析，2026-10-21 实测校准）：HERMES_HOME 指向
 * profile 时 Hermes 不再读主配置——profile config.yaml 自带 providers 段时
 * 它就是权威清单；profile 未定义 providers（如只覆盖 model.default 的轻量
 * profile）时 Hermes 落到内置 provider 目录，扩展侧退回主配置清单近似
 * （主配置通常与内置目录重合，但仅存在于主配置的自定义 provider 实际不可
 * 用——实测 sub2api 在 profile 下静默回落 zai 并报 400）。model.provider/
 * default 始终按「主配置打底、profile 覆盖」合并，用于默认项展示。
 * 后续在 config.yaml 里增删模型，重开命令或刷新列表即动态生效。
 * 任何失败返回 null（下拉退化为只有「默认」一项，不报错）。
 */
export function loadHermesModelCatalog(
  hermesProfileHome?: string,
): HermesModelCatalog | null {
  const mainConfig = readConfigFile(join(homedir(), ".hermes", "config.yaml"));
  if (!hermesProfileHome) return mainConfig ? toCatalog(mainConfig) : null;

  const profileConfig = readConfigFile(join(hermesProfileHome, "config.yaml"));
  if (!mainConfig && !profileConfig) return null;
  if (!profileConfig) return toCatalog(mainConfig!);
  if (!mainConfig) return toCatalog(profileConfig);

  const profileProviders = profileConfig.providers as object | undefined;
  const merged: Record<string, unknown> = {
    ...mainConfig,
    ...profileConfig,
    model: {
      ...((mainConfig.model as object | undefined) ?? {}),
      ...((profileConfig.model as object | undefined) ?? {}),
    },
    // profile 自带 providers 段 → 权威（Hermes 不读主配置）；否则退回主配置
    providers:
      profileProviders && Object.keys(profileProviders).length > 0
        ? profileProviders
        : ((mainConfig.providers as object | undefined) ?? {}),
  };
  return toCatalog(merged);
}

/** 下拉里「默认」项的哨兵值（Raycast Dropdown 的 value 不允许空串）。 */
export const DEFAULT_MODEL_CHOICE = "__default__";

/** 把下拉值还原为传给 hermes -m 的参数：哨兵 → undefined；其余过白名单校验。 */
export function dropdownValueToModel(value: string): string | undefined {
  if (!value || value === DEFAULT_MODEL_CHOICE) return undefined;
  return normalizeHermesModel(value) || undefined;
}

/**
 * 把模型选择值转成 Hermes CLI 的参数片段。
 *
 * 按首个 `/` 切分：provider 给 `--provider`，余下整体给 `-m`
 * （`magpie/minimax-code/MiniMax-M3.1-Flash` →
 * `--provider magpie -m minimax-code/MiniMax-M3.1-Flash`）。
 * 裸模型名 → `["-m", 模型]`；空/默认哨兵/非法值 → `[]`（跟随 config.yaml 默认）。
 *
 * buildHermesArgs（参数数组）与可视化终端（bash 字符串）共用本函数，
 * 保证两条执行路径的 provider/model 语义一致。
 */
export function buildHermesModelArgs(value?: string): string[] {
  if (!value || value === DEFAULT_MODEL_CHOICE) return [];
  const normalized = normalizeHermesModel(value);
  if (!normalized) return [];
  const slashIndex = normalized.indexOf("/");
  if (slashIndex === -1) return ["-m", normalized];
  const provider = normalized.slice(0, slashIndex);
  const model = normalized.slice(slashIndex + 1);
  if (!provider || !model) return [];
  return ["--provider", provider, "-m", model];
}

/** 给 UI 展示：默认项标题，如「默认（glm-5.3 @ zai）」。 */
export function defaultModelTitle(catalog: HermesModelCatalog | null): string {
  if (catalog?.defaultModel) {
    return catalog.defaultProvider
      ? `默认（${catalog.defaultModel} @ ${catalog.defaultProvider}）`
      : `默认（${catalog.defaultModel}）`;
  }
  return "默认（跟随 Hermes 配置）";
}
