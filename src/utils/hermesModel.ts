import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { LocalStorage } from "@raycast/api";
import { parse as parseYaml } from "yaml";

/** LocalStorage key：用户选中的 Hermes 模型（provider/model）；空/未设置 = 跟随 config.yaml 默认 */
const SELECTED_MODEL_KEY = "hermes-selected-model";

/**
 * 同步快路径文件：~/.hermes/active-model（纯文本一行 provider/model）。
 * 与 active-profile / active-backend 同理——下拉初始值必须在首个渲染帧同步可读，
 * LocalStorage IPC 桥冷启动可能秒级。写路径双写（文件+LocalStorage），文件为准。
 * 空字符串/文件缺失 = 未选过，跟随 Hermes config.yaml 的 model.default。
 */
const ACTIVE_MODEL_FILE = join(homedir(), ".hermes", "active-model");

/**
 * 模型名白名单：`provider/model` 或裸模型名。字符集覆盖真实模型名
 * （glm-5.3-flash、zai_glm-5.3-flash[1M]、MiniMax-M3.1-Flash-Preview 等）。
 * 选择值最终会插进可视化终端的 bash 脚本字符串（claude.ts），来源又是
 * config.yaml / active-model 文件 / LocalStorage——读入即校验，不带引号/
 * $/反引号等可注入字符的值一律丢弃，注入面在入口处关死。
 */
const MODEL_NAME_RE =
  /^[A-Za-z0-9][A-Za-z0-9._[\]-]*(?:\/[A-Za-z0-9][A-Za-z0-9._[\]-]*)?$/;

/** 校验并归一模型选择值；非法（含可注入字符/为空）返回空字符串 = 默认。 */
export function normalizeHermesModel(value: string): string {
  const v = value.trim();
  return MODEL_NAME_RE.test(v) ? v : "";
}

/** 同步读取当前选中模型（provider/model 形态，如 zai/glm-5.3）；空 = 默认。 */
export function getSelectedHermesModelSync(): string {
  try {
    if (!existsSync(ACTIVE_MODEL_FILE)) return "";
    return normalizeHermesModel(readFileSync(ACTIVE_MODEL_FILE, "utf-8"));
  } catch {
    return "";
  }
}

/**
 * 读取当前选中的 Hermes 模型。快路径文件优先；文件缺失时回落
 * LocalStorage 并迁移回写文件（语义与 getSelectedHermesProfile 一致）。
 * 两条来源都过 normalizeHermesModel 白名单。
 */
export async function getSelectedHermesModel(): Promise<string> {
  const fromFile = getSelectedHermesModelSync();
  if (fromFile) return fromFile;
  try {
    const legacyRaw =
      ((await LocalStorage.getItem(SELECTED_MODEL_KEY)) as string) || "";
    const legacy = normalizeHermesModel(legacyRaw);
    if (legacy) {
      try {
        writeFileSync(ACTIVE_MODEL_FILE, legacy, "utf-8");
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
 * 保存选中的 Hermes 模型；传空字符串 = 回到默认（不传 -m）。
 */
export async function setSelectedHermesModel(model: string): Promise<void> {
  try {
    writeFileSync(ACTIVE_MODEL_FILE, model, "utf-8");
  } catch {
    // 文件写失败不致命，LocalStorage 仍生效
  }
  if (model) {
    await LocalStorage.setItem(SELECTED_MODEL_KEY, model);
  } else {
    await LocalStorage.removeItem(SELECTED_MODEL_KEY);
  }
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

/** 给 UI 展示：默认项标题，如「默认（glm-5.3 @ zai）」。 */
export function defaultModelTitle(catalog: HermesModelCatalog | null): string {
  if (catalog?.defaultModel) {
    return catalog.defaultProvider
      ? `默认（${catalog.defaultModel} @ ${catalog.defaultProvider}）`
      : `默认（${catalog.defaultModel}）`;
  }
  return "默认（跟随 Hermes 配置）";
}
