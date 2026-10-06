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
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? (args[onlyAt + 1] || "").split(",").filter(Boolean) : [];
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

// ---- chat-ferry ------------------------------------------------------------------------------------
// An Antigravity-style conversation in a folder the tool reads through ANTIGRAVITY_DIR, imported as
// a Claude Code session, then a Claude Code session exported for Cursor. The marketplace section
// below resumes the imported session with Claude Code itself.
let ferrySession = null;
if (want("chat-ferry")) {
  const ag = path.join(base, "antigravity");
  const logs = path.join(ag, "brain", "e2e00000-0000-4000-8000-000000000001", ".system_generated", "logs");
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, "transcript.jsonl"), [
    { step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", created_at: "2026-09-30T10:00:00Z", content: "<USER_REQUEST>\nfix the retry loop in client.go\n</USER_REQUEST>" },
    { step_index: 1, source: "SYSTEM", type: "CONVERSATION_HISTORY", status: "DONE", created_at: "2026-09-30T10:00:01Z" },
    { step_index: 2, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-09-30T10:00:05Z", content: "The loop never backs off; adding exponential backoff with a 30 second cap." },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  const imp = tool("claude-chat-ferry", "bin/claude-chat-ferry.mjs", ["import", "antigravity:latest"], { cwd: project, env: { ANTIGRAVITY_DIR: ag } });
  const id = /claude --resume ([0-9a-f-]{36})/.exec(imp.out)?.[1] || "";
  const sessionFile = id ? path.join(cfg, "projects", project.replace(/[^A-Za-z0-9]/g, "-"), `${id}.jsonl`) : "";
  check("chat-ferry", "import writes a Claude Code session for the project and prints the resume line", imp.code === 0 && !!id && fs.existsSync(sessionFile), imp.out + imp.err);
  const text = sessionFile && fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, "utf8") : "";
  check("chat-ferry", "the session holds the banner, the prompt and the answer", text.includes("[Conversation imported from Antigravity") && text.includes("fix the retry loop in client.go") && text.includes("exponential backoff"), text.slice(0, 300));
  if (text) ferrySession = { id, file: sessionFile };
  const exp = tool("claude-chat-ferry", "bin/claude-chat-ferry.mjs", ["export", `claude:${id.slice(0, 8)}`, "--to", "cursor"], { cwd: project });
  const md = /^Wrote (\S+)/m.exec(exp.out)?.[1] || "";
  const mdFile = md ? path.join(project, md) : "";
  check("chat-ferry", "export writes a Markdown file under .ai-chats for Cursor", exp.code === 0 && md.replace(/\\/g, "/").startsWith(".ai-chats/") && fs.existsSync(mdFile) && fs.readFileSync(mdFile, "utf8").includes("## Assistant"), exp.out + exp.err);
  const list = tool("claude-chat-ferry", "bin/claude-chat-ferry.mjs", ["list", "--from", "claude"], { cwd: project });
  check("chat-ferry", "list shows the imported session", list.code === 0 && list.out.includes(id.slice(0, 8)), list.out + list.err);
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

  // The one-command setup, in a fresh project and config folder of its own.
  const hHome = path.join(base, "hh");
  const hCfg = path.join(hHome, ".claude");
  const hProj = path.join(base, "handover-project");
  fs.mkdirSync(hCfg, { recursive: true });
  fs.mkdirSync(hProj, { recursive: true });
  fs.writeFileSync(path.join(hCfg, "settings.json"), JSON.stringify(ORIGINAL, null, 2) + "\n");
  git(["init", "-q"], hProj);
  const hEnv = { HOME: hHome, USERPROFILE: hHome, CLAUDE_CONFIG_DIR: hCfg, HANDOVER_PROJECTS_DIR: path.join(hCfg, "projects"), HANDOVER_DATA_DIR: path.join(hCfg, "claude-code-handover-data") };
  const ho = (argv) => run(process.execPath, [path.join(dir, "bin", "claude-handover.mjs"), ...argv], { cwd: hProj, env: hEnv, timeout: 300000 });
  const personal = ["CLAUDE.local.md", "HANDOVER.md", "DECISIONS.md", "claude-token-rules.md"];
  const i1 = ho(["init", "--dir", hProj, "--models", "Opus + Sonnet", "--streams", "api, web"]);
  check("handover", "init sets up a project in one command", i1.code === 0 && personal.every((f) => fs.existsSync(path.join(hProj, f))), (i1.out + i1.err).slice(-600));
  const hs = () => JSON.parse(fs.readFileSync(path.join(hCfg, "settings.json"), "utf8"));
  const hHooks = () => JSON.stringify(hs().hooks || {}).replace(/\\\\/g, "/");
  check("handover", "its hooks and skills are installed, the user's own settings kept",
    (hHooks().match(/context-guard\.mjs/g) || []).length === 3 && fs.existsSync(path.join(hCfg, "skills", "handover", "SKILL.md")) && hs().theme === "dark" && hs().env?.MY_VAR === "1", hHooks().slice(0, 300));
  const snapshot = () => personal.map((f) => fs.readFileSync(path.join(hProj, f), "utf8")).join("\u0000") + JSON.stringify(hs());
  const before = snapshot();
  const i2 = ho(["init", "--dir", hProj, "--models", "Opus + Sonnet", "--streams", "api, web"]);
  check("handover", "a second init changes nothing", i2.code === 0 && snapshot() === before && /Nothing to do/.test(i2.out), i2.out.slice(-300));
  const guard = hs().hooks.SessionStart.flatMap((g) => g.hooks).find((h) => JSON.stringify(h).includes("context-guard"));
  const g = run(guard.command, guard.args, { cwd: hProj, env: hEnv, input: JSON.stringify({ session_id: "h1", transcript_path: "", cwd: hProj, hook_event_name: "SessionStart", source: "startup" }) });
  check("handover", "the installed context guard runs as a hook", g.code === 0, g.out + g.err);
  const u = ho(["uninstall"]);
  check("handover", "uninstall takes out its hooks and skills and keeps the project's files",
    u.code === 0 && !hHooks().includes("context-guard") && !fs.existsSync(path.join(hCfg, "skills", "handover", "SKILL.md")) && personal.every((f) => fs.existsSync(path.join(hProj, f))) && hs().env?.MY_VAR === "1", (u.out + u.err).slice(-400));
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
    // Does Claude Code continue the session chat-ferry imported? Claude Code is pointed at a fake
    // API on localhost that records the request and answers with an error: nothing is sent
    // anywhere and no token is spent. It runs in this second config folder, where the plugins
    // are: the main one holds the cost guard in hard mode over its budget, which holds every
    // prompt (that is its job, checked above). The session file is copied over for that.
    if (ferrySession) {
      const http = await import("node:http");
      const { spawn } = await import("node:child_process");
      const copy = path.join(pEnv.CLAUDE_CONFIG_DIR, "projects", path.basename(path.dirname(ferrySession.file)), path.basename(ferrySession.file));
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(ferrySession.file, copy);
      // The project folder holds a .claude/settings.json by now (the starter kit wrote one), and
      // Claude Code 2.1.291 will not run in such a folder until it has been trusted once. The
      // sandbox config says so, the way the interactive dialog would.
      const claudeJson = path.join(pEnv.CLAUDE_CONFIG_DIR, ".claude.json");
      const trust = parse(fs.existsSync(claudeJson) ? fs.readFileSync(claudeJson, "utf8") : "") || {};
      trust.projects = trust.projects || {};
      for (const key of new Set([project, project.replace(/\\/g, "/")])) trust.projects[key] = { ...(trust.projects[key] || {}), hasTrustDialogAccepted: true };
      fs.writeFileSync(claudeJson, JSON.stringify(trust, null, 2) + "\n");
      const seen = [];
      const srv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { seen.push(b); res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "fake api" } })); }); });
      await new Promise((r) => srv.listen(0, "127.0.0.1", r));
      const fakeEnv = { ...ENV, ...pEnv, ANTHROPIC_API_KEY: "sk-ant-api03-bogus", ANTHROPIC_BASE_URL: `http://127.0.0.1:${srv.address().port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1" };
      const argv = ["-p", "--resume", ferrySession.id, "--output-format", "json", "Reply OK. E2E_NEW_PROMPT"];
      const viaShell = process.platform === "win32" && !/\.exe$/i.test(CLAUDE);
      const quoted = [CLAUDE, ...argv].map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
      const child = viaShell ? spawn(quoted, [], { cwd: project, env: fakeEnv, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }) : spawn(CLAUDE, argv, { cwd: project, env: fakeEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let errText = "";
      let outText = "";
      child.stderr.on("data", (d) => (errText += d));
      child.stdout.on("data", (d) => (outText += d));
      await new Promise((r) => { const t = setTimeout(() => { child.kill(); r(); }, 120000); child.on("exit", () => { clearTimeout(t); r(); }); });
      srv.close();
      const body = seen.map((b) => parse(b)).find((j) => j?.messages);
      const sent = JSON.stringify(body?.messages || []);
      check("marketplace", "Claude Code resumes the session chat-ferry imported and sends its turns to the model", !!body && sent.includes("fix the retry loop in client.go") && sent.includes("exponential backoff") && sent.includes("E2E_NEW_PROMPT"), (body ? "" : "no request reached the fake API; ") + `stderr: ${errText.slice(0, 300)} stdout: ${outText.slice(0, 300)}`);
    }
    const ping = pluginHook("nudge@claude-code-toolkit", "Notification", { message: "Claude needs your permission to use Bash", notification_type: "permission_prompt" });
    check("marketplace", "the nudge plugin's (notify's) own hook pings on a permission prompt", /permission/.test(parse(ping.out)?.terminalSequence || ""), ping.out + ping.err);
    const budget = pluginHook("spendcap@claude-code-toolkit", "UserPromptSubmit", { prompt: "hi", source: "user" });
    check("marketplace", "the spendcap plugin's (cost guard's) own hook runs, silent with no budget", budget.code === 0 && budget.out.trim() === "", budget.out + budget.err);
    let total = 0;
    for (const name of names) {
      const d = claude(["plugin", "details", `${name}@claude-code-toolkit`]);
      const m = /Always-on:\s+~?(\d+)\s*tok/.exec(d.out);
      total += m ? Number(m[1]) : 1000;
    }
    check("marketplace", `all plugins together: about ${total} always-on tokens, by Claude Code's own estimate (limit 150)`, total < 150, String(total));
    const hud = list.find((p) => p.id === "glowbar@claude-code-toolkit");
    if (hud) {
      const t = claude(["plugin", "test", hud.installPath], 300000);
      const lines = (t.out + t.err).split("\n");
      const failed = lines.flatMap((l, i) => (/\(fail\)/.test(l) ? lines.slice(i, i + 4) : [])).join("\n");
      check("marketplace", "glowbar's engine tests (the glow HUD) pass in this Claude Code", t.code === 0 && /\b0 fail/.test(t.out + t.err), failed || (t.out + t.err).slice(-400));
    }
  }
}

