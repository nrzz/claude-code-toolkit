// From "what I want" to the steps that get there.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readState } from "../src/state.mjs";
import { plan, removal } from "../src/plan.mjs";
import { sandbox, installedSettings, writeJson } from "./helpers.mjs";

const args = (p) => p.steps.map((s) => [s.tool, ...s.args]);

test("installs in a fixed order, settings tools before project tools, with readable labels", () => {
  const { env, project } = sandbox();
  const s = readState({ env, project });
  const p = plan(s, {
    "starter-kits": { enabled: true, options: { stack: "node" } },
    glow: { enabled: true, options: { theme: "classic" } },
    guardrails: { enabled: true, options: {} },
    notify: { enabled: true, options: { slack: "https://hooks.slack.com/services/T/B/x" } },
  }, { project });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(args(p), [
    ["guardrails", "init", "--preset", "balanced", "--scope", "user"],
    ["notify", "init"],
    ["notify", "set", "desktop", "on"],
    ["notify", "set", "slack.url", "https://hooks.slack.com/services/T/B/x"],
    ["glow", "install", "--theme", "classic", "--icons", "unicode"],
    ["starter-kits", "--dir", project, "node"],
  ]);
  assert.deepEqual(p.steps.map((x) => x.label), ["Install Guardrails", "Install Notify", "Notify: set desktop on", "Notify: set slack.url <URL>", "Install Glow", "Install Starter kit"]);
  assert.equal(p.steps.at(-1).cwd, project, "project tools run in the project");
});

test("installed tools: only what changed runs, switched-off ones are removed, untouched ones stay", () => {
  const { env, cfg, project } = sandbox(null);
  writeJson(path.join(cfg, "settings.json"), installedSettings(cfg));
  const s = readState({ env, project });
  const p = plan(s, {
    guardrails: { enabled: true, options: { preset: "strict" } },
    notify: { enabled: false },
    glow: { enabled: true, options: { theme: "classic", icons: "unicode", uiTheme: true } },
  }, { project });
  assert.deepEqual(args(p), [["guardrails", "preset", "strict", "--scope", "user"], ["notify", "uninstall"]]);
  assert.equal(p.steps[1].label, "Remove Notify");
  assert.deepEqual(args(plan(s, removal(s, ["all"]), { project })), [["guardrails", "uninstall", "--scope", "user"], ["notify", "uninstall"], ["glow", "uninstall"], ["cost-guard", "uninstall"]]);
});

test("uninstall handover removes only what it put in your settings; a switch never removes project files", () => {
  const { env, cfg, project } = sandbox(null);
  writeJson(path.join(cfg, "settings.json"), { hooks: { Stop: [{ hooks: [{ type: "command", command: "node", args: [`${cfg}/claude-code-handover/scripts/context-guard.mjs`.replace(/\\/g, "/")] }] }] } });
  const s = readState({ env, project });
  assert.equal(s.tools.handover.userLevel, true);
  assert.deepEqual(args(plan(s, { handover: { enabled: false } }, { project })), [], "switching it off on the page does nothing");
  assert.deepEqual(args(plan(s, removal(s, ["handover"]), { project })), [["handover", "uninstall"]]);
  assert.deepEqual(args(plan(s, removal(s, ["all"]), { project })), [["handover", "uninstall"]]);
});

test("problems are reported before anything runs", () => {
  const { env, project } = sandbox();
  const s = readState({ env, project });
  const p = plan(s, { guardrails: { enabled: true, options: { preset: "max" } }, "team-sync": { enabled: true, options: { hub: "branch" } } }, { project });
  assert.deepEqual(p.steps, []);
  assert.equal(p.errors.length, 2);
  assert.match(p.errors[1], /no git remote/);
  const nowhere = readState({ env, project: path.join(project, "missing") });
  assert.match(plan(nowhere, { handover: { enabled: true } }).errors[0], /choose a project folder/);
  const home = readState({ env: { ...env }, project: os.homedir() });
  assert.match(plan(home, { "starter-kits": { enabled: true } }).errors[0], /not your home folder/);
});

test("a project tool already set up, or a tool installed as a plugin, is left alone", () => {
  const { env, project } = sandbox({ enabledPlugins: { "nudge@claude-code-toolkit": true } });
  spawnSync("git", ["init", "-q"], { cwd: project });
  writeJson(path.join(project, ".claude", "agents", "test-runner.md"), {});
  const s = readState({ env, project });
  const p = plan(s, { "starter-kits": { enabled: true }, notify: { enabled: true }, handover: { enabled: false } }, { project });
  assert.deepEqual(p.steps, []);
  assert.match(p.notes.join(" "), /plugin/);
});
