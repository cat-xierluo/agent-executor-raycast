#!/usr/bin/env node
/**
 * hermesModel.ts 单元测试（本地 TypeScript 转译 + mock fs/os/@raycast/api）。
 *
 * 项目无测试框架，这里用 node 内置 assert + 自写 mock 跑确定性用例：
 *   - TypeScript 本地转译（require('typescript')），不依赖构建产物
 *   - mock fs：内存文件表，可模拟「文件缺失 / 空文件 / 写失败」
 *   - mock os：homedir() 指向虚拟家目录，不碰真实 ~/.hermes
 *   - mock @raycast/api：LocalStorage，可控延迟与释放时机（复现竞态）
 *
 * 用法：node scripts/test-hermes-model.cjs [--report <输出文件路径>]
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsReal = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");

const SRC = path.join(__dirname, "..", "src", "utils", "hermesModel.ts");
const VIRTUAL_HOME = "/virtual/home";
const MODEL_FILE = path.join(VIRTUAL_HOME, ".hermes", "active-model");

/* ------------------------------------------------------------------ *
 * mock 基础设施
 * ------------------------------------------------------------------ */

/** 内存版 fs：只实现 hermesModel.ts 用到的三个 API。 */
function createMockFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  const state = { failWrites: false, writeCount: 0, writeOrder: [] };
  const api = {
    existsSync(p) {
      return files.has(String(p));
    },
    readFileSync(p) {
      const key = String(p);
      if (!files.has(key)) {
        const err = new Error(
          `ENOENT: no such file or directory, open '${key}'`,
        );
        err.code = "ENOENT";
        throw err;
      }
      return files.get(key);
    },
    writeFileSync(p, data) {
      if (state.failWrites) {
        const err = new Error(`EACCES: permission denied, open '${String(p)}'`);
        err.code = "EACCES";
        throw err;
      }
      state.writeCount += 1;
      state.writeOrder.push(String(data));
      files.set(String(p), String(data));
    },
    __state: state,
    __files: files,
  };
  return api;
}

/** mock LocalStorage：可控延迟（复现并发乱序）与手动释放（复现迁移竞态）。 */
function createMockLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  const log = { getCalls: [], setCalls: [], removeCalls: [], completions: [] };
  const control = {
    /** getItem 的挂起闸门：null = 立即返回；非 null = 等待 release() */
    gate: null,
    setDelayMs: 0,
  };
  const api = {
    async getItem(key) {
      log.getCalls.push(key);
      if (control.gate) {
        await control.gate.promise;
      }
      const v = store.get(key);
      return v === undefined ? undefined : v;
    },
    async setItem(key, value) {
      log.setCalls.push([key, value]);
      if (control.setDelayMs > 0) {
        await new Promise((r) => setTimeout(r, control.setDelayMs));
      }
      store.set(key, value);
      log.completions.push(["set", key, value]);
    },
    async removeItem(key) {
      log.removeCalls.push(key);
      if (control.setDelayMs > 0) {
        await new Promise((r) => setTimeout(r, control.setDelayMs));
      }
      store.delete(key);
      log.completions.push(["remove", key]);
    },
    __store: store,
    __log: log,
    __control: control,
  };
  return api;
}

/** 手动闸门：resolve 后放行被挂起的 await。 */
function createGate() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, release: () => resolve() };
}

/**
 * 载入（重新编译）hermesModel.ts —— 每次都是全新模块实例，
 * 模块级状态（如 LocalStorage 串行队列）互不污染。
 */
function loadHermesModel(mocks) {
  const outputText = transpileSource();
  const m = new Module(SRC, null);
  m.filename = SRC;
  m.paths = Module._nodeModulePaths(path.dirname(SRC));
  const req = (id) =>
    Object.prototype.hasOwnProperty.call(mocks, id) ? mocks[id] : require(id);
  const fn = vm.runInThisContext(Module.wrap(outputText), { filename: SRC });
  fn.call(m.exports, m.exports, req, m, SRC, path.dirname(SRC));
  return m.exports;
}

