// What is installed and how it is set, read from the Claude Code config folder and the project
// folder. Reading only: nothing here writes, runs a tool or touches the network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { TOOLS } from "./catalog.mjs";

export const configDir = (env = process.env) => (env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), ".claude"));

function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8").replace(/^﻿/, ""); } catch { return { missing: true, data: null }; }
  try { return { data: JSON.parse(text) }; } catch { return { invalid: true, data: null }; }
}

/** cost guard's stored amount ({ unit, amount }) as the text its CLI takes back. */
function amountText(a) {
  if (!a || typeof a.amount !== "number") return "";
  if (a.unit === "usd") return `${a.amount}usd`;
  if (a.amount % 1e6 === 0) return `${a.amount / 1e6}M`;
  if (a.amount % 1e3 === 0) return `${a.amount / 1e3}k`;
  return `${a.amount}`;
}

/** A secret shown as "set (…last 4)", so the page never puts a webhook or token on screen. */
export const mask = (s) => (s ? `set (…${String(s).slice(-4)})` : "");

function projectInfo(dir) {
  const info = { dir, exists: false, isGit: false, hasRemote: false, name: path.basename(dir || "") };
  if (!dir) return info;
  try { info.exists = fs.statSync(dir).isDirectory(); } catch { return info; }
  if (!info.exists) return info;
  const git = (args) => spawnSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true, timeout: 10000 });
  const top = git(["rev-parse", "--show-toplevel"]);
  info.isGit = top.status === 0;
  if (info.isGit) info.hasRemote = git(["remote"]).stdout.trim() !== "";
  info.home = path.resolve(dir) === path.resolve(os.homedir());
  return info;
}

/**
 * Everything the setup page and the planner need to know.
 * `secrets` keeps the real values (for comparing); `tools[id].current` is safe to show.
 */
export function readState({ env = process.env, project = process.cwd() } = {}) {
  const cfg = configDir(env);
  const settingsFile = path.join(cfg, "settings.json");
  const settings = readJson(settingsFile);
  const s = settings.data || {};
  const hooks = JSON.stringify(s.hooks || {}).replace(/\\\\/g, "/");
  const has = (needle) => hooks.includes(needle);
  const enabledPlugins = Object.entries(s.enabledPlugins || {}).filter(([, on]) => on === true).map(([k]) => k.split("@"));
  const proj = projectInfo(project);
  const inProject = (...p) => proj.exists && fs.existsSync(path.join(proj.dir, ...p));

  const glowCfg = readJson(path.join(cfg, "claude-code-glow", "config.json")).data || {};
  const statusCmd = typeof s.statusLine?.command === "string" ? s.statusLine.command.replace(/\\/g, "/") : "";
  const guard = readJson(path.join(cfg, "guardrails.json")).data || {};
  const notify = readJson(path.join(cfg, "notify.json")).data || {};
  const budgets = readJson(path.join(cfg, "cost-guard", "budgets.json")).data || {};
  const g = budgets.global || {};

  const secrets = {
    notify: { slack: notify.slack?.url || "", discord: notify.discord?.url || "", teams: notify.teams?.url || "", ntfy: notify.ntfy?.topic || "" },
  };
  const tools = {
    guardrails: { installed: has("claude-code-guardrails/guard.mjs"), current: { preset: ["strict", "balanced", "relaxed"].includes(guard.preset) ? guard.preset : "balanced" } },
    notify: {
      installed: has("/notify/app/notify.mjs"),
      current: {
        desktop: notify.desktop === true || notify.desktop === "on", minTurnSeconds: Number.isInteger(notify.minTurnSeconds) ? notify.minTurnSeconds : 30,
        quiet: typeof notify.quiet === "string" ? notify.quiet : "", ntfy: mask(secrets.notify.ntfy),
        slack: mask(secrets.notify.slack), discord: mask(secrets.notify.discord), teams: mask(secrets.notify.teams),
      },
    },
    glow: {
      installed: statusCmd.includes("claude-code-glow"),
      current: { theme: glowCfg.theme || "classic", icons: glowCfg.icons || "unicode", uiTheme: glowCfg.uiTheme !== false },
      otherStatusLine: statusCmd !== "" && !statusCmd.includes("claude-code-glow"),
    },
    "cost-guard": { installed: has("cost-guard/app/guard.mjs"), current: { daily: amountText(g.daily), weekly: amountText(g.weekly), mode: g.mode === "hard" ? "hard" : "soft" } },
    handover: {
      installed: inProject("HANDOVER.md"), userLevel: has("claude-code-handover/scripts/context-guard.mjs"),
      current: { models: "Opus + Sonnet", streams: "main" },
    },
    "team-sync": { installed: inProject(".claude", "team-sync.json"), current: { hub: "branch", name: "" } },
    "starter-kits": { installed: inProject(".claude", "agents", "test-runner.md"), current: { stack: "auto", merge: false } },
    "md-doctor": { installed: false, current: {} },
    replay: { installed: false, current: {} },
  };
  for (const t of TOOLS) {
    // A tool's plugin under its name from any marketplace, or under its name until 4 October 2026 from our own
    // marketplaces only (a plugin called notify or glow from elsewhere is somebody else's).
    tools[t.id].plugin = !!t.plugin && enabledPlugins.some(([name, market]) => name === t.plugin
      || (!!t.oldPlugin && name === t.oldPlugin && (market === "claude-code-toolkit" || market === t.repo)));
  }
  return {
    configDir: cfg,
    settings: { file: settingsFile, missing: !!settings.missing, invalid: !!settings.invalid },
    project: proj,
    tools,
    secrets,
  };
}

/**
 * The tools switched on before anyone touches a switch. On a first setup (no toolkit tool in the
 * settings yet) that is the recommended set, unless it would replace something; after that it is
 * exactly what is installed, so a tool someone removed is never offered again by default.
 */
export function defaultChoices(state) {
  const out = {};
  const firstSetup = !TOOLS.some((t) => t.scope === "user" && (state.tools[t.id].installed || state.tools[t.id].plugin));
  for (const t of TOOLS) {
    if (t.scope === "action") continue;
    const st = state.tools[t.id];
    let enabled = st.installed || (firstSetup && t.recommended && !st.plugin);
    if (t.id === "glow" && !st.installed && st.otherStatusLine) enabled = false;
    if (t.scope === "project" && !st.installed) enabled = false;
    out[t.id] = { enabled, options: { ...t.defaults, ...(st.installed ? st.current : {}) } };
  }
  // Saved secrets start empty, which means "keep them": the masked text is for showing only.
  for (const k of ["ntfy", "slack", "discord", "teams"]) out.notify.options[k] = "";
  return out;
}
