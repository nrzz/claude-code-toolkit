#!/usr/bin/env node
// End-to-end test of the whole toolkit, as a new user would meet it: every tool is fetched from
// GitHub with npx (or git clone), installed into ONE fresh Claude Code config folder next to
// settings a user already had, and every hook is run exactly as settings.json says, with the JSON
// Claude Code sends. Then each tool is uninstalled and the settings must be back to the start.
//
//   node e2e/run.mjs            everything (needs network and git)
//   node e2e/run.mjs --local    use the sibling checkouts in ../ instead of GitHub
//   node e2e/run.mjs --only glow,guardrails
//
// Nothing outside a temporary folder is read or written: HOME, USERPROFILE and CLAUDE_CONFIG_DIR
// point into it, and git runs with an empty global config.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const LOCAL = args.includes("--local");
const only = (args[args.indexOf("--only") + 1] || "").split(",").filter(Boolean);
const want = (name) => !only.length || only.includes(name);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIBLINGS = path.resolve(HERE, "..", "..");

// ---- a sandbox that looks like a new user's machine --------------------------------------------
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tk-")));
const home = path.join(base, "h");
const cfg = path.join(home, ".claude");
fs.mkdirSync(cfg, { recursive: true });
const gitcfg = path.join(base, "gitconfig");
fs.writeFileSync(gitcfg, "[user]\n\tname = E2E\n\temail = e2e@example.com\n[init]\n\tdefaultBranch = main\n");
const ENV = {
  ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: cfg, NO_COLOR: "1",
  GIT_CONFIG_GLOBAL: gitcfg, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
  npm_config_yes: "true", npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false",
};
delete ENV.CLAUDE_CODE_SESSION_ID;
delete ENV.CLAUDECODE;