/**
 * 转译 hermesModel.ts —— 带磁盘缓存。
 * TypeScript 编译器本身加载约 5s，首次转译再约 2.5s；按源码哈希缓存后
 * 重复运行只需毫秒级。缓存键含源码内容与 TS 版本，任一变化即失效。
 */
function transpileSource() {
  const source = fsReal.readFileSync(SRC, "utf8");
  const key = crypto
    .createHash("sha256")
    .update(source)
    .update(typescriptVersion())
    .digest("hex")
    .slice(0, 16);
  const cacheDir = path.join(os.tmpdir(), "agent-executor-raycast-test-cache");
  const cacheFile = path.join(cacheDir, `hermesModel.${key}.js`);
  try {
    return fsReal.readFileSync(cacheFile, "utf8");
  } catch {
    // 缓存未命中 → 转译并写缓存
  }
  // 惰性加载 TypeScript 编译器（仅缓存未命中时才付出约 5s 的加载成本）
  const ts = require("typescript");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
      isolatedModules: true,
    },
    fileName: SRC,
  });
  try {
    fsReal.mkdirSync(cacheDir, { recursive: true });
    fsReal.writeFileSync(cacheFile, outputText, "utf8");
  } catch {
    // 缓存写失败不影响测试
  }
  return outputText;
}

/** 取 TypeScript 版本号（读 package.json，不加载编译器本体）。 */
function typescriptVersion() {
  try {
    const pkgPath = require.resolve("typescript/package.json");
    return (
      JSON.parse(fsReal.readFileSync(pkgPath, "utf8")).version || "unknown"
    );
  } catch {
    return "unknown";
  }
}

/** 组装一套 mock 环境并载入被测模块。 */
function setup({ files = {}, storage = {} } = {}) {
  const mockFs = createMockFs(files);
  const mockStorage = createMockLocalStorage(storage);
  const mod = loadHermesModel({
    fs: mockFs,
    os: { homedir: () => VIRTUAL_HOME },
    "@raycast/api": { LocalStorage: mockStorage },
  });
  return { mod, mockFs, mockStorage };
}

/* ------------------------------------------------------------------ *
 * 迷你测试框架
 * ------------------------------------------------------------------ */

const tests = [];
const only = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function testOnly(name, fn) {
  only.push({ name, fn });
}

async function run() {
  const list = only.length ? only : tests;
  let passed = 0;
  const failures = [];
  const lines = [];
  for (const t of list) {
    try {
      await t.fn();
      passed += 1;
      lines.push(`  ✓ ${t.name}`);
    } catch (err) {
      failures.push({ name: t.name, err });
      lines.push(`  ✗ ${t.name}`);
      lines.push(`      ${err && err.message}`);
    }
  }
  const report = [
    `hermesModel.ts 测试报告 ${new Date().toISOString()}`,
    `结果：${passed}/${list.length} 通过`,
    "",
    ...lines,
  ];
  if (failures.length) {
    report.push("", "失败详情：");
    for (const f of failures) {
      report.push(`- ${f.name}: ${f.err && f.err.stack ? f.err.stack : f.err}`);
    }
  }
  const text = report.join("\n");
  process.stdout.write(`${text}\n`);

  const reportArgIndex = process.argv.indexOf("--report");
  if (reportArgIndex !== -1 && process.argv[reportArgIndex + 1]) {
    fsReal.writeFileSync(process.argv[reportArgIndex + 1], `${text}\n`, "utf8");
    process.stdout.write(`报告已写入：${process.argv[reportArgIndex + 1]}\n`);
  }

  process.exitCode = failures.length ? 1 : 0;
}

/* ------------------------------------------------------------------ *
 * 用例：归一化（多段模型名 / 非法字符）
 * ------------------------------------------------------------------ */

