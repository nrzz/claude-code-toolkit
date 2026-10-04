// The command line: one-shot install, uninstall and status, and the terminal checklist.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { main, parseArgs, pickTools, optionsFromFlags } from "../src/cli.mjs";
import { readState } from "../src/state.mjs";
import { terminalSetup } from "../src/tui.mjs";
import { sandbox, fakeTools, installedSettings, writeJson } from "./helpers.mjs";

function sink() {
  let text = "";
  return { write: (s) => { text += s; return true; }, get text() { return text; } };
}
async function run(argv, env, cwd) {
  const out = sink();
  const err = sink();
  const code = await main(argv, { out, err, env, cwd });
  return { code, out: out.text, err: err.text };
}

test("arguments: tools by name, groups and aliases; flags as each tool's options", () => {
  assert.deepEqual(parseArgs(["install", "glow,notify", "--theme", "nord", "--no-ui-theme", "--daily=20usd"]), { _: ["install", "glow,notify"], flags: { theme: "nord", "no-ui-theme": true, daily: "20usd" } });
  assert.throws(() => parseArgs(["install", "--theme"]), /needs a value/);
  assert.deepEqual(pickTools(["recommended"]), ["guardrails", "notify", "glow"]);
  assert.deepEqual(pickTools(["starter", "cost", "guardrails"]), ["guardrails", "cost-guard", "starter-kits"]);
  assert.equal(pickTools(["all"]).length, 7);
  assert.throws(() => pickTools(["md-doctor"]), /no tool "md-doctor"/);
  assert.deepEqual(optionsFromFlags("glow", { theme: "nord", "no-ui-theme": true }), { theme: "nord", uiTheme: false });
  assert.deepEqual(optionsFromFlags("notify", { ntfy: "auto", "min-turn-seconds": "45" }), { ntfy: "auto", minTurnSeconds: 45 });
});

test("install runs the tools' own commands with the options given, then says what to do next", async () => {
  const { env, project } = sandbox();
  const tools = fakeTools();
  const r = await run(["install", "recommended,cost-guard", "--source", tools.dir, "--preset", "strict", "--theme", "nord", "--daily", "$15", "--project", project], env, project);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(tools.calls().map((c) => [c.repo.replace("claude-", ""), ...c.args]), [
    ["code-guardrails", "init", "--preset", "strict", "--scope", "user"],
    ["code-notify", "init"],
    ["code-notify", "set", "desktop", "on"],
    ["code-glow", "install", "--theme", "nord", "--icons", "unicode"],
    ["cost-guard", "init"],
    ["cost-guard", "budget", "set", "--daily", "15usd", "--mode", "soft"],
  ]);
  assert.match(r.out, /- Install Guardrails \.\.\. done/);
  assert.match(r.out, /Start a new Claude Code session/);
});

test("install refuses bad options before anything runs, and leaves glow out over another status line", async () => {
  const { env, project } = sandbox({ statusLine: { type: "command", command: "mine.sh" } });
  const tools = fakeTools();
  const bad = await run(["install", "guardrails", "--source", tools.dir, "--preset", "max"], env, project);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /preset must be one of/);
  assert.deepEqual(tools.calls(), []);
  const r = await run(["install", "recommended", "--source", tools.dir], env, project);
  assert.match(r.out, /Glow is left out: you already have a status line/);
  assert.equal(tools.calls().some((c) => c.repo === "claude-code-glow"), false);
  await run(["install", "glow", "--source", tools.dir], env, project);
  assert.equal(tools.calls().some((c) => c.repo === "claude-code-glow"), true, "named, it is installed");
});

test("uninstall all removes what is installed; status describes it", async () => {
  const { env, cfg, project } = sandbox(null);
  writeJson(path.join(cfg, "settings.json"), installedSettings(cfg));
  writeJson(path.join(cfg, "guardrails.json"), { preset: "relaxed" });
  const tools = fakeTools();
  const status = await run(["status", "--project", project], env, project);
  assert.match(status.out, /Guardrails\s+installed \(preset relaxed\)/);
  assert.match(status.out, /Cost guard\s+installed \(no budget set\)/);
  const r = await run(["uninstall", "all", "--source", tools.dir], env, project);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(tools.calls().map((c) => c.args.join(" ")), ["uninstall --scope user", "uninstall", "uninstall", "uninstall"]);
});

test("a settings.json that is not JSON stops install before anything runs", async () => {
  const { env, cfg, project } = sandbox(null);
  fs.writeFileSync(path.join(cfg, "settings.json"), "{ broken");
  const tools = fakeTools();
  const r = await run(["install", "guardrails", "--source", tools.dir], env, project);
  assert.equal(r.code, 1);
  assert.match(r.err, /not valid JSON/);
  assert.deepEqual(tools.calls(), []);
});

test("help, version and unknown commands", async () => {
  const { env, project } = sandbox();
  assert.match((await run(["--help"], env, project)).out, /npx -y github:nrzz\/claude-code-toolkit/);
  assert.match((await run(["-v"], env, project)).out, /^\d+\.\d+\.\d+\n$/);
  assert.equal((await run(["frobnicate"], env, project)).code, 2);
});

test("the terminal checklist: Enter keeps the recommended set, numbers switch tools, answers are checked", async () => {
  const { env, project } = sandbox();
  const tools = fakeTools();
  const state = readState({ env, project });
  // 4 switches cost guard on; then: preset (a bad one, then strict), desktop, ntfy, theme, daily, weekly, hard stop, go ahead.
  const answers = ["4", "", "max", "strict", "", "n", "nord", "10usd", "", "y", "y"];
  const rl = { question: async () => answers.shift() ?? "" };
  const out = sink();
  let ran = null;
  const code = await terminalSetup({ rl, out, state, ctx: { project, glowThemes: [{ slug: "classic" }, { slug: "nord" }] }, run: async (steps) => { ran = steps; return 0; } });
  assert.equal(code, 0);
  assert.match(out.text, /preset must be one of/, "a bad answer is asked again");
  assert.deepEqual(ran.map((s) => [s.tool, ...s.args]), [
    ["guardrails", "init", "--preset", "strict", "--scope", "user"],
    ["notify", "init"],
    ["notify", "set", "desktop", "on"],
    ["glow", "install", "--theme", "nord", "--icons", "unicode"],
    ["cost-guard", "init"],
    ["cost-guard", "budget", "set", "--daily", "10usd", "--mode", "hard"],
  ]);
  assert.deepEqual(tools.calls(), [], "the checklist only plans; running is the caller's");
});

test("the terminal checklist can be left without changing anything", async () => {
  const { env, project } = sandbox();
  const out = sink();
  const answers = ["q"];
  const code = await terminalSetup({ rl: { question: async () => answers.shift() }, out, state: readState({ env, project }), ctx: { project }, run: async () => { throw new Error("must not run"); } });
  assert.equal(code, 0);
  assert.match(out.text, /Nothing changed/);
});

test("setup with no browser to open asks in the terminal instead", async () => {
  const { env, project } = sandbox();
  const tools = fakeTools();
  const stdin = new PassThrough();
  stdin.end("q\n");
  const out = sink();
  const err = sink();
  const code = await main(["setup", "--source", tools.dir], { out, err, env: { ...env, CLAUDE_TOOLKIT_NO_BROWSER: "1" }, cwd: project, stdin });
  assert.equal(code, 0, err.text);
  assert.match(out.text, /Press Enter to go on/);
  assert.match(out.text, /Nothing changed/);
  assert.deepEqual(tools.calls(), []);
});
