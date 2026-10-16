// The nineteen tools: where each lives, what it asks, and the exact command lines that install,
// change and remove it. Every command line is an argument array for the tool's own CLI, never a
// shell string, so nothing a person types can become a command.

export const ORG = "nrzz";

const PRESETS = ["strict", "balanced", "relaxed"];
const ICONS = ["unicode", "nerd", "ascii"];
const STACKS = ["auto", "dotnet", "node", "python", "go", "flutter", "java"];
const MODES = ["soft", "hard"];

export class OptionError extends Error {}
const fail = (tool, msg) => { throw new OptionError(`${tool}: ${msg}`); };

const bool = (v, d) => (v === undefined || v === null || v === "" ? d : v === true || v === "true" || v === "on" || v === "yes" || v === 1);
const text = (v) => (v === undefined || v === null ? "" : String(v).trim());

/** "" keeps what is there, "off" removes it, an https URL sets it. */
function webhook(tool, name, v) {
  const s = text(v);
  if (s === "" || s === "off") return s;
  let u;
  try { u = new URL(s); } catch { fail(tool, `${name} is not a URL`); }
  if (u.protocol !== "https:") fail(tool, `${name} must start with https://`);
  return s;
}

/** Amounts as cost guard reads them: 15usd, $15, 3M or 500k tokens. "" means none. */
function amount(tool, name, v) {
  const s = text(v).replace(/\s+/g, "");
  if (s === "") return "";
  if (/^\$?\d+(\.\d+)?(usd)?$/i.test(s) || /^\d+(\.\d+)?[km]$/i.test(s)) return /^\$/.test(s) ? `${s.slice(1)}usd` : s;
  fail(tool, `${name} "${s}" is not an amount such as 20usd, $20, 3M or 500k`);
}

function oneOf(tool, name, v, list, d) {
  const s = text(v) || d;
  if (!list.includes(s)) fail(tool, `${name} must be one of ${list.join(", ")}`);
  return s;
}

