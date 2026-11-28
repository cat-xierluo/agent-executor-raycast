const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const YAML = require("yaml");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "dsh consumer with spaces-"),
);
const modules = new Map();
let preferences = {};
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const mod = { exports: {} };
  modules.set(filename, mod);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const localRequire = (id) => {
    if (id === "@raycast/api") {
      return { getPreferenceValues: () => preferences, LocalStorage: {} };
    }
    if (id.startsWith(".")) {
      return load(path.resolve(path.dirname(filename), `${id}.ts`));
    }
    return require(id);
  };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, {
    filename,
  })(localRequire, mod, mod.exports);
  return mod.exports;
}

async function main() {
  const dsh = load(path.join(root, "src/utils/deepseek.ts"));
  const claude = load(path.join(root, "src/utils/claude.ts"));
  const profile = path.join(temp, "profiles/desktop");
  fs.mkdirSync(profile, { recursive: true });
  const profileFile = path.join(profile, "cordis.patch.yml");
  const fixture = `
- id: llm-pi-ai
  config:
    providers:
      test:
        apiKeyEnv: TEST_KEY_REFERENCE
        baseURL: http://localhost:1234/v1
        models: [{ id: "group/test" }]
- id: agent-default-model
  config: { provider: test, model: group/test, reasoningEffort: high }
- id: ui-chat
  config: { arbitrary: !!js "process.env.NEVER_EVALUATE" }
`;
  fs.writeFileSync(profileFile, fixture);
  const patch = YAML.parse(dsh.buildDshPatch("desktop", temp));
  assert.equal(
    patch.find((r) => r.id === "ui-chat"),
    undefined,
  );
  assert.equal(
    patch.find((r) => r.id === "agent-default-model").config.reasoningEffort,
    "high",
  );
  assert.equal(patch.find((r) => r.id === "credentials").disabled, false);
  assert.equal(
    patch.find((r) => r.id === "permission").config.defaultPreset,
    "danger-full-access",
  );
  assert.throws(() => dsh.buildDshPatch("../desktop", temp));
  assert.throws(() => dsh.buildDshPatch("missing", temp));
  fs.mkdirSync(path.join(temp, "profiles/empty"), { recursive: true });
  fs.writeFileSync(path.join(temp, "profiles/empty/cordis.patch.yml"), "[]\n");
  assert.throws(() => dsh.buildDshPatch("empty", temp), /未包含 llm-pi-ai/);
  fs.writeFileSync(
    path.join(temp, "profiles/empty/cordis.patch.yml"),
    "- id: web-search-deepseek\n  config: { model: group/test }\n",
  );
  assert.throws(() => dsh.buildDshPatch("empty", temp), /未包含 llm-pi-ai/);
  fs.writeFileSync(
    profileFile,
    "- id: llm-pi-ai\n  config: { baseURL: !!js process.env.TEST_URL }\n",
  );
  assert.match(dsh.buildDshPatch("desktop", temp), /!!js/);
  fs.writeFileSync(
    profileFile,
    "- id: llm-pi-ai\n  config: &shared { providers: {} }\n",
  );
  assert.throws(() => dsh.buildDshPatch("desktop", temp), /锚点/);
  fs.writeFileSync(profileFile, fixture);

  // Exercise actual child-process pipes, argv, stdin and split UTF-8 bytes.
  const fake = path.join(temp, "dsh");
  fs.symlinkSync(process.execPath, path.join(temp, "node"));
  fs.writeFileSync(
    fake,
    `#!/bin/sh
exec node "$0.js" "$@"
`,
    { mode: 0o700 },
  );
  fs.writeFileSync(
    `${fake}.js`,
    `#!${process.execPath}
const fs = require("fs");
const assert = require("assert/strict");
assert.deepEqual(process.argv.slice(2, 5), ["--profile", "headless", "--patch"]);
assert.equal(process.argv[6], "--json");
const pgid = require("child_process")
  .execSync("ps -o pgid= -p " + process.pid)
  .toString()
  .trim();
assert.equal(pgid, String(process.pid), "child must own its process group");
assert.ok(process.env.PATH.includes("/usr/bin:/bin"));
const patch = fs.readFileSync(process.argv[5], "utf8");
assert.match(patch, /defaultPreset: danger-full-access/);
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", x => prompt += x);
process.stdin.on("end", () => {
  const isResume = process.argv.includes("--session-id");
  if (isResume) {
    assert.equal(process.argv[7], "--session-id");
    assert.equal(process.argv[8], "session-fixture");
    assert.equal(prompt, "继续");
  } else {
    assert.match(prompt, /preamble/);
    assert.doesNotMatch(prompt, /skill-body/, "SKILL.md body must not be embedded");
    assert.match(prompt, /literal \\$\\(echo unsafe\\)/);
  }
  const emit = x => process.stdout.write(JSON.stringify(x) + "\\n");
  emit({type:"session", sessionId:"session-fixture", cwd:process.cwd()});
  emit({type:"tool_call", tool:"read"});
  if (process.env.TEST_MODE === "crash") process.exit(2);
  if (process.env.TEST_MODE === "orphan-pipe") {
    require("child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 1500)"], {stdio: ["ignore", "inherit", "inherit"]});
    process.exit(0);
  }
  if (process.env.TEST_MODE === "disposed" && !isResume) {
    emit({type:"status", phase:"turn_end", reason:{kind:"aborted", reason:{kind:"disposed"}}});
    process.exit(0);
  }
  emit({type:"status", phase:"turn_end", reason:{kind:process.env.TEST_MODE === "failed" ? "error" : "completed"}});
  if (process.env.TEST_MODE === "missing-final") process.exit(0);
  const text = JSON.stringify({type:"text", text:"中文结果"}) + "\\n";
  const bytes = Buffer.from(text);
  for (let i = 0; i < bytes.length; i++) process.stdout.write(bytes.subarray(i,i+1));
  process.stderr.write("diagnostic only\\n");
  emit({type:"final", text:process.env.TEST_MODE === "long" ? "X".repeat(20000) : "中文结果"});
  if (process.env.TEST_MODE === "failed") process.exitCode = 1;
});
`,
    { mode: 0o700 },
  );
  const base = {
    backend: "dsh",
    projectDir: temp,
    workDir: temp,
    dshBin: fake,
    dshConfigProfile: "desktop",
    prompt: "literal $(echo unsafe)",
  };
  const env = {
    ...process.env,
    DSH_HOME: temp,
    PATH: "",
    DSH_TEST_DETACHED: "1",
  };
  for (const mode of [
    "ok",
    "long",
    "failed",
    "crash",
    "orphan-pipe",
    "missing-final",
    "disposed",
  ]) {
    const chunks = [];
    const sessions = [];
    const result = await dsh.executeDsh(
      { ...base, onChunk: (text, final) => chunks.push({ text, final }) },
      { ...env, TEST_MODE: mode },
      "preamble",
      {
        startRealtimeLogging() {},
        logRealtime() {},
        logSession(id) {
          sessions.push(id);
        },
      },
    );
    assert.equal(result.sessionId, "session-fixture", result.output);
    assert.deepEqual(
      sessions,
      mode === "disposed"
        ? ["session-fixture", "session-fixture"]
        : ["session-fixture"],
    );
    assert.equal(chunks.filter((c) => c.final).length, mode === "disposed" ? 2 : 1);
    assert.equal(
      result.success,
      mode === "ok" || mode === "long" || mode === "disposed",
      `mode=${mode} output=${result.output}`,
    );
    assert.equal(result.apiSuccess, result.success, `mode=${mode}`);
    if (mode === "disposed") {
      assert.equal(result.exitCode, 0);
      assert.match(result.output, /中文结果/);
    }
    if (mode === "ok") {
      assert.equal(result.output, "中文结果");
      assert.equal(chunks.filter((c) => c.text === "中文结果\n").length, 1);
      assert.equal(
        chunks.some((c) => c.text.includes("�")),
        false,
      );
    }
    if (mode === "long") assert.equal(result.output.length, 20000);
    if (mode === "missing-final") assert.notEqual(result.exitCode, 0);
  }
  const missing = await dsh.executeDsh(
    { ...base, dshBin: path.join(temp, "not-installed") },
    env,
    "preamble",
  );
  assert.equal(missing.success, false);
  assert.match(missing.error, /ENOENT/);
  const preSpawnChunks = [];
  const preSpawn = await dsh.executeDsh(
    {
      ...base,
      dshConfigProfile: "empty",
      onChunk: (text, final) => preSpawnChunks.push({ text, final }),
    },
    env,
    "preamble",
  );
  assert.equal(preSpawn.success, false);
  assert.match(preSpawn.output, /未包含 llm-pi-ai/);
  assert.equal(preSpawnChunks.at(-1).final, true);

  const savedHome = process.env.DSH_HOME;
  process.env.DSH_HOME = temp;
  preferences = { headlessPreamble: "preamble" };
  try {
    for (const execute of [
      claude.executeClaudeCommand,
      claude.executeClaudeStreaming,
    ]) {
      const result = await execute(base);
      assert.equal(result.success, true);
      assert.equal(result.sessionId, "session-fixture");
    }
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = savedHome;
  }
  const state = { final: false };
  dsh.consumeDshEvent("not json", state);
  assert.equal(dsh.dshRunSucceeded(state, 0), false);
  dsh.consumeDshEvent('{"type":"final","text":""}', state);
  assert.equal(state.final, true);

  // A skill run names the skill directory only: no SKILL.md body in the prompt.
  const skillDir = path.join(temp, "skills", "video-compressor");
  fs.mkdirSync(skillDir, { recursive: true });
  const skillFile = path.join(skillDir, "SKILL.md");
  const skillBody = "SKILL_BODY_MARKER do not embed me ".repeat(200).trim();
  fs.writeFileSync(skillFile, `---\nname: video-compressor\n---\n\n${skillBody}\n`);
  const skillHint = dsh.buildDshSkillHint(skillFile);
  assert.match(skillHint, /技能目录：.*skills\/video-compressor/);
  assert.match(skillHint, /SKILL\.md/);
  assert.doesNotMatch(skillHint, /SKILL_BODY_MARKER/);
  const skillPrompt = dsh.buildDshPrompt(
    "/video-compressor input.mp4",
    "preamble",
    skillHint,
  );
  assert.match(skillPrompt, /\/video-compressor input\.mp4/);
  assert.match(skillPrompt, /# 本次任务/);
  assert.doesNotMatch(skillPrompt, /SKILL_BODY_MARKER/);
  assert.ok(
    skillPrompt.length < 1200,
    `skill prompt should stay short, got ${skillPrompt.length} chars`,
  );

  let skillRunPrompt = "";
  fs.writeFileSync(
    path.join(temp, "dsh-skill.skill.js"),
    `#!${process.execPath}
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", x => prompt += x);
process.stdin.on("end", () => {
  require("fs").writeFileSync(process.env.SKILL_PROMPT_OUT, prompt);
  const emit = x => process.stdout.write(JSON.stringify(x) + "\\n");
  emit({type:"session", sessionId:"session-skill"});
  emit({type:"status", phase:"turn_end", reason:{kind:"completed"}});
  emit({type:"final", text:"中文结果"});
});
`,
    { mode: 0o700 },
  );
  fs.writeFileSync(
    path.join(temp, "dsh-skill"),
    `#!/bin/sh
exec node "$0.skill.js" "$@"
`,
    { mode: 0o700 },
  );
  const skillPromptOut = path.join(temp, "skill-prompt.txt");
  const skillResult = await dsh.executeDsh(
    {
      ...base,
      dshBin: path.join(temp, "dsh-skill"),
      skillFile,
      prompt: "/video-compressor input.mp4",
    },
    { ...env, SKILL_PROMPT_OUT: skillPromptOut },
    "preamble",
  );
  assert.equal(skillResult.success, true, skillResult.output);
  skillRunPrompt = fs.readFileSync(skillPromptOut, "utf8");
  assert.match(skillRunPrompt, /技能目录：.*skills\/video-compressor/);
  assert.doesNotMatch(skillRunPrompt, /SKILL_BODY_MARKER/);
  console.log(
    "PASS: DSH config isolation, native argv/stdin, UTF-8, final integrity, failure/early/orphan-pipe exit, both execution entry points, skill path hint without body",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }));