test("normalize 接受多段模型名（真实 sub2api/magpie 形态）", () => {
  const { mod } = setup();
  assert.equal(
    mod.normalizeHermesModel("sub2api/minimax-code/MiniMax-M3.1-Flash"),
    "sub2api/minimax-code/MiniMax-M3.1-Flash",
  );
  assert.equal(
    mod.normalizeHermesModel("magpie/minimax-code/MiniMax-M3.1-Flash"),
    "magpie/minimax-code/MiniMax-M3.1-Flash",
  );
  assert.equal(
    mod.normalizeHermesModel("magpie/group/glm-5.3"),
    "magpie/group/glm-5.3",
  );
  assert.equal(
    mod.normalizeHermesModel("magpie/group/deepseek-v4.1-flash"),
    "magpie/group/deepseek-v4.1-flash",
  );
  assert.equal(
    mod.normalizeHermesModel("magpie/zcode/GLM-5.3-Flash"),
    "magpie/zcode/GLM-5.3-Flash",
  );
  assert.equal(
    mod.normalizeHermesModel("minimax-cn/MiniMax-M3.1-Flash"),
    "minimax-cn/MiniMax-M3.1-Flash",
  );
  assert.equal(mod.normalizeHermesModel("zai/glm-5.3"), "zai/glm-5.3");
});

test("normalize 接受裸模型名与既有特殊字符（[]_ . -）", () => {
  const { mod } = setup();
  assert.equal(mod.normalizeHermesModel("glm-5.3-flash"), "glm-5.3-flash");
  assert.equal(
    mod.normalizeHermesModel("zai_glm-5.3-flash[1M]"),
    "zai_glm-5.3-flash[1M]",
  );
  assert.equal(
    mod.normalizeHermesModel("MiniMax-M3.1-Flash-Preview"),
    "MiniMax-M3.1-Flash-Preview",
  );
  assert.equal(mod.normalizeHermesModel("  glm-5.3  "), "glm-5.3");
});