// ---- the one-command setup: this checkout's installer, fetching the tools as a user's would ----------
// Its own home folder, with the same settings a user already had, so it cannot disturb the checks above.
if (want("setup")) {
  const sHome = path.join(base, "s");
  const sCfg = path.join(sHome, ".claude");
  fs.mkdirSync(sCfg, { recursive: true });
  fs.writeFileSync(path.join(sCfg, "settings.json"), JSON.stringify(ORIGINAL, null, 2) + "\n");
  const sEnv = { HOME: sHome, USERPROFILE: sHome, CLAUDE_CONFIG_DIR: sCfg };
  const KIT = path.join(HERE, "..", "bin", "claude-toolkit.mjs");
  const src = LOCAL ? ["--source", SIBLINGS] : [];
  const kit = (argv) => run(process.execPath, [KIT, ...argv, ...src], { cwd: project, env: sEnv });
  const sSettings = () => JSON.parse(fs.readFileSync(path.join(sCfg, "settings.json"), "utf8"));

  const inst = kit(["install", "recommended,cost-guard", "--preset", "strict", "--theme", "dracula", "--daily", "0.5usd"]);
  check("setup", "install recommended,cost-guard with options, in one command", inst.code === 0 && /Start a new Claude Code session/.test(inst.out), inst.out + inst.err);
  const hooks = JSON.stringify(sSettings().hooks || {}).replace(/\\\\/g, "/");
  check("setup", "every hook and the status line are in settings.json, the user's own keys kept",
    ["claude-code-guardrails/guard.mjs", "/notify/app/notify.mjs", "cost-guard/app/guard.mjs"].every((h) => hooks.includes(h)) && /claude-code-glow/.test(sSettings().statusLine?.command || "") && sSettings().env?.MY_VAR === "1", hooks.slice(0, 300));
  const pre = sSettings().hooks.PreToolUse.flatMap((g) => g.hooks).find((h) => JSON.stringify(h).includes("guardrails"));
  const deny = run(pre.command, pre.args, { cwd: project, env: sEnv, input: JSON.stringify({ session_id: "s", cwd: project, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf /" } }) });
  check("setup", "the guardrails hook it installed denies rm -rf /", parse(deny.out)?.hookSpecificOutput?.permissionDecision === "deny", deny.out + deny.err);
  const st = kit(["status"]);
  check("setup", "status reads the choices back", /Guardrails\s+installed \(preset strict\)/.test(st.out) && /theme dracula/.test(st.out) && /daily 0\.5usd/.test(st.out), st.out);

  // The setup page: started as a user would, then driven through its own API.
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [KIT, "setup", "--web", "--no-open", ...src], { cwd: project, env: { ...ENV, ...sEnv }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let childOut = "";
  child.stdout.on("data", (c) => { childOut += c; });
  child.stderr.on("data", (c) => { childOut += c; });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  const url = await new Promise((resolve) => {
    const started = Date.now();
    const tick = setInterval(() => {
      const m = /http:\/\/127\.0\.0\.1:\d+\/\?t=[\w-]+/.exec(childOut);
      if (m || Date.now() - started > 30000) { clearInterval(tick); resolve(m?.[0]); }
    }, 100);
  });
  check("setup", "the setup page starts on 127.0.0.1 with a one-time key in its link", !!url, childOut);
  if (url) {
    const u = new URL(url);
    const token = u.searchParams.get("t");
    const api = (p, body) => fetch(`${u.origin}${p}`, { method: body ? "POST" : "GET", headers: { "x-toolkit-token": token, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const page = await fetch(url);
    check("setup", "the page loads, with a strict Content-Security-Policy", page.status === 200 && /default-src 'none'/.test(page.headers.get("content-security-policy") || ""));
    check("setup", "the page refuses a request without the key", (await api("/api/state").then(() => fetch(`${u.origin}/api/state`))).status === 403);
    let state = null;
    for (let i = 0; i < 120 && !state?.ready; i++) { state = await (await api("/api/state")).json(); if (!state.ready) await new Promise((r) => setTimeout(r, 500)); }
    // The four installed above; project tools depend on what earlier sections left in the project.
    const userInstalled = (state?.tools || []).filter((t) => t.scope === "user" && t.installed).map((t) => t.id);
    check("setup", "it fetched all ten tools and sees what is installed", state?.ready && state.failed.length === 0 && userInstalled.length === 4 && state.glowThemes.length >= 15,
      JSON.stringify({ failed: state?.failed, userInstalled, glowThemes: state?.glowThemes?.length }));
    const applied = await (await api("/api/apply", { choices: { glow: { enabled: true, options: { theme: "nord", icons: "unicode", uiTheme: true } }, notify: { enabled: false } } })).text();
    const last = parse(applied.trim().split("\n").pop());
    const glowCfg = parse(fs.readFileSync(path.join(sCfg, "claude-code-glow", "config.json"), "utf8"));
    check("setup", "Apply on the page changes the glow theme and removes notify", last?.ok === true && glowCfg?.theme === "nord" && !JSON.stringify(sSettings().hooks || {}).includes("notify.mjs"), applied.slice(-600));
    await api("/api/quit", {});
  }
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => { child.kill(); r("killed"); }, 15000))]);
  check("setup", "Done stops the page's server", code === 0, `exit ${code}`);

  const un = kit(["uninstall", "all"]);
  check("setup", "uninstall all leaves settings.json exactly as the user had it", un.code === 0 && JSON.stringify(sSettings()) === JSON.stringify(ORIGINAL), JSON.stringify(sSettings()));
  if (!LOCAL) {
    const v = runCmd(NPX, ["-y", "github:nrzz/claude-code-toolkit", "--version"], { env: sEnv });
    check("setup", "npx -y github:nrzz/claude-code-toolkit runs from GitHub", v.code === 0 && /^\d+\.\d+\.\d+/.test(v.out.trim()), v.out + v.err);
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
// A run that checked nothing is not a pass (a wrong --only once made every section skip).
if (!results.length) failed.push({ area: "e2e", what: `no checks ran${only.length ? ` for --only ${only.join(",")}` : ""}` });
const passed = results.filter((r) => r.ok).length;
console.log(results.length
  ? `\n${passed} of ${results.length} checks passed${failed.length ? `; failed: ${failed.map((f) => `${f.area}: ${f.what}`).join("; ")}` : ""}.`
  : `\nNo checks ran${only.length ? ` (--only ${only.join(",")} names no section: glow, guardrails, notify, cost-guard, replay, chat-ferry, starter, md-doctor, team-sync, handover, setup, marketplace)` : ""}.`);
if (!args.includes("--keep")) fs.rmSync(base, { recursive: true, force: true });
process.exitCode = failed.length ? 1 : 0;