export const TOOLS = [
  {
    id: "guardrails", repo: "claude-code-guardrails", bin: "bin/claude-guardrails.mjs", scope: "user", plugin: "guardrails",
    name: "Guardrails", tokens: "0 per allowed call",
    summary: "Stops rm -rf on root or home, force pushes to protected branches, secrets in commits and .env edits, and asks before resets, publishes and curl | sh.",
    recommended: true,
    defaults: { preset: "balanced" },
    validate(o) { return { preset: oneOf(this.id, "preset", o.preset, PRESETS, "balanced") }; },
    install: (o) => [["init", "--preset", o.preset, "--scope", "user"]],
    change: (o, cur) => (o.preset !== cur.preset ? [["preset", o.preset, "--scope", "user"]] : []),
    uninstall: () => [["uninstall", "--scope", "user"]],
    actions: { status: { label: "Show status", args: () => ["status"] } },
  },
  {
    id: "notify", repo: "claude-code-notify", bin: "bin/claude-notify.mjs", scope: "user", plugin: "nudge", oldPlugin: "notify",
    name: "Notify", tokens: "0",
    summary: "A ping when Claude needs you or finishes: in the terminal, on the desktop, on your phone (ntfy), or in Slack, Discord or Teams. Turns under 30 seconds stay quiet.",
    recommended: true,
    defaults: { desktop: true, ntfy: "", slack: "", discord: "", teams: "", minTurnSeconds: 30, quiet: "" },
    validate(o) {
      const ntfy = text(o.ntfy);
      if (ntfy && ntfy !== "off" && ntfy !== "auto" && !/^[A-Za-z0-9_-]{1,64}$/.test(ntfy)) fail(this.id, "the ntfy topic may use letters, digits, - and _ (or auto)");
      const quiet = text(o.quiet);
      if (quiet && quiet !== "off" && !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(quiet)) fail(this.id, "quiet hours look like 22:00-07:00 (or off)");
      const secs = o.minTurnSeconds === undefined || o.minTurnSeconds === "" ? 30 : Number(o.minTurnSeconds);
      if (!Number.isInteger(secs) || secs < 0 || secs > 3600) fail(this.id, "minTurnSeconds is a whole number from 0 to 3600");
      return {
        desktop: bool(o.desktop, true), ntfy, quiet, minTurnSeconds: secs,
        slack: webhook(this.id, "the Slack URL", o.slack), discord: webhook(this.id, "the Discord URL", o.discord), teams: webhook(this.id, "the Teams URL", o.teams),
      };
    },
    install(o) { return [["init"], ...this.settings(o, {})]; },
    change(o, cur) { return this.settings(o, cur); },
    /** `set` lines for what differs from the current settings; "" keeps a value, "off" removes it. */
    settings(o, cur) {
      const out = [];
      if (o.desktop !== (cur.desktop ?? false)) out.push(["set", "desktop", o.desktop ? "on" : "off"]);
      if (o.minTurnSeconds !== (cur.minTurnSeconds ?? 30)) out.push(["set", "minTurnSeconds", String(o.minTurnSeconds)]);
      const pairs = [["ntfy", "ntfy.topic"], ["slack", "slack.url"], ["discord", "discord.url"], ["teams", "teams.url"], ["quiet", "quiet"]];
      for (const [key, setting] of pairs) {
        if (o[key] === "") continue;
        if (o[key] === "off") { if (cur[key]) out.push(["set", setting, key === "quiet" ? "off" : "default"]); continue; }
        if (key === "ntfy" && o.ntfy === "auto" && cur.ntfy) continue; // keep the topic already made
        if (o[key] !== cur[key]) out.push(["set", setting, o[key]]);
      }
      return out;
    },
    uninstall: () => [["uninstall"]],
    actions: { test: { label: "Send a test notification", args: () => ["test"] }, status: { label: "Show status", args: () => ["status"] } },
  },
  {
    id: "glow", repo: "claude-code-glow", bin: "bin/claude-glow.mjs", scope: "user", plugin: "glowline", oldPlugin: "glow",
    name: "Glow", tokens: "0",
    summary: "14 color themes for the whole interface (plus classic, which keeps Claude's colors), and a status line with a context meter, plan limits, cost and token-saving tips.",
    recommended: true,
    defaults: { theme: "classic", icons: "unicode", uiTheme: true },
    validate(o, ctx = {}) {
      const theme = text(o.theme) || "classic";
      const known = (ctx.glowThemes || []).map((t) => t.slug);
      if (known.length ? !known.includes(theme) : !/^[a-z0-9-]{1,40}$/.test(theme)) fail(this.id, `there is no theme "${theme}"`);
      return { theme, icons: oneOf(this.id, "icons", o.icons, ICONS, "unicode"), uiTheme: bool(o.uiTheme, true) };
    },
    install: (o) => [["install", "--theme", o.theme, "--icons", o.icons, ...(o.uiTheme ? [] : ["--no-ui-theme"])]],
    change: (o, cur) => (o.theme !== cur.theme || o.icons !== cur.icons || o.uiTheme !== cur.uiTheme
      ? [["install", "--theme", o.theme, "--icons", o.icons, ...(o.uiTheme ? [] : ["--no-ui-theme"])]] : []),
    uninstall: () => [["uninstall"]],
    actions: {},
  },
  {
    id: "cost-guard", repo: "claude-cost-guard", bin: "bin/claude-cost-guard.mjs", scope: "user", plugin: "spendcap", oldPlugin: "cost-guard",
    name: "Cost guard", tokens: "0",
    summary: "Daily and weekly budgets counted from your local transcripts, with warnings at 50%, 80% and 100% and an optional hard stop that still lets /compact through.",
    recommended: false,
    defaults: { daily: "", weekly: "", mode: "soft" },
    validate(o) { return { daily: amount(this.id, "the daily budget", o.daily), weekly: amount(this.id, "the weekly budget", o.weekly), mode: oneOf(this.id, "mode", o.mode, MODES, "soft") }; },
    install(o) { return [["init"], ...this.change(o, {})]; },
    change(o, cur) {
      const want = [o.daily, o.weekly, o.daily || o.weekly ? o.mode : ""].join("|");
      const have = [cur.daily || "", cur.weekly || "", cur.daily || cur.weekly ? cur.mode || "soft" : ""].join("|");
      if (want === have) return [];
      if (!o.daily && !o.weekly) return cur.daily || cur.weekly ? [["budget", "clear"]] : [];
      return [["budget", "set", ...(o.daily ? ["--daily", o.daily] : []), ...(o.weekly ? ["--weekly", o.weekly] : []), "--mode", o.mode]];
    },
    uninstall: () => [["uninstall"]],
    actions: { today: { label: "Spend today", args: () => ["today"] }, report: { label: "Last 7 days", args: () => ["report", "--days", "7"] } },
  },
  {
    id: "session-tidy", repo: "claude-session-tidy", bin: "bin/claude-session-tidy.mjs", scope: "user", plugin: "session-tidy",
    name: "Session tidy", tokens: "0: runs outside Claude",
    summary: "Delete, keep and restore your sessions before Claude Code's 30-day cleanup removes them: a trash you can restore from, a keep list that outlives the cleanup, and empty or orphaned sessions found for you. Adds one silent hook that refreshes the sessions you keep.",
    recommended: false,
    defaults: {},
    validate: () => ({}),
    install: () => [["init"]],
    change: () => [],
    uninstall: () => [["uninstall"]],
    actions: { list: { label: "This project's sessions", args: (o, ctx) => ["list", "--project", ctx.project] } },
  },
  {
    id: "handover", repo: "claude-code-handover", bin: "bin/claude-handover.mjs", scope: "project",
    name: "Handover", tokens: "a short file, plus recalled lines",
    summary: "Short sessions that start from a handover file Claude Code loads by itself, a dated decisions log, automatic recall of earlier sessions, and a context guard.",
    recommended: false,
    defaults: { models: "Opus + Sonnet", streams: "main" },
    validate(o) {
      const models = text(o.models) || "Opus + Sonnet";
      if (!/^[A-Za-z0-9 +,.-]{1,60}$/.test(models)) fail(this.id, "list your models like: Opus + Sonnet");
      const streams = text(o.streams) || "main";
      if (!/^[A-Za-z0-9 _,-]{1,80}$/.test(streams)) fail(this.id, "name streams with letters, digits, spaces, - and _, separated by commas");
      return { models, streams };
    },
    install: (o, ctx) => [["init", "--dir", ctx.project, "--models", o.models, "--streams", o.streams]],
    change: () => [],
    uninstall: () => [["uninstall"]],
    actions: { status: { label: "Show status", args: () => ["status"] } },
  },
  {
    id: "team-sync", repo: "claude-code-team-sync", bin: "claude-team.mjs", scope: "project",
    name: "Team sync", tokens: "0 when nothing is new",
    summary: "Share sessions, notes and team context with coworkers through this repository, another git repository or a shared folder, synced in the background.",
    recommended: false,
    defaults: { hub: "branch", name: "" },
    validate(o) {
      if ((o.hubMode === "git" || o.hubMode === "folder") && !text(o.hub)) fail(this.id, o.hubMode === "git" ? "paste the git URL of the hub repository" : "type the full path of the shared folder");
      const hub = text(o.hub) || "branch";
      if (hub !== "branch" && !/^(https:\/\/|git@|ssh:\/\/)\S+$/.test(hub) && !/^([A-Za-z]:[\\/]|\/|\\\\)/.test(hub)) fail(this.id, "the hub is branch, a git URL, or the full path of a shared folder");
      const name = text(o.name);
      if (name && !/^[\p{L}\p{N} ._'-]{1,40}$/u.test(name)) fail(this.id, "your name may use letters, digits, spaces and . _ ' -");
      return { hub, name };
    },
    install: (o) => [["init", "--hub", o.hub, ...(o.name ? ["--name", o.name] : []), "--yes"]],
    change: () => [],
    uninstall: null,
    removeHint: "Team sync is part of the project: delete .claude/team-sync/ and its hooks in .claude/settings.json, then commit.",
    actions: { status: { label: "Show status", args: () => ["status"] }, list: { label: "Shared sessions", args: () => ["list"] } },
  },
  {
    id: "starter-kits", repo: "claude-code-starter-kits", bin: "bin/claude-starter.mjs", scope: "project",
    name: "Starter kit", tokens: "230 to 260 per session",
    summary: "A lean CLAUDE.md, permission rules, /test and /check skills and a Haiku test runner for .NET, Node, Python, Go, Flutter or Java. Never overwrites a file.",
    recommended: false,
    defaults: { stack: "auto", merge: false },
    validate(o) { return { stack: oneOf(this.id, "stack", o.stack, STACKS, "auto"), merge: bool(o.merge, false) }; },
    install: (o, ctx) => [["--dir", ctx.project, ...(o.stack !== "auto" ? [o.stack] : []), ...(o.merge ? ["--merge"] : [])]],
    change: () => [],
    uninstall: null,
    removeHint: "The kit's files are yours once written: edit or delete them like any other project file.",
    actions: { preview: { label: "Preview what it writes", args: (o, ctx) => ["--dir", ctx.project, "--dry-run"] } },
  },
  {
    id: "md-doctor", repo: "claude-md-doctor", bin: "bin/claude-md-doctor.mjs", scope: "action",
    name: "CLAUDE.md doctor", tokens: "0: runs outside Claude",
    summary: "What your CLAUDE.md files cost in every session, what is stale or duplicated, and the fixes that save the most tokens.",
    defaults: {},
    validate: () => ({}),
    actions: { check: { label: "Check this project", args: (o, ctx) => [ctx.project] } },
  },
  {
    id: "replay", repo: "claude-session-replay", bin: "bin/claude-replay.mjs", scope: "action",
    name: "Session replay", tokens: "0: runs outside Claude",
    summary: "Search everything you discussed in past sessions, and export one as a self-contained HTML page or Markdown; --redact replaces secrets first.",
    defaults: {},
    validate: () => ({}),
    actions: { list: { label: "This project's sessions", args: (o, ctx) => ["list", "--project", ctx.project] } },
  },
  {
    id: "chat-ferry", repo: "claude-chat-ferry", bin: "bin/claude-chat-ferry.mjs", scope: "action",
    name: "Chat ferry", tokens: "0: runs outside Claude",
    summary: "Continue a Cursor or Antigravity chat in Claude Code, hand a Claude Code session to them, or turn any chat (Codex CLI, claude.ai and ChatGPT exports too) into Markdown or JSON.",
    defaults: {},
    validate: () => ({}),
    actions: { list: { label: "This project's chats in every tool", args: (o, ctx) => ["list", "--project", ctx.project] } },
  },
  {
    id: "permission-doctor", repo: "claude-permission-doctor", bin: "bin/claude-permission-doctor.mjs", scope: "action",
    name: "Permission doctor", tokens: "0: runs outside Claude",
    summary: "Why a permission prompt appeared: the rule that allowed, asked about or denied each part of a command, or the one rule that would stop it. Finds dead and hidden rules, and proposes rules from the commands that ran without one.",
    defaults: {},
    validate: () => ({}),
    actions: {
      show: { label: "Show this project's rules", args: (o, ctx) => ["show", "--project", ctx.project] },
      lint: { label: "Check the rules", args: (o, ctx) => ["lint", "--project", ctx.project] },
      suggest: { label: "Suggest rules from history", args: (o, ctx) => ["suggest", "--project", ctx.project] },
    },
  },
  {
    id: "hook-bench", repo: "claude-hook-bench", bin: "bin/claude-hook-bench.mjs", scope: "action",
    name: "Hook bench", tokens: "0: runs outside Claude",
    summary: "Runs every hook of this setup with the exact JSON Claude Code sends for its event and reports what each one does: exit code, time, output, whether the output is valid for the event, and whether it blocks, allows or stays silent. Finds the mistakes Claude Code swallows in silence before running anything.",
    defaults: {},
    validate: () => ({}),
    actions: {
      list: { label: "List the hooks and check them", args: (o, ctx) => ["list", "--project", ctx.project] },
      run: { label: "Run every hook", args: (o, ctx) => ["run", "--project", ctx.project] },
    },
  },
  {
    id: "relocate", repo: "claude-relocate", bin: "bin/claude-relocate.mjs", scope: "action",
    name: "Relocate", tokens: "0: runs outside Claude",
    summary: "Moves Claude Code's config folder (settings, sessions, the plugin cache, .claude.json) to another drive or into the XDG folders, writes CLAUDE_CONFIG_DIR into your shell profiles and the Windows user environment, and puts everything back with undo. These buttons only look: the move itself is a command with --yes.",
    defaults: {},
    validate: () => ({}),
    actions: {
      plan: { label: "What is in the config folder, and how big", args: () => ["plan"] },
      status: { label: "Where things are now", args: () => ["status"] },
      verify: { label: "Check a move", args: () => ["verify"] },
    },
  },
  {
    id: "settings-doctor", repo: "claude-settings-doctor", bin: "bin/claude-settings-doctor.mjs", scope: "action",
    name: "Settings doctor", tokens: "0: runs outside Claude",
    summary: "The settings Claude Code merges, with the file each key came from and which file wins, and the mistakes in them: a comment or trailing comma that makes Claude Code ignore the whole file, keys the schema does not know, wrong types, deprecated keys. Keeps a commented settings.jsonc that builds settings.json.",
    defaults: {},
    validate: () => ({}),
    actions: {
      show: { label: "Show the merged settings", args: (o, ctx) => ["show", "--project", ctx.project] },
      lint: { label: "Check the settings files", args: (o, ctx) => ["lint", "--project", ctx.project] },
    },
  },
  {
    id: "automode-doctor", repo: "claude-automode-doctor", bin: "bin/claude-automode-doctor.mjs", scope: "action",
    name: "Auto mode doctor", tokens: "0: runs outside Claude",
    summary: "What Claude Code's auto mode and its classifier decided, read from your transcripts: who made each tool decision (static approval, a rule, the classifier, a hook, you), the commands the classifier refused, and the refusals that were no verdict at all (the service, not your settings). Its lint finds an autoMode list that replaces the built-in rules because \"$defaults\" is missing, and why says whether a command goes to the classifier.",
    defaults: {},
    validate: () => ({}),
    actions: {
      report: { label: "What auto mode decided, in all projects", args: () => ["report"] },
      show: { label: "Show the autoMode and permission settings", args: (o, ctx) => ["show", "--project", ctx.project] },
      lint: { label: "Check the autoMode settings", args: (o, ctx) => ["lint", "--project", ctx.project] },
    },
  },
  {
    id: "mcp-check", repo: "claude-mcp-check", bin: "bin/claude-mcp-check.mjs", scope: "action",
    name: "MCP check", tokens: "0: runs outside Claude",
    summary: "Every MCP server Claude Code would load for the project, from which file, which definition wins, and whether a .mcp.json server is approved, pending or off, with the mistakes that keep one from starting: a command that is not on PATH, a ${VAR} set nowhere, a name in two scopes. Its check command starts each server the way Claude Code would and sizes its tools; toggle turns a .mcp.json server on or off.",
    defaults: {},
    validate: () => ({}),
    actions: {
      show: { label: "Show the MCP servers and where each comes from", args: (o, ctx) => ["show", "--project", ctx.project] },
      lint: { label: "Check the MCP configuration", args: (o, ctx) => ["lint", "--project", ctx.project] },
    },
  },
  {
    id: "sandbox-doctor", repo: "claude-sandbox-doctor", bin: "bin/claude-sandbox-doctor.mjs", scope: "action",
    name: "Sandbox doctor", tokens: "0: runs outside Claude",
    summary: "Whether Claude Code's Bash sandbox can work on this machine (bubblewrap, socat and user namespaces on Linux, seatbelt on macOS; Windows has no Bash sandbox), the merged sandbox settings with the file each came from, and the settings that can never take effect, such as an allowedDomains entry with a scheme. Its why command says whether a command runs inside the sandbox, outside it, or not at all, the way Claude Code decides it.",
    defaults: {},
    validate: () => ({}),
    actions: {
      check: { label: "Can the sandbox work on this machine?", args: () => ["check"] },
      show: { label: "Show the sandbox settings", args: (o, ctx) => ["show", "--project", ctx.project] },
      lint: { label: "Check the sandbox settings", args: (o, ctx) => ["lint", "--project", ctx.project] },
    },
  },
  {
    id: "windows-doctor", repo: "claude-windows-doctor", bin: "bin/claude-windows-doctor.mjs", scope: "action",
    name: "Windows doctor", tokens: "0: runs outside Claude",
    summary: "On Windows: which shell Claude Code's Bash tool will get and why (Git Bash found or not, CLAUDE_CODE_GIT_BASH_PATH, the PowerShell tool), every claude on the machine and which one runs first, and the setup problems behind common Windows issues: long paths, core.autocrlf, the PowerShell execution policy, variables set for one process but not the user. On Linux and macOS it says there is nothing to check.",
    defaults: {},
    validate: () => ({}),
    actions: {
      check: { label: "Check this Windows setup", args: (o, ctx) => ["check", "--project", ctx.project] },
    },
  },
];

export const byId = (id) => TOOLS.find((t) => t.id === id) || null;
export const INSTALLABLE = TOOLS.filter((t) => t.scope !== "action").map((t) => t.id);