test("normalize 拒绝可注入字符与畸形路径", () => {
  const { mod } = setup();
  const illegal = [
    "",
    "   ",
    "a b",
    'a"b',
    "a'b",
    "a$b",
    "a`b`",
    "a;b",
    "a|b",
    "a&b",
    "a\nb",
    "a>b",
    "a<b",
    "a(b",
    "a{b",
    "a*b",
    "a?b",
    "a\\b",
    "a:b",
    "a#b",
    "a!b",
    "/leading",
    "trailing/",
    "a//b",
    "a/./b",
    "a/../b",
    "/",
    "//",
    "a/ /b",
    "中文",
    "a".repeat(500),
  ];
  for (const v of illegal) {
    assert.equal(
      mod.normalizeHermesModel(v),
      "",
      `应拒绝: ${JSON.stringify(v)}`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * 用例：buildHermesModelArgs
 * ------------------------------------------------------------------ */

test("buildHermesModelArgs：按首个 / 拆 provider 与完整模型名", () => {
  const { mod } = setup();
  assert.deepEqual(
    mod.buildHermesModelArgs("magpie/minimax-code/MiniMax-M3.1-Flash"),
    ["--provider", "magpie", "-m", "minimax-code/MiniMax-M3.1-Flash"],
  );
  assert.deepEqual(mod.buildHermesModelArgs("magpie/group/glm-5.3"), [
    "--provider",
    "magpie",
    "-m",
    "group/glm-5.3",
  ]);
  assert.deepEqual(mod.buildHermesModelArgs("minimax-cn/MiniMax-M3.1-Flash"), [
    "--provider",
    "minimax-cn",
    "-m",
    "MiniMax-M3.1-Flash",
  ]);
  assert.deepEqual(mod.buildHermesModelArgs("zai/glm-5.3"), [
    "--provider",
    "zai",
    "-m",
    "glm-5.3",
  ]);
});

test("buildHermesModelArgs：裸模型名 / 空 / 默认哨兵 / 非法值", () => {
  const { mod } = setup();
  assert.deepEqual(mod.buildHermesModelArgs("glm-5.3"), ["-m", "glm-5.3"]);
  assert.deepEqual(mod.buildHermesModelArgs(""), []);
  assert.deepEqual(mod.buildHermesModelArgs(undefined), []);
  assert.deepEqual(mod.buildHermesModelArgs(mod.DEFAULT_MODEL_CHOICE), []);
  assert.deepEqual(mod.buildHermesModelArgs('a"b'), []);
  assert.deepEqual(mod.buildHermesModelArgs("a b"), []);
});

/* ------------------------------------------------------------------ *
 * 用例：持久化 / 重开读取
 * ------------------------------------------------------------------ */

test("setSelected 写快路径文件 + LocalStorage，重开可读回", async () => {
  const { mod, mockFs, mockStorage } = setup();
  await mod.setSelectedHermesModel("magpie/minimax-code/MiniMax-M3.1-Flash");
  assert.equal(
    mockFs.__files.get(MODEL_FILE),
    "magpie/minimax-code/MiniMax-M3.1-Flash",
  );
  assert.equal(
    mockStorage.__store.get("hermes-selected-model"),
    "magpie/minimax-code/MiniMax-M3.1-Flash",
  );
  // 重开：同步快路径 + 异步读取都应拿到同一个值
  assert.equal(
    mod.getSelectedHermesModelSync(),
    "magpie/minimax-code/MiniMax-M3.1-Flash",
  );
  assert.equal(
    await mod.getSelectedHermesModel(),
    "magpie/minimax-code/MiniMax-M3.1-Flash",
  );
});

test("dropdownValueToModel：默认哨兵与多段值", () => {
  const { mod } = setup();
  assert.equal(mod.dropdownValueToModel(mod.DEFAULT_MODEL_CHOICE), undefined);
  assert.equal(mod.dropdownValueToModel(""), undefined);
  assert.equal(
    mod.dropdownValueToModel("magpie/minimax-code/MiniMax-M3.1-Flash"),
    "magpie/minimax-code/MiniMax-M3.1-Flash",
  );
  assert.equal(mod.dropdownValueToModel("a b"), undefined);
});

/* ------------------------------------------------------------------ *
 * 用例：空文件 = 权威默认，不复活 LocalStorage 旧值
 * ------------------------------------------------------------------ */

test("文件存在且为空 = 权威默认，不复活 LocalStorage 旧值", async () => {
  const { mod, mockStorage } = setup({
    files: { [MODEL_FILE]: "" },
    storage: { "hermes-selected-model": "magpie/group/glm-5.3" },
  });
  assert.equal(mod.getSelectedHermesModelSync(), "");
  assert.equal(await mod.getSelectedHermesModel(), "");
  // 不得触发 LocalStorage 读取（更不得回写旧值）
  assert.equal(mockStorage.__log.getCalls.length, 0);
  assert.equal(mockStorage.__log.setCalls.length, 0);
});

test("清空选择后重开仍是默认（不复活旧值）", async () => {
  const { mod, mockFs, mockStorage } = setup();
  await mod.setSelectedHermesModel("magpie/group/glm-5.3");
  await mod.setSelectedHermesModel("");
  // 文件被清空（空文件 = 显式默认），LocalStorage 键被移除
  assert.equal(mockFs.__files.get(MODEL_FILE), "");
  assert.equal(mockStorage.__store.has("hermes-selected-model"), false);
  // 模拟 LocalStorage 里残留旧值（历史版本/竞态写回），读取仍必须是默认
  mockStorage.__store.set("hermes-selected-model", "magpie/group/glm-5.3");
  assert.equal(mod.getSelectedHermesModelSync(), "");
  assert.equal(await mod.getSelectedHermesModel(), "");
});

/* ------------------------------------------------------------------ *
 * 用例：迁移（文件缺失才迁移）
 * ------------------------------------------------------------------ */

test("文件缺失时才迁移 LocalStorage 旧值并回写文件", async () => {
  const { mod, mockFs } = setup({
    storage: { "hermes-selected-model": "magpie/group/glm-5.3" },
  });
  assert.equal(await mod.getSelectedHermesModel(), "magpie/group/glm-5.3");
  assert.equal(mockFs.__files.get(MODEL_FILE), "magpie/group/glm-5.3");
});

test("文件缺失 + LocalStorage 也空 = 默认，且不写文件", async () => {
  const { mod, mockFs } = setup();
  assert.equal(await mod.getSelectedHermesModel(), "");
  assert.equal(mockFs.__files.has(MODEL_FILE), false);
});

/* ------------------------------------------------------------------ *
 * 用例：迁移与手动选择竞态
 * ------------------------------------------------------------------ */

test("迁移读旧值期间文件被新选择写入 → 迁移不得覆盖新值", async () => {
  const { mod, mockFs, mockStorage } = setup({
    storage: { "hermes-selected-model": "magpie/group/glm-5.3" },
  });
  const gate = createGate();
  mockStorage.__control.gate = gate;

  const pending = mod.getSelectedHermesModel(); // 异步读旧值，挂起
  await new Promise((r) => setTimeout(r, 0));

  // 期间用户手动选了新模型（新值先落盘）
  await mod.setSelectedHermesModel("magpie/minimax-code/MiniMax-M3.1-Flash");
  const writesBeforeRelease = mockFs.__state.writeCount;

  gate.release();
  const resolved = await pending;

  // 新值不被旧值覆盖
  assert.equal(
    mockFs.__files.get(MODEL_FILE),
    "magpie/minimax-code/MiniMax-M3.1-Flash",
  );
  assert.equal(resolved, "magpie/minimax-code/MiniMax-M3.1-Flash");
  // 迁移没有额外写文件
  assert.equal(mockFs.__state.writeCount, writesBeforeRelease);
});

test("迁移读旧值期间用户清空选择（空文件）→ 不被旧值复活", async () => {
  const { mod, mockFs, mockStorage } = setup({
    storage: { "hermes-selected-model": "magpie/group/glm-5.3" },
  });
  const gate = createGate();
  mockStorage.__control.gate = gate;

  const pending = mod.getSelectedHermesModel();
  await new Promise((r) => setTimeout(r, 0));
  await mod.setSelectedHermesModel(""); // 用户显式回到默认
  gate.release();
  const resolved = await pending;

  assert.equal(mockFs.__files.get(MODEL_FILE), "");
  assert.equal(resolved, "");
});

test("LocalStorage 为空但迁移期间文件被写入 → 不得返回旧值或覆盖新值", async () => {
  const { mod, mockFs, mockStorage } = setup();
  const gate = createGate();
  mockStorage.__control.gate = gate;

  const pending = mod.getSelectedHermesModel(); // LocalStorage 为空，挂起
  await new Promise((r) => setTimeout(r, 0));
  // 期间用户手动选了新模型
  await mod.setSelectedHermesModel("magpie/minimax-code/MiniMax-M3.1-Flash");
  gate.release();
  const resolved = await pending;

  assert.equal(
    mockFs.__files.get(MODEL_FILE),
    "magpie/minimax-code/MiniMax-M3.1-Flash",
  );
  assert.equal(resolved, "magpie/minimax-code/MiniMax-M3.1-Flash");
});

test("LocalStorage 为空且迁移期间无新写入 → 返回默认且不写文件", async () => {
  const { mod, mockFs, mockStorage } = setup();
  const gate = createGate();
  mockStorage.__control.gate = gate;

  const pending = mod.getSelectedHermesModel();
  await new Promise((r) => setTimeout(r, 0));
  gate.release();
  const resolved = await pending;

  assert.equal(resolved, "");
  assert.equal(mockFs.__files.has(MODEL_FILE), false);
});

/* ------------------------------------------------------------------ *
 * 用例：快速连续选择（LocalStorage 按序完成，文件即时）
 * ------------------------------------------------------------------ */

test("快速连续保存：LocalStorage 按调用顺序完成，文件即时生效", async () => {
  const { mod, mockFs, mockStorage } = setup();
  mockStorage.__control.setDelayMs = 5; // 制造完成乱序的可能

  const a = mod.setSelectedHermesModel("magpie/group/glm-5.3");
  const b = mod.setSelectedHermesModel("magpie/group/glm-5.3-flash");
  const c = mod.setSelectedHermesModel(
    "magpie/minimax-code/MiniMax-M3.1-Flash",
  );

  // 同步文件立即生效（最后一次调用即最终值）
  assert.equal(
    mockFs.__files.get(MODEL_FILE),
    "magpie/minimax-code/MiniMax-M3.1-Flash",
  );

  await Promise.all([a, b, c]);

  const completions = mockStorage.__log.completions.map((c2) => c2[2]);
  assert.deepEqual(completions, [
    "magpie/group/glm-5.3",
    "magpie/group/glm-5.3-flash",
    "magpie/minimax-code/MiniMax-M3.1-Flash",
  ]);
  assert.equal(
    mockStorage.__store.get("hermes-selected-model"),
    "magpie/minimax-code/MiniMax-M3.1-Flash",
  );
});

test("快速连续保存含「回到默认」：LocalStorage 最终为移除状态", async () => {
  const { mod, mockStorage } = setup();
  mockStorage.__control.setDelayMs = 5;
  const a = mod.setSelectedHermesModel("magpie/group/glm-5.3");
  const b = mod.setSelectedHermesModel("");
  await Promise.all([a, b]);
  assert.equal(mockStorage.__store.has("hermes-selected-model"), false);
  assert.deepEqual(
    mockStorage.__log.completions.map((x) => x[0]),
    ["set", "remove"],
  );
});

/* ------------------------------------------------------------------ *
 * 用例：入口校验与写失败兜底
 * ------------------------------------------------------------------ */

test("setSelected 入口校验：非法值抛错，既有选择不被破坏", async () => {
  const { mod, mockFs, mockStorage } = setup();
  await mod.setSelectedHermesModel("magpie/group/glm-5.3");
  const writesBefore = mockFs.__state.writeCount;

  const illegal = ['magpie/group/glm-5.3"; rm -rf /', "a b", "a//b"];
  for (const v of illegal) {
    await assert.rejects(
      () => mod.setSelectedHermesModel(v),
      (err) => {
        // 错误信息不得回显原始输入（可能是任意用户输入）
        assert.ok(!String(err.message).includes(v), "错误信息不应含原始值");
        return true;
      },
    );
  }

  assert.equal(mockFs.__files.get(MODEL_FILE), "magpie/group/glm-5.3");
  assert.equal(mockFs.__state.writeCount, writesBefore);
  assert.equal(
    mockStorage.__store.get("hermes-selected-model"),
    "magpie/group/glm-5.3",
  );
  assert.equal(mockStorage.__log.setCalls.length, 1);
});

test("文件写失败不致命：LocalStorage 仍保存选择", async () => {
  const { mod, mockFs, mockStorage } = setup();
  mockFs.__state.failWrites = true;
  await mod.setSelectedHermesModel("magpie/group/glm-5.3");
  assert.equal(
    mockStorage.__store.get("hermes-selected-model"),
    "magpie/group/glm-5.3",
  );
});

test("setSelected 接受多段模型名并原样落盘", async () => {
  const { mod, mockFs } = setup();
  await mod.setSelectedHermesModel(
    "  magpie/minimax-code/MiniMax-M3.1-Flash  ",
  );
  assert.equal(
    mockFs.__files.get(MODEL_FILE),
    "magpie/minimax-code/MiniMax-M3.1-Flash",
  );
});

/* ------------------------------------------------------------------ *
 * 用例：清单解析（多段模型名出现在 config 时下拉仍可用）
 * ------------------------------------------------------------------ */

test("loadHermesModelCatalog 读取多段模型名清单", () => {
  const configPath = path.join(VIRTUAL_HOME, ".hermes", "config.yaml");
  const yaml = [
    "model:",
    "  provider: magpie",
    "  default: group/deepseek-v4.1-flash",
    "providers:",
    "  magpie:",
    "    models:",
    "      - group/glm-5.3",
    "      - minimax-code/MiniMax-M3.1-Flash",
    "",
  ].join("\n");
  const { mod } = setup({ files: { [configPath]: yaml } });
  const catalog = mod.loadHermesModelCatalog();
  assert.ok(catalog);
  assert.equal(catalog.defaultProvider, "magpie");
  assert.equal(catalog.defaultModel, "group/deepseek-v4.1-flash");
  assert.deepEqual(catalog.providers[0].models, [
    "group/glm-5.3",
    "minimax-code/MiniMax-M3.1-Flash",
  ]);
});

run();