const ORIGINAL = { theme: "dark", env: { MY_VAR: "1" }, permissions: { allow: ["Bash(npm test)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "node", args: ["-e", "0"] }] }] } };
fs.writeFileSync(path.join(cfg, "settings.json"), JSON.stringify(ORIGINAL, null, 2) + "\n");

// ---- running things --------------------------------------------------------------------------
const results = [];
function check(area, what, ok, detail = "") {
  results.push({ area, what, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${area.padEnd(12)} ${what}${detail && !ok ? `\n      ${String(detail).slice(0, 2000)}` : ""}`);
}
function run(cmd, argv, { cwd = base, input, env = {}, shell = false, timeout = 240000 } = {}) {
  const t = Date.now();
  const r = spawnSync(cmd, argv, { cwd, input, env: { ...ENV, ...env }, encoding: "utf8", shell, timeout, windowsHide: true });
  return { code: r.status, out: r.stdout || "", err: `${r.stderr || ""}${r.error ? r.error.message : ""}`, ms: Date.now() - t };
}
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
// On Windows a .cmd shim (npx, an npm-installed claude) needs a shell, so quote one command line.
function runCmd(cmd, argv, opts) {
  if (process.platform !== "win32" || /\.exe$/i.test(cmd)) return run(cmd, argv, opts);
  const quoted = [cmd, ...argv].map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
  return run(quoted, [], { ...opts, shell: true });
}
// A tool's command line: npx from GitHub, or the sibling checkout with --local.
function tool(repo, bin, argv, opts) {
  if (LOCAL) return run(process.execPath, [path.join(SIBLINGS, repo, bin), ...argv], opts);
  return runCmd(NPX, ["-y", `github:nrzz/${repo}`, ...argv], opts);
}
const readSettings = () => JSON.parse(fs.readFileSync(path.join(cfg, "settings.json"), "utf8"));
const git = (argv, cwd) => run("git", argv, { cwd });

// Every hook a settings.json lists for an event, run the way Claude Code runs it.
function runHooks(event, payload, { cwd = base, env = {}, match = () => true } = {}) {
  const outs = [];
  for (const group of readSettings().hooks?.[event] || []) {
    for (const h of group.hooks || []) {
      if (h.type !== "command" || !match(h)) continue;
      const input = JSON.stringify({ session_id: "e2e-session", transcript_path: "", cwd, hook_event_name: event, ...payload });
      const r = Array.isArray(h.args) ? run(h.command, h.args, { cwd, input, env }) : run(h.command, [], { cwd, input, env, shell: true });
      outs.push({ hook: [h.command, ...(h.args || [])].join(" "), ...r });
    }
  }
  return outs;
}
const ours = (name) => (h) => JSON.stringify(h).includes(name);
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// A transcript in Claude Code's format, with usage, for cost-guard and session-replay.
function writeSession(projectDir, id, { prompts = 3, model = "claude-sonnet-5-5", day = new Date() } = {}) {
  const slug = projectDir.replace(/[^a-zA-Z0-9]/g, "-");
  const dir = path.join(cfg, "projects", slug);
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  let parent = null;
  const t0 = new Date(day).getTime() - (prompts * 2 + 5) * 60000; // just finished
  for (let i = 0; i < prompts; i++) {
    const u = `${id.slice(0, 8)}-u-${i}`, a = `${id.slice(0, 8)}-a-${i}`;
    const at = (k) => new Date(t0 + (i * 2 + k) * 60000).toISOString();
    lines.push({ type: "user", uuid: u, parentUuid: parent, sessionId: id, cwd: projectDir, timestamp: at(0), isSidechain: false, message: { role: "user", content: `Step ${i}: please refactor module ${i} <script>alert(1)</script>` } });
    lines.push({ type: "assistant", uuid: a, parentUuid: u, sessionId: id, cwd: projectDir, timestamp: at(1), isSidechain: false, requestId: `req_${id.slice(0, 8)}_${i}`, message: { id: `msg_${i}`, model, role: "assistant", content: [{ type: "text", text: `Done with module ${i}.` }], usage: { input_tokens: 20000, output_tokens: 3000, cache_read_input_tokens: 100000, cache_creation_input_tokens: 10000 } } });
    parent = a;
  }
  lines.push({ type: "custom-title", customTitle: "E2E refactor session", sessionId: id });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

// =================================================================================================
console.log(`toolkit e2e: ${LOCAL ? "local checkouts" : "fetched from GitHub"}; sandbox ${base}\n`);
const project = path.join(base, "web");
fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "web", scripts: { test: "node --test", lint: "node -e 0", build: "node -e 0" } }, null, 2));
git(["init", "-q"], project);

// ---- glow: status line and themes ---------------------------------------------------------------
if (want("glow")) {
  const r = tool("claude-code-glow", "bin/claude-glow.mjs", ["install", "--theme", "dracula"]);
  check("glow", "install from scratch", r.code === 0, r.out + r.err);
  const s = readSettings();
  check("glow", "statusLine set, other settings kept", s.statusLine?.command?.includes("statusline.mjs") && s.theme === "dark" && s.env?.MY_VAR === "1", JSON.stringify(s.statusLine));
  check("glow", "15 UI themes and the live theme written", fs.readdirSync(path.join(cfg, "themes")).filter((f) => f.startsWith("glow")).length >= 15);
  const sample = { model: { display_name: "Opus" }, workspace: { current_dir: project }, cost: { total_cost_usd: 1.2 }, context_window: { context_window_size: 1000000, used_percentage: 62 } };
  const sl = run(s.statusLine.command, [], { cwd: project, input: JSON.stringify(sample), shell: true });
  check("glow", "status line runs from settings.json, two lines with a tip", sl.code === 0 && sl.out.trim().split("\n").length === 2 && /Context 62%/.test(sl.out.replace(/\x1b\[[0-9;]*m/g, "")), sl.out + sl.err);
  const t = tool("claude-code-glow", "bin/claude-glow.mjs", ["theme", "set", "nord"]);
  const live = parse(fs.readFileSync(path.join(cfg, "themes", "glow.json"), "utf8"));
  const nord = parse(fs.readFileSync(path.join(cfg, "themes", "glow-nord.json"), "utf8"));
  check("glow", "theme set makes the live theme Nord's colors", t.code === 0 && live?.name === "Glow (live)" && JSON.stringify(live?.overrides) === JSON.stringify(nord?.overrides), t.out + t.err);
}

// ---- guardrails: PreToolUse ----------------------------------------------------------------------
if (want("guardrails")) {
  const r = tool("claude-code-guardrails", "bin/claude-guardrails.mjs", ["init", "--scope", "user"]);
  check("guardrails", "init (user scope)", r.code === 0, r.out + r.err);
  const pre = (tool_name, tool_input) => runHooks("PreToolUse", { tool_name, tool_input }, { cwd: project, match: ours("guardrails") })[0];
  const deny = pre("Bash", { command: "rm -rf /" });
  check("guardrails", "rm -rf / is denied with a reason", parse(deny?.out)?.hookSpecificOutput?.permissionDecision === "deny", deny?.out + deny?.err);
  const allow = pre("Bash", { command: "npm test" });
  check("guardrails", "npm test passes silently", allow?.code === 0 && allow.out.trim() === "", allow?.out + allow?.err);
  const env = pre("Write", { file_path: path.join(project, ".env"), content: "X=1" });
  check("guardrails", "writing .env is denied", parse(env?.out)?.hookSpecificOutput?.permissionDecision === "deny", env?.out);
  check("guardrails", "a hook call stays under a second", (allow?.ms ?? 9999) < 1000, `${allow?.ms} ms`);
}

// ---- notify: UserPromptSubmit, Stop, Notification ------------------------------------------------
if (want("notify")) {
  const r = tool("claude-code-notify", "bin/claude-notify.mjs", ["init"]);
  check("notify", "init (user scope)", r.code === 0, r.out + r.err);
  const now = Date.now();
  runHooks("UserPromptSubmit", { prompt: "build it", source: "user" }, { cwd: project, match: ours("notify"), env: { CLAUDE_NOTIFY_NOW: String(now) } });
  const quick = runHooks("Stop", { stop_hook_active: false }, { cwd: project, match: ours("notify"), env: { CLAUDE_NOTIFY_NOW: String(now + 5000) } })[0];
  check("notify", "a 5-second turn stays quiet", quick?.code === 0 && quick.out.trim() === "", quick?.out);
  runHooks("UserPromptSubmit", { prompt: "build it", source: "user" }, { cwd: project, match: ours("notify"), env: { CLAUDE_NOTIFY_NOW: String(now + 10000) } });
  const long = runHooks("Stop", { stop_hook_active: false }, { cwd: project, match: ours("notify"), env: { CLAUDE_NOTIFY_NOW: String(now + 70000) } })[0];
  const seq = parse(long?.out)?.terminalSequence || "";
  check("notify", "a 60-second turn sends one OSC 9 notification, nothing for the model", /^\u001b\]9;[^\d]/.test(seq) && Object.keys(parse(long.out)).length === 1, long?.out);
  const perm = runHooks("Notification", { message: "Claude needs your permission to use Bash", notification_type: "permission_prompt" }, { cwd: project, match: ours("notify") })[0];
  check("notify", "a permission prompt pings", /permission/.test(parse(perm?.out)?.terminalSequence || ""), perm?.out);
}

// ---- cost-guard: UserPromptSubmit ----------------------------------------------------------------
if (want("cost-guard")) {
  const r = tool("claude-cost-guard", "bin/claude-cost-guard.mjs", ["init"]);
  check("cost-guard", "init", r.code === 0, r.out + r.err);
  writeSession(project, "cccccccc-1111-4111-8111-111111111111", { prompts: 4 });
  const silent = runHooks("UserPromptSubmit", { prompt: "hi", source: "user" }, { cwd: project, match: ours("cost-guard") })[0];
  check("cost-guard", "no budget: silent", silent?.code === 0 && silent.out.trim() === "", silent?.out + silent?.err);
  const b = tool("claude-cost-guard", "bin/claude-cost-guard.mjs", ["budget", "set", "--daily", "0.2usd", "--mode", "hard"]);
  check("cost-guard", "budget set (0.20 USD, hard)", b.code === 0, b.out + b.err);
  const block = runHooks("UserPromptSubmit", { prompt: "hi", source: "user" }, { cwd: project, match: ours("cost-guard") })[0];
  check("cost-guard", "over budget in hard mode: the prompt is held", parse(block?.out)?.decision === "block", block?.out + block?.err);
  const compact = runHooks("UserPromptSubmit", { prompt: "/compact", source: "user" }, { cwd: project, match: ours("cost-guard") })[0];
  check("cost-guard", "/compact still runs when over budget", parse(compact?.out)?.decision !== "block", compact?.out);
  const today = tool("claude-cost-guard", "bin/claude-cost-guard.mjs", ["today"], { cwd: project });
  check("cost-guard", "today reports the spend", today.code === 0 && /\$/.test(today.out), today.out + today.err);
}

// ---- session-replay --------------------------------------------------------------------------------
if (want("replay")) {
  writeSession(project, "eeeeeeee-2222-4222-8222-222222222222", { prompts: 2 });
  const out = path.join(base, "replay.html");
  const r = tool("claude-session-replay", "bin/claude-replay.mjs", ["export", "eeeeeeee", "--out", out], { cwd: project });
  const html = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  check("replay", "export writes one self-contained page", r.code === 0 && html.includes("Content-Security-Policy") && (html.match(/<script\b/gi) || []).length === 1, r.out + r.err);
  check("replay", "transcript text is escaped", html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !/<script>alert/.test(html));
  const s = tool("claude-session-replay", "bin/claude-replay.mjs", ["search", "refactor", "module"], { cwd: project });
  check("replay", "search finds the session", s.code === 0 && /eeeeeeee/.test(s.out), s.out + s.err);
}

// ---- starter-kits, then md-doctor on what they wrote -----------------------------------------------
if (want("starter") || want("md-doctor")) {
  const k = tool("claude-code-starter-kits", "bin/claude-starter.mjs", [], { cwd: project });
  check("starter", "node kit written", k.code === 0 && fs.existsSync(path.join(project, "CLAUDE.md")) && fs.existsSync(path.join(project, ".claude", "agents", "test-runner.md")), k.out + k.err);
  const again = tool("claude-code-starter-kits", "bin/claude-starter.mjs", [], { cwd: project });
  check("starter", "a second run changes nothing", again.code === 0 && !/created/.test(again.out.split("Files")[1] || ""), again.out);
  const d = tool("claude-md-doctor", "bin/claude-md-doctor.mjs", [project, "--ci", "--budget", "500", "--no-user"], { cwd: project });
  check("md-doctor", "the starter kit's CLAUDE.md passes the doctor in CI mode", d.code === 0, d.out + d.err);
  fs.appendFileSync(path.join(project, "CLAUDE.md"), "\n- Lint with `npm run format`.\n- See `docs/missing.md`.\n");
  const bad = tool("claude-md-doctor", "bin/claude-md-doctor.mjs", [project, "--json", "--no-user"], { cwd: project });
  const ids = (parse(bad.out)?.findings || []).map((f) => f.id);
  check("md-doctor", "finds the stale command and the stale path added on purpose", ids.includes("stale-command") && ids.includes("stale-path"), bad.out.slice(0, 300) + bad.err);
}

// ---- team-sync: two people, one remote ---------------------------------------------------------------
if (want("team-sync")) {
  const remote = path.join(base, "remote.git");
  git(["init", "-q", "--bare", remote], base);
  const alice = path.join(base, "alice"), bob = path.join(base, "bob");
  git(["clone", "-q", remote, alice], base);
  fs.writeFileSync(path.join(alice, "README.md"), "# web\n");
  git(["add", "."], alice); git(["commit", "-q", "-m", "first"], alice); git(["push", "-q", "origin", "HEAD:main"], alice);
  const aliceEnv = { CLAUDE_TEAM_NAME: "Alice", CLAUDE_TEAM_SYNC_INLINE: "1" };
  const i = tool("claude-code-team-sync", "claude-team.mjs", ["init", "--hub", "branch", "--yes"], { cwd: alice, env: aliceEnv });
  check("team-sync", "init creates the hub branch", i.code === 0 && /claude-team-hub/.test(git(["ls-remote", "--heads", remote], base).out), i.out + i.err);
  git(["add", "."], alice); git(["commit", "-q", "-m", "team hub"], alice); git(["push", "-q", "origin", "HEAD:main"], alice);
  writeSession(alice, "aaaaaaaa-3333-4333-8333-333333333333", { prompts: 3 });
  const vend = path.join(alice, ".claude", "team-sync", "claude-team.mjs");
  const sh = run(process.execPath, [vend, "share", "aaaaaaaa"], { cwd: alice, env: aliceEnv });
  check("team-sync", "share publishes a redacted session", sh.code === 0 && /Shared/.test(sh.out), sh.out + sh.err);
  git(["clone", "-q", remote, bob], base);
  const bobEnv = { CLAUDE_TEAM_NAME: "Bob", CLAUDE_TEAM_SYNC_INLINE: "1" };
  const start = run(process.execPath, [path.join(bob, ".claude", "team-sync", "claude-team.mjs"), "hook", "session-start"], { cwd: bob, env: bobEnv, input: JSON.stringify({ session_id: "bob-1", cwd: bob, source: "startup" }) });
  check("team-sync", "Bob's first session gets the digest with Alice's session", /E2E refactor session/.test(parse(start.out)?.hookSpecificOutput?.additionalContext || ""), start.out + start.err);
  const load = run(process.execPath, [path.join(bob, ".claude", "team-sync", "claude-team.mjs"), "show", "--for-context", "refactor"], { cwd: bob, env: bobEnv });
  check("team-sync", "/team-load finds it by topic, within the token budget", load.code === 0 && /<team-session/.test(load.out) && load.out.length < 16000, load.out.slice(0, 200) + load.err);
}

// ---- handover (the first tool of the family) ---------------------------------------------------------
if (want("handover")) {
  const dir = LOCAL ? path.join(SIBLINGS, "claude-code-handover") : path.join(base, "handover");
  if (!LOCAL) git(["clone", "-q", "--depth", "1", "https://github.com/nrzz/claude-code-handover", dir], base);
  const st = run(process.execPath, [path.join(dir, "scripts", "selftest.mjs")], { cwd: dir, timeout: 600000 });
  check("handover", "selftest (synthetic histories) passes", st.code === 0, (st.out + st.err).slice(-400));
}

// ---- the toolkit's plugin marketplace, through Claude Code's own plugin commands ----------------------
// Uses a second config folder, so the plugins do not touch the settings checked below.
if (want("marketplace")) {
  const CLAUDE = process.env.E2E_CLAUDE || "claude";
  const pHome = path.join(base, "p");
  const pEnv = { HOME: pHome, USERPROFILE: pHome, CLAUDE_CONFIG_DIR: path.join(pHome, ".claude") };
  fs.mkdirSync(pEnv.CLAUDE_CONFIG_DIR, { recursive: true });
  const claude = (argv, timeout) => runCmd(CLAUDE, argv, { env: pEnv, timeout });
  const version = claude(["--version"]);
  if (version.code !== 0) console.log("SKIP  marketplace  no Claude Code CLI found (set E2E_CLAUDE to its path)");
  else {
    const hub = path.resolve(HERE, "..");
    const v = claude(["plugin", "validate", hub]);
    check("marketplace", `marketplace.json validates (Claude Code ${version.out.trim().split(" ")[0]})`, v.code === 0 && /Validation passed/.test(v.out + v.err), v.out + v.err);
    const add = claude(["plugin", "marketplace", "add", hub]);
    check("marketplace", "marketplace add", add.code === 0, add.out + add.err);
    const names = JSON.parse(fs.readFileSync(path.join(hub, ".claude-plugin", "marketplace.json"), "utf8")).plugins.map((p) => p.name);
    for (const name of names) {
      const i = claude(["plugin", "install", `${name}@claude-code-toolkit`], 300000);
      check("marketplace", `install ${name} from GitHub`, i.code === 0, i.out + i.err);
    }
    const list = parse(claude(["plugin", "list", "--json"]).out) || [];
    check("marketplace", "every plugin installed and enabled", names.every((n) => list.some((p) => p.id === `${n}@claude-code-toolkit` && p.enabled)), JSON.stringify(list.map((p) => p.id)));
    // The plugins' own hooks, run the way Claude Code runs a plugin's hook: ${CLAUDE_PLUGIN_ROOT}
    // expanded to the installed copy, the event's JSON on stdin.
    const pluginHook = (id, event, payload) => {
      const p = list.find((x) => x.id === id);
      const spec = p && parse(fs.readFileSync(path.join(p.installPath, "hooks", "hooks.json"), "utf8"));
      const h = spec?.hooks?.[event]?.[0]?.hooks?.[0];
      if (!h) return { code: -1, out: "", err: `${id} has no ${event} hook` };
      const dataDir = path.join(pHome, "plugin-data", id.replace(/[^\w-]/g, "-"));
      const expand = (s) => s.replaceAll("${CLAUDE_PLUGIN_ROOT}", p.installPath).replaceAll("${CLAUDE_PLUGIN_DATA}", dataDir);
      const input = JSON.stringify({ session_id: "e2e-plugin", transcript_path: "", cwd: project, hook_event_name: event, ...payload });
      return run(expand(h.command), (h.args || []).map(expand), { cwd: project, input, env: { ...pEnv, CLAUDE_PLUGIN_ROOT: p.installPath, CLAUDE_PLUGIN_DATA: dataDir } });
    };
    const denied = pluginHook("guardrails@claude-code-toolkit", "PreToolUse", { tool_name: "Bash", tool_input: { command: "rm -rf /" } });
    check("marketplace", "the guardrails plugin's own hook denies rm -rf /", parse(denied.out)?.hookSpecificOutput?.permissionDecision === "deny", denied.out + denied.err);
    const allowed = pluginHook("guardrails@claude-code-toolkit", "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm test" } });
    check("marketplace", "the guardrails plugin's own hook passes npm test in silence", allowed.code === 0 && allowed.out.trim() === "", allowed.out + allowed.err);
    const ping = pluginHook("notify@claude-code-toolkit", "Notification", { message: "Claude needs your permission to use Bash", notification_type: "permission_prompt" });
    check("marketplace", "the notify plugin's own hook pings on a permission prompt", /permission/.test(parse(ping.out)?.terminalSequence || ""), ping.out + ping.err);
    const budget = pluginHook("cost-guard@claude-code-toolkit", "UserPromptSubmit", { prompt: "hi", source: "user" });
    check("marketplace", "the cost-guard plugin's own hook runs, silent with no budget", budget.code === 0 && budget.out.trim() === "", budget.out + budget.err);
    let total = 0;
    for (const name of names) {
      const d = claude(["plugin", "details", `${name}@claude-code-toolkit`]);
      const m = /Always-on:\s+~?(\d+)\s*tok/.exec(d.out);
      total += m ? Number(m[1]) : 1000;
    }
    check("marketplace", `all plugins together: about ${total} always-on tokens, by Claude Code's own estimate (limit 150)`, total < 150, String(total));
    const hud = list.find((p) => p.id === "glow-hud@claude-code-toolkit");
    if (hud) {
      const t = claude(["plugin", "test", hud.installPath], 300000);
      const lines = (t.out + t.err).split("\n");
      const failed = lines.flatMap((l, i) => (/\(fail\)/.test(l) ? lines.slice(i, i + 4) : [])).join("\n");
      check("marketplace", "glow-hud's engine tests pass in this Claude Code", t.code === 0 && /\b0 fail/.test(t.out + t.err), failed || (t.out + t.err).slice(-400));
    }
  }
}

// ---- uninstall everything: the settings must be the user's own again ----------------------------------
if (!only.length) {
  for (const [repo, bin, argv] of [
    ["claude-cost-guard", "bin/claude-cost-guard.mjs", ["uninstall"]],
    ["claude-code-notify", "bin/claude-notify.mjs", ["uninstall"]],
    ["claude-code-guardrails", "bin/claude-guardrails.mjs", ["uninstall", "--scope", "user"]],
    ["claude-code-glow", "bin/claude-glow.mjs", ["uninstall"]],
  ]) {
    const r = tool(repo, bin, argv);
    check("uninstall", repo, r.code === 0, r.out + r.err);
  }
  const after = readSettings();
  check("uninstall", "settings.json is back to what the user had", JSON.stringify(after) === JSON.stringify(ORIGINAL), JSON.stringify(after));
}

// ---- report ---------------------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; failed: ${failed.map((f) => `${f.area}: ${f.what}`).join("; ")}` : ""}.`);
if (!args.includes("--keep")) fs.rmSync(base, { recursive: true, force: true });
process.exitCode = failed.length ? 1 : 0;
