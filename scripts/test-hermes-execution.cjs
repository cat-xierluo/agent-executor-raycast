const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-execution-test-"));
const calls = [];
const scripts = [];
const modules = new Map();

function loadModule(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const mod = { exports: {} };
  modules.set(filename, mod);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const requireMock = (id) => {
    if (id === "@raycast/api") {
      return {
        getPreferenceValues: () => ({}),
        LocalStorage: {
          getItem: async () => undefined,
          setItem: async () => {},
          removeItem: async () => {},
        },
      };
    }
    if (id === "./hermesSkills") {
      return { canPreloadHermesSkill: async () => false };
    }
    if (id === "child_process") {
      return {
        spawn(binary, args, options) {
          calls.push({ binary, args, options });
          const child = new EventEmitter();
          child.pid = 12345;
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.kill = () => {};
          setImmediate(() => {
            child.stdout.emit(
              "data",
              Buffer.from("MODEL_SELECTION_OK\nsession_id: model-test\n"),
            );
            child.stdout.emit("end");
            child.emit("close", 0);
          });
          return child;
        },
        execSync(command) {
          assert.match(command, /^osascript /);
        },
      };
    }
    if (id === "os") return { ...os, homedir: () => temp, tmpdir: () => temp };
    if (id === "fs") {
      return {
        ...fs,
        writeFileSync(filename, data, ...rest) {
          if (filename.endsWith(".sh")) scripts.push(data);
          return fs.writeFileSync(filename, data, ...rest);
        },
      };
    }
    if (id.startsWith(".")) {
      return loadModule(path.resolve(path.dirname(filename), `${id}.ts`));
    }
    return require(id);
  };
  const run = vm.runInThisContext(
    `(function(require, module, exports, setTimeout) { ${source}\n})`,
    { filename },
  );
  run(requireMock, mod, mod.exports, (callback, delay) => {
    // Execute terminal cleanup without delaying the test by five seconds.
    return setTimeout(callback, delay === 5000 ? 0 : delay);
  });
  return mod.exports;
}

async function main() {
  const { executeClaudeCommand, executeClaudeStreaming, buildHermesArgs } =
    loadModule(path.join(root, "src/utils/claude.ts"));
  const model = "magpie/minimax-code/MiniMax-M3.1-Flash";
  const base = {
    backend: "hermes",
    projectDir: temp,
    hermesBin: "/test/hermes",
    hermesProfileHome: path.join(temp, "profile"),
    hermesModel: model,
    prompt: "Model routing test",
    headlessMode: true,
  };
  const expected = [
    "--provider",
    "magpie",
    "-m",
    "minimax-code/MiniMax-M3.1-Flash",
  ];
  assert.deepEqual(
    buildHermesArgs("test", temp, "", "", "", model).slice(-4),
    expected,
  );
  for (const execute of [executeClaudeCommand, executeClaudeStreaming]) {
    const result = await execute(base);
    assert.equal(result.success, true);
    assert.equal(result.sessionId, "model-test");
    const call = calls.at(-1);
    assert.equal(call.binary, "/test/hermes");
    assert.deepEqual(call.args.slice(-4), expected);
    assert.equal(call.options.env.HERMES_HOME, base.hermesProfileHome);
  }
  const defaultResult = await executeClaudeCommand({
    ...base,
    hermesModel: undefined,
  });
  assert.equal(defaultResult.success, true);
  assert.equal(calls.at(-1).args.includes("--provider"), false);
  assert.equal(calls.at(-1).args.includes("-m"), false);
  const visible = await executeClaudeCommand({ ...base, headlessMode: false });
  assert.equal(visible.success, true);
  assert.match(
    scripts.at(-1),
    /"--provider" "magpie" "-m" "minimax-code\/MiniMax-M3\.1-Flash"/,
  );
  await testFreeCommandBackend();
  console.log(
    "PASS: headless, streaming, default, terminal and free-command backend routing",
  );
}

async function testFreeCommandBackend() {
  const filename = path.join(root, "src/commands.tsx");
  const source = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let command;
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "executeFreeCommand"
    ) {
      command = node.getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(command);
  const noop = () => {};
  let captured;
  const context = {
    console,
    processingCommand: [],
    note: "routing test",
    parseNoteInput: (note) => ({ note }),
    selectedFiles: [],
    setProcessingCommand: noop,
    showToast: async () => ({ hide: async () => {} }),
    Toast: { Style: { Animated: "animated", Failure: "failure" } },
    getConfig: () => ({ projectDirs: [temp], headlessMode: true }),
    selectedBackend: "hermes",
    activeProfileHome: path.join(temp, "profile"),
    hermesModelChoice: "magpie/minimax-code/MiniMax-M3.1-Flash",
    dropdownValueToModel: (value) => value,
    countRunningCommands: () => 0,
    getConcurrencyLimit: () => 5,
    RunLogger: class {
      logValidated() {}
      logCompleted() {}
    },
    executeClaudeCommand: async (options) => {
      captured = options;
      return { success: false, output: "", exitCode: 1 };
    },
    recordExecution: noop,
    activePids: { current: {} },
    loadRunningCount: noop,
    invalidateSkillsCache: noop,
    loadSkills: noop,
    triggerStatusRefresh: noop,
    scheduleNext: noop,
    setQueuedTasks: noop,
    getQueuedTasks: () => [],
  };
  vm.createContext(context);
  const compiled = ts.transpileModule(command, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInContext(compiled, context);
  await context.executeFreeCommand({ type: "action" });
  assert.equal(captured?.backend, "hermes");
  assert.equal(captured?.hermesModel, context.hermesModelChoice);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(temp, { recursive: true, force: true });
  });
