// Reading what is installed: hooks in settings.json, each tool's own settings file, plugins, the
// project folder; secrets masked; and which switches start on.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readState, defaultChoices } from "../src/state.mjs";
import { sandbox, installedSettings, writeJson } from "./helpers.mjs";

test("a fresh config: nothing installed, and the recommended tools start switched on", () => {
  const { env, project } = sandbox();
  const s = readState({ env, project });
  for (const id of ["guardrails", "notify", "glow", "cost-guard"]) assert.equal(s.tools[id].installed, false, id);
  const c = defaultChoices(s);
  assert.deepEqual(Object.entries(c).filter(([, x]) => x.enabled).map(([id]) => id), ["guardrails", "notify", "glow"]);
  assert.equal(s.project.exists, true);
  assert.equal(s.project.isGit, false);
});

test("installed tools are found from their hooks, with their own settings read back", () => {
  const { env, cfg, project } = sandbox(null);
  writeJson(path.join(cfg, "settings.json"), installedSettings(cfg));
  writeJson(path.join(cfg, "guardrails.json"), { preset: "strict" });
  writeJson(path.join(cfg, "notify.json"), { desktop: true, slack: { url: "https://hooks.slack.com/services/T/B/secretabcd" }, ntfy: { topic: "claude-topic-wxyz" }, quiet: "22:00-07:00", minTurnSeconds: 45 });
  writeJson(path.join(cfg, "cost-guard", "budgets.json"), { version: 1, global: { daily: { unit: "usd", amount: 20 }, weekly: { unit: "tokens", amount: 3000000 }, mode: "hard" }, projects: [] });
  writeJson(path.join(cfg, "claude-code-glow", "config.json"), { theme: "nord", icons: "nerd", uiTheme: false });
  const s = readState({ env, project });
  assert.deepEqual(["guardrails", "notify", "glow", "cost-guard"].map((id) => s.tools[id].installed), [true, true, true, true]);
  assert.deepEqual(s.tools.guardrails.current, { preset: "strict" });
  assert.deepEqual(s.tools.glow.current, { theme: "nord", icons: "nerd", uiTheme: false });
  assert.deepEqual(s.tools["cost-guard"].current, { daily: "20usd", weekly: "3M", mode: "hard" });
  const n = s.tools.notify.current;
  assert.equal(n.slack, "set (…abcd)", "a webhook is never shown whole");
  assert.equal(n.ntfy, "set (…wxyz)", "nor an ntfy topic, which works like a password");
  assert.equal(JSON.stringify(s.tools).includes("secretabcd"), false);
  assert.equal(s.secrets.notify.slack, "https://hooks.slack.com/services/T/B/secretabcd", "the real value stays on the server for comparing");
  const c = defaultChoices(s);
  assert.equal(c.notify.options.slack, "", "a kept secret starts empty, which means keep");
  assert.equal(c["cost-guard"].enabled, true);
  assert.equal(c.handover.enabled, false);
});

test("after the first setup the switches show what is installed: a removed tool is not offered again", () => {
  const { env, cfg, project } = sandbox(null);
  const settings = installedSettings(cfg);
  delete settings.statusLine;
  settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.slice(1); // notify removed, cost guard kept
  writeJson(path.join(cfg, "settings.json"), settings);
  const c = defaultChoices(readState({ env, project }));
  assert.deepEqual(Object.entries(c).filter(([, x]) => x.enabled).map(([id]) => id), ["guardrails", "cost-guard"]);
});

test("glow is not switched on over someone else's status line; plugins are recognised", () => {
  const { env, project } = sandbox({ statusLine: { type: "command", command: "my-statusline.sh" }, enabledPlugins: { "guardrails@claude-code-toolkit": true, "notify@claude-code-toolkit": false } });
  const s = readState({ env, project });
  assert.equal(s.tools.glow.otherStatusLine, true);
  assert.equal(s.tools.guardrails.plugin, true);
  assert.equal(s.tools.notify.plugin, false, "a disabled plugin does not count");
  const c = defaultChoices(s);
  assert.equal(c.glow.enabled, false);
  assert.equal(c.guardrails.enabled, false, "left to /plugin");
});

test("project tools are read from the project folder; git and its remote are noticed", () => {
  const { env, project } = sandbox();
  fs.writeFileSync(path.join(project, "HANDOVER.md"), "# Handover\n");
  writeJson(path.join(project, ".claude", "team-sync.json"), { hub: "branch" });
  const git = (...a) => spawnSync("git", a, { cwd: project, encoding: "utf8" });
  git("init", "-q");
  let s = readState({ env, project });
  assert.equal(s.tools.handover.installed, true);
  assert.equal(s.tools["team-sync"].installed, true);
  assert.equal(s.tools["starter-kits"].installed, false);
  assert.deepEqual([s.project.isGit, s.project.hasRemote], [true, false]);
  git("remote", "add", "origin", "https://example.com/x.git");
  s = readState({ env, project });
  assert.equal(s.project.hasRemote, true);
  assert.equal(readState({ env, project: path.join(project, "missing") }).project.exists, false);
});

test("a settings.json that is not JSON is reported, not guessed at", () => {
  const { env, cfg, project } = sandbox(null);
  fs.writeFileSync(path.join(cfg, "settings.json"), "{ not json");
  const s = readState({ env, project });
  assert.equal(s.settings.invalid, true);
  assert.equal(s.tools.guardrails.installed, false);
});
